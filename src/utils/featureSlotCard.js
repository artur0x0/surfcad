/**
 * Feature cards name saved contours. They do not carry a profile tool
 * or a contour size. The feature's own parameters stay on the card:
 * extrude distance and sense, revolve angle, axis, segments, and sense,
 * sweep reverse and closed, and a loft station's offset along the
 * contour normal. Sweep has a profile slot and a path slot.
 */

import { planeUvToWorld } from './contourPick.js';
import {
  buildExtrudeLoopsPreview,
  buildExtrudeSolidPreview,
  buildLoftSolidPreview,
  buildRevolveSolidPreview,
  buildSweepSolidPreviewFromPoints,
  defaultContourParams,
  defaultExtrudeParams,
  defaultRevolveParams,
  isLoftEntry,
  isSolidContourEntry,
  isSweepEntry,
  planeFromContourFace,
  REVOLVE_SEGMENTS,
  toolToProfileParams,
} from './contourMode.js';
import { buildProfileFromParams } from './crossSectionSubstrate.js';
import { SEPARATE_BODY_CALL } from './featureMarkers.js';
import { inferExtrudeSense } from './featureSheetWriteback.js';
import { parseLoftReferences } from './loftReference.js';
import {
  parseExtrudeReference,
  parseRevolveReference,
  parseSweepReferences,
} from './solidReference.js';

export const FEATURE_SLOT_TITLE = {
  makeExtrude: 'Extrude',
  makeRevolve: 'Revolve',
  makeLoft: 'Loft',
  makeSweep: 'Sweep',
};

const LOFT_MAX = 8;

function blankStation(id, offset) {
  return { id, contourId: null, contourName: null, label: '', offset };
}

export function emptyFeatureSlotCard(kind) {
  const base = { kind, featureId: null, combine: 'add', merge: true };
  if (kind === 'makeLoft') {
    return {
      ...base,
      stations: [blankStation('p0', 0), blankStation('p1', 20)],
    };
  }
  if (kind === 'makeSweep') {
    return { ...base, profile: null, path: null, sweep: { reverse: false, closed: false } };
  }
  if (kind === 'makeRevolve') {
    return {
      ...base,
      profile: null,
      revolve: { ...defaultRevolveParams(), segments: REVOLVE_SEGMENTS },
    };
  }
  return { ...base, profile: null, profiles: [], extrude: { ...defaultExtrudeParams() } };
}

function refOf(contour) {
  if (!contour?.name) return { contourId: null, contourName: null, label: '', plane: null };
  return {
    contourId: contour.id || contour.name,
    contourName: contour.name,
    label: contour.label || contour.name,
    plane: contour.plane || null,
  };
}

function faceOf(ref) {
  const plane = ref?.plane;
  if (!plane?.center || !plane?.normal || !plane?.x || !plane?.y) return null;
  return {
    type: 'planar',
    planeFrame: {
      center: plane.center.slice(),
      normal: plane.normal.slice(),
      x: plane.x.slice(),
      y: plane.y.slice(),
    },
  };
}

function named(ref) {
  return !!(ref && ref.contourName);
}

/**
 * After a contour rename, every slot that stored this id shows the new name.
 * Offsets and the other slots stay.
 */
export function renameFeatureSlotRefs(card, contourId, contour) {
  if (!card || !contourId || !contour?.name) return card;
  const ref = refOf(contour);
  const hit = (row) => row?.contourId === contourId;
  let next = card;
  if (hit(card.profile)) next = { ...next, profile: { ...card.profile, ...ref } };
  if (Array.isArray(card.profiles)) {
    const profiles = card.profiles.map((row) => (hit(row) ? { ...row, ...ref } : row));
    next = { ...next, profiles, profile: profiles[0] ? { ...profiles[0] } : next.profile };
  }
  if (hit(card.path)) next = { ...next, path: { ...card.path, ...ref } };
  if (next.stations) {
    next = {
      ...next,
      stations: next.stations.map((row) => (hit(row) ? { ...row, ...ref } : row)),
    };
  }
  return next;
}

/** Empty every slot that stored this contour. Offsets on other stations stay. */
export function clearFeatureSlotRefs(card, contourId) {
  if (!card || !contourId) return card;
  const hit = (row) => row?.contourId === contourId;
  const blank = { contourId: null, contourName: null, label: '', plane: null };
  let next = card;
  if (hit(card.profile)) next = { ...next, profile: null };
  if (Array.isArray(card.profiles)) {
    const profiles = card.profiles.filter((row) => !hit(row));
    next = { ...next, profiles, profile: profiles[0] ? { ...profiles[0] } : null };
  }
  if (hit(card.path)) next = { ...next, path: null };
  if (next.stations) {
    next = {
      ...next,
      stations: next.stations.map((row) => (
        hit(row) ? { ...row, ...blank, offset: row.offset } : row
      )),
    };
  }
  return next;
}

/** Fill one slot. Every other slot, offset, and combine flag stays. */
export function assignFeatureSlot(card, slot, contour) {
  if (!card || !slot) return card;
  const ref = refOf(contour);
  if (isLoftEntry(card.kind) || slot.role === 'station') {
    const stations = (card.stations || []).map((row, i) => (
      i === slot.index ? { ...row, ...ref } : row
    ));
    return { ...card, stations };
  }
  if (slot.role === 'path') {
    const closed = typeof contour?.params?.closed === 'boolean'
      ? contour.params.closed
      : !!card.sweep?.closed;
    return {
      ...card,
      path: named(ref) ? ref : null,
      sweep: { reverse: !!card.sweep?.reverse, closed },
    };
  }
  if (card.kind === 'makeExtrude') return assignExtrudeProfile(card, slot, ref);
  return { ...card, profile: named(ref) ? ref : null };
}

function loopRoleOf(slot) {
  const role = slot?.loopRole || slot?.loop_role;
  if (role === 'outer' || role === 'hole' || role === 'auto') return role;
  return 'auto';
}

function extrudeProfiles(card) {
  if (Array.isArray(card?.profiles) && card.profiles.length) return card.profiles.map((row) => ({ ...row }));
  if (named(card?.profile)) return [{ ...card.profile, loopRole: card.profile.loopRole || 'auto' }];
  return [];
}

function withExtrudeProfiles(card, profiles) {
  const list = profiles.filter((row) => named(row));
  return {
    ...card,
    profiles: list,
    profile: list[0] ? { ...list[0] } : null,
  };
}

/** Extrude keeps every assigned contour. The first stays `profile` for older readers. */
function assignExtrudeProfile(card, slot, ref) {
  const id = ref.contourId || ref.contourName;
  let profiles = extrudeProfiles(card);
  if (slot?.remove) {
    profiles = profiles.filter((row) => row.contourId !== id && row.contourName !== id);
    return withExtrudeProfiles(card, profiles);
  }
  if (!named(ref)) return withExtrudeProfiles(card, profiles);
  const loopRole = loopRoleOf(slot);
  const next = { ...ref, loopRole };
  const index = profiles.findIndex((row) => row.contourId === next.contourId || row.contourName === next.contourName);
  if (index >= 0) profiles[index] = { ...profiles[index], ...next };
  else profiles.push(next);
  return withExtrudeProfiles(card, profiles);
}

export function setFeatureStationOffset(card, index, offset) {
  if (!card?.stations) return card;
  return {
    ...card,
    stations: card.stations.map((row, i) => (i === index ? { ...row, offset } : row)),
  };
}

export function addFeatureStation(card) {
  if (!isLoftEntry(card?.kind) || card.stations.length >= LOFT_MAX) return card;
  const n = card.stations.length;
  return {
    ...card,
    stations: [...card.stations, blankStation(`p${n}`, n * 20)],
  };
}

export function removeFeatureStation(card, index) {
  if (!isLoftEntry(card?.kind) || card.stations.length <= 2) return card;
  return {
    ...card,
    stations: card.stations.filter((_, i) => i !== index),
  };
}

function positive(value, max = Infinity) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= max;
}

export function featureSlotReady(card) {
  if (!card) return false;
  if (isLoftEntry(card.kind)) {
    return card.stations.length >= 2 && card.stations.every((row) => (
      named(row) && Number.isFinite(Number(row.offset))
    ));
  }
  if (isSweepEntry(card.kind)) return named(card.profile) && named(card.path);
  if (card.kind === 'makeRevolve') {
    const segments = Number(card.revolve?.segments);
    return named(card.profile)
      && positive(card.revolve?.angle, 360)
      && Number.isFinite(segments)
      && segments >= 3;
  }
  return named(card.profile) && positive(card.extrude?.distance);
}

/** Hover wins. Otherwise the filled profile (or the first filled station) stays lit. */
export function featureSlotGhostId(card, hoverId) {
  if (hoverId) return hoverId;
  if (!card) return null;
  if (card.profile?.contourId) return card.profile.contourId;
  if (isLoftEntry(card.kind)) {
    const hit = (card.stations || []).find((row) => row.contourId);
    return hit?.contourId || null;
  }
  return card.path?.contourId || null;
}

export function contoursForSlot(contours, role) {
  const list = Array.isArray(contours) ? contours : [];
  if (role === 'path') return list.filter((row) => row.tool === 'path');
  return list.filter((row) => row.tool !== 'path');
}

const ENTRY_BY_KIND = {
  extrude: 'makeExtrude',
  revolve: 'makeRevolve',
  loft: 'makeLoft',
  sweep: 'makeSweep',
};

function featureIdFromBlock(block) {
  const m = String(block || '').match(/\bid=([A-Za-z_$][\w$]*)(?![\w$-])/);
  return m ? m[1] : null;
}

function contourRef(name, contours) {
  if (!name) return null;
  const row = (contours || []).find((item) => item.name === name || item.id === name);
  if (row) return refOf(row);
  return { contourId: name, contourName: name, label: name, plane: null };
}

function revolveNumbers(block) {
  const m = String(block || '').match(/,\s*(\d+)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)(?:\.rotate)?/);
  if (!m) return null;
  return { segments: Number(m[1]), angle: Number(m[2]) };
}

/** V-axis is `[u, v]`. U-axis is `[-v, u]`. Anything else stays on V. */
function revolveAxisFromBlock(block) {
  const map = String(block || '').match(
    /ring\.map\(\s*\(\s*\[\s*u\s*,\s*v\s*\]\s*\)\s*=>\s*\[\s*([^,\]]+)\s*,\s*([^\]]+)\s*\]/,
  );
  if (!map) return 'v';
  const radial = map[1].replace(/\s+/g, '');
  const height = map[2].replace(/\s+/g, '');
  if (radial === 'u' && height === 'v') return 'v';
  if (radial === '-v' && height === 'u') return 'u';
  return 'v';
}

function revolveSenseFromBlock(block, angle) {
  const rot = String(block || '').match(/\.rotate\(\s*\[\s*0\s*,\s*0\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\s*\)/);
  if (!rot) return 'positive';
  const start = Number(rot[1]);
  const a = Number(angle);
  if (Number.isFinite(a) && Math.abs(start + a) < 1e-6) return 'negative';
  if (Number.isFinite(a) && Math.abs(start + a / 2) < 1e-6) return 'both';
  return 'positive';
}

/**
 * Slot card for a saved Extrude, Revolve, Loft, or Sweep block.
 * A named contour fills that slot. An inline profile with no name stays
 * empty, so the chip reads Pick a contour. Confirm rewrites `id=` when
 * the marker carries one. A positional chip id such as `extrude-0` does not.
 */
export function featureSlotCardFromEdit(session, contours = []) {
  const entry = session?.entry || ENTRY_BY_KIND[session?.kind] || ENTRY_BY_KIND[session?.feature?.kind];
  const card = emptyFeatureSlotCard(isSolidContourEntry(entry) ? entry : 'makeExtrude');
  const block = String(session?.block || '');
  const fields = session?.fields || {};
  card.featureId = featureIdFromBlock(block);
  card.combine = /\.subtract\s*\(/.test(block) ? 'subtract' : 'add';
  card.merge = card.combine === 'subtract' ? true : !SEPARATE_BODY_CALL.test(block);

  if (card.kind === 'makeExtrude') {
    const parsed = parseExtrudeReference(block);
    const distance = parsed?.distance ?? fields.distance;
    const sense = parsed
      ? inferExtrudeSense(parsed.distance, parsed.w)
      : (fields.sense || card.extrude.sense);
    const names = parsed?.names?.length ? parsed.names : [];
    const profiles = names.map((name) => ({
      ...contourRef(name, contours),
      loopRole: parsed?.roles?.[name] || 'auto',
    }));
    return {
      ...card,
      profile: profiles[0] || null,
      profiles,
      extrude: {
        ...card.extrude,
        ...(distance != null ? { distance } : {}),
        sense,
      },
    };
  }

  if (card.kind === 'makeRevolve') {
    const parsed = parseRevolveReference(block);
    const nums = revolveNumbers(block);
    const angle = fields.angle ?? nums?.angle ?? card.revolve.angle;
    return {
      ...card,
      profile: contourRef(parsed?.name, contours),
      revolve: {
        ...card.revolve,
        angle,
        segments: nums?.segments ?? card.revolve.segments,
        sense: revolveSenseFromBlock(block, angle),
        axis: revolveAxisFromBlock(block),
      },
    };
  }

  if (card.kind === 'makeSweep') {
    const parsed = parseSweepReferences(block);
    const lit = block.match(/closed:\s*(true|false)/);
    let closed = lit ? lit[1] === 'true' : !!card.sweep?.closed;
    if (!lit && parsed?.path) {
      const path = (contours || []).find((item) => item.name === parsed.path || item.id === parsed.path);
      if (typeof path?.params?.closed === 'boolean') closed = path.params.closed;
    }
    return {
      ...card,
      profile: contourRef(parsed?.profile, contours),
      path: contourRef(parsed?.path, contours),
      sweep: {
        reverse: /\.slice\(\)\.reverse\(\)/.test(block) || !!fields.reverse,
        closed,
      },
    };
  }

  const stations = parseLoftReferences(block);
  if (stations.length >= 2) {
    return {
      ...card,
      stations: stations.map((row, index) => ({
        id: `p${index}`,
        ...contourRef(row.name, contours),
        offset: row.offset,
      })),
    };
  }
  return card;
}

/**
 * Confirm payload. Names that already exist are kept. Distance, sense,
 * angle, axis, segments, reverse, and closed come from the card.
 */
export function featureSlotCommitPayload(card) {
  const combine = card.combine === 'subtract' ? 'subtract' : 'add';
  const merge = combine === 'subtract' ? true : card.merge !== false;
  const featureId = card.featureId || null;
  const circle = { tool: 'circle', params: { ...defaultContourParams('circle') } };
  if (card.kind === 'makeExtrude') {
    const profiles = (card.profiles?.length ? card.profiles : [card.profile]).filter((row) => named(row));
    return {
      entry: 'makeExtrude',
      ...circle,
      face: faceOf(card.profile),
      combine,
      merge,
      featureId,
      contourId: card.profile.contourId,
      contourName: card.profile.contourName,
      profiles: profiles.map((row) => ({
        contourId: row.contourId,
        contourName: row.contourName,
        loopRole: row.loopRole || 'auto',
      })),
      extrude: { ...defaultExtrudeParams(), ...card.extrude },
    };
  }
  if (card.kind === 'makeRevolve') {
    return {
      entry: 'makeRevolve',
      ...circle,
      face: faceOf(card.profile),
      combine,
      merge,
      featureId,
      contourId: card.profile.contourId,
      contourName: card.profile.contourName,
      revolve: { ...defaultRevolveParams(), segments: REVOLVE_SEGMENTS, ...card.revolve },
    };
  }
  if (card.kind === 'makeSweep') {
    return {
      entry: 'makeSweep',
      ...circle,
      face: faceOf(card.profile),
      combine,
      merge,
      featureId,
      contourId: card.profile.contourId,
      contourName: card.profile.contourName,
      pathContourId: card.path.contourId,
      pathContourName: card.path.contourName,
      sweep: {
        reverse: !!card.sweep?.reverse,
        closed: !!card.sweep?.closed,
      },
      edges: [],
    };
  }
  return {
    entry: 'makeLoft',
    face: null,
    combine,
    merge,
    featureId,
    loft: {
      selected: 0,
      profiles: card.stations.map((row) => ({
        id: row.id,
        tool: 'circle',
        params: { ...defaultContourParams('circle') },
        offset: Number(row.offset) || 0,
        contourId: row.contourId,
        contourName: row.contourName,
      })),
    },
  };
}

function findSaved(contours, ref) {
  if (!ref) return null;
  const id = ref.contourId || ref.contourName;
  const name = ref.contourName;
  if (!id && !name) return null;
  return (contours || []).find((row) => (
    (id && (row.id === id || row.name === id))
    || (name && (row.name === name || row.id === name))
  )) || null;
}

function sameSlot(live, slot) {
  if (!live?.slot || !slot || live.slot.role !== slot.role) return false;
  if (slot.role === 'station') return Number(live.slot.index) === Number(slot.index);
  return true;
}

function offsetFrame(plane, offset) {
  const n = plane.normal;
  const w = Number(offset) || 0;
  return {
    center: [
      plane.center[0] + w * n[0],
      plane.center[1] + w * n[1],
      plane.center[2] + w * n[2],
    ],
    normal: n.slice(),
    x: plane.x.slice(),
    y: plane.y.slice(),
  };
}

/**
 * Profile for one slot. A live draw (New contour / edit) wins for that slot.
 * Otherwise the saved contour's tool, params, and plane.
 */
function slotProfile(ref, slot, contours, live) {
  if (sameSlot(live, slot) && live.tool && live.params && live.face) {
    const plane = planeFromContourFace(live.face);
    if (!plane?.center) return null;
    return { tool: live.tool, params: live.params, face: live.face, plane };
  }
  const row = findSaved(contours, ref);
  if (!row || row.tool === 'path' || !row.plane?.center) return null;
  const face = faceOf(refOf(row));
  if (!face) return null;
  return { tool: row.tool, params: row.params, face, plane: row.plane };
}

function pathWorldPoints(row) {
  const pts = row?.params?.points;
  const plane = row?.plane;
  if (!Array.isArray(pts) || pts.length < 2 || !plane?.center || !plane.x || !plane.y) return null;
  return pts.map((uv) => planeUvToWorld(uv, plane));
}

/**
 * Live solid for an Extrude, Revolve, Loft, or Sweep card.
 * Uses the saved contour (tool, params, plane), not the circle placeholder
 * Confirm sends so compose can look the name up. `live` is the profile
 * currently being drawn into `live.slot`. Null until the slots that preview
 * needs are filled. Not the committed solid.
 */
export function buildFeatureSlotPreview(card, contours, live = null) {
  if (!card) return null;
  if (card.kind === 'makeExtrude') {
    const refs = (card.profiles?.length ? card.profiles : [card.profile]).filter((row) => named(row));
    if (refs.length > 1) {
      let face = null;
      const records = [];
      for (let i = 0; i < refs.length; i += 1) {
        const prof = slotProfile(refs[i], { role: 'profile' }, contours, i === 0 ? live : null);
        if (!prof) return null;
        face = face || prof.face;
        let loops;
        try {
          loops = buildProfileFromParams(toolToProfileParams(prof.tool, prof.params)).contours;
        } catch {
          return null;
        }
        if (!loops?.length) return null;
        const role = refs[i].loopRole;
        records.push({
          name: refs[i].contourName || `c${i}`,
          role: role === 'outer' || role === 'hole' ? role : null,
          loops,
        });
      }
      const payload = buildExtrudeLoopsPreview(face, records, card.extrude);
      return payload ? { kind: 'extrude', payload } : null;
    }
    const prof = slotProfile(card.profile, { role: 'profile' }, contours, live);
    if (!prof) return null;
    const payload = buildExtrudeSolidPreview(prof.face, prof.tool, prof.params, card.extrude);
    return payload ? { kind: 'extrude', payload } : null;
  }
  if (card.kind === 'makeRevolve') {
    const prof = slotProfile(card.profile, { role: 'profile' }, contours, live);
    if (!prof) return null;
    const payload = buildRevolveSolidPreview(prof.face, prof.tool, prof.params, card.revolve);
    return payload ? { kind: 'revolve', payload } : null;
  }
  if (card.kind === 'makeSweep') {
    const prof = slotProfile(card.profile, { role: 'profile' }, contours, live);
    const path = findSaved(contours, card.path);
    const points = pathWorldPoints(path);
    if (!prof || !points) return null;
    const payload = buildSweepSolidPreviewFromPoints(
      prof.face,
      prof.tool,
      prof.params,
      points,
      card.sweep,
    );
    return payload ? { kind: 'sweep', payload } : null;
  }
  if (!isLoftEntry(card.kind)) return null;
  const profiles = [];
  for (let i = 0; i < (card.stations || []).length; i += 1) {
    const station = card.stations[i];
    const prof = slotProfile(station, { role: 'station', index: i }, contours, live);
    if (!prof) return null;
    profiles.push({
      id: station.id,
      tool: prof.tool,
      params: prof.params,
      offset: 0,
      planeKind: 'contour',
      plane: offsetFrame(prof.plane, station.offset),
      contourId: station.contourId || null,
      contourName: station.contourName || null,
    });
  }
  const payload = buildLoftSolidPreview(
    { type: 'planar', planeFrame: profiles[0].plane },
    profiles,
  );
  return payload ? { kind: 'loft', payload } : null;
}
