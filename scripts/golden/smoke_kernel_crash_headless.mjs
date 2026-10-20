#!/usr/bin/env node
/**
 * Geometry PR 2, the real thing: drive the shipped worker over its message
 * protocol (bindWorker, the bundled wasm) and make the kernel run out of
 * memory. The report must come back fatal with reason out_of_memory, and
 * the next message must fail at once with the same report instead of
 * hanging. Runs in a child process so the dead module does not outlive the
 * check. Needs about 4 GB of free memory for a few seconds.
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);

if (process.argv[2] === '--child') {
  const { bindWorker } = await import('../../src/lib/surfcad/runtime.js');
  const out = [];
  const fake = {
    postMessage(message) { out.push(message); process.send(message); },
    addEventListener() {},
    removeEventListener() {},
  };
  // lockdownGlobals writes on the worker global; give it this object.
  globalThis.self = fake;
  bindWorker(fake);
  process.on('message', (message) => { fake.onmessage({ data: message }); });
  process.send({ type: 'child-ready' });
} else {
  let failed = 0;
  const check = (name, cond, detail = '') => {
    if (cond) console.log(`  ✅ ${name}`);
    else { failed += 1; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
  };
  console.log('kernel crash headless golden');
  const child = fork(here, ['--child'], { stdio: ['inherit', 'ignore', 'inherit', 'ipc'] });
  const waitFor = (pred, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.off('message', on); reject(new Error(`timed out after ${ms} ms`)); }, ms);
    const on = (message) => { if (pred(message)) { clearTimeout(timer); child.off('message', on); resolve(message); } };
    child.on('message', on);
  });
  await waitFor((m) => m.type === 'child-ready', 60000);
  child.send({ type: 'init', id: 'init', payload: {} });
  const ready = await waitFor((m) => m.id === 'init', 60000);
  check('worker init', ready.type === 'ready', JSON.stringify(ready));

  const cube = 'return Manifold.cube([10, 10, 10]);';
  child.send({ type: 'execute', id: 'ok1', payload: { script: cube, importedModels: {}, memoryLimitMB: 512 } });
  const ok1 = await waitFor((m) => m.id === 'ok1', 60000);
  check('a cube builds', ok1.type === 'result' && Math.abs(ok1.payload.volume - 1000) < 1e-6, JSON.stringify(ok1.payload?.volume ?? ok1.payload?.message));

  // Doubling composes: runs and triangles double each round until the
  // allocator fails at the 4 GB cap.
  const oom = 'let m = Manifold.cube([1, 1, 1]);\nfor (let i = 0; i < 40; i++) m = Manifold.compose([m, m.translate([1, 0, 0])]);\nreturn m;';
  const t0 = Date.now();
  child.send({ type: 'execute', id: 'oom', payload: { script: oom, importedModels: {}, memoryLimitMB: 512 } });
  const dead = await waitFor((m) => m.id === 'oom', 180000);
  const ms = Date.now() - t0;
  check('the abort is reported as an error', dead.type === 'error', JSON.stringify(dead).slice(0, 200));
  check('the report is fatal with reason out_of_memory', dead.payload?.fatal === true && dead.payload?.reason === 'out_of_memory', JSON.stringify(dead.payload));
  check('the heap reading is near the cap', Number(dead.payload?.wasmHeapMB) > 3500, String(dead.payload?.wasmHeapMB));
  console.log(`  (abort after ${ms} ms, message: ${String(dead.payload?.message).slice(0, 60)})`);

  const t1 = Date.now();
  child.send({ type: 'execute', id: 'after', payload: { script: cube, importedModels: {}, memoryLimitMB: 512 } });
  const after = await waitFor((m) => m.id === 'after', 10000).catch((err) => ({ type: 'timeout', error: err.message }));
  check('the next message fails at once with the dead report (no hang)', after.type === 'error' && after.payload?.dead === true && after.payload?.fatal === true && Date.now() - t1 < 2000, JSON.stringify(after).slice(0, 200));
  child.send({ type: 'ping', id: 'ping' });
  const ping = await waitFor((m) => m.id === 'ping', 10000).catch((err) => ({ type: 'timeout', error: err.message }));
  check('a ping on the dead worker is answered with the report too', ping.type === 'error' && ping.payload?.dead === true, JSON.stringify(ping).slice(0, 200));

  child.kill('SIGKILL');
  if (failed) {
    console.log(`kernel crash headless golden: FAIL (${failed})`);
    process.exit(1);
  }
  console.log('kernel crash headless golden: ok');
}
