#!/usr/bin/env node
/**
 * Slice 30 — Sweep solid (profile + path) from contour mode.
 * - Advanced → Sweep enters contour mode (not a placeholder)
 * - Profile is makeCrossSection; path is makeSweepPath from edges
 * - Confirm composes sweepPoints + frame-only placeInFrame replace
 * - second Confirm on a founding Sweep stacks (part.add); host Sweep still replaces
 * - Back / strip leaves no orphan sweep
 * - loud fail on empty path, disconnected edges, empty profile
 * - Extrude / Revolve / Loft / Fillet / #41 groups stay put
 * - straight and frame-tilted sweeps build a real solid (bundled wasm)
 */
import { register } from 'node:module';
import {
  HELPER_PALETTE_GROUPS,
  itemsByGroup,
  HELPER_PALETTE_ITEMS,
  CONTOUR_SWEEP_BEGIN,
  CONTOUR_SWEEP_END,
} from '../../src/utils/helperPaletteSnippets.js';
import { isFilletEntry } from '../../src/utils/filletMode.js';
import {
  pickFilletStrategy,
  resolveFilletStrategy,
} from '../../src/utils/filletAlongPath.js';
import { resolveFaceModal } from '../../src/utils/faceFeaturePlacement.js';
import {
  isContourEntry,
  isExtrudeEntry,
  isRevolveEntry,
  isLoftEntry,
  isSweepEntry,
  enterContourState,
  defaultSweepParams,
  defaultExtrudeParams,
  defaultRevolveParams,
  validateSweepPath,
  buildSweepSolidPreview,
  composeContourSweep,
  composeContourCommit,
  composeContourExtrude,
  stripContourSweepBlock,
  hasContourSweepBlock,
  hasContourExtrudeBlock,
  hasContourProfileBlock,
  contourSweepOwnedRegion,
  countMakeCrossSection,
  countMakeExtrude,
  countSweepPoints,
  SWEEP_EMPTY_PATH,
} from '../../src/utils/contourMode.js';

register('./manifold-resolve-hook.mjs', import.meta.url);

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('slice-30 sweep solid smoke');

const starter = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

const straight = [
  { a: 0, b: 1, va: [0, 0, 0], vb: [0, 0, 20], length: 20, key: 'e0' },
];

const disconnected = [
  { a: 0, b: 1, va: [0, 0, 0], vb: [10, 0, 0], length: 10, key: 'e0' },
  { a: 2, b: 3, va: [0, 5, 0], vb: [10, 5, 0], length: 10, key: 'e1' },
];

const xFace = {
  type: 'planar',
  center: [0, 0, 0],
  normal: [1, 0, 0],
  area: 400,
  triangleCount: 2,
  selectionMode: 'coplanar',
};

function sweepPayload(extra = {}) {
  return {
    face: null,
    tool: 'circle',
    params: { radius: 2, segments: 24 },
    edges: straight,
    sweep: { reverse: false },
    entry: 'makeSweep',
    ...extra,
  };
}

// ── Entry / groups ─────────────────────────────────────────────
{
  check('Sweep is contour entry', isContourEntry('makeSweep') && isSweepEntry('makeSweep'));
  check('Sweep is not Extrude/Revolve/Loft/Fillet',
    !isExtrudeEntry('makeSweep') && !isRevolveEntry('makeSweep')
    && !isLoftEntry('makeSweep') && !isFilletEntry('makeSweep'));
  check('Extrude/Revolve/Loft/Profile still contour entries',
    isContourEntry('makeExtrude') && isContourEntry('makeRevolve')
    && isContourEntry('makeLoft') && isContourEntry('crossSection'));
  check('Fillet stays out of contour mode', !isContourEntry('filletEdges') && isFilletEntry('filletEdges'));

  const grouped = itemsByGroup();
  check(
    'palette groups unchanged',
    HELPER_PALETTE_GROUPS.join('|') === 'Primitives|Advanced|Features|Transforms',
  );
  check(
    'Advanced order Profile Workplane Extrude Revolve Sweep Loft',
    grouped.Advanced.map((i) => i.id).join(',') === 'crossSection,workplane,makeExtrude,makeRevolve,makeSweep,makeLoft',
  );
  const sweep = grouped.Advanced.find((i) => i.id === 'makeSweep');
  check('Sweep is not a placeholder', sweep && sweep.placeholder !== true);
  check('Sweep title is contour mode', /contour/i.test(sweep?.title || ''));
  check('Fillet still in Features', grouped.Features.some((i) => i.id === 'filletEdges'));
  check('Path still in Features', grouped.Features.some((i) => i.id === 'sweepPath'));
  check('Profile in Advanced', grouped.Advanced.some((i) => i.id === 'crossSection'));
  check('Workplane in Advanced', grouped.Advanced.some((i) => i.id === 'workplane'));
  check('Profile left Features', !grouped.Features.some((i) => i.id === 'crossSection'));

  const st = enterContourState('makeSweep', null);
  check('enter Sweep keeps entry', st.entry === 'makeSweep');
  check('enter Sweep seeds circle profile', st.tool === 'circle' && st.params.radius === 5);
  check('enter Sweep seeds reverse off', st.sweep && st.sweep.reverse === false);
  check('enter Sweep still seeds Extrude defaults',
    st.extrude && st.extrude.distance === defaultExtrudeParams().distance);
  check('enter Sweep still seeds Revolve defaults',
    st.revolve && st.revolve.angle === defaultRevolveParams().angle);
  check('defaultSweepParams reverse off', defaultSweepParams().reverse === false);
}

// ── Loud fail ──────────────────────────────────────────────────
{
  const empty = composeContourSweep(starter, sweepPayload({ edges: [] }));
  check('empty path refuses', empty.ok === false);
  check('empty path message', empty.message === SWEEP_EMPTY_PATH, empty.message || '');
  check('empty path does not write', !hasContourSweepBlock(starter));

  const disc = composeContourSweep(starter, sweepPayload({ edges: disconnected }));
  check('disconnected path refuses', disc.ok === false);
  check('disconnected message', /disconnect/i.test(disc.message || ''), disc.message || '');

  const badProfile = composeContourSweep(starter, sweepPayload({
    params: { radius: 0, segments: 24 },
  }));
  check('empty profile refuses', badProfile.ok === false);
  check('empty profile mentions radius', /radius/i.test(badProfile.message || ''), badProfile.message || '');

  const previewBad = buildSweepSolidPreview(null, 'circle', { radius: 2, segments: 16 }, disconnected, {});
  check('disconnected preview is null', previewBad == null);
  const previewEmpty = buildSweepSolidPreview(null, 'circle', { radius: 2, segments: 16 }, [], {});
  check('empty-path preview is null', previewEmpty == null);
}

// ── Confirm compose ────────────────────────────────────────────
{
  const first = composeContourSweep('', sweepPayload());
  check('empty-buffer Sweep ok', first.ok === true, first.message || '');
  check('empty-buffer has markers', hasContourSweepBlock(first.buffer));
  check('markers bookend', first.buffer.includes(CONTOUR_SWEEP_BEGIN) && first.buffer.includes(CONTOUR_SWEEP_END));
  const owned = contourSweepOwnedRegion(first.buffer);
  check('owned has makeCrossSection', /makeCrossSection\s*\(/.test(owned));
  check('owned has makeSweepPath', /makeSweepPath\s*\(/.test(owned));
  check('owned has sweepPoints', /sweepPoints\s*\(/.test(owned));
  check('owned has placeInFrame', /placeInFrame\s*\(/.test(owned));
  check('owned has no placeOnFace', !/placeOnFace\s*\(/.test(owned));
  check('owned has no host add', !/part\s*=\s*part\.add\(/.test(owned));
  check('owned has no starter cube', !/Manifold\.cube\s*\(/.test(first.buffer));
  check('empty buffer uses let part', /let\s+part\s*=\s*placeInFrame\(/.test(owned));
  check('one makeCrossSection', countMakeCrossSection(first.buffer) === 1);
  check('one sweepPoints', countSweepPoints(first.buffer) === 1);
  check('router matches direct compose', composeContourCommit('', sweepPayload()).buffer === first.buffer);

  const preview = buildSweepSolidPreview(null, 'circle', { radius: 2, segments: 16 }, straight, {});
  check('straight preview has stations', preview && preview.stations.length >= 2);
  check('straight preview open', preview && preview.closed === false);

  const second = composeContourSweep(first.buffer, sweepPayload({
    params: { radius: 4, segments: 24 },
  }));
  check('second Confirm ok', second.ok === true, second.message || '');
  // Founding `let part` Sweep is kept — Extrude-on-Extrude-class stack, not wipe/TDZ.
  check('second Confirm stacks a second sweep block',
    (second.buffer.match(/contour-mode sweep begin/g) || []).length === 2);
  check('second Confirm keeps founding let part + part.add',
    /let\s+part\s*=\s*placeInFrame\(/.test(second.buffer)
    && /part\s*=\s*part\.add\(\s*placeInFrame\(/.test(second.buffer));
  check('second Confirm has two sweepPoints', countSweepPoints(second.buffer) === 2);
  check('second Confirm includes new radius', /profileCircle\(4/.test(second.buffer));
  check('second Confirm keeps prior radius (stack)', /profileCircle\(2/.test(second.buffer));

  const reversed = composeContourSweep('', sweepPayload({ sweep: { reverse: true } }));
  check('reverse emits flag', reversed.ok && /reverse:\s*true/.test(contourSweepOwnedRegion(reversed.buffer)));

  const stripped = stripContourSweepBlock(first.buffer);
  check('Back-equivalent has no orphan Sweep', !hasContourSweepBlock(stripped));
  check('Back-equivalent has no sweepPoints', countSweepPoints(stripped) === 0);
  check('Back-equivalent has no makeCrossSection', countMakeCrossSection(stripped) === 0);

  const onStarter = composeContourSweep(starter, sweepPayload());
  check('starter Sweep unions onto part',
    onStarter.ok && /part\s*=\s*part\.add\(\s*placeInFrame\(/.test(onStarter.buffer));
  check('starter Sweep keeps the cube', /Manifold\.cube\(/.test(onStarter.buffer));
  check('starter Sweep has no placeOnFace', !/placeOnFace\s*\(/.test(contourSweepOwnedRegion(onStarter.buffer)));
  const back = stripContourSweepBlock(onStarter.buffer);
  check('strip restores a buffer without sweep markers', !hasContourSweepBlock(back));
  check('strip leaves the starter cube', /Manifold\.cube\(/.test(back));
}

// ── Siblings preserved ─────────────────────────────────────────
{
  const swept = composeContourSweep(starter, sweepPayload());
  const thenExt = composeContourExtrude(swept.buffer, {
    face: null,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('Extrude after Sweep strips sweep', thenExt.ok && !hasContourSweepBlock(thenExt.buffer));
  check('Extrude after Sweep has extrude markers', hasContourExtrudeBlock(thenExt.buffer));
  check('Extrude after Sweep one makeExtrude', countMakeExtrude(thenExt.buffer) === 1);
  check('Extrude after Sweep no sweepPoints', countSweepPoints(thenExt.buffer) === 0);

  const profile = composeContourCommit(swept.buffer, {
    entry: 'crossSection',
    face: null,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
  });
  check('Profile Confirm stays profile-only', profile.ok && profile.run === false);
  check('Profile Confirm writes a named contour', /@contour id=c1/.test(profile.buffer) && !hasContourProfileBlock(profile.buffer));
  check('Profile Confirm leaves the sweep', hasContourSweepBlock(profile.buffer));
  check('named contour is not the sweep path', !/sweepPoints\s*\(/.test(
    (profile.buffer.match(/const c1 = makeCrossSection\([\s\S]*?\/\/ @contour id=c1/) || [''])[0],
  ));

  check('pickFilletStrategy is sweep', pickFilletStrategy() === 'sweep');
  check('resolveFilletStrategy(auto) is sweep', resolveFilletStrategy('auto') === 'sweep');
  const fillet = HELPER_PALETTE_ITEMS.find((h) => h.id === 'filletEdges');
  const strat = (fillet?.params || []).find((p) => p.name === 'strategy');
  check('palette Fillet Strategy default sweep', strat && strat.default === 'sweep');
  const modal = resolveFaceModal(fillet, null, straight);
  check('fillet edge modal still opens', modal.mode === 'params');

  const gate = validateSweepPath(straight, { reverse: true });
  check('validate reverse still a path', gate.ok && gate.normalized.reverse === true && gate.path.points.length >= 2);
}

// ── Function() under stubs ─────────────────────────────────────
{
  const composed = composeContourSweep(starter, sweepPayload());
  const stubs = {
    Manifold: { cube: () => ({ _cube: true, add(x) { return x; } }) },
    profileCircle: (r) => ({ type: 'circle', contours: [[[r, 0], [0, r], [-r, 0], [0, -r]]] }),
    makeCrossSection: (plane, profile) => ({
      kind: 'crossSection',
      plane,
      contours: profile.contours,
    }),
    makeSweepPath: () => ({
      kind: 'sweepPath',
      closed: false,
      points: [[0, 0, 0], [0, 0, 20]],
      length: 20,
      edgeCount: 1,
    }),
    CrossSection: function CrossSection() { return { _cs: true }; },
    sweepPoints: () => ({ volume: () => 1, _t: 'sweep' }),
    placeInFrame: (_frame, solid) => solid,
    placeOnFace: () => { throw new Error('placeOnFace must not run'); },
  };
  try {
    const fn = new Function(...Object.keys(stubs), `"use strict";\n${composed.buffer}`);
    const result = fn(...Object.values(stubs));
    check('composed Sweep Function() runs', result && result._t === 'sweep');
  } catch (e) {
    check('composed Sweep Function() runs', false, String(e.message || e));
  }
}

// ── Geometry via sandboxWorker ─────────────────────────────────
console.log('slice-30 geometry (bundled wasm + helpers)');

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
      if (!workerSelf.onmessage) {
        reject(new Error('sandboxWorker handler missing'));
        return;
      }
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

{
  const script = composeContourSweep('', sweepPayload()).buffer;
  try {
    const payload = await exec(script);
    const vol = payload?.volume;
    const bb = payload?.boundingBox;
    const zSpan = bb ? bb.max[2] - bb.min[2] : 0;
    const xy = bb ? Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]) : 99;
    check('straight sweep volume ≈ πr²L', vol > 180 && vol < 400, `vol=${vol}`);
    check('straight sweep runs along Z', zSpan > 15 && xy < 12, `z=${zSpan} xy=${xy}`);
    check('straight sweep NoError', payload?.status === 'NoError' || !payload?.status, `status=${payload?.status}`);
  } catch (e) {
    check('straight sweep builds', false, String(e.message || e));
  }
}

{
  const alongX = [
    { a: 0, b: 1, va: [0, 0, 0], vb: [20, 0, 0], length: 20, key: 'ex' },
  ];
  const script = composeContourSweep('', sweepPayload({
    face: xFace,
    edges: alongX,
  })).buffer;
  check('tilted frame literal normal +X', /normal:\s*\[1,\s*0,\s*0\]/.test(script));
  try {
    const payload = await exec(script);
    const bb = payload?.boundingBox;
    const xSpan = bb ? bb.max[0] - bb.min[0] : 0;
    const ySpan = bb ? bb.max[1] - bb.min[1] : 99;
    const zSpan = bb ? bb.max[2] - bb.min[2] : 99;
    check('frame-only placeInFrame keeps the sweep on +X',
      payload?.volume > 180 && xSpan > 15 && ySpan < 12 && zSpan < 12,
      `vol=${payload?.volume} x=${xSpan} y=${ySpan} z=${zSpan}`);
  } catch (e) {
    check('tilted sweep builds', false, String(e.message || e));
  }
}

{
  const bad = `
const fr = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const xs = makeCrossSection(fr, profileCircle(2, 16));
const path = makeSweepPath([]);
return sweepPoints(new CrossSection(xs.contours), path.points, { closed: false });
`;
  let threw = false;
  let msg = '';
  try {
    await exec(bad);
  } catch (e) {
    threw = true;
    msg = String(e.message || e);
  }
  check('worker empty path throws', threw && /edge|path|makeSweepPath/i.test(msg), msg || 'did not throw');
}

if (failed) {
  console.log(`\nFAILED: ${failed}`);
  process.exit(1);
}
console.log('\nAll slice-30 sweep checks passed.');
