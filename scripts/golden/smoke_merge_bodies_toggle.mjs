#!/usr/bin/env node
/**
 * Merge bodies toggle (slice N).
 *
 * Every additive feature (Block palette: cube / round box / cylinder /
 * sphere / tube / hex; Shape: Extrude / Revolve / Loft / Sweep) has Merge
 * bodies, on by default and hidden in Subtract. On writes the old
 * `part = part.add(x);` (union). Off writes `part = part.add(x, { merge: false });`
 * and the worker composes instead of unioning, so the solid stays a separate
 * body of the same part.
 *
 * FilletKiller (20 mm cube + three R=2 fillets) + a 10 mm cube at x = 10:
 *   merge off → 2 bodies; Boolean union of the two → 1; merge on → 1.
 * Then every follow-up feature on the 2-body part: per-body booleans keep the
 * overlap from fusing them, face features run on the picked body only.
 *
 * Slice O: the violet strip marker derives from live body count — present at
 * 2 bodies, cleared after Boolean union to 1 — not from the script alone.
 */
import { register } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { BufferAttribute, BufferGeometry } from 'three';
import {
  composeHelperInsert,
  defaultParamsFor,
  HELPER_PALETTE_ITEMS,
} from '../../src/utils/helperPaletteSnippets.js';
import {
  composeContourExtrude,
  composeContourRevolve,
  composeContourLoft,
  composeContourSweep,
  defaultContourParams,
  defaultExtrudeParams,
  defaultLoftProfiles,
} from '../../src/utils/contourMode.js';
import { parseFeatureMarkers, featureShowsSeparateBody } from '../../src/utils/featureMarkers.js';
import {
  emptyBooleanState,
  applyBooleanTap,
  composeBooleanCommit,
  meshBodyComponents,
} from '../../src/utils/booleanMode.js';
import { selectOwningBody } from '../../src/utils/selectFace.js';
import { buildPartGraphPatches } from '../../src/utils/partGraphPatches.js';
import { buildFeatureEdges } from '../../src/utils/selectEdge.js';
import { listCutPieces, emptyCutState, applyCutTap, setCutPickTarget, setCutPlaneSource } from '../../src/utils/cutMode.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

register('./manifold-resolve-hook.mjs', import.meta.url);
const pending = new Map();
let msgId = 0;
const workerSelf = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const w = pending.get(msg.id);
    if (!w) return;
    pending.delete(msg.id);
    w.resolve(msg);
  },
};
globalThis.self = workerSelf;
function send(type, payload = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, { resolve });
    Promise.resolve().then(() => workerSelf.onmessage({ data: { type, payload, id } }));
  });
}
await import('../../src/workers/sandboxWorker.js');
await send('init');

const run = async (script) => {
  const r = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
  if (r.type !== 'result') return { ok: false, message: r.payload?.message || String(r.type) };
  return { ok: true, ...r.payload, bodies: r.payload.bodyCentroids.length };
};

function meshOf(mesh) {
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  const nVert = Math.floor(src.length / np);
  const positions = new Float32Array(nVert * 3);
  for (let i = 0; i < nVert; i++) {
    positions[i * 3] = src[i * np];
    positions[i * 3 + 1] = src[i * np + 1];
    positions[i * 3 + 2] = src[i * np + 2];
  }
  const indices = new Uint32Array(mesh.triVerts);
  const faceIDs = mesh.faceID ? Int32Array.from(mesh.faceID) : null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return { geometry, positions, indices, faceIDs };
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('merge bodies toggle');

// FilletKiller (fixtures/artur_playtest_chamfer_multi_rotation.txt, before the chain).
const FK = [
  '// --- cube begin ---',
  'let box1 = Manifold.cube([20, 20, 20], true);',
  'let part = box1;',
  '// --- cube end ---',
  'const selEdges = edgesBetween(part, 3, 6);',
  'part = filletAlongPath(part, makeSweepPath(selEdges), 2);',
  'const selEdges2 = edgesBetween(part, 2, 5);',
  'part = filletAlongPath(part, makeSweepPath(selEdges2), 2);',
  'const selEdges3 = edgesBetween(part, 0, 2);',
  'part = filletAlongPath(part, makeSweepPath(selEdges3), 2, { variableProfile: true });',
  'return part;',
  '',
].join('\n');
{
  const fixture = read('scripts/golden/fixtures/artur_playtest_chamfer_multi_rotation.txt');
  const body = FK.split('\n').filter((l) => l && !l.startsWith('//') && l !== 'return part;').join('\n');
  check('FilletKiller fixture still opens with this script', fixture.startsWith(body));
}

const BLOCK = { width: 10, depth: 10, height: 10, center: true, x: 10, combine: 'add' };

// ── Toggle: default on, every additive feature, hidden in Subtract ─────
{
  const BLOCKS = ['cube', 'roundedBox', 'cylinder', 'sphere', 'tube', 'hexPrism'];
  const SHAPES = ['makeExtrude', 'makeRevolve', 'makeLoft'];
  for (const id of [...BLOCKS, ...SHAPES]) {
    const item = HELPER_PALETTE_ITEMS.find((h) => h.id === id);
    const p = item.params.find((x) => x.name === 'merge');
    check(`${id}: Merge bodies on by default, hidden unless Mode is Add`,
      defaultParamsFor(id).merge === true && p?.type === 'bool' && p.label === 'Merge bodies'
      && JSON.stringify(p.showWhen) === JSON.stringify({ field: 'combine', values: ['add'] }));
  }
  for (const id of ['hole', 'filletEdges', 'shell', 'crossSection', 'workplane']) {
    check(`${id} has no Merge bodies`, defaultParamsFor(id)?.merge == null);
  }
  for (const id of BLOCKS) {
    const on = composeHelperInsert(FK, id, null, { combine: 'add' });
    const off = composeHelperInsert(FK, id, null, { combine: 'add', merge: false });
    const sub = composeHelperInsert(FK, id, null, { combine: 'subtract', merge: false });
    check(`${id}: on writes the bare union`, /part = part\.add\(\w+\);/.test(on) && !/merge/.test(on), on);
    check(`${id}: off writes { merge: false }`, /part = part\.add\(\w+, \{ merge: false \}\);/.test(off), off);
    check(`${id}: Subtract ignores the toggle`, /part = part\.subtract\(\w+\);/.test(sub) && !/merge/.test(sub));
  }
  const first = composeHelperInsert('', 'cube', null, { merge: false });
  check('first body on an empty script is still `let part`', /let part = box1;/.test(first) && !/merge/.test(first));

  // HelperParamModal hides the field from showWhen; ContourModeChip hides it in Subtract.
  const modal = read('src/components/HelperParamModal.jsx');
  check('param sheet honours showWhen', /p\.showWhen && !ruleHolds\(p\.showWhen\)/.test(modal));
  const chip = read('src/components/ContourModeChip.jsx');
  check('contour chip: Merge bodies only for a solid in Add',
    /solidEntry && combineOp === 'add' && \(/.test(chip) && /data-contour-merge=/.test(chip) && /Merge bodies/.test(chip));
  const vp = read('src/components/Viewport.jsx');
  check('viewport: contour state carries merge into the commit',
    /merge: loftState\.combine === 'subtract' \? true : loftState\.merge !== false/.test(vp)
    && /onMergeChange=\{/.test(vp));
  check('contour mode starts with merge on',
    /combine: 'add',\n\s+merge: true,/.test(read('src/utils/contourMode.js')));
}

// ── Shape writers (contour Confirm) ─────────────────────────────────────
{
  const face = {
    type: 'planar',
    planeFrame: { center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
  };
  const base = { face, tool: 'circle', params: { radius: 3, segments: 24 } };
  const ex = (merge) => composeContourExtrude(FK, { ...base, extrude: defaultExtrudeParams(), combine: 'add', merge });
  const rv = (merge) => composeContourRevolve(FK, { ...base, revolve: { angle: 360, axis: 'v', sense: 'positive' }, combine: 'add', merge });
  const lf = (merge) => composeContourLoft(FK, { face, loft: { profiles: defaultLoftProfiles(), selected: 0 }, combine: 'add', merge });
  const sw = (merge) => composeContourSweep(FK, {
    face: null,
    tool: 'circle',
    params: { radius: 2, segments: 24 },
    edges: [{ a: 0, b: 1, va: [0, 0, 10], vb: [0, 0, 30], length: 20, key: 'e0' }],
    sweep: { reverse: false },
    entry: 'makeSweep',
    combine: 'add',
    merge,
  });
  for (const [name, fn] of [['Extrude', ex], ['Revolve', rv], ['Loft', lf], ['Sweep', sw]]) {
    const on = fn(undefined);
    const off = fn(false);
    check(`${name}: default is the bare union`,
      on.ok && /part = part\.add\(placeInFrame\([\s\S]*?\)\);/.test(on.buffer) && !/merge: false/.test(on.buffer),
      on.message || on.buffer);
    check(`${name}: off writes part.add(placeInFrame(...), { merge: false })`,
      off.ok && /part = part\.add\(placeInFrame\([\s\S]*?\), \{ merge: false \}\);/.test(off.buffer),
      off.message || off.buffer);
    if (off.ok) {
      const r = await run(off.buffer);
      check(`${name}: merge off runs and gives 2 bodies`, r.ok && r.bodies === 2, r.message || `${r.bodies} bodies`);
      const strip = parseFeatureMarkers(off.buffer);
      check(`${name}: strip marks only that chip as a separate body`,
        strip.filter((f) => f.separate).length === 1 && strip.find((f) => f.separate)?.kind === name.toLowerCase());
    }
  }
  const sub = composeContourExtrude(FK, { ...base, extrude: defaultExtrudeParams(), combine: 'subtract', merge: false });
  check('Extrude Subtract ignores merge', sub.ok && /part = part\.subtract\(/.test(sub.buffer) && !/merge/.test(sub.buffer));
}

// ── The golden: FilletKiller + overlapping Block ────────────────────────
const solo = await run(FK);
const blockVol = 1000;
const offScript = composeHelperInsert(FK, 'cube', null, { ...BLOCK, merge: false });
const onScript = composeHelperInsert(FK, 'cube', null, { ...BLOCK });
const off = await run(offScript);
const on = await run(onScript);
check('FilletKiller alone is one body', solo.ok && solo.bodies === 1);
check('merge off → 2 bodies in the same part', off.ok && off.bodies === 2, `${off.bodies} ${off.message || ''}`);
check('merge off composes (volume = FK + block, no boolean)', near(off.volume, solo.volume + blockVol, 1e-3),
  `${off.volume} vs ${solo.volume + blockVol}`);
check('merge on → 1 body', on.ok && on.bodies === 1, `${on.bodies}`);
check('merge on unions (overlap counted once)', on.volume < solo.volume + blockVol - 100, `${on.volume}`);

let unionScript = null;
{
  // Boolean: tap FK, tap the block, Confirm union.
  const m = meshOf(off.mesh);
  const bodies = meshBodyComponents(m.positions, m.indices);
  check('viewer sees 2 bodies (no shared vertices)', bodies.length === 2);
  const blockBody = bodies.find((b) => b.center[0] > 5);
  const fkBody = bodies.find((b) => b !== blockBody);
  let st = emptyBooleanState();
  st = applyBooleanTap(st, { triangle: fkBody.minTri, positions: m.positions, index: m.indices, partId: 'p' }).state;
  st = applyBooleanTap(st, { triangle: blockBody.minTri, positions: m.positions, index: m.indices, partId: 'p' }).state;
  const commit = composeBooleanCommit(offScript, st, 'p', { positions: m.positions, index: m.indices, bodyCount: 2 });
  check('Boolean union commits over the 2 bodies', commit.ok, commit.message);
  unionScript = commit.buffer;
  const u = await run(commit.buffer);
  check('Boolean union → 1 body', u.ok && u.bodies === 1, `${u.bodies} ${u.message || ''}`);
  check('Boolean union volume equals merge on', near(u.volume, on.volume, 0.05), `${u.volume} vs ${on.volume}`);

  // Double-click body select stays on one body.
  const own = selectOwningBody(m.geometry, blockBody.minTri);
  check('double-click selects the block body only',
    own.length === blockBody.triangles.length && own.every((t) => blockBody.triangles.includes(t)));
  // Face graph: no patch spans both bodies.
  const triBody = new Int32Array(m.indices.length / 3);
  for (const t of blockBody.triangles) triBody[t] = 1;
  const graph = buildPartGraphPatches({ positions: m.positions, indices: m.indices, faceIDs: m.faceIDs });
  const mixed = graph.patches.filter((p) => p.tris.length && !p.tris.every((t) => triBody[t] === triBody[p.tris[0]]));
  check('face graph: every patch stays on one body', graph.patches.length > 0 && mixed.length === 0, `${mixed.length} mixed`);
  // Edge graph: every feature edge belongs to one body, both bodies have edges.
  const edges = buildFeatureEdges(m.geometry);
  const ids = new Set(edges.map((e) => e.bodyId));
  check('edge graph: edges carry one of 2 body ids', ids.size === 2 && !ids.has(-1));
  // Cut Pieces: a z = 0 cut lists FK and block pieces separately.
  let cs = setCutPickTarget(setCutPlaneSource(emptyCutState(), 'xy'), 'bodies');
  cs = applyCutTap(cs, { triangle: fkBody.minTri, positions: m.positions, index: m.indices }).state;
  cs = applyCutTap(cs, { triangle: blockBody.minTri, positions: m.positions, index: m.indices }).state;
  const pieces = listCutPieces(cs, m.positions, m.indices);
  check('Pieces: a plane through both bodies lists 4 pieces', pieces.length === 4, `${pieces.length}`);
}

// ── Follow-up features on the 2-body part ───────────────────────────────
const C = off.bodyCentroids;
const fkAt = C.find((c) => c[0] < 5);
const blkAt = C.find((c) => c[0] > 5);
const two = offScript.replace(/return part;\s*$/, '');
const after = async (line) => run(`${two}${line}\nreturn part;\n`);
{
  const r1 = await after('part = part.subtract(Manifold.cylinder(40, 2, 2, 32, true).translate([8, 0, 0]));');
  check('Subtract through the overlap keeps 2 bodies', r1.ok && r1.bodies === 2, `${r1.bodies}`);
  const r2 = await after('part = part.add(Manifold.cube([4, 4, 4], true).translate([16, 0, 0]));');
  check('merge-on Add touching only the block: still 2 bodies', r2.ok && r2.bodies === 2, `${r2.bodies}`);
  const r2b = await after('part = part.add(Manifold.cube([4, 4, 4], true).translate([17, 0, 0]));');
  check('merge-on Add sitting on the block face joins it (2 bodies)', r2b.ok && r2b.bodies === 2
    && near(r2b.volume, off.volume + 64, 1e-3), `${r2b.bodies} ${r2b.volume}`);
  const r3 = await after('part = part.add(Manifold.cube([4, 4, 4], true).translate([9, 0, 4]));');
  check('merge-on Add touching both bodies joins them (1 body)', r3.ok && r3.bodies === 1, `${r3.bodies}`);
  const r4 = await after('part = part.add(Manifold.cube([2, 2, 2], true).translate([40, 0, 0]));');
  check('merge-on Add away from both: a third body', r4.ok && r4.bodies === 3, `${r4.bodies}`);
  const r5 = await after('part = part.add(Manifold.cube([2, 2, 2], true).translate([12, 0, 0]), { merge: false });');
  check('a second merge-off Add inside the block: 3 bodies', r5.ok && r5.bodies === 3, `${r5.bodies}`);

  const fil = await after('part = filletAlongPath(part, makeSweepPath([{ a: 0, b: 1, va: [15, 5, 5], vb: [15, -5, 5], length: 10 }]), 1);');
  check('fillet on a block edge: 2 bodies, ~(1 − π/4)·10 removed', fil.ok && fil.bodies === 2
    && near(off.volume - fil.volume, (1 - Math.PI / 4) * 10, 0.2), `${fil.bodies} ${off.volume - fil.volume}`);
  const ch = await after("part = filletAlongPath(part, makeSweepPath([{ a: 0, b: 1, va: [15, 5, 5], vb: [15, -5, 5], length: 10 }]), 1, { profile: 'chamfer' });");
  check('chamfer on a block edge: 2 bodies, 5 mm³ removed', ch.ok && ch.bodies === 2 && near(off.volume - ch.volume, 5, 0.1),
    `${ch.bodies} ${off.volume - ch.volume} ${ch.message || ''}`);

  const blockOnly = await run('let part = Manifold.cube([10, 10, 10], true).translate([10, 0, 0]);\npart = hollow(part, 1.5, { center: [12, 0, 5], normal: [0, 0, 1] });\nreturn part;\n');
  const sh = await after('part = hollow(part, 1.5, { center: [12, 0, 5], normal: [0, 0, 1] });');
  check('shell the block: FK keeps its volume, block matches a solo shell', sh.ok && sh.bodies === 2
    && near(sh.volume, solo.volume + blockOnly.volume, 0.01), `${sh.volume} vs ${solo.volume + blockOnly.volume}`);
  const fkShell = await run(FK.replace('return part;', 'part = hollow(part, 1.5, { center: [0, 0, 10], normal: [0, 0, 1] });\nreturn part;'));
  const sh2 = await after('part = hollow(part, 1.5, { center: [0, 0, 10], normal: [0, 0, 1] });');
  check('shell FilletKiller: block untouched, FK matches a solo shell', sh2.ok && sh2.bodies === 2
    && near(sh2.volume, fkShell.volume + blockVol, 0.01), `${sh2.volume} vs ${fkShell.volume + blockVol}`);

  const draftSolo = await run('let part = Manifold.cube([10, 10, 10], true).translate([10, 0, 0]);\npart = draftFaces(part, [{ center: [10, 5, 0], normal: [0, 1, 0] }], 5, { pull: "z" });\nreturn part;\n');
  const dr = await after('part = draftFaces(part, [{ center: [10, 5, 0], normal: [0, 1, 0] }], 5, { pull: "z" });');
  check('draft a block face on the seam: drafts the block (its own neutral plane)', dr.ok && dr.bodies === 2
    && near(dr.volume, solo.volume + draftSolo.volume, 0.01), `${dr.volume} vs ${solo.volume + draftSolo.volume} ${dr.message || ''}`);

  const mf = await after('part = moveFace(part, [{ center: [15, 0, 0], normal: [1, 0, 0] }], 3);');
  check('Move Face on the block: 2 bodies, +300', mf.ok && mf.bodies === 2 && near(mf.volume - off.volume, 300, 0.01),
    `${mf.volume - off.volume}`);
  const df = await after(
    'part = part.add(Manifold.cube([40, 30, 20], true).trimByPlane([-0.7071067811865476, 0, -0.7071067811865476], -18.384776310850235).translate([0, 0, 40]), { merge: false });\n'
    + 'part = deleteFace(part, [{ center: [18, 0, 48], normal: [0.7071067811865476, 0, 0.7071067811865476] }]);',
  );
  check('Delete Face on a third body: heals that body only', df.ok && df.bodies === 3
    && near(df.volume, off.volume + 24000, 0.01), `${df.bodies} ${df.volume} ${df.message || ''}`);

  const cu = await after('part = cut(part, { normal: [0, 0, 1], originOffset: 0 });');
  check('Cut through both bodies: 4 pieces, volume kept', cu.ok && cu.bodies === 4 && near(cu.volume, off.volume, 0.01));
  const mv = await after(`part = move(part, [0, 0, 20], { bodies: [{ at: [${blkAt.join(', ')}] }] });`);
  check('Move the block body only', mv.ok && mv.bodies === 2 && mv.bodyCentroids.some((c) => near(c[2], 20, 1e-3)));
  const di = await after(`part = booleanBodies(part, { op: 'difference', bodies: [{ at: [${fkAt.join(', ')}] }, { at: [${blkAt.join(', ')}] }] });`);
  check('Boolean difference FK − block → 1 body', di.ok && di.bodies === 1 && near(di.volume, solo.volume - (off.volume - on.volume), 0.05),
    `${di.volume}`);

  // Cross-part clone: another part copies just the block body.
  const clone = await run(`let part = Manifold.cube([4, 4, 4], true).translate([0, 0, 40]);\n`
    + `part = part.add(externalBody(function () {\n${offScript}}, { bodies: [{ at: [${blkAt.join(', ')}] }], offset: [0, 0, 0] }));\nreturn part;\n`);
  check('cross-part clone picks the block body alone', clone.ok && clone.bodies === 2 && near(clone.volume, 64 + blockVol, 1e-3),
    `${clone.bodies} ${clone.volume} ${clone.message || ''}`);
  const cloneBoth = await run(`let part = Manifold.cube([4, 4, 4], true).translate([0, 0, 40]);\n`
    + `part = part.add(externalBody(function () {\n${offScript}}, { offset: [0, 0, 0] }));\nreturn part;\n`);
  check('cross-part clone of the whole part: both bodies come along, still separate', cloneBoth.ok && cloneBoth.bodies === 3,
    `${cloneBoth.bodies}`);
}

// ── Single-body scripts are unchanged ───────────────────────────────────
{
  const a = await run('let part = Manifold.cube([20, 20, 20], true);\npart = part.add(Manifold.cube([10, 10, 10], true).translate([10, 0, 0]));\npart = part.subtract(Manifold.cylinder(40, 2, 2, 32, true));\nreturn part;\n');
  check('bare add / subtract on one body: same union as before', a.ok && a.bodies === 1
    && near(a.volume, 8000 + 500 - Math.PI * 4 * 20 * (32 * Math.sin(Math.PI / 16) / (2 * Math.PI)), 0.5), `${a.volume}`);
  const k = await run('let part = Manifold.cube([10, 10, 10]);\npart = part.add(Manifold.cube([10, 10, 10]).translate([10, 0, 0]));\nreturn part;\n');
  check('face-to-face bare add still fuses', k.ok && k.bodies === 1 && near(k.volume, 2000, 1e-6));
}

// ── Strip chip marker (live body state) ─────────────────────────────────
{
  const feats = parseFeatureMarkers(offScript);
  const cubes = feats.filter((f) => f.kind === 'cube');
  check('strip: the merge-off Cube is marked separate, the founding Cube is not',
    cubes.length === 2 && !cubes[0].separate && cubes[1].separate === true);
  check('strip: merge-on script marks nothing', parseFeatureMarkers(onScript).every((f) => !f.separate));
  // AST still records how the block wrote; the live marker uses bodyCount.
  const afterUnion = parseFeatureMarkers(unionScript);
  check('strip: after Boolean the Cube chip still wrote merge:false (AST)',
    afterUnion.filter((f) => f.separate).length === 1);
  check('live: marker on at 2 bodies, off at 1 (Boolean union clears it)',
    featureShowsSeparateBody(cubes[1], 2) === true
    && featureShowsSeparateBody(cubes[1], 1) === false
    && featureShowsSeparateBody(cubes[0], 2) === false
    && featureShowsSeparateBody(afterUnion.find((f) => f.separate), 1) === false);

  const dir = mkdtempSync(join(tmpdir(), 'merge-bodies-'));
  const out = join(dir, 'ui.mjs');
  const res = await build({
    stdin: {
      contents: `export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
export { default as FeatureStrip } from './src/components/FeatureStrip.jsx';
export { default as ContourModeChip } from './src/components/ContourModeChip.jsx';`,
      resolveDir: ROOT,
      loader: 'jsx',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'text', '.png': 'dataurl' },
    logLevel: 'error',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  writeFileSync(out, res.outputFiles[0].text);
  const ui = await import(out);
  rmSync(dir, { recursive: true, force: true });
  const h = (Comp, props) => {
    const err = console.error;
    console.error = (...a) => { if (!/useLayoutEffect does nothing on the server/.test(String(a[0]))) err(...a); };
    try { return ui.renderToStaticMarkup(ui.createElement(Comp, props)); } finally { console.error = err; }
  };
  const chipOf = (html, id) => {
    const i = html.indexOf(`data-feature-id="${id}"`);
    if (i < 0) return '';
    return html.slice(i, html.indexOf('</button>', i));
  };
  for (const [label, props] of [
    ['mobile top strip', { orientation: 'horizontal', side: 'top' }],
    ['script rail strip', { orientation: 'vertical', side: 'right' }],
  ]) {
    const html2 = h(ui.FeatureStrip, { script: offScript, bodyCount: 2, onJump: () => {}, ...props });
    const sep = chipOf(html2, cubes[1].id);
    const plain = chipOf(html2, cubes[0].id);
    check(`${label}: separate-body marker on the merge-off chip only (2 bodies)`,
      /data-feature-separate="1"/.test(sep) && /data-feature-separate-body/.test(sep)
      && !/data-feature-separate/.test(plain), sep.slice(0, 200));
    check(`${label}: title says separate body`, /separate body \(merge off\)/.test(sep));
    const html1 = h(ui.FeatureStrip, { script: unionScript, bodyCount: 1, onJump: () => {}, ...props });
    const cleared = chipOf(html1, afterUnion.find((f) => f.kind === 'cube' && f.separate).id);
    check(`${label}: marker cleared after Boolean union (1 body)`,
      !/data-feature-separate/.test(cleared) && !/data-feature-separate-body/.test(cleared)
      && !/separate body \(merge off\)/.test(cleared), cleared.slice(0, 200));
  }
  const addChip = h(ui.ContourModeChip, { entry: 'makeExtrude', tool: 'circle', params: defaultContourParams('circle'), combine: 'add', merge: true });
  const offChip = h(ui.ContourModeChip, { entry: 'makeExtrude', tool: 'circle', params: defaultContourParams('circle'), combine: 'add', merge: false });
  const subChip = h(ui.ContourModeChip, { entry: 'makeExtrude', tool: 'circle', params: defaultContourParams('circle'), combine: 'subtract', merge: false });
  const profChip = h(ui.ContourModeChip, { entry: 'crossSection', tool: 'circle', params: defaultContourParams('circle') });
  check('contour chip: Merge bodies checked in Add', /data-contour-merge="on"/.test(addChip) && /Merge bodies/.test(addChip));
  check('contour chip: unchecked shows off + "separate body"', /data-contour-merge="off"/.test(offChip) && /separate body/.test(offChip));
  check('contour chip: hidden in Subtract', !/data-contour-merge/.test(subChip) && !/Merge bodies/.test(subChip));
  check('contour chip: not on Profile', !/data-contour-merge/.test(profChip));
}

// ── Wiring / docs ───────────────────────────────────────────────────────
{
  const worker = read('src/workers/sandboxWorker.js') + '\n' + read('src/lib/surfcad/runtime.js');
  check('worker installs separate bodies after setup', /installSeparateBodies\(manifoldModule\)/.test(worker));
  for (const fn of ['hollow', 'draftFaces', 'moveFace', 'deleteFace']) {
    check(`${fn} routes through _perBodyFaceOp`, new RegExp(`function ${fn}\\([^)]*\\) \\{\\n  return _perBodyFaceOp\\(`).test(worker));
  }
  const arch = read('docs/architecture.md');
  check('architecture.md documents Merge bodies', /Merge bodies/.test(arch) && /merge: false/.test(arch));
  check('architecture.md: strip marker follows live bodyCount',
    /featureShowsSeparateBody/.test(arch) && /live part still has more than one body/.test(arch)
    && !/It stays after a later Boolean union/.test(arch));
  const pkg = JSON.parse(read('package.json'));
  check('package.json registers golden:merge-bodies-toggle',
    pkg.scripts['golden:merge-bodies-toggle'] === 'node scripts/golden/smoke_merge_bodies_toggle.mjs');
  check('golden README lists it', /smoke_merge_bodies_toggle\.mjs/.test(read('docs/golden/README.md')));
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
