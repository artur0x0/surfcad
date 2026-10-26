/**
 * Joints on the feature strip, the shared sticky-pick card, and the
 * floating tags.
 *
 * The create card is `StickyPickApply`: sticky-pick 1–2 faces, lines, or
 * points, then a suggested property, then Confirm. The viewport and the
 * card share the rich pick list, the same way a contour shares its list,
 * because a joint fingerprint does not fit in the id/kind/label chip.
 * A strip chip reopens that joint in the same card. Delete removes it.
 * X writes nothing.
 *
 * Status is not stored. Undo is an in-memory snapshot of joints and
 * placements. A reload seeds one commit, so Undo starts empty and Redo
 * does not survive it. Scripts are never written here.
 */
import { nextNumberedName, serializeAssembly } from '../utils/assembly.js';
import { matchFaceKeys } from '../utils/faceColorMatch.js';
import { mintSurfId, partSurfId } from '../utils/git/surfId.js';
import { jointRefs, partPlacement } from '../utils/jointSchema.js';
import { worldPoint } from '../utils/partPose.js';
import { commitJointEdit } from './refreshJoints.js';
import { rotateByQuat } from './rigid.js';

export const SAME_PART_MESSAGE = 'A joint needs two parts';
export const NO_SURF_ID_MESSAGE = 'This part has no surf id';

export const JOINT_TYPE_LABEL = Object.freeze({
  coincident: 'Coincident',
  concentric: 'Concentric',
  distance: 'Distance',
  angle: 'Angle',
  symmetric: 'Symmetric',
  fixed: 'Fixed',
  parallel: 'Parallel',
});

/** The shared pick-and-apply steps. `component` records which UI shipped. */
export const STICKY_PICK_CONTRACT = Object.freeze({
  component: 'StickyPickApply',
  picks: Object.freeze([1, 2]),
  kinds: Object.freeze(['face', 'edge', 'point', 'plane']),
  then: 'suggested property',
  confirm: 'Confirm',
});

export function jointsChromeMounted({ appMode = 'cad', featureSession = false } = {}) {
  return appMode !== 'game' && !featureSession;
}

/** Strip Undo walks joints only while no part is selected. */
export function stripUndoTarget(cadPartId) {
  return cadPartId == null ? 'joint' : 'part';
}

export function stripUndoLabel(cadPartId) {
  return stripUndoTarget(cadPartId) === 'joint' ? 'Undo joint' : 'Undo';
}

export function stripRedoLabel(cadPartId) {
  return stripUndoTarget(cadPartId) === 'joint' ? 'Redo joint' : 'Redo';
}

/**
 * An empty click keeps the CAD part. Users tap empty space while rotating,
 * so the last selected part stays until another part is tapped or the
 * assembly chip in the viewer title is tapped. The geometric selection
 * still clears. The editor's active part stays.
 */
export function emptyClickCadSelection({
  cadPartId = null,
  activeId = null,
  featureSession = false,
} = {}) {
  return { cadPartId, activeId, cleared: !featureSession };
}

/**
 * A face, edge, or point tap arms a joint only while the create card is
 * open. The Blocks button opens that card. With the card closed, the tap
 * selects the part. A body tap, a feature session, and game mode stay on
 * the normal selection path.
 */
export function shouldArmJointPick({
  featureSession = false,
  appMode = 'cad',
  kind = 'face',
  jointPicking = false,
} = {}) {
  if (!jointPicking) return false;
  if (appMode === 'game' || featureSession) return false;
  if (kind === 'body') return false;
  return kind === 'face' || kind === 'edge' || kind === 'point' || kind === 'plane';
}

/** Parallel planar faces farther apart than this suggest distance, not coincident. */
export const DISTANCE_SUGGEST_MM = 5;

function roundPick(pick) {
  if (!pick) return false;
  if (pick.kind === 'axis' || pick.axis === true) return true;
  if (pick.kind === 'edge' && Number(pick.key?.radius) > 0) return true;
  return false;
}

function unitNormal(pick) {
  const n = pick?.key?.n;
  if (!Array.isArray(n) || n.length < 3) return null;
  const len = Math.hypot(Number(n[0]) || 0, Number(n[1]) || 0, Number(n[2]) || 0);
  if (len < 1e-9) return null;
  return [n[0] / len, n[1] / len, n[2] / len];
}

function parallelPlanar(picks) {
  const na = unitNormal(picks[0]);
  const nb = unitNormal(picks[1]);
  if (!na || !nb) return false;
  const dot = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
  return Math.abs(Math.abs(dot) - 1) <= 1e-3;
}

/** Separation of the two face centers along the first normal, in millimetres. */
export function planarGapMm(picks) {
  const list = Array.isArray(picks) ? picks : [];
  const n = unitNormal(list[0]);
  const at = list[0]?.key?.at;
  const bt = list[1]?.key?.at;
  if (!n || !Array.isArray(at) || !Array.isArray(bt)) return 0;
  return Math.abs(
    ((Number(bt[0]) || 0) - (Number(at[0]) || 0)) * n[0]
    + ((Number(bt[1]) || 0) - (Number(at[1]) || 0)) * n[1]
    + ((Number(bt[2]) || 0) - (Number(at[2]) || 0)) * n[2],
  );
}

function planePick(pick) {
  return pick?.kind === 'plane';
}

/** A planar face, or a plane. Both carry a point and a normal. */
function planarFace(pick) {
  if (!pick || pick.axis) return false;
  if (planePick(pick)) return true;
  return pick.kind === 'face' && pick.planar !== false;
}

/** Picks in first-seen part order. Later taps on a part stay in that group. */
export function groupPicksByPart(picks) {
  const groups = [];
  for (const pick of Array.isArray(picks) ? picks : []) {
    if (!pick?.surfId) continue;
    let group = groups.find((row) => row.surfId === pick.surfId);
    if (!group) {
      group = { surfId: pick.surfId, partName: pick.partName || 'Part', picks: [] };
      groups.push(group);
    }
    group.picks.push(pick);
  }
  return groups;
}

function orderedPicks(picks) {
  return groupPicksByPart(picks).flatMap((group) => group.picks);
}

function pairOf(picks) {
  const groups = groupPicksByPart(picks);
  if (groups.length !== 2 || groups.some((group) => group.picks.length !== 1)) return null;
  return [groups[0].picks[0], groups[1].picks[0]];
}

/** One planar face on each of two parts. Parallel and Perpendicular use this. */
export function planarAnglePair(picks) {
  const pair = pairOf(picks);
  if (!pair || !pair.every(planarFace)) return null;
  return pair;
}

export function jointPickCap(picks) {
  const groups = groupPicksByPart(picks);
  if (groups.some((group) => group.picks.length > 1)) return 4;
  return 2;
}

/**
 * Highlight key. Two faces on one part stay distinct. Two origin planes
 * share a point, so a plane id keeps them apart.
 */
export function jointHighlightSlot(partId, at, planeId = '') {
  const id = String(partId || '');
  if (planeId) return `${id}#${planeId}`;
  if (!Array.isArray(at) || at.length < 3) return id;
  const q = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  return `${id}@${q(at[0])},${q(at[1])},${q(at[2])}`;
}

export function jointPickSlot(pick) {
  return jointHighlightSlot(
    pick?.partId || pick?.surfId,
    pick?.key?.at,
    pick?.kind === 'plane' ? (pick?.key?.id || '') : '',
  );
}

export function typeFits(type, picks) {
  const list = orderedPicks(picks);
  const groups = groupPicksByPart(list);
  if (type === 'fixed') return list.length === 1 && !!list[0]?.surfId;
  if (type === 'symmetric') {
    return groups.length === 2
      && groups.every((group) => group.picks.length === 2 && group.picks.every(planarFace));
  }
  const pair = pairOf(list);
  if (!pair) return false;
  if (!pair[0]?.surfId || !pair[1]?.surfId || pair[0].surfId === pair[1].surfId) return false;
  if (type === 'coincident' || type === 'distance') return planarFace(pair[0]) && planarFace(pair[1]);
  if (type === 'concentric') return roundPick(pair[0]) && roundPick(pair[1]);
  if (type === 'angle') {
    return pair.every((pick) => (
      pick.kind === 'face' || pick.kind === 'edge' || pick.kind === 'axis' || pick.kind === 'plane'
    ));
  }
  return false;
}

/**
 * Two faces on each part suggest symmetric. One reference on each part
 * keeps the older rules: concentric, then distance, then coincident.
 * Never fixed. The type buttons can still override this.
 */
export function suggestJointType(picks) {
  const list = orderedPicks(picks);
  if (list.length === 1 && list[0]?.kind === 'part') return 'fixed';
  if (typeFits('symmetric', picks)) return 'symmetric';
  if (typeFits('concentric', picks)) return 'concentric';
  const pair = pairOf(picks);
  if (pair && pair.some(planePick) && typeFits('coincident', picks)) {
    if (parallelPlanar(pair) && planarGapMm(pair) > DISTANCE_SUGGEST_MM) return 'parallel';
    return 'coincident';
  }
  if (
    typeFits('distance', picks)
    && pair
    && parallelPlanar(pair)
    && planarGapMm(pair) > DISTANCE_SUGGEST_MM
  ) {
    return 'distance';
  }
  if (typeFits('coincident', picks)) return 'coincident';
  return null;
}

function samePick(a, b) {
  if (!a || !b || a.surfId !== b.surfId) return false;
  if (a.kind === 'plane' || b.kind === 'plane') {
    return a.kind === 'plane' && b.kind === 'plane' && !!a.key?.id && a.key.id === b.key?.id;
  }
  const aa = a.key?.at;
  const bb = b.key?.at;
  if (!Array.isArray(aa) || !Array.isArray(bb)) return false;
  const dx = (Number(aa[0]) || 0) - (Number(bb[0]) || 0);
  const dy = (Number(aa[1]) || 0) - (Number(bb[1]) || 0);
  const dz = (Number(aa[2]) || 0) - (Number(bb[2]) || 0);
  return Math.hypot(dx, dy, dz) < 0.05;
}

/**
 * Picks stay grouped by part, in any tap order. A third part does not
 * join the list: the card asks which part to replace.
 */
export function acceptJointPick(existing, pick) {
  const prior = orderedPicks(existing);
  if (!pick || !pick.surfId) {
    return {
      picks: prior,
      open: prior.length > 0,
      refuse: true,
      message: NO_SURF_ID_MESSAGE,
      choice: null,
    };
  }
  const replaced = prior.map((row) => (samePick(row, pick) ? pick : row));
  if (replaced.some((row, index) => row !== prior[index])) {
    return { picks: orderedPicks(replaced), open: true, refuse: false, message: null, choice: null };
  }
  const groups = groupPicksByPart(prior);
  const known = groups.find((group) => group.surfId === pick.surfId);
  if (!known && groups.length >= 2) {
    return {
      picks: prior,
      open: true,
      refuse: false,
      message: null,
      choice: { pick, part1: groups[0].partName, part2: groups[1].partName },
    };
  }
  if (known && known.picks.length >= 2) {
    const next = prior.slice();
    let last = -1;
    for (let i = 0; i < next.length; i += 1) {
      if (next[i].surfId === pick.surfId) last = i;
    }
    if (last >= 0) next[last] = pick;
    return { picks: orderedPicks(next), open: true, refuse: false, message: null, choice: null };
  }
  return {
    picks: orderedPicks([...prior, pick]),
    open: true,
    refuse: false,
    message: null,
    choice: null,
  };
}

/** Discard the third-part tap, or let it take the place of part 1 or part 2. */
export function resolvePartChange(picks, pending, action) {
  const prior = orderedPicks(picks);
  const groups = groupPicksByPart(prior);
  if (!pending || action === 'discard' || groups.length < 2) return prior;
  if (action === 'replace-1') {
    const kept = prior.filter((row) => row.surfId !== groups[0].surfId);
    return orderedPicks([pending, ...kept]);
  }
  if (action === 'replace-2') {
    const kept = prior.filter((row) => row.surfId !== groups[1].surfId);
    return orderedPicks([...kept, pending]);
  }
  return prior;
}

function worldNormal(pick, doc) {
  const n = unitNormal(pick);
  if (!n) return null;
  const part = (doc?.parts || []).find((row) => partSurfId(row) === pick.surfId);
  return rotateByQuat(partPlacement(part).q, n);
}

/**
 * Angle joint at 0° (parallel) or 90° (perpendicular), ready to write.
 * Parallel sense follows the normals so the parts are not flipped over.
 */
export function quickAngleCard(card, degrees, doc) {
  const pair = planarAnglePair(card?.picks);
  if (!pair || (degrees !== 0 && degrees !== 90)) return null;
  let sense = 1;
  if (degrees === 0) {
    const a = worldNormal(pair[0], doc);
    const b = worldNormal(pair[1], doc);
    if (a && b) {
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      sense = dot < 0 ? -1 : 1;
    }
  }
  const joints = doc?.joints || [];
  return {
    ...card,
    picks: pair,
    type: 'angle',
    userPickedType: true,
    valueMm: degrees,
    sense,
    name: card?.userNamed ? card.name : nextJointName('angle', joints),
    partChange: null,
  };
}

function kindWord(pick) {
  if (!pick) return '';
  if (pick.kind === 'part') return 'part';
  if (pick.kind === 'edge') return 'line';
  if (pick.kind === 'axis') return 'axis';
  if (pick.kind === 'point') return 'point';
  if (pick.kind === 'plane') return 'plane';
  return 'face';
}

/** Chip shown on StickyPickApply. The rich fingerprint stays on the pick. */
export function stickyJointPick(pick, index = 0) {
  const kind = pick?.kind || 'face';
  const word = kind === 'edge' ? 'line' : kind;
  const id = pick?.stickyId || `${pick?.surfId || 'part'}:${index}`;
  return {
    id: String(id),
    kind: String(kind),
    label: `${pick?.partName || 'Part'} · ${word}`,
  };
}

/** World point a floating tag sits on. Two references use their midpoint. */
export function jointTagAnchor(doc, joint) {
  const atOf = (ref) => {
    if (!ref?.part) return null;
    const part = (doc?.parts || []).find((row) => partSurfId(row) === ref.part);
    if (!part) return null;
    const local = ref.key?.at || [0, 0, 0];
    return worldPoint(local, partPlacement(part));
  };
  const a = atOf(joint?.a);
  const b = atOf(joint?.b);
  if (a && b) return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return a || b || [0, 0, 0];
}

export function jointSubtitle(picks) {
  const groups = groupPicksByPart(picks);
  if (!groups.length) return '';
  const side = (group) => {
    const words = group.picks.map(kindWord);
    const word = words.every((item) => item === words[0]) ? words[0] : 'pick';
    const count = group.picks.length > 1 ? ` ×${group.picks.length}` : '';
    return `${group.partName || 'Part'} · ${word}${count}`;
  };
  if (groups.length === 1) return side(groups[0]);
  return `${side(groups[0])}  →  ${side(groups[1])}`;
}

/**
 * `Coincident 1`. nextNumberedName allocates `Coincident (1)`; the card
 * shows that same slot without the parentheses.
 */
export function nextJointName(type, joints) {
  const label = JOINT_TYPE_LABEL[type] || 'Joint';
  const taken = [];
  for (const joint of joints || []) {
    const name = String(joint?.name || '');
    taken.push(name.replace(/ (\d+)$/, ' ($1)'));
  }
  const allocated = nextNumberedName(label, taken);
  return allocated.replace(/ \((\d+)\)$/, ' $1');
}

export function mintJointIdentity(type, joints, mint = mintSurfId) {
  return { id: mint(), name: nextJointName(type, joints) };
}

function storedKind(pick, type) {
  if (pick.kind === 'plane') return 'plane';
  if (type === 'concentric' || pick.kind === 'axis' || pick.axis) return 'axis';
  if (pick.kind === 'edge') return 'edge';
  return 'face';
}

/**
 * The reference a fixed joint stores: the part, plus the face, edge, or
 * axis that was tapped when there was one, so the chip reopens on that
 * pick. A whole-part pick stores the part alone. The solver and refresh
 * read only the part.
 */
function fixedReference(pick) {
  const out = { part: pick.surfId };
  if (pick.kind !== 'part' && pick.key) {
    out.kind = storedKind(pick, 'fixed');
    out.key = pick.key;
  }
  return out;
}

export function buildJointRecord(card, identity) {
  const picks = orderedPicks(card?.picks || []);
  const type = card?.type;
  if (type !== 'fixed' && groupPicksByPart(picks).length < 2) {
    return { ok: false, message: SAME_PART_MESSAGE };
  }
  if (!typeFits(type, picks)) {
    return { ok: false, message: 'That joint does not fit these references' };
  }
  if (picks.some((pick) => !pick.surfId)) {
    return { ok: false, message: NO_SURF_ID_MESSAGE };
  }
  const name = String(card?.name || identity?.name || '').trim();
  const id = card?.id || identity?.id;
  if (!id || !name) return { ok: false, message: 'Name the joint' };
  const joint = { id, name, type };
  if (type === 'distance' || type === 'angle') {
    const value = Number(card.valueMm);
    if (!Number.isFinite(value)) return { ok: false, message: 'Enter a value' };
    joint.value = value;
    joint.sense = card.sense === -1 ? -1 : 1;
  }
  if (type === 'coincident') joint.opposed = card.opposed !== false;
  if (type === 'fixed') {
    joint.a = fixedReference(picks[0]);
    return { ok: true, joint };
  }
  const groups = groupPicksByPart(picks);
  const refOf = (pick) => ({
    part: pick.surfId,
    kind: storedKind(pick, type),
    key: pick.key,
  });
  if (type === 'symmetric') {
    joint.a = refOf(groups[0].picks[0]);
    joint.a2 = refOf(groups[0].picks[1]);
    joint.b = refOf(groups[1].picks[0]);
    joint.b2 = refOf(groups[1].picks[1]);
    return { ok: true, joint };
  }
  joint.a = refOf(groups[0].picks[0]);
  joint.b = refOf(groups[1].picks[0]);
  return { ok: true, joint };
}

export function jointConfirmDisabled({ card, locked = false } = {}) {
  if (!card || locked || card.partChange) return true;
  if (!typeFits(card.type, card.picks)) return true;
  if (card.type === 'distance' || card.type === 'angle') {
    if (!Number.isFinite(Number(card.valueMm))) return true;
  }
  return false;
}

export function draftFromPicks(previous, picks, { joints = [] } = {}) {
  const suggested = suggestJointType(picks);
  const parallel = suggested === 'parallel';
  const suggestedType = parallel ? 'angle' : suggested;
  const keepType = previous?.userPickedType && typeFits(previous.type, picks);
  const type = keepType ? previous.type : suggestedType;
  const identity = previous?.id
    ? { id: previous.id, name: previous.name }
    : (type ? mintJointIdentity(type, joints) : { id: null, name: '' });
  return {
    mode: 'create',
    id: identity.id,
    name: previous?.userNamed ? previous.name : (type ? nextJointName(type, joints) : (previous?.name || '')),
    picks,
    type,
    suggested,
    userPickedType: !!keepType,
    userNamed: !!previous?.userNamed,
    valueMm: (!keepType && parallel)
      ? 0
      : (Number.isFinite(Number(previous?.valueMm))
        ? Number(previous.valueMm)
        : (type === 'distance' ? planarGapMm(picks) : previous?.valueMm)),
    sense: previous?.sense === -1 ? -1 : 1,
    opposed: previous?.opposed !== false,
    note: previous?.note || '',
  };
}

export function cardFromJoint(joint, doc, message = '') {
  const partOf = (surfId) => (doc?.parts || []).find((part) => partSurfId(part) === surfId);
  const pickOf = (ref) => {
    if (!ref) return null;
    const part = partOf(ref.part);
    // A fixed joint with no stored geometry is a whole-part pick.
    const kind = ref.kind || (joint.type === 'fixed' ? 'part' : 'face');
    return {
      surfId: ref.part,
      partId: part?.id || null,
      partName: part?.name || ref.part,
      kind,
      planar: kind !== 'axis' && kind !== 'edge' && kind !== 'part',
      axis: kind === 'axis',
      key: ref.key ?? null,
    };
  };
  const refs = joint.type === 'symmetric'
    ? [joint.a, joint.a2, joint.b, joint.b2]
    : [joint.a, joint.b];
  const picks = refs.map(pickOf).filter(Boolean);
  return {
    mode: 'edit',
    id: joint.id,
    name: joint.name,
    picks,
    type: joint.type,
    suggested: null,
    userPickedType: true,
    userNamed: true,
    valueMm: joint.value,
    sense: joint.sense === -1 ? -1 : 1,
    opposed: joint.opposed !== false,
    note: message || '',
  };
}

/**
 * Face triangles to paint when a chip reopens a joint. Axes and edges
 * have no face patch. A miss leaves that pick unhighlighted.
 */
export function jointHighlightEntries(card, doc, catalogs) {
  const parts = doc?.parts || [];
  const out = [];
  for (const pick of card?.picks || []) {
    if (!pick?.key || pick.kind === 'axis' || pick.kind === 'edge' || pick.kind === 'plane') continue;
    const part = parts.find((row) => partSurfId(row) === pick.surfId);
    const faces = catalogs?.[pick.surfId]?.faces;
    if (!part || !Array.isArray(faces)) continue;
    const hit = matchFaceKeys(faces, [{ key: pick.key }]);
    const tris = hit.matched[0]?.face?.tris;
    if (!tris?.length) continue;
    out.push({ partId: part.id, tris, at: pick.key.at });
  }
  return out;
}

export function jointChipTitle(joint, status, message) {
  const name = joint?.name || 'Joint';
  if ((status === 'broken' || status === 'conflict') && message) return `${name} — ${message}`;
  return name;
}

export function jointChips(doc, live = {}) {
  return (doc?.joints || []).map((joint) => {
    const status = live.statuses?.[joint.id] || 'ok';
    const message = live.messages?.[joint.id] || (status === 'conflict' ? live.conflict : '');
    return {
      id: joint.id,
      name: joint.name,
      type: joint.type,
      status,
      title: jointChipTitle(joint, status, message),
      invalid: status === 'broken' || status === 'conflict',
      value: joint.value,
      sense: joint.sense,
    };
  });
}

/** Surf ids of the parts a joint names, in reference order, without repeats. */
export function jointPartSurfIds(joint) {
  const out = [];
  for (const ref of jointRefs(joint)) {
    const id = ref?.part;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function partNameOf(doc, surfId) {
  const part = (doc?.parts || []).find((row) => partSurfId(row) === surfId);
  return part?.name || 'Part';
}

/**
 * Joints-row chip text. From a part: `Type · Other part`, and `Fixed` for a
 * ground joint. From the assembly: `Type · A ↔ B`, and `Fixed · A`. Values
 * never show on a chip; the card shows them.
 */
export function jointChipLabel(joint, doc, viewSurfId = null) {
  const type = JOINT_TYPE_LABEL[joint?.type] || 'Joint';
  const parts = jointPartSurfIds(joint);
  const others = viewSurfId ? parts.filter((id) => id !== viewSurfId) : parts;
  const names = others.map((id) => partNameOf(doc, id));
  if (joint?.type === 'fixed') {
    return viewSurfId && !others.length ? 'Fixed' : `Fixed · ${names.join(' ↔ ') || 'Part'}`;
  }
  if (!names.length) return type;
  return `${type} · ${names.join(' ↔ ')}`;
}

/**
 * Chips for the joints row. With `surfId`, only joints that name that part
 * (scope `part`); without it, every joint (scope `assembly`). `shortLabel`
 * is the phone text: the other part alone, or `Fixed`.
 */
export function jointRowChips(doc, live = {}, { surfId = null } = {}) {
  const byId = new Map((doc?.joints || []).map((joint) => [joint.id, joint]));
  return jointChips(doc, live)
    .filter((row) => !surfId || jointPartSurfIds(byId.get(row.id)).includes(surfId))
    .map((row) => {
      const joint = byId.get(row.id);
      const parts = jointPartSurfIds(joint);
      const others = surfId ? parts.filter((id) => id !== surfId) : parts;
      const label = jointChipLabel(joint, doc, surfId);
      const shortLabel = joint?.type === 'fixed'
        ? 'Fixed'
        : (others.length ? others.map((id) => partNameOf(doc, id)).join(' ↔ ') : label);
      return { ...row, label, shortLabel, parts };
    });
}

/** X and Esc write nothing. The document is returned as the same object. */
export function dismissJointEdit(doc) {
  return doc;
}

export function applyJointCard({
  doc,
  scripts = null,
  card,
  action = 'confirm',
  locked = false,
  preempt = null,
  catalogs = null,
  joints = null,
} = {}) {
  if (action === 'delete') {
    return commitJointEdit({
      doc,
      scripts,
      action: 'delete',
      joint: { id: card?.id },
      locked,
      preempt,
      catalogs,
    });
  }
  if (locked) {
    return commitJointEdit({
      doc,
      scripts,
      action: 'confirm',
      joint: null,
      locked: true,
      preempt,
      catalogs,
    });
  }
  const identity = card?.id
    ? { id: card.id, name: card.name }
    : mintJointIdentity(card?.type, joints || doc?.joints || []);
  const built = buildJointRecord({ ...card, id: card?.id || identity.id, name: card?.name || identity.name }, identity);
  if (!built.ok) {
    return { ok: false, locked: false, doc, scripts, message: built.message, preempted: false };
  }
  const result = commitJointEdit({
    doc,
    scripts,
    action: 'confirm',
    joint: built.joint,
    locked: false,
    preempt,
    catalogs,
  });
  const status = result.statuses?.[built.joint.id];
  if (result.ok && (status === 'broken' || status === 'conflict')) {
    const candidates = result.candidates?.[built.joint.id];
    return {
      ok: false,
      locked: false,
      doc,
      scripts,
      message: result.messages?.[built.joint.id] || result.message || 'That joint does not fit these references',
      statuses: result.statuses,
      ...(candidates ? { candidates } : {}),
      preempted: false,
    };
  }
  return result;
}

function snapshotOf(doc) {
  const placements = {};
  for (const part of doc?.parts || []) {
    const sid = partSurfId(part);
    if (!sid) continue;
    const pose = partPlacement(part);
    placements[sid] = { t: pose.t.slice(), q: pose.q.slice() };
  }
  return {
    joints: JSON.parse(JSON.stringify(doc?.joints || [])),
    placements,
  };
}

/** One commit at the file's current joints and placements. Undo starts empty. */
export function seedAssemblyHistory(doc) {
  return { commits: [snapshotOf(doc)], head: 0 };
}

export function assemblyHistoryCanUndo(history) {
  return !!history && history.head > 0;
}

export function assemblyHistoryCanRedo(history) {
  return !!history && history.head < (history.commits?.length || 0) - 1;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** True when two documents have the same joints and placements. */
export function assemblySnapshotsEqual(beforeDoc, afterDoc) {
  return canonicalJson(snapshotOf(beforeDoc)) === canonicalJson(snapshotOf(afterDoc));
}

function partIdSet(doc) {
  return (doc?.parts || []).map((part) => partSurfId(part) || '').filter(Boolean).sort().join('\0');
}

function movedSurfIds(beforeSnap, afterSnap) {
  const ids = new Set([
    ...Object.keys(beforeSnap.placements || {}),
    ...Object.keys(afterSnap.placements || {}),
  ]);
  const moved = [];
  for (const id of ids) {
    if (canonicalJson(beforeSnap.placements[id]) !== canonicalJson(afterSnap.placements[id])) {
      moved.push(id);
    }
  }
  return moved;
}

function jointSurfIds(joint) {
  const ids = [];
  for (const slot of ['a', 'a2', 'b', 'b2']) {
    const part = joint?.[slot]?.part;
    if (part && !ids.includes(part)) ids.push(part);
  }
  return ids;
}

/** Parts named by a joint whose stored record changed, including a delete. */
function changedJointSurfIds(beforeJoints, afterJoints) {
  const before = new Map((beforeJoints || []).map((joint) => [joint.id, canonicalJson(joint)]));
  const after = new Map((afterJoints || []).map((joint) => [joint.id, canonicalJson(joint)]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const parts = [];
  for (const id of ids) {
    if (before.get(id) === after.get(id)) continue;
    const joint = (afterJoints || []).find((row) => row.id === id)
      || (beforeJoints || []).find((row) => row.id === id);
    for (const part of jointSurfIds(joint)) {
      if (!parts.includes(part)) parts.push(part);
    }
  }
  return parts;
}

function copyPlacements(placements) {
  const out = {};
  for (const [id, pose] of Object.entries(placements || {})) {
    if (!pose) continue;
    out[id] = { t: pose.t.slice(), q: pose.q.slice() };
  }
  return out;
}

/**
 * The tip becomes the live document, then the written document is one step.
 * A part-run solve that moved placements is the "before", not its own step.
 * A write that changed no joint or placement is not a step. If live has
 * drifted from the tip, the tip is replaced with that live snapshot so
 * undo/redo does not restore a stale pose. Redo is kept when the tip
 * already matches.
 *
 * Joints and placements share this stack, and each step is still a full
 * snapshot. A write that changes joints and also moves a part those joints
 * do not name is stored as a placement step and then the joint step, so
 * one undo reverts one action. Adding or removing a part stays one step.
 * Poses of parts the changed joint names stay on the joint step.
 */
export function pushAssemblyHistory(history, beforeDoc, afterDoc) {
  const base = history?.commits ? history : seedAssemblyHistory(beforeDoc);
  const beforeSnap = snapshotOf(beforeDoc);
  const afterSnap = snapshotOf(afterDoc);
  if (canonicalJson(beforeSnap) === canonicalJson(afterSnap)) {
    const tip = base.commits[base.head];
    if (canonicalJson(tip) === canonicalJson(beforeSnap)) {
      return { commits: base.commits, head: base.head };
    }
    const commits = base.commits.slice();
    commits[base.head] = beforeSnap;
    return { commits, head: base.head };
  }
  const commits = base.commits.slice(0, base.head + 1);
  commits[commits.length - 1] = beforeSnap;
  const jointsChanged = canonicalJson(beforeSnap.joints) !== canonicalJson(afterSnap.joints);
  const moved = movedSurfIds(beforeSnap, afterSnap);
  const jointParts = jointsChanged ? changedJointSurfIds(beforeSnap.joints, afterSnap.joints) : [];
  const unrelated = jointsChanged && partIdSet(beforeDoc) === partIdSet(afterDoc)
    ? moved.filter((id) => !jointParts.includes(id))
    : [];
  if (unrelated.length) {
    const placements = copyPlacements(beforeSnap.placements);
    for (const id of unrelated) {
      const pose = afterSnap.placements[id];
      if (pose) placements[id] = { t: pose.t.slice(), q: pose.q.slice() };
    }
    commits.push({
      joints: JSON.parse(JSON.stringify(beforeSnap.joints)),
      placements,
    });
  }
  commits.push(afterSnap);
  return { commits, head: commits.length - 1 };
}

export function undoAssemblyHistory(history) {
  if (!assemblyHistoryCanUndo(history)) return { history, snapshot: null };
  const head = history.head - 1;
  return { history: { ...history, head }, snapshot: history.commits[head] };
}

export function redoAssemblyHistory(history) {
  if (!assemblyHistoryCanRedo(history)) return { history, snapshot: null };
  const head = history.head + 1;
  return { history: { ...history, head }, snapshot: history.commits[head] };
}

export function applyAssemblySnapshot(doc, snapshot) {
  if (!doc || !snapshot) return doc;
  const parts = (doc.parts || []).map((part) => {
    const pose = snapshot.placements?.[partSurfId(part)];
    if (!pose) return part;
    return { ...part, placement: { t: pose.t.slice(), q: pose.q.slice() } };
  });
  const joints = Array.isArray(snapshot.joints) && snapshot.joints.length
    ? snapshot.joints
    : undefined;
  return serializeAssembly({ ...doc, parts, joints });
}

/**
 * Strip Undo while no part is selected. Scripts are returned as the same
 * object. The part stacks are not an argument, so they cannot move.
 */
export function undoJointStrip({ history, doc, scripts }) {
  const step = undoAssemblyHistory(history);
  if (!step.snapshot) return { history, doc, scripts, changed: false };
  return {
    history: step.history,
    doc: applyAssemblySnapshot(doc, step.snapshot),
    scripts,
    changed: true,
  };
}

export function redoJointStrip({ history, doc, scripts }) {
  const step = redoAssemblyHistory(history);
  if (!step.snapshot) return { history, doc, scripts, changed: false };
  return {
    history: step.history,
    doc: applyAssemblySnapshot(doc, step.snapshot),
    scripts,
    changed: true,
  };
}

export function assemblyHistoryKey(doc) {
  const ids = (doc?.parts || []).map((part) => partSurfId(part) || part?.id || '').sort().join(',');
  return `${doc?.source || ''}\0${doc?.name || ''}\0${ids}`;
}
