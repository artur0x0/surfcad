import assert from 'node:assert/strict';
import test from 'node:test';
import { runAssemblyParts } from './assemblyRun.js';

/**
 * Geometry PR 3: runAssemblyParts builds up to `concurrency` parts at once
 * and still records them in part order, with the active part last.
 */

const MESH = { numProp: 3, vertProperties: [0, 0, 0, 1, 0, 0, 0, 1, 0], triVerts: [0, 1, 2] };

function doc(n) {
  return {
    id: 'asm',
    activeId: 'p1',
    source: 'local',
    parts: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Part ${i + 1}`, visible: true, order: i })),
  };
}

function scripts(n) {
  const out = {};
  for (let i = 1; i <= n; i += 1) out[`p${i}`] = `// D${20 + (i % 3) * 10}\nreturn Manifold.cube([1,1,1]);`;
  return out;
}

function timedExecute(log) {
  let inFlight = 0;
  let peak = 0;
  const execute = async (script, opts) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    log.push(`start ${opts.partId}`);
    const ms = Number(/D(\d+)/.exec(script)?.[1] || 10);
    await new Promise((r) => setTimeout(r, ms));
    inFlight -= 1;
    log.push(`end ${opts.partId}`);
    if (opts.partId === 'p4') throw Object.assign(new Error('boom'), { code: 'geometry_worker_crashed', reason: 'timeout', workerRestarted: true });
    return { mesh: MESH, volume: 1, boundingBox: { min: [0, 0, 0], max: [1, 1, 1] }, bodyCentroids: [[0.5, 0.5, 0.5]] };
  };
  return { execute, peak: () => peak };
}

test('concurrency builds several parts at once and records them in part order', async () => {
  const log = [];
  const timed = timedExecute(log);
  const ids = ['p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
  const t0 = Date.now();
  const { runs } = await runAssemblyParts({ doc: doc(7), scripts: scripts(7), execute: timed.execute, ids, concurrency: 3 });
  const ms = Date.now() - t0;
  assert.equal(timed.peak(), 3);
  assert.deepEqual(Object.keys(runs), ids);
  assert.equal(runs.p2.ok, true);
  assert.equal(runs.p4.ok, false);
  assert.equal(runs.p4.crash.code, 'geometry_worker_crashed');
  assert.equal(runs.p4.crash.reason, 'timeout');
  assert.equal(runs.p7.ok, true);
  assert.ok(ms < 6 * 40, `took ${ms} ms, not serial`);
});

test('concurrency 1 is the serial build, active part last, skipped rows filled in', async () => {
  const log = [];
  const timed = timedExecute(log);
  const d = doc(3);
  d.parts[2].visible = false;
  const { runs } = await runAssemblyParts({ doc: d, scripts: scripts(3), execute: timed.execute });
  assert.equal(timed.peak(), 1);
  assert.deepEqual(log, ['start p2', 'end p2', 'start p1', 'end p1']);
  assert.deepEqual(Object.keys(runs), ['p2', 'p1', 'p3']);
  assert.equal(runs.p3.skipped, true);
});
