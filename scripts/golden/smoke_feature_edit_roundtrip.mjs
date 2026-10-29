#!/usr/bin/env node
/**
 * Feature edit round-trip.
 *
 * Every marked feature kind that has a creation dialog:
 *   1. Create it with that dialog's composer.
 *   2. Open edit and check the dialog fields equal the saved params.
 *   3. Confirm with no changes → script byte-identical.
 *   4. Change one param, confirm → same feature count, that block updated,
 *      no duplicate.
 *
 * Fillet also checks the highlighted edge set, an add/remove round-trip,
 * and a stored edge the graph can no longer resolve (shown missing, not dropped).
 */
import { register } from 'node:module';
import { BufferGeometry, BufferAttribute } from 'three';
import { composeHelperInsert } from '../../src/utils/helperPaletteSnippets.js';
import {
  composeFilletCommit,
  composeChamferCommit,
  replaceEditedBlend,
  countMakeSweepPath,
  countFilletAlongPath,
} from '../../src/utils/filletMode.js';
import {
  composeContourCommit,
  defaultLoftProfiles,
} from '../../src/utils/contourMode.js';
import { composeShellCommit } from '../../src/utils/shellMode.js';
import { composeDraftCommit, applyDraftFaceTap, emptyDraftState } from '../../src/utils/draftMode.js';
import {
  composeCutCommit,
  emptyCutState,
  setCutPlaneSource,
  setCutPickTarget,
  applyCutTap,
} from '../../src/utils/cutMode.js';
import {
  composeBooleanCommit,
  emptyBooleanState,
  applyBooleanTap,
} from '../../src/utils/booleanMode.js';
import { composeMoveCommit } from '../../src/utils/moveMode.js';
import { composeMoveFaceCommit } from '../../src/utils/moveFaceMode.js';
import { composeDeleteFaceCommit } from '../../src/utils/deleteFaceMode.js';
import { composeSheetMetalCommit } from '../../src/utils/sheetMetal/sheetMetalScript.js';
import { createSheetSpec } from '../../src/utils/sheetMetal/sheetModel.js';
import { classifySelectedFace } from '../../src/utils/faceFeaturePlacement.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';
import { buildFeatureEdges, buildCoherentEdges } from '../../src/utils/selectEdge.js';
import { annotateFeatureEdges, indexBoundaryEdges, featureEdgesFromBoundary } from '../../src/utils/boundaryEdgeIds.js';
import {
  openFeatureEdit,
  confirmFeatureEdit,
  withSampleChange,
  parseFeatureEdit,
  parseStoredEdges,
  resolveStoredEdges,
  missingSelectionLabel,
  creationDialogFor,
  FEATURE_EDIT_DIALOGS,
  FEATURE_EDIT_SAMPLE_KEY,
} from '../../src/utils/featureEdit.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function fieldsMatch(actual, expect) {
  if (!actual) return false;
  for (const [key, value] of Object.entries(expect)) {
    const got = actual[key];
    if (typeof value === 'number') {
      if (!(Math.abs(got - value) < 1e-6)) return false;
    } else if (got !== value) return false;
  }
  return true;
}

function blockText(script, feature) {
  return script.slice(feature.startOffset, feature.endOffset);
}

/**
 * @param {string} label
 * @param {string} script
 * @param {string} kind
 * @param {object} expect fields the creation dialog was given
 */
function roundTrip(label, script, kind, expect) {
  const features = parseFeatureMarkers(script);
  const feature = [...features].reverse().find((f) => f.kind === kind);
  check(`${label}: created`, !!feature, features.map((f) => f.kind).join(','));
  if (!feature) return;
  const others = features.filter((f) => f !== feature).map((f) => blockText(script, f));
  const session = openFeatureEdit(script, feature);
  check(`${label}: dialog is the creator`, session.ok && session.dialog === creationDialogFor(kind).dialog, session.message || session.dialog);
  check(`${label}: fields equal saved params`, session.ok && fieldsMatch(session.fields, expect), JSON.stringify(session.fields));
  const same = confirmFeatureEdit(script, feature, { fields: session.fields });
  check(`${label}: confirm unchanged is byte-identical`, same.ok && same.changed === false && same.buffer === script);
  const draft = withSampleChange(session);
  const key = FEATURE_EDIT_SAMPLE_KEY[kind];
  const next = confirmFeatureEdit(script, feature, draft);
  const after = next.ok ? parseFeatureMarkers(next.buffer) : [];
  check(`${label}: change keeps the feature count`, next.ok && next.changed === true && after.length === features.length, next.message || '');
  if (!next.ok) return;
  const edited = [...after].reverse().find((f) => f.kind === kind);
  const again = openFeatureEdit(next.buffer, edited);
  const expectNext = kind === 'deleteFace' ? { faceCount: draft.fields.faceCount } : { [key]: draft.fields[key] };
  check(`${label}: changed field saved in place`, again.ok && fieldsMatch(again.fields, expectNext), JSON.stringify(again.fields));
  const rest = after.filter((f) => f !== edited).map((f) => blockText(next.buffer, f));
  check(`${label}: other features untouched`, JSON.stringify(rest) === JSON.stringify(others));
}

const host = composeHelperInsert('', 'cube', null, { width: 30, depth: 20, height: 10, center: true });
check('host cube', typeof host === 'string' && /cube begin/.test(host));

console.log('feature edit — blocks');
roundTrip('cube', host, 'cube', { width: 30, depth: 20, height: 10, center: true });

for (const [id, kind, params, expect] of [
  ['roundedBox', 'roundedBox', { sx: 40, sy: 24, sz: 16, edgeRadius: 3, segments: 8 }, { sx: 40, edgeRadius: 3, segments: 8 }],
  ['cylinder', 'cylinder', { height: 18, radius: 7, segments: 24 }, { height: 18, radius: 7, segments: 24 }],
  ['sphere', 'sphere', { radius: 9, segments: 20 }, { radius: 9, segments: 20 }],
  ['tube', 'tube', { section: 'round', outerRadius: 12, innerRadius: 8, height: 22, segments: 16 }, { section: 'round', outerRadius: 12, height: 22 }],
  ['hexPrism', 'hexPrism', { radius: 11, height: 6 }, { radius: 11, height: 6 }],
  ['center', 'center', { cx: true, cy: false, cz: false }, { cx: true, cy: false, cz: false }],
  ['align', 'align', {}, { body: 'part' }],
  ['mirror', 'mirror', { plane: 'yz', keepOriginal: true }, { plane: 'yz', keepOriginal: true }],
  ['array3D', 'array', { arrayType: 'grid', nx: 2, ny: 3, nz: 1, sx: 40, sy: 30, sz: 0 }, { nx: 2, ny: 3, nz: 1, sx: 40 }],
  ['polarArray', 'polarArray', { count: 6, boltCircleRadius: 25, axis: 'z' }, { count: 6, boltCircleRadius: 25, axis: 'z' }],
  ['hole', 'hole', { holeType: 'clearance', size: 'M4', fit: 'normal', u: 3, v: 4 }, { holeType: 'clearance', size: 'M4', u: 3, v: 4 }],
  ['holePattern', 'holePattern', { n: 3, m: 2, spacingU: 16, spacingV: 12, dia: 5 }, { n: 3, m: 2, dia: 5 }],
  ['clearanceHole', 'clearanceHole', { size: 'M5', fit: 'close', u: 1, v: 2 }, { size: 'M5', fit: 'close', u: 1, v: 2 }],
  ['tapDrillHole', 'tapDrillHole', { size: 'M3', u: 2, v: -1 }, { size: 'M3', u: 2, v: -1 }],
  ['cboreHole', 'cboreHole', { diaThru: 5.5, diaCbore: 10, cboreDepth: 4, u: 0, v: 1 }, { diaThru: 5.5, diaCbore: 10, u: 0, v: 1 }],
  ['cskHole', 'cskHole', { diaThru: 3.4, diaCsk: 6.5, cskDepth: 2, u: 1, v: 0 }, { diaThru: 3.4, diaCsk: 6.5, u: 1 }],
]) {
  const script = composeHelperInsert(host, id, null, params);
  check(`${kind}: composer wrote`, typeof script === 'string', script && script.message);
  if (typeof script === 'string') roundTrip(kind, script, kind, expect);
}

const face = classifySelectedFace({
  center: [0, 0, 5],
  normal: [0, 0, 1],
  area: 600,
  triangleCount: 2,
  selectionMode: 'coplanar',
});

const profile = composeContourCommit(host, {
  entry: 'crossSection',
  face,
  tool: 'circle',
  params: { radius: 6, segments: 24 },
});
check('profile composer', profile.ok, profile.message);
if (profile.ok) roundTrip('profile', profile.buffer, 'profile', { tool: 'circle', radius: 6, segments: 24 });

const extrude = composeContourCommit(host, {
  entry: 'makeExtrude',
  face,
  tool: 'circle',
  params: { radius: 6, segments: 24 },
  extrude: { distance: 14, direction: 'normal', sense: 'positive' },
});
check('extrude composer', extrude.ok, extrude.message);
if (extrude.ok) roundTrip('extrude', extrude.buffer, 'extrude', { distance: 14, sense: 'positive', radius: 6 });

const revolve = composeContourCommit(host, {
  entry: 'makeRevolve',
  face,
  tool: 'circle',
  params: { radius: 6, segments: 24 },
  revolve: { angle: 270, axis: 'v', sense: 'positive' },
});
check('revolve composer', revolve.ok, revolve.message);
if (revolve.ok) roundTrip('revolve', revolve.buffer, 'revolve', { angle: 270, radius: 6 });

const loft = composeContourCommit(host, {
  entry: 'makeLoft',
  face,
  loft: { profiles: defaultLoftProfiles(), selected: 0 },
});
check('loft composer', loft.ok, loft.message);
if (loft.ok) roundTrip('loft', loft.buffer, 'loft', { radius: 5 });

const edge = {
  a: 0, b: 1, va: [0, 0, 0], vb: [10, 0, 0], length: 10,
  tangent: [1, 0, 0], n0: [0, 0, 1], n1: [0, 1, 0],
  boundaryId: 4, faceA: 1, faceB: 2, pairCount: 1,
};
const sweep = composeContourCommit(host, {
  entry: 'makeSweep',
  face: null,
  tool: 'circle',
  params: { radius: 2, segments: 12 },
  edges: [edge],
  sweep: { reverse: false },
});
check('sweep composer', sweep.ok, sweep.message);
if (sweep.ok) roundTrip('sweep', sweep.buffer, 'sweep', { radius: 2, reverse: false });

const plane = composeContourCommit(host, { entry: 'workplane', face: null });
check('workplane composer', plane.ok, plane.message);
if (plane.ok) roundTrip('workplane', plane.buffer, 'workplane', { cx: 0, cy: 0, cz: 0 });

const shell = composeShellCommit(host, {
  face,
  params: { wall: 2.5, openingMode: 'face' },
});
check('shell composer', shell.ok, shell.message);
if (shell.ok) roundTrip('shell', shell.buffer, 'shell', { wall: 2.5, openingMode: 'face' });

const Zp = { center: [0, 0, 5], normal: [0, 0, 1] };
const Xp = { center: [15, 0, 0], normal: [1, 0, 0] };
let draftState = applyDraftFaceTap(applyDraftFaceTap(emptyDraftState(), Zp), Xp);
draftState = { ...draftState, angle: 8 };
const draft = composeDraftCommit(host, draftState);
check('draft composer', draft.ok, draft.message);
if (draft.ok) roundTrip('draft', draft.buffer, 'draft', { angle: 8 });

const crossPos = [0, 0, -1, 1, 0, -1, 0, 0, 1];
const crossIdx = [0, 1, 2];
let cutState = setCutPickTarget(setCutPlaneSource(emptyCutState(), 'xy'), 'bodies');
cutState = applyCutTap(cutState, { triangle: 0, positions: crossPos, index: crossIdx }).state;
const cut = composeCutCommit(host, cutState, { positions: crossPos, index: crossIdx, bodyCount: 1 });
check('cut composer', cut.ok, cut.message);
if (cut.ok) roundTrip('cut', cut.buffer, 'cut', { originOffset: 0, keep: 'both' });

const move = composeMoveCommit(host, { body: 'part', target: { at: [1, 2, 3] }, dx: 0, dy: 10, dz: 0 });
check('move composer', move.ok, move.message);
if (move.ok) roundTrip('move', move.buffer, 'move', { dx: 0, dy: 10, dz: 0 });

const top = { center: [0, 0, 5], normal: [0, 0, 1] };
const side = { center: [15, 0, 0], normal: [1, 0, 0] };
const moveFace = composeMoveFaceCommit(host, { body: 'part', faces: [top], distance: 4, flip: false });
check('move face composer', moveFace.ok, moveFace.message);
if (moveFace.ok) roundTrip('moveFace', moveFace.buffer, 'moveFace', { distance: 4, flip: false });

const deleteFace = composeDeleteFaceCommit(host, { body: 'part', faces: [top, side] });
check('delete face composer', deleteFace.ok, deleteFace.message);
if (deleteFace.ok) roundTrip('deleteFace', deleteFace.buffer, 'deleteFace', { faceCount: 2 });

const other = composeHelperInsert('', 'cube', null, { width: 10, depth: 10, height: 10, center: true });
let boolState = applyBooleanTap(emptyBooleanState(), { body: { at: [0, 0, 0], center: [0, 0, 0], triangles: [] }, partId: 'a' }).state;
boolState = applyBooleanTap(boolState, { body: { at: [12, 0, 0], center: [12, 0, 0], triangles: [] }, partId: 'b' }).state;
const bool = composeBooleanCommit(host, boolState, 'b', null, {
  parts: {
    a: { script: host, name: 'A', position: [0, 0, 0], ok: true },
    b: { script: other, name: 'B', position: [12, 0, 0], ok: true },
  },
});
check('boolean composer', bool.ok, bool.message);
if (bool.ok) roundTrip('boolean', bool.buffer, 'boolean', { op: 'union' });

const sheetSpec = createSheetSpec(
  { sku: 'ALU-063', name: 'Alu', thicknessMm: 1.6, bendable: true, kFactor: 0.38, bendRadiusMm: 1.6 },
  'XY',
  { width: 80, height: 50 },
);
const sheet = composeSheetMetalCommit('', sheetSpec);
check('sheet composer', sheet.ok, sheet.message);
if (sheet.ok) roundTrip('sheetMetal', sheet.buffer, 'sheetMetal', { width: 80, height: 50, sku: 'ALU-063' });

console.log('feature edit — fillet edges');

register('./manifold-resolve-hook.mjs', import.meta.url);
const pending = new Map();
let msgId = 0;
const workerSelf = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.type === 'error') waiter.reject(new Error(msg.payload?.message || 'worker error'));
    else waiter.resolve(msg);
  },
};
globalThis.self = workerSelf;
function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => {
      workerSelf.onmessage({ data: { type, payload, id } });
    });
  });
}
await import('../../src/workers/sandboxWorker.js');
await send('init');
async function exec(script) {
  const res = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
  return res.payload;
}
function geomOf(mesh) {
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  const nVert = Math.floor(src.length / np);
  const positions = new Float32Array(nVert * 3);
  for (let i = 0; i < nVert; i += 1) {
    positions[i * 3] = src[i * np];
    positions[i * 3 + 1] = src[i * np + 1];
    positions[i * 3 + 2] = src[i * np + 2];
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  return g;
}

const cubeRun = await exec('return Manifold.cube([40, 30, 20], true);');
const g = geomOf(cubeRun.mesh);
const topo = indexBoundaryEdges({
  positions: g.attributes.position.array,
  indices: g.index.array,
  faceIDs: cubeRun.mesh.faceID,
});
const liveEdges = featureEdgesFromBoundary(topo);
const coherent = buildCoherentEdges(annotateFeatureEdges(buildFeatureEdges(g), topo));
const vertical = coherent.filter((e) => Math.abs(e.tangent?.[2] || 0) > 0.99);
check('box has four vertical edges', vertical.length === 4, `n=${vertical.length}`);

const starter = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';
const one = vertical.slice(0, 1);
const fillet = composeFilletCommit(starter, {
  edges: one,
  params: { radius: 2, strategy: 'sweep' },
  geometry: g,
  filletClass: 'easy',
});
check('fillet composer', fillet.ok, fillet.message);
if (fillet.ok) {
  roundTrip('fillet', fillet.buffer, 'fillet', { radius: 2 });
  const feature = parseFeatureMarkers(fillet.buffer).find((f) => f.kind === 'fillet');
  const session = openFeatureEdit(fillet.buffer, feature, { edges: liveEdges });
  const storedIds = parseStoredEdges(blockText(fillet.buffer, feature)).map((e) => e.id).filter((id) => id != null).sort((a, b) => a - b);
  const highlighted = [...new Set(session.resolvedEdges.map((e) => e.boundaryId))].sort((a, b) => a - b);
  check('fillet highlight equals the stored edge set', session.missingEdges.length === 0 && JSON.stringify(highlighted) === JSON.stringify(storedIds), `stored=${storedIds} highlighted=${highlighted} missing=${session.missingEdges.length}`);

  const two = composeFilletCommit(starter, {
    edges: vertical.slice(0, 2),
    params: { radius: 2, strategy: 'sweep' },
    geometry: g,
    filletClass: 'easy',
  });
  check('two-edge fillet', two.ok, two.message);
  if (two.ok) {
    const f2 = parseFeatureMarkers(two.buffer).find((item) => item.kind === 'fillet');
    const open2 = openFeatureEdit(two.buffer, f2, { edges: liveEdges });
    const ids = parseStoredEdges(blockText(two.buffer, f2)).map((e) => e.id).filter((id) => id != null);
    check('two stored edges resolve', open2.missingEdges.length === 0 && open2.resolvedEdges.length >= 2, `ids=${ids} resolved=${open2.resolvedEdges.length}`);
    const dropped = ids.slice(0, 1);
    const oneEdge = vertical.filter((edge) => edge.boundaryId === dropped[0]);
    const blendOpts = { filletClass: 'easy', geometry: g };
    const removed = replaceEditedBlend(two.buffer, f2, {
      edges: oneEdge,
      params: { radius: 2, strategy: 'sweep' },
      ...blendOpts,
    });
    const removedRun = removed.ok ? await exec(removed.buffer) : null;
    const removedFeature = removed.ok ? parseFeatureMarkers(removed.buffer).find((item) => item.kind === 'fillet') : null;
    check(
      'removing an edge stays one runnable fillet',
      removed.ok
        && removed.changed === true
        && !removedRun?.featureSkip
        && parseFeatureMarkers(removed.buffer).length === parseFeatureMarkers(two.buffer).length
        && countMakeSweepPath(removed.buffer) === 1
        && countFilletAlongPath(removed.buffer) === 1,
      removed.message || removedRun?.featureSkip?.message || '',
    );
    const putBack = replaceEditedBlend(removed.buffer, removedFeature, {
      edges: vertical.slice(0, 2),
      params: { radius: 2, strategy: 'sweep' },
      ...blendOpts,
    });
    const putRun = putBack.ok ? await exec(putBack.buffer) : null;
    const freshTwo = composeFilletCommit(starter, {
      edges: vertical.slice(0, 2),
      params: { radius: 2, strategy: 'sweep' },
      ...blendOpts,
    });
    check(
      'putting the edge back matches a fresh create',
      putBack.ok && freshTwo.ok && !putRun?.featureSkip && putBack.buffer === freshTwo.buffer,
      putBack.message || putRun?.featureSkip?.message || '',
    );

    const sameRadius = replaceEditedBlend(two.buffer, f2, {
      edges: vertical.slice(0, 2),
      params: { radius: 2, strategy: 'sweep' },
      ...blendOpts,
    });
    check(
      'unchanged disconnected fillet edit writes nothing',
      sameRadius.ok && sameRadius.changed === false && sameRadius.run === false && sameRadius.buffer === two.buffer,
      sameRadius.message || '',
    );

    const createdRun = await exec(two.buffer);
    const radiusEdit = replaceEditedBlend(two.buffer, f2, {
      edges: vertical.slice(0, 2),
      params: { radius: 4, strategy: 'sweep' },
      ...blendOpts,
    });
    const freshRadius = composeFilletCommit(starter, {
      edges: vertical.slice(0, 2),
      params: { radius: 4, strategy: 'sweep' },
      ...blendOpts,
    });
    const radiusRun = radiusEdit.ok ? await exec(radiusEdit.buffer) : null;
    const freshRadiusRun = freshRadius.ok ? await exec(freshRadius.buffer) : null;
    check(
      'disconnected fillet places without error',
      !createdRun?.featureSkip && countMakeSweepPath(two.buffer) === 1 && countFilletAlongPath(two.buffer) === 1,
      createdRun?.featureSkip?.message || '',
    );
    check(
      'editing a disconnected fillet matches a fresh create at the new radius',
      radiusEdit.ok && freshRadius.ok
        && radiusEdit.changed === true
        && !radiusRun?.featureSkip
        && !freshRadiusRun?.featureSkip
        && countMakeSweepPath(radiusEdit.buffer) === 1
        && countFilletAlongPath(radiusEdit.buffer) === 1
        && radiusEdit.buffer === freshRadius.buffer
        && Math.abs(Number(radiusRun.volume) - Number(freshRadiusRun.volume)) < 1e-4
        && Math.abs(Number(radiusRun.volume) - Number(createdRun.volume)) > 1,
      radiusEdit.message || radiusRun?.featureSkip?.message || freshRadiusRun?.featureSkip?.message || '',
    );
  }

  const edited = replaceEditedBlend(fillet.buffer, feature, {
    edges: one,
    params: { radius: 4, strategy: 'sweep' },
    filletClass: 'easy',
    geometry: g,
  });
  const fresh = composeFilletCommit(starter, {
    edges: one,
    params: { radius: 4, strategy: 'sweep' },
    filletClass: 'easy',
    geometry: g,
  });
  const editedRun = edited.ok ? await exec(edited.buffer) : null;
  const freshRun = fresh.ok ? await exec(fresh.buffer) : null;
  check(
    'editing one edge matches a fresh create at the new radius',
    edited.ok && fresh.ok && !editedRun?.featureSkip && !freshRun?.featureSkip
      && edited.buffer === fresh.buffer
      && Math.abs(Number(editedRun.volume) - Number(freshRun.volume)) < 1e-4,
    edited.message || editedRun?.featureSkip?.message || '',
  );

  const gone = liveEdges.filter((e) => e.boundaryId !== storedIds[0]);
  const missed = resolveStoredEdges(parseStoredEdges(blockText(fillet.buffer, feature)), gone);
  check('unresolvable edge is missing, not dropped', missed.missing.length === 1 && missed.resolved.length === 0 && parseStoredEdges(blockText(fillet.buffer, feature)).length === 1, `missing=${missed.missing.length}`);
  check('missing label', missingSelectionLabel(missed.missing, 'edge') === '1 edge not found');
  const kept = confirmFeatureEdit(fillet.buffer, feature, { fields: { radius: 2 } });
  check('opening a missing edge does not rewrite the script', kept.ok && kept.buffer === fillet.buffer);
  const cleared = confirmFeatureEdit(fillet.buffer, feature, { fields: { radius: 2 }, clearMissing: true, edgeIds: [] });
  // clearMissing with an explicit empty list still rewrites when we pass edgeIds.
  const cleared2 = confirmFeatureEdit(fillet.buffer, feature, {
    fields: { radius: 2 },
    clearMissing: true,
  });
  const clearedBlock = cleared2.ok ? blockText(cleared2.buffer, parseFeatureMarkers(cleared2.buffer).find((item) => item.kind === 'fillet')) : '';
  check('clear missing drops the edge and keeps the feature', cleared2.ok && cleared2.changed === true && parseFeatureMarkers(cleared2.buffer).filter((item) => item.kind === 'fillet').length === 1 && !clearedBlock.includes(`boundary edge ${storedIds[0]}`) && !clearedBlock.includes(`[${storedIds[0]}]`), cleared2.message || clearedBlock.slice(0, 180));
  void cleared;
}

const chamfer = composeChamferCommit(starter, { edges: one, params: { chamfer: 1.5 } });
check('chamfer composer', chamfer.ok, chamfer.message);
if (chamfer.ok) roundTrip('chamfer', chamfer.buffer, 'chamfer', { chamfer: 1.5 });

const chamferTwo = composeChamferCommit(starter, {
  edges: vertical.slice(0, 2),
  params: { chamfer: 1.5 },
});
check('disconnected chamfer places', chamferTwo.ok && countMakeSweepPath(chamferTwo.buffer) === 1, chamferTwo.message || '');
if (chamferTwo.ok) {
  const chamferFeature = parseFeatureMarkers(chamferTwo.buffer).find((item) => item.kind === 'chamfer');
  const chamferSame = replaceEditedBlend(chamferTwo.buffer, chamferFeature, {
    chamfer: true,
    edges: vertical.slice(0, 2),
    params: { chamfer: 1.5 },
  });
  check(
    'unchanged disconnected chamfer edit writes nothing',
    chamferSame.ok && chamferSame.changed === false && chamferSame.buffer === chamferTwo.buffer,
    chamferSame.message || '',
  );
  const chamferEdit = replaceEditedBlend(chamferTwo.buffer, chamferFeature, {
    chamfer: true,
    edges: vertical.slice(0, 2),
    params: { chamfer: 2.5 },
  });
  const chamferFresh = composeChamferCommit(starter, {
    edges: vertical.slice(0, 2),
    params: { chamfer: 2.5 },
  });
  const chamferRun = chamferEdit.ok ? await exec(chamferEdit.buffer) : null;
  const chamferFreshRun = chamferFresh.ok ? await exec(chamferFresh.buffer) : null;
  check(
    'editing a disconnected chamfer matches a fresh create at the new size',
    chamferEdit.ok && chamferFresh.ok
      && !chamferRun?.featureSkip
      && !chamferFreshRun?.featureSkip
      && countFilletAlongPath(chamferEdit.buffer) === 1
      && chamferEdit.buffer === chamferFresh.buffer
      && Math.abs(Number(chamferRun.volume) - Number(chamferFreshRun.volume)) < 1e-4,
    chamferEdit.message || chamferRun?.featureSkip?.message || '',
  );
}

console.log('feature edit — coverage');
{
  const kinds = Object.keys(FEATURE_EDIT_DIALOGS);
  check('every strip kind has a creation dialog', kinds.length >= 30);
  check('fillet dialog is the fillet chip', creationDialogFor('fillet').dialog === 'fillet' && creationDialogFor('fillet').entry === 'filletEdges');
  check('extrude dialog is the contour chip', creationDialogFor('extrude').entry === 'makeExtrude');
  check('cube dialog is the helper sheet', creationDialogFor('cube').helperId === 'cube');
  const app = (await import('node:fs')).readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  const chip = (await import('node:fs')).readFileSync(new URL('../../src/components/FilletModeChip.jsx', import.meta.url), 'utf8');
  const view = (await import('node:fs')).readFileSync(new URL('../../src/components/Viewport.jsx', import.meta.url), 'utf8');
  check('strip edit calls beginFeatureEdit', /beginFeatureEdit\?\.\(/.test(app));
  check('desktop and mobile share openFeatureSheetFor', /openFeatureSheetFor/.test(app) && /handleDesktopFeatureStripJump/.test(app));
  check('confirm edit writes one buffer', /confirmFeatureEdit/.test(app) && /applyBuffer/.test(app));
  const commitFn = app.slice(app.indexOf('const handleCommitFeatureEdit'), app.indexOf('const handleFeatureSheetDelete'));
  check('edit confirm yields while an assembly open holds the auto-run lock',
    commitFn.includes('assemblyOpenLockRef.current')
    && commitFn.indexOf('assemblyOpenLockRef.current') < commitFn.indexOf('applyBuffer?.')
    && !/assemblyOpenLockRef\.current\s*=/.test(commitFn));
  check('edit preview does not post while that lock is held',
    /assemblyRunLockRef\?\.current/.test(view)
    && /editPreviewBlocked\(\)/.test(view)
    && !/assemblyOpenLockRef\.current\s*=/.test(view));
  check('fillet chip shows missing edges', /data-feature-edit-missing/.test(chip) && /data-feature-edit-clear-missing/.test(chip));
  const accept = view.slice(view.indexOf('const acceptFillet'), view.indexOf('const exitShellMode'));
  check(
    'fillet edit uses the create commit',
    accept.includes('editFeature:') && !accept.includes('commitFeatureEditRef'),
  );
  check('fillet edit splices the create composer', /replaceEditedBlend/.test(app));
  check('viewport resolves edit edges on the prefix graph', /editPreviewScript/.test(view) && /resolveStoredEdges|openFeatureEdit/.test(view));
  const parsed = parseFeatureEdit('fillet', '// --- fillet-mode begin ---\nconst selEdges = edgesBetween(part, 2, 5); // boundary edge 9\npart = filletAlongPath(part, path, 2);\n// --- fillet-mode end ---');
  check('edgesBetween parses the boundary id', parsed.ok && parsed.edges[0]?.id === 9 && parsed.fields.radius === 2);
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll feature-edit round-trip checks passed.');
