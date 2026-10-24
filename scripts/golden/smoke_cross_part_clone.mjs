#!/usr/bin/env node
/**
 * Cross-part subtract / Boolean clone (edit-what-you-touch slice C).
 *
 * A tool body in another part is frozen into the target part at Accept:
 * that part's script text is embedded in the feature as
 * externalBody(function () { … }, { bodies, offset }). offset is source
 * position − target position. Not linked: a later edit of the source does
 * not change the copy. Deleting the feature deletes the copy. The chip is
 * flagged external (yellow border).
 *
 * Boolean: part A cube 20³ at the origin, part B cube 20³ placed at x = 10.
 * World overlap is 4000. Target in A, tool in B:
 *   union 12000, difference 4000, intersect 4000.
 * Intersect: A plate 40×20×10, B (placed at x = −20) holds two 10×30×10
 * cubes at local x = 8 and 32 (world −12 and +12). Two 2000 pieces; dropping
 * the +X piece leaves 2000.
 *
 * Subtract: S and P are 40×30×20 boxes, P placed at x = 30. A 10³ Subtract
 * cube in S at x = 15 overlaps both. S is 23000, and P gets one external
 * copy and is 23000. A far part Q is not touched. A hidden part is not.
 * Re-confirming the same cube replaces P's copy. Moving it off P drops it.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { composeHelperInsert } from '../../src/utils/helperPaletteSnippets.js';
import { parseFeatureMarkers, FEATURE_MARKER_KINDS } from '../../src/utils/featureMarkers.js';
import { deleteFeatureBlock } from '../../src/utils/featureSheetWriteback.js';
import {
  historyForPart,
  pushPartHistory,
  undoPartHistory,
  scriptWithFeatureCount,
} from '../../src/utils/partHistory.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const {
  emptyBooleanState,
  applyBooleanTap,
  setBooleanOp,
  setBooleanPickTarget,
  validateBooleanAccept,
  composeBooleanCommit,
  booleanPreviewRequest,
  booleanTargetPartId,
  booleanCrossPart,
  booleanSlot,
  noteBooleanPartHidden,
  popLastBooleanPick,
} = await import('../../src/utils/booleanMode.js');
const {
  planCrossPartSubtract,
  crossPartSubtractWrites,
  subtractCutterBody,
  featureBlocks,
  isExternalCopyBlock,
  neutralizeMarkers,
  partOffset,
} = await import('../../src/utils/externalCopy.js');

console.log('cross-part subtract / boolean clone');

// --- worker harness (same as block-shape-boolean) ---
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
    Promise.resolve().then(() => workerSelf.onmessage({ data: { type, payload, id } }));
  });
}
register('./manifold-resolve-hook.mjs', import.meta.url);
await import('../../src/workers/sandboxWorker.js');
await send('init');
async function exec(script) {
  const res = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
  return res.payload;
}
async function execFail(script) {
  try { await exec(script); return null; } catch (e) { return e.message || String(e); }
}
const near = (a, b, eps = 1e-2) => Math.abs(a - b) < eps;
const body = (at) => ({ at, center: at, triangles: [] });

// ---------------------------------------------------------------- Boolean
{
  const A = composeHelperInsert('', 'cube', null, { width: 20, depth: 20, height: 20 });
  const B = composeHelperInsert('', 'cube', null, { width: 20, depth: 20, height: 20 });
  const ctx = {
    parts: {
      a: { script: A, name: 'Part A', position: [0, 0, 0], ok: true },
      b: { script: B, name: 'Part B', position: [10, 0, 0], ok: true },
    },
  };
  check('offset is source position minus target position',
    JSON.stringify(partOffset([10, 0, 0], [0, 0, 0])) === '[10,0,0]');

  let st = applyBooleanTap(emptyBooleanState(), { body: body([0, 0, 0]), partId: 'a' }).state;
  st = applyBooleanTap(st, { body: body([0, 0, 0]), partId: 'b' }).state;
  check('picks span parts and the first tap is the target',
    booleanCrossPart(st) && booleanTargetPartId(st) === 'a');
  const gate = validateBooleanAccept(st, 'b');
  check('Confirm writes the target part even when another part is active',
    gate.ok && gate.targetPartId === 'a' && gate.external.length === 1 && gate.external[0].partId === 'b');

  const union = composeBooleanCommit(A, st, 'b', null, ctx);
  check('cross-part union composes', union.ok && union.targetPartId === 'a', union.message || '');
  const feats = parseFeatureMarkers(union.buffer);
  check('the copy adds no chips of its own (markers neutralized)',
    feats.length === 2 && feats[0].kind === 'cube' && feats[1].kind === 'boolean',
    feats.map((f) => f.kind).join(','));
  check('the Boolean chip is flagged external (yellow border)',
    feats[1].external === true && feats[0].external === false);
  check('source script text is embedded inside the Boolean block',
    isExternalCopyBlock(featureBlocks(union.buffer)[1].text)
    && featureBlocks(union.buffer)[1].text.includes(neutralizeMarkers(B).trim().split('\n')[1])
    && /external copy from "Part B" · src b/.test(union.buffer)
    && /offset: \[10, 0, 0\]/.test(union.buffer));
  check('one booleanBodies call is written outside the copy',
    (union.buffer.match(/booleanBodies\s*\(/g) || []).length === 1);

  const uRes = await exec(union.buffer);
  check('cross-part union volume is 12000', near(uRes.volume, 12000), `vol=${uRes.volume}`);
  const diff = composeBooleanCommit(A, setBooleanOp(st, 'difference'), 'a', null, ctx);
  const dRes = await exec(diff.buffer);
  check('cross-part difference volume is 4000', near(dRes.volume, 4000), `vol=${dRes.volume}`);
  const inter = composeBooleanCommit(A, setBooleanOp(st, 'intersect'), 'a', null, ctx);
  const iRes = await exec(inter.buffer);
  check('cross-part intersect volume is 4000', near(iRes.volume, 4000), `vol=${iRes.volume}`);

  // Not associative: B changes later; A's written script does not.
  const bEdited = composeHelperInsert('', 'cube', null, { width: 30, depth: 30, height: 30 });
  check('editing the source part does not change the copy',
    !diff.buffer.includes('30, 30, 30') && bEdited.includes('30, 30, 30'));
  const dAgain = await exec(diff.buffer);
  check('the frozen copy still cuts the same 4000', near(dAgain.volume, 4000), `vol=${dAgain.volume}`);

  // Deleted with the feature, and with Undo of that step.
  const bool = parseFeatureMarkers(diff.buffer).find((f) => f.kind === 'boolean');
  const del = deleteFeatureBlock(diff.buffer, bool);
  check('deleting the Boolean deletes the embedded copy',
    del.ok && !/externalBody\s*\(/.test(del.buffer) && !del.buffer.includes('external copy'));
  check('undoing that feature step drops the copy too',
    !/externalBody\s*\(/.test(scriptWithFeatureCount(diff.buffer, 1)));

  // Hidden tool part keeps its pick and still writes.
  const hidden = noteBooleanPartHidden(st, 'b');
  check('hiding the tool part keeps its pick',
    booleanSlot(hidden, 'b').bodies.length === 1 && composeBooleanCommit(A, hidden, 'a', null, ctx).ok);

  // A failed source part refuses.
  const bad = composeBooleanCommit(A, st, 'a', null, {
    parts: { ...ctx.parts, b: { ...ctx.parts.b, ok: false } },
  });
  check('a tool part whose last run failed is not copied',
    !bad.ok && /failed its last run/.test(bad.message || ''));

  check('Undo drops the latest pick across parts',
    booleanSlot(popLastBooleanPick(st, 'a'), 'b').bodies.length === 0
    && booleanSlot(popLastBooleanPick(st, 'a'), 'a').bodies.length === 1);

  // Same-part picks write exactly what #160 wrote.
  let one = applyBooleanTap(emptyBooleanState(), { body: body([0, 0, 0]), partId: 'a' }).state;
  one = applyBooleanTap(one, { body: body([10, 0, 0]), partId: 'a' }).state;
  const plain = composeBooleanCommit('let part = 1;', one, 'a');
  check('same-part Boolean has no external copy and no yellow chip',
    plain.ok && !/externalBody/.test(plain.buffer)
    && parseFeatureMarkers(plain.buffer).every((f) => !f.external));
}

// ------------------------------------------- Boolean intersect + piece delete
{
  const A = 'let part = Manifold.cube([40, 20, 10], true);\nreturn part;\n';
  const B = [
    'const l = Manifold.cube([10, 30, 10], true).translate([8, 0, 0]);',
    'const r = Manifold.cube([10, 30, 10], true).translate([32, 0, 0]);',
    'let part = Manifold.compose([l, r]);',
    'return part;',
  ].join('\n');
  const ctx = {
    parts: {
      a: { script: A, name: 'Plate', position: [0, 0, 0], ok: true },
      b: { script: B, name: 'Bars', position: [-20, 0, 0], ok: true },
    },
  };
  let st = setBooleanOp(emptyBooleanState(), 'intersect');
  st = applyBooleanTap(st, { body: body([0, 0, 0]), partId: 'a' }).state;
  st = applyBooleanTap(st, { body: body([8, 0, 0]), partId: 'b' }).state;
  st = applyBooleanTap(st, { body: body([32, 0, 0]), partId: 'b' }).state;
  const req = booleanPreviewRequest(st, 'b', ctx);
  check('Pieces preview runs on the target with the frozen tools',
    req.ok && req.targetPartId === 'a' && req.tools?.length === 1
    && JSON.stringify(req.tools[0].offset) === '[-20,0,0]' && req.targetScript === A);
  const preview = await send('previewBoolean', {
    op: 'intersect', bodies: req.bodies, tools: req.tools, targetScript: req.targetScript,
  });
  const pieces = (preview.payload?.pieces || []).filter((p) => p.selected);
  check('cross-part intersect previews two pieces', pieces.length === 2, `n=${pieces.length}`);
  const plusX = pieces.find((p) => p.at[0] > 0);
  let dropped = setBooleanPickTarget(st, 'pieces');
  dropped = applyBooleanTap(dropped, { at: plusX.at, partId: 'a' }).state;
  const commit = composeBooleanCommit(A, dropped, 'b', { pieceCount: 2 }, ctx);
  check('drop list is the target part\'s', commit.ok && /drop: \[\{ at: \[12/.test(commit.buffer), commit.message || '');
  const res = await exec(commit.buffer);
  check('cross-part intersect with the +X piece deleted leaves 2000', near(res.volume, 2000), `vol=${res.volume}`);
}

// ---------------------------------------------------------------- Subtract
const meshOf = async (script) => (await exec(script)).mesh;
{
  const host = composeHelperInsert('', 'cube', null, {});
  const cutAt = (x) => composeHelperInsert(host, 'cube', null, {
    width: 10, depth: 10, height: 10, combine: 'subtract',
  }).replace('Manifold.cube([10, 10, 10], true)', `Manifold.cube([10, 10, 10], true).translate([${x}, 0, 0])`);
  const sAfter = cutAt(15);
  const parts = [
    { id: 's', name: 'S', script: sAfter, position: [0, 0, 0], visible: true, ok: true },
    { id: 'p', name: 'P', script: host, position: [30, 0, 0], visible: true, ok: true },
    { id: 'q', name: 'Q', script: host, position: [200, 0, 0], visible: true, ok: true },
    { id: 'h', name: 'H', script: host, position: [30, 0, 0], visible: false, ok: true },
    { id: 'f', name: 'F', script: host, position: [30, 0, 0], visible: true, ok: false },
  ];
  const source = { id: 's', name: 'S', position: [0, 0, 0] };
  const plan = planCrossPartSubtract({ before: host, after: sAfter, source, parts, markers: FEATURE_MARKER_KINDS });
  check('Subtract Block plans copies for the other visible, healthy parts',
    plan && plan.kind === 'cube' && plan.candidates.map((c) => c.id).join(',') === 'p,q',
    plan ? plan.candidates.map((c) => c.id).join(',') : 'no plan');
  check('a self-contained cutter does not copy the whole source script',
    plan && !/40, 30, 20/.test(plan.body) && /return /.test(plan.body));

  const sRes = await exec(sAfter);
  check('source part S is 23000', near(sRes.volume, 23000), `vol=${sRes.volume}`);

  const hostMesh = await meshOf(host);
  const probe = await send('probeOverlap', {
    cutterScript: plan.cutterScript,
    parts: plan.candidates.map((c) => ({ id: c.id, mesh: hostMesh, offset: c.offset })),
  });
  const overlapIds = (probe.payload?.overlaps || []).map((o) => o.id);
  check('probe finds only the overlapped part', overlapIds.join(',') === 'p', overlapIds.join(','));
  const after = await send('getModelInfo');
  check('probe leaves the cached solid alone', near(after.payload.volume, 24000), `vol=${after.payload?.volume}`);

  const writes = crossPartSubtractWrites(plan, { source, parts, overlapIds });
  check('one write, into P', writes.length === 1 && writes[0].id === 'p');
  const pScript = writes[0].buffer;
  const pFeats = parseFeatureMarkers(pScript);
  check('P gets a Cube chip flagged external',
    pFeats.length === 2 && pFeats[1].kind === 'cube' && pFeats[1].external && !pFeats[0].external);
  check('the copy is posed into P\'s frame', /offset: \[-30, 0, 0\]/.test(pScript));
  const pRes = await exec(pScript);
  check('P is cut by the frozen cutter: 23000', near(pRes.volume, 23000), `vol=${pRes.volume}`);

  // Per-part undo: one feature step on P; S's stack is separate.
  const histories = {};
  histories.p = pushPartHistory(historyForPart(histories, 'p', host), pScript, 'External copy');
  const undone = undoPartHistory(histories.p);
  check('the copy is one feature step on P, and Undo on P removes it',
    histories.p.commits.length === 3 && undone.code === host);
  check('S keeps its own stack (no P step on it)',
    historyForPart(histories, 's', sAfter).commits.every((c) => !/externalBody/.test(c.code)));

  // Re-confirm the same feature in S → P's copy is replaced, not doubled.
  const moved = cutAt(16);
  const plan2 = planCrossPartSubtract({
    before: sAfter, after: moved, source,
    parts: parts.map((p) => (p.id === 'p' ? { ...p, script: pScript } : p)),
    markers: FEATURE_MARKER_KINDS,
  });
  check('re-confirm knows which copy it replaces', plan2 && plan2.replaceRef === plan.ref);
  const writes2 = crossPartSubtractWrites(plan2, {
    source, parts: parts.map((p) => (p.id === 'p' ? { ...p, script: pScript } : p)), overlapIds: ['p'],
  });
  const p2 = writes2[0]?.buffer || '';
  check('re-confirm replaces P\'s copy in place',
    (p2.match(/externalBody\s*\(/g) || []).length === 1 && /translate\(\[16, 0, 0\]\)/.test(p2));

  // Moved off P → P's copy dropped.
  const away = cutAt(0);
  const plan3 = planCrossPartSubtract({
    before: moved, after: away, source,
    parts: parts.map((p) => (p.id === 'p' ? { ...p, script: p2 } : p)),
    markers: FEATURE_MARKER_KINDS,
  });
  const writes3 = crossPartSubtractWrites(plan3, {
    source, parts: parts.map((p) => (p.id === 'p' ? { ...p, script: p2 } : p)), overlapIds: [],
  });
  check('a cutter moved off P drops P\'s copy',
    writes3.length === 1 && writes3[0].id === 'p' && !/externalBody/.test(writes3[0].buffer));

  // Delete the copy feature on P → copy gone.
  const pChip = parseFeatureMarkers(pScript)[1];
  const pDel = deleteFeatureBlock(pScript, pChip);
  check('deleting P\'s external chip deletes the copy', pDel.ok && !/externalBody/.test(pDel.buffer));

  // Add mode and single-body ops write only the touched part.
  const added = composeHelperInsert(host, 'cube', null, { width: 10, depth: 10, height: 10, combine: 'add' });
  check('Add mode plans no cross-part write',
    planCrossPartSubtract({ before: host, after: added, source, parts, markers: FEATURE_MARKER_KINDS }) === null);
  const filleted = composeHelperInsert(host, 'filletEdges', null, { radius: 1, strategy: 'planar' });
  check('Fillet (single-body op) plans no cross-part write',
    planCrossPartSubtract({ before: host, after: filleted, source, parts, markers: FEATURE_MARKER_KINDS }) === null);
}

// A cutter that reads an earlier binding copies the source prefix.
{
  const script = [
    '// --- cube begin ---',
    'let box1 = Manifold.cube([40, 30, 20], true);',
    'let part = box1;',
    '// --- cube end ---',
    'const hx = 15;',
    '// --- cube begin ---',
    'let cut1 = Manifold.cube([10, 10, 10], true).translate([hx, 0, 0]);',
    'part = part.subtract(cut1);',
    '// --- cube end ---',
    'return part;',
    '',
  ].join('\n');
  const block = featureBlocks(script)[1];
  const cutter = subtractCutterBody(script, block);
  check('a cutter that reads an earlier binding embeds the source prefix',
    cutter.ok && cutter.needsPrefix && /const hx = 15/.test(cutter.body)
    && /\/\/ \(copy\) --- cube begin ---/.test(cutter.body));
  const res = await exec(`return (function () {\n${cutter.body}\n})();`);
  check('that frozen cutter is the 1000 cube', near(res.volume, 1000), `vol=${res.volume}`);
}

// Worker: externalBody picks bodies and poses them.
{
  const two = 'const a = Manifold.cube([10, 10, 10], true); const b = Manifold.cube([10, 10, 10], true).translate([30, 0, 0]); return Manifold.compose([a, b]);';
  const res = await exec(`return externalBody(function () { ${two} }, { bodies: [{ at: [30, 0, 0] }], offset: [5, 0, 0] });`);
  check('externalBody keeps the named body only', near(res.volume, 1000), `vol=${res.volume}`);
  check('externalBody poses it by the offset', near(res.boundingBox.min[0], 30), `min=${res.boundingBox?.min}`);
  const miss = await execFail(`return externalBody(function () { ${two} }, { bodies: [{ at: [99, 0, 0] }] });`);
  check('a body point that is not in the copy throws', !!miss && /externalBody:/.test(miss), miss || 'no throw');
}

// --------------------------------------------------------------- Static
{
  const app = read('src/App.jsx');
  const view = read('src/components/Viewport.jsx');
  // Chip classes live in featureChipTone.js (shared with the failed-chip border).
  const strip = read('src/components/FeatureStrip.jsx') + read('src/utils/featureChipTone.js');
  const chip = read('src/components/BooleanModeChip.jsx');
  const arch = read('docs/architecture.md');
  const pkg = JSON.parse(read('package.json'));
  check('strip chip draws a yellow border for an external copy',
    /data-feature-external=/.test(strip) && /border-yellow-400/.test(strip));
  check('App writes other parts as one step on their own stack',
    /const writeOtherPartScripts/.test(app) && /pushPartHistory\(\s*historyForPart\(partHistoriesRef\.current, w\.id/.test(app));
  check('Block and Shape Subtract Confirm run the cross-part plan',
    /params\.combine === 'subtract'[\s\S]{0,120}crossPartSubtract\(/.test(app)
    && /crossPartSubtract\(buf, codeEditorRef\.current\?\.getContent\?\.\(\) \?\? plan\.buffer\)/.test(app));
  check('Boolean Confirm opens and writes the target part',
    /gate\.targetPartId/.test(app) && /handleSelectPart\(target, \{ keepPicks: true \}\)/.test(app));
  check('Pieces preview passes the frozen tools to the worker',
    /booleanPreviewRequest\(/.test(view) && /tools: req\.tools/.test(view) && /targetScript: req\.targetScript/.test(view));
  check('Boolean chip notes the cross-part copy', /data-boolean-cross-part="1"/.test(chip));
  check('architecture documents the cross-part copy',
    /externalBody/.test(arch) && /yellow/.test(arch) && /golden:cross-part-clone/.test(arch));
  check('package.json registers golden:cross-part-clone',
    pkg.scripts['golden:cross-part-clone'] === 'node scripts/golden/smoke_cross_part_clone.mjs');
}

if (failed) {
  console.log(`\n${failed} cross-part-clone check(s) failed`);
  process.exit(1);
}
console.log('\nAll cross-part-clone checks passed.');
process.exit(0);
