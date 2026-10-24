import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { FEATURE_TIMEOUT_CODE } from '../workers/kernelCrash.js';

/**
 * The worker side of the per-block budget, on the real kernel in Node: a
 * script re-run with `timedOut` naming one block builds without that block
 * (and its hard dependents), reports it as a feature_timeout skip, and
 * returns the kernel time of every block that ran.
 */

const SCRIPT = `// --- cube begin id=cube1 ---
let part = Manifold.cube([10, 10, 10], true);
// --- cube end ---
// --- hole begin id=hole1 ---
part = part.subtract(Manifold.cylinder(12, 2, 2, 12, true));
// --- hole end ---
// --- cube begin id=cube2 ---
part = part.add(Manifold.cube([4, 4, 4], true).translate([20, 0, 0]));
// --- cube end ---
return part;
`;

test('a run reports kernel time per block', async () => {
  const run = await runScript(SCRIPT);
  const ids = (run.featureTimings || []).map((row) => row.id);
  assert.deepEqual(ids, ['cube1', 'hole1', 'cube2']);
  assert.ok(run.featureTimings.every((row) => Number.isFinite(row.ms) && row.ms >= 0 && typeof row.kind === 'string'));
  assert.equal(run.featureSkip, undefined);
  run.manifold?.delete?.();
});

test('a run re-posted with a timed-out block builds without it and names it as feature_timeout', async () => {
  const run = await runScript(SCRIPT, {
    timedOut: [{ id: 'hole1', kind: 'hole', elapsedMs: 30007, budgetMs: 30000 }],
  });
  // The hole is gone: a full 10 mm cube plus the 4 mm cube.
  assert.ok(Math.abs(run.volume - (1000 + 64)) < 1e-6, String(run.volume));
  const skip = run.featureSkip;
  assert.equal(skip.code, FEATURE_TIMEOUT_CODE);
  assert.equal(skip.featureId, 'hole1');
  assert.match(skip.featureBlock, /hole begin id=hole1/);
  assert.match(skip.message, /Hole did not finish within the 30 s budget after 30 s/);
  assert.deepEqual(skip.timeout, { id: 'hole1', kind: 'hole', label: 'Hole', elapsedMs: 30007, budgetMs: 30000 });
  assert.match(skip.hint, /fewer edges/);
  assert.deepEqual(skip.skipped, []);
  // The blocks that ran are timed; the skipped one is not.
  assert.deepEqual((run.featureTimings || []).map((row) => row.id), ['cube1', 'cube2']);
  run.manifold?.delete?.();
});

test('a timed-out block takes its hard dependents with it', async () => {
  const dependent = `// --- cube begin id=cube1 ---
let part = Manifold.cube([10, 10, 10], true);
// --- cube end ---
// --- cylinder begin id=cyl1 ---
const post = Manifold.cylinder(30, 1, 1, 12, true);
part = part.add(post);
// --- cylinder end ---
// --- cube begin id=cube2 ---
part = part.add(post.translate([5, 0, 0]));
// --- cube end ---
return part;
`;
  const run = await runScript(dependent, { timedOut: [{ id: 'cyl1', kind: 'cylinder', elapsedMs: 30000, budgetMs: 30000 }] });
  assert.ok(Math.abs(run.volume - 1000) < 1e-6, String(run.volume));
  assert.equal(run.featureSkip.featureId, 'cyl1');
  assert.deepEqual(run.featureSkip.skipped.map((row) => [row.id, row.dependsOn]), [['cube2', 'cyl1']]);
  run.manifold?.delete?.();
});
