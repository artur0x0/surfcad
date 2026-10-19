import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';

/** Pi 5 C2: status.bodyCount is a number after undo and redo, not null. */

const TWO = 'let part = Manifold.cube([10, 10, 10], true);\npart = part.add(Manifold.cube([5, 5, 5], true).translate([30, 0, 0]), { merge: false });\nreturn part;\n';
const ONE = 'let part = Manifold.cube([10, 10, 10], true);\nreturn part;\n';

function host() {
  let script = TWO;
  // The bridge wraps the script it runs, so match the body, not the whole text.
  const isTwo = (text) => String(text).includes('merge: false');
  const stepStatus = (text) => ({
    volume: isTwo(text) ? 1125 : 1000,
    bbox: null,
    partName: 'base',
    featureCount: 1,
    bodyCount: isTwo(text) ? 2 : 1,
    runState: 'ok',
  });
  return {
    getScript: () => script,
    setEditor(src) { script = src; },
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory: () => {},
    readParts: () => ({ activeId: 'p1', assemblyName: 'Asm', parts: [{ id: 'p1', name: 'base', visible: true }] }),
    async execute(src) {
      return { ok: true, errors: [], volume: isTwo(src) ? 1125 : 1000, bbox: null, partName: 'base', bodyCount: isTwo(src) ? 2 : 1 };
    },
    async agentUndo() {
      script = ONE;
      return { handled: true, result: { ok: true, kind: 'part', partId: 'p1', applied: { label: 'Step' }, reverted: { label: 'Add' }, errors: [], runFailure: null, status: stepStatus(ONE) } };
    },
    async agentRedo() {
      script = TWO;
      return { handled: true, result: { ok: true, kind: 'part', partId: 'p1', applied: { label: 'Add' }, reverted: { label: 'Step' }, errors: [], runFailure: null, status: stepStatus(TWO) } };
    },
  };
}

test('undo and redo results and the cached status carry bodyCount', async () => {
  const api = createSurfcadBridge({ resolve: () => host() });
  const ran = await api.call('run', {});
  assert.equal(ran.result.status.bodyCount, 2);

  const undone = await api.call('undo', {});
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(undone.result.status.bodyCount, 1);
  assert.equal(undone.result.status.runState, 'ok');
  const afterUndo = await api.call('status', {});
  assert.equal(afterUndo.result.bodyCount, 1, 'status after undo');
  assert.equal(afterUndo.result.volume, 1000);

  const redone = await api.call('redo', {});
  assert.equal(redone.ok, true, JSON.stringify(redone));
  assert.equal(redone.result.status.bodyCount, 2);
  const afterRedo = await api.call('status', {});
  assert.equal(afterRedo.result.bodyCount, 2, 'status after redo');
});
