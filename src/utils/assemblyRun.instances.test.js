import assert from 'node:assert/strict';
import test from 'node:test';
import { runAssemblyParts } from './assemblyRun.js';

/**
 * Part instances: rows that place one definition build once; the outcome
 * lands on every row of it, hidden rows included.
 */

const MESH = { numProp: 3, vertProperties: [0, 0, 0, 1, 0, 0, 0, 1, 0], triVerts: [0, 1, 2] };
const DEF = 'r001';

const doc = () => ({
  id: 'asm',
  activeId: 'f001',
  source: 'local',
  parts: [
    { id: 'f001', name: 'Frame', visible: true, order: 0 },
    { id: DEF, name: 'Roller', visible: true, order: 1 },
    { id: 'i2', instanceOf: DEF, name: 'Roller (2)', visible: true, order: 2, position: [40, 0, 0] },
    { id: 'i3', instanceOf: DEF, name: 'Roller (3)', visible: false, order: 3 },
  ],
});
const SCRIPT = 'return Manifold.cube([1,1,1]);';
const scripts = () => ({ f001: `// frame\n${SCRIPT}`, [DEF]: SCRIPT, i2: SCRIPT, i3: SCRIPT });

function counting(fail = null) {
  const calls = [];
  const execute = async (script, opts) => {
    calls.push(opts.partId);
    if (fail && opts.partId === fail) throw new Error('boom');
    return { mesh: { ...MESH }, volume: 1, boundingBox: { min: [0, 0, 0], max: [1, 1, 1] }, bodyCentroids: [[0.5, 0.5, 0.5]] };
  };
  return { execute, calls };
}

test('one definition builds once and its run reaches every row, the hidden instance too', async () => {
  const c = counting();
  const { runs, solids } = await runAssemblyParts({ doc: doc(), scripts: scripts(), execute: c.execute, ids: [DEF, 'i2'] });
  assert.deepEqual(c.calls, [DEF]);
  assert.equal(runs[DEF].ok, true);
  assert.equal(runs.i2.ok, true);
  assert.equal(runs.i3.ok, true);
  assert.equal(runs.i2.mesh, runs[DEF].mesh, 'instances share the mesh object');
  assert.equal(runs.i3.mesh, runs[DEF].mesh);
  assert.equal(runs.f001, undefined, 'ids filter still applies to other definitions');
  assert.deepEqual(solids.map((solid) => solid.id), [DEF, 'i2']);
});

test('with only an instance asked for, the definition still builds once under that row', async () => {
  const c = counting();
  const { runs } = await runAssemblyParts({ doc: doc(), scripts: scripts(), execute: c.execute, ids: ['i2'] });
  assert.deepEqual(c.calls, ['i2']);
  assert.equal(runs.i2.ok, true);
  assert.equal(runs[DEF].ok, true);
});

test('a failed definition flags every row that places it', async () => {
  const c = counting(DEF);
  const { runs } = await runAssemblyParts({ doc: doc(), scripts: scripts(), execute: c.execute, ids: ['f001', DEF, 'i2'] });
  assert.deepEqual(c.calls.sort(), ['f001', DEF].sort());
  assert.equal(runs[DEF].ok, false);
  assert.equal(runs.i2.ok, false);
  assert.equal(runs.i3.ok, false);
  assert.equal(runs.f001.ok, true);
});

test('a full run (no ids) builds each definition once and marks nothing skipped twice', async () => {
  const c = counting();
  const { runs } = await runAssemblyParts({ doc: doc(), scripts: scripts(), execute: c.execute });
  assert.deepEqual(c.calls.sort(), ['f001', DEF].sort());
  assert.deepEqual(Object.keys(runs).sort(), ['f001', 'i2', 'i3', DEF].sort());
  assert.equal(runs.i3.ok, true, 'hidden instance carries its definition run, not a skipped marker');
});
