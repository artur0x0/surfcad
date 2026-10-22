import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';

/**
 * MVP-1 step 4b: after a run past its budget the worker is replaced. The
 * undo that follows must report the run it did, echo the script it restored,
 * and say `stale` when that run never reported instead of passing the old
 * timeout failure off as the result.
 */

const CHAMFER = 'let part = Manifold.cube([20, 20, 20], true);\n// chamfer-12\npart = chamferEdges(part, 2);\nreturn part;\n';
const BOX = 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;\n';
const TIMEOUT = { id: 'chamfer-12', message: 'chamfer-12 exceeded the 30 s budget', crash: { code: 'geometry_worker_crashed', reason: 'timeout', workerRestarted: true } };

function host({ undoOutcome }) {
  let script = CHAMFER;
  let runFailure = null;
  return {
    getScript: () => script,
    setEditor(src) { script = src; },
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory: () => {},
    readParts: () => ({ activeId: 'p1', assemblyName: 'Asm', parts: [{ id: 'p1', name: 'Frame', visible: true }] }),
    readRunFailure: () => runFailure,
    async execute(src) {
      if (src.includes('chamfer-12')) {
        runFailure = TIMEOUT;
        return { ok: false, errors: [TIMEOUT.message], volume: null, bbox: null, partName: 'Frame', runFailure: TIMEOUT, crash: TIMEOUT.crash };
      }
      runFailure = null;
      return { ok: true, errors: [], volume: 8000, bbox: null, partName: 'Frame', bodyCount: 1, runFailure: null };
    },
    async agentUndo() {
      // The host restored BOX in the editor. The simulated editor re-read
      // still returns the chamfer text, to prove the bridge echoes the
      // restored script and not a re-read.
      const outcome = undoOutcome();
      return {
        handled: true,
        result: {
          ok: outcome.ok === true,
          kind: 'part',
          partId: 'p1',
          applied: { label: 'Step' },
          reverted: { label: 'Chamfer' },
          errors: outcome.errors || [],
          ...(Object.prototype.hasOwnProperty.call(outcome, 'runFailure') ? { runFailure: outcome.runFailure } : {}),
          ...(outcome.stale === true ? { stale: true } : {}),
          restoredScript: BOX,
          status: {
            volume: outcome.volume ?? null, bbox: null, partName: 'Frame', featureCount: 1,
            bodyCount: outcome.bodyCount ?? null, runState: outcome.ok === true ? 'ok' : 'failed',
            ...(outcome.stale === true ? { stale: true } : {}),
          },
        },
      };
    },
  };
}

test('undo after a timeout reports the restored run and echoes the restored script', async () => {
  const api = createSurfcadBridge({
    resolve: () => host({
      undoOutcome: () => ({ ok: true, errors: [], volume: 8000, bodyCount: 1, runFailure: null }),
    }),
  });
  const timedOut = await api.call('run', {});
  assert.equal(timedOut.result.ok, false);
  assert.equal(timedOut.result.status.runState, 'failed');
  assert.equal(timedOut.result.crash?.reason, 'timeout');

  const undone = await api.call('undo', {});
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(undone.result.ok, true);
  assert.deepEqual(undone.result.errors, []);
  assert.equal(undone.result.status.runState, 'ok');
  assert.equal(undone.result.status.volume, 8000);
  assert.equal(undone.result.status.script, BOX, 'the echo is the restored script, not the editor re-read');
  assert.equal(undone.result.status.script.includes('chamfer-12'), false);
  assert.equal('restoredScript' in undone.result, false, 'the host-only field is not echoed twice');
  assert.equal('stale' in undone.result.status, false);

  const status = await api.call('status', {});
  assert.equal(status.result.runState, 'ok');
  assert.equal(status.result.script, BOX);
  assert.equal('stale' in status.result, false);
  assert.deepEqual((await api.call('errors', {})).result.errors, []);
});

test('an undo whose run never reported says stale instead of passing the timeout off as fresh', async () => {
  const api = createSurfcadBridge({
    resolve: () => host({
      // The host could not get a report out of the viewport even after the
      // kernel came back: the outcome carries the previous failure text and
      // stale: true, and omits runFailure the way agentCadRunOutcome does.
      undoOutcome: () => ({ ok: false, errors: ['Run did not finish'], volume: null, stale: true }),
    }),
  });
  await api.call('run', {});
  const undone = await api.call('undo', {});
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(undone.result.ok, false);
  assert.equal(undone.result.stale, true);
  assert.equal(undone.result.status.stale, true);
  assert.equal(undone.result.status.runState, 'failed');
  assert.equal(undone.result.status.script, BOX, 'the script is still the restored one');
  const status = await api.call('status', {});
  assert.equal(status.result.stale, true, 'the cached status keeps the stale mark');

  // The next run that reports clears it (the simulated editor still holds
  // the chamfer text, so write the box explicitly).
  const ran = await api.call('set_script', { part_id: 'p1', source: BOX });
  assert.equal(ran.result.ok, true);
  assert.equal('stale' in ran.result.status, false);
  assert.equal('stale' in (await api.call('status', {})).result, false);
});

test('a mutate whose run never reported carries stale on its status', async () => {
  const api = createSurfcadBridge({
    resolve: () => ({
      getScript: () => BOX,
      setEditor() {},
      readHistory: () => ({ commits: [], head: -1 }),
      writeHistory: () => {},
      readParts: () => ({ activeId: 'p1', assemblyName: 'Asm', parts: [{ id: 'p1', name: 'Frame', visible: true }] }),
      async execute() {
        return { ok: false, errors: ['Run did not finish'], volume: null, bbox: null, partName: 'Frame', stale: true };
      },
    }),
  });
  const env = await api.call('set_script', { part_id: 'p1', source: BOX });
  assert.equal(env.ok, true, JSON.stringify(env));
  assert.equal(env.result.ok, false);
  assert.equal(env.result.status.stale, true);
  assert.deepEqual(env.result.errors, ['Run did not finish']);
});
