#!/usr/bin/env node
/**
 * Fillet one body of a keep-both cut.
 *
 * The L is 24000. A z=0 keep-both cut is two bodies of 12000. Filleting an
 * edge on the upper body must not throw "decompose found 2 components with
 * scrap vol". The other body stays ~12000. The 5% / 0.01 scrap test stays.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const readRepo = (rel) => readFileSync(join(__here, '../..', rel), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('fillet after keep-both cut — source pins');
{
  const w = readRepo('src/workers/sandboxWorker.js') + '\n' + readRepo('src/lib/surfcad/runtime.js');
  const gate = 'scrapVol > 0.05 * bestVol && scrapVol > 1e-2';
  const n = w.split(gate).length - 1;
  // Open path, semi-arc batch, and the edge set (one subtract for a whole pick) share the gate.
  check('open-path, semi-arc and edge-set scrap gates all still 5% and 0.01', n === 3, `count=${n}`);
  check('scrap messages still fail loud',
    w.includes('decompose found ${parts.length} components with scrap vol')
    && w.includes('semi-arc batch decompose found ${parts.length} components with scrap vol'));
  check('multi-body fillet isolates the owning body',
    w.includes('function _filletOnlyOwningBody') && w.includes('_filletBodySplit'));
}

register('./manifold-resolve-hook.mjs', import.meta.url);
const pending = new Map();
let msgId = 0;
globalThis.self = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const w = pending.get(msg.id);
    if (!w) return;
    pending.delete(msg.id);
    if (msg.type === 'error') w.reject(new Error(msg.payload?.message || 'worker error'));
    else w.resolve(msg);
  },
};
function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => globalThis.self.onmessage({ data: { type, payload, id } }));
  });
}
await import('../../src/workers/sandboxWorker.js');
await send('init');
async function exec(script) {
  try { return (await send('execute', { script, importedModels: {}, memoryLimitMB: 512 })).payload; }
  catch (e) { return { error: e.message }; }
}

console.log('');
console.log('fillet after keep-both cut — one body');
{
  const r = await exec(`
const part0 = Manifold.difference(
  Manifold.cube([40, 40, 20], true),
  Manifold.cube([20, 20, 22], true).translate([10, 10, 0]));
const halved = cut(part0, { normal: [0, 0, 1], originOffset: 0 });
const edges = convexEdges(halved);
const edgeLen = (e) => Math.hypot(e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]);
const owned = edges.find((e) => (e.va[2] + e.vb[2]) / 2 > 1 && edgeLen(e) > 8);
if (!owned) throw new Error('no convex edge on the upper body');
const out = filletAlongPath(halved, makeSweepPath([owned]), 2);
const parts = out.decompose();
globalThis.__note = {
  n: parts.length,
  vols: parts.map((p) => p.volume()),
};
return out;`);
  check('fillet on one body of a keep-both cut succeeds', !r.error, r.error || '');
  const note = globalThis.__note;
  if (!r.error && note) {
    check('result is still two bodies', note.n === 2, `n=${note.n} vols=${note.vols}`);
    const vols = (note.vols || []).slice().sort((a, b) => a - b);
    const untouched = vols.filter((v) => Math.abs(v - 12000) < 1);
    const filleted = vols.filter((v) => v > 11000 && v < 11999);
    check('untouched half stays ~12000', untouched.length === 1, `vols=${vols.map((v) => v.toFixed(2))}`);
    check('filleted half lost material and stayed one body', filleted.length === 1, `vols=${vols.map((v) => v.toFixed(2))}`);
    check('both pieces are real bodies', vols.every((v) => v > 1000), `vols=${vols}`);
  }
}

if (failed) {
  console.log(`❌ fillet-after-cut golden FAILED (${failed} checks)`);
  process.exit(1);
}
console.log('fillet-after-cut golden passed');
