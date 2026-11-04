#!/usr/bin/env node
/**
 * Wall thickness on the vault Flanged_Box (headless, no Chrome).
 *
 * The plate on the back wall is a flat 0.8 mm box placed against a 1°
 * drafted wall, so its upper half fuses with the wall (2.5 mm there) and
 * its lower half sits 0.07 to 0.13 mm off the wall as a free 0.8 mm sheet.
 * The field must show both: cells beside the slot read about 2.5 mm above
 * the plate's midline and 0.8 mm below it. The part has 16.5k triangles,
 * most of them slivers; the refined probe spacing must stay near a
 * millimetre instead of degrading to one probe per triangle (it was 15 mm
 * before slivers were probed by area), and the refined pass must carry
 * paint cells.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
    if (msg.type === 'error') w.reject(new Error(msg.payload?.message || 'err'));
    else w.resolve(msg);
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

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, 'fixtures/flanged_box_side_action.txt'), 'utf8');

await import('../../src/workers/sandboxWorker.js');
await send('init');
const { buildSolidGeometry } = await import('../../src/utils/partSolidCache.js');
const { stampedFaceTable } = await import('../../src/utils/faceIdentity.js');
const { moldFitFromGeometry } = await import('../../src/molding/fromGeometry.js');
const res = (await send('execute', { script, importedModels: {}, memoryLimitMB: 1024 })).payload;
if (res.status !== 'NoError') throw new Error(`script status ${res.status}`);
const { geometry, faceIDs } = buildSolidGeometry(res.mesh);
const table = stampedFaceTable(geometry, faceIDs);
const nameOf = (t) => (table.triFace[t] >= 0 ? table.faces[table.triFace[t]].name : 'unstamped');

console.log('wall thickness cells on Flanged_Box');
const t0 = Date.now();
const fit = moldFitFromGeometry(geometry, faceIDs, { pull: [0, 0, 1], wallOnly: true });
const ms = Date.now() - t0;
const wall = fit.wall;
check('nominal is the 1.85 mm shell', Math.abs(wall.nominal - 1.85) < 0.02, `nominal ${wall.nominal}`);
check('refined probe spacing stays near a millimetre', wall.probeSpacingMm != null && wall.probeSpacingMm <= 2, `spacing ${wall.probeSpacingMm} mm`);
check('refined pass carries paint cells', !!wall.cells && wall.cells.count > 50_000, `cells ${wall.cells?.count}`);
check('wall pass under 8 s headless', ms < 8000, `${ms.toFixed(0)} ms`);

const median = (v) => {
  const s = v.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const upper = [];
const lower = [];
const cells = wall.cells;
for (let i = 0; i < cells.count; i++) {
  if (!nameOf(cells.index[i]).startsWith('cube2.back')) continue;
  const x = (cells.positions[i * 9] + cells.positions[i * 9 + 3] + cells.positions[i * 9 + 6]) / 3;
  const z = (cells.positions[i * 9 + 2] + cells.positions[i * 9 + 5] + cells.positions[i * 9 + 8]) / 3;
  if (Math.abs(x) < 13 || Math.abs(x) > 19.5) continue; // beside the slot, off the plate's side edges
  if (z > 2 && z < 6) upper.push(cells.thickness[i]);
  if (z > -6 && z < -2) lower.push(cells.thickness[i]);
}
check('plate beside the slot, upper half, reads the fused wall (≈2.5 mm)', upper.length >= 20 && median(upper) >= 2.3,
  `n ${upper.length} median ${median(upper)}`);
check('plate beside the slot, lower half, reads the free 0.8 mm sheet', lower.length >= 20 && median(lower) <= 1.0 && median(lower) >= 0.7,
  `n ${lower.length} median ${median(lower)}`);

if (failed) {
  console.log(`wall thickness cells: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('wall thickness cells ok');
process.exit(0);
