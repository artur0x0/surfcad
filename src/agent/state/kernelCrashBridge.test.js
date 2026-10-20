import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { kernelCrashError } from '../../workers/kernelCrash.js';
import { buildPartsState } from './parts.js';

/**
 * Geometry PR 2: when the host's execute rejects with the kernel crash
 * error, the bridge's mutate result, structured errors, and status say so.
 */

const CUBE = 'let part = Manifold.cube([10, 10, 10], true);\nreturn part;\n';

function host({ crashOnce = true } = {}) {
  let script = CUBE;
  let crashed = false;
  let partRows = [
    { id: 'p1', name: 'Frame', visible: true, runState: 'ok' },
    { id: 'p2', name: 'Clamps', visible: true, runState: 'not_run_yet' },
  ];
  const h = {
    getScript: () => script,
    setEditor(src) { script = src; },
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory() {},
    // App publishes readParts through buildPartsState (runState and crash per row).
    readParts: () => buildPartsState({ activeId: 'p2', assemblyName: 'Bike', parts: partRows }),
    readActivePartSurfId: () => 'p2',
    readActivePartStatus: () => ({
      partId: 'p2', partName: 'Clamps', script, runState: crashed ? 'failed' : 'not_run_yet', volume: null, bbox: null, featureCount: 1, bodyCount: null,
    }),
    readRunFailure: () => null,
    setActivePart() { return { ok: true }; },
    async execute() {
      if (crashOnce && !crashed) {
        crashed = true;
        const err = kernelCrashError({ reason: 'out_of_memory', kernelMessage: 'Aborted()', wasmHeapMB: 4096, partId: 'p2' });
        partRows = partRows.map((row) => (row.id === 'p2'
          ? { ...row, runState: 'failed', crash: { reason: 'out_of_memory', workerRestarted: true, message: err.message } }
          : row));
        throw err;
      }
      partRows = partRows.map((row) => (row.id === 'p2' ? { id: row.id, name: row.name, visible: true, runState: 'ok' } : row));
      return { ok: true, errors: [], volume: 1000, bbox: { min: [-5, -5, -5], max: [5, 5, 5] }, partName: 'Clamps', bodyCount: 1, runFailure: null };
    },
  };
  return h;
}

test('a kernel crash under set_script: ok false, crash on the result, one geometry_worker_crashed row, status failed, parts rows', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const ran = await api.call('set_script', { part_id: 'p2', source: CUBE });
  assert.equal(ran.ok, true, JSON.stringify(ran));
  assert.equal(ran.result.ok, false);
  assert.match(ran.result.errors[0], /ran out of memory.*restarted/);
  assert.equal(ran.result.crash.code, 'geometry_worker_crashed');
  assert.equal(ran.result.crash.reason, 'out_of_memory');
  assert.equal(ran.result.crash.workerRestarted, true);
  assert.equal(ran.result.crash.partId, 'p2');
  assert.equal(ran.result.failures.length, 1);
  assert.equal(ran.result.failures[0].code, 'geometry_worker_crashed');
  assert.equal(ran.result.failures[0].reason, 'out_of_memory');
  assert.match(ran.result.failures[0].detail, /Simplify/);
  assert.equal(ran.result.status.runState, 'failed');

  const errors = await api.call('errors', {});
  assert.equal(errors.result.errors.length, 1);
  assert.equal(errors.result.errors[0].code, 'geometry_worker_crashed');
  assert.equal(errors.result.errors[0].workerRestarted, true);

  const status = await api.call('status', {});
  assert.equal(status.result.runState, 'failed');

  const parts = await api.call('parts', {});
  const clamps = parts.result.parts.find((row) => row.id === 'p2');
  assert.equal(clamps.runState, 'failed');
  assert.equal(clamps.crash.code, 'geometry_worker_crashed');
  assert.equal(parts.result.parts.find((row) => row.id === 'p1').runState, 'ok');

  // The next run on the fresh worker clears it all.
  const again = await api.call('run', {});
  assert.equal(again.result.ok, true, JSON.stringify(again.result));
  assert.equal('crash' in again.result, false);
  assert.equal((await api.call('errors', {})).result.errors.length, 0);
  assert.equal((await api.call('status', {})).result.runState, 'ok');
  assert.equal((await api.call('parts', {})).result.parts.find((row) => row.id === 'p2').runState, 'ok');
});
