import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { deleteFeatureEdit, partDeclarationDeletePlan } from '../../utils/featureEdit.js';
import { liveSheetFeature } from '../../utils/featureSheetWriteback.js';
import { resolveStripTarget } from '../featureStripAgent.js';

/**
 * Pi 5 acceptance A2. delete_feature used to write the buffer, schedule the
 * run, and return before it; `status` kept the old script and `runState: ok`
 * and `errors` was [] until an explicit `run`. It now goes through the same
 * mutate path as confirm_feature, and the block that declares `part` needs
 * `confirm: true` while later code still uses `part`.
 */

const SCRIPT = `// --- cube begin id=cube0 ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
// --- cube begin id=rb1 ---
part = part.add(roundedBox([50, 30, 20], 4, 16));
// --- cube end ---
return part;
`;

const NO_PART = 'ReferenceError: part is not defined';

/** Host stand-in for App: the same prepare rules, a fake kernel. */
function host() {
  let script = SCRIPT;
  let runs = 0;
  const h = {
    getScript: () => script,
    setEditor(src) { script = src; },
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory: () => {},
    readParts: () => ({ activeId: 'p1', assemblyName: 'Asm', parts: [{ id: 'p1', name: 'base', visible: true }] }),
    async execute(src) {
      runs += 1;
      if (!/\blet part\b/.test(src)) {
        return { ok: false, errors: [NO_PART], volume: null, bbox: null, partName: 'base' };
      }
      const volume = src.includes('roundedBox') ? 109554 : 24000;
      return { ok: true, errors: [], volume, bbox: null, partName: 'base', bodyCount: 1 };
    },
    prepareFeatureDelete(args = {}) {
      const resolved = resolveStripTarget(script, args);
      if (resolved.error) return resolved;
      const live = liveSheetFeature(script, resolved.feature);
      const base = partDeclarationDeletePlan(script, live);
      if (base && args.confirm !== true) {
        return {
          error: {
            code: 'confirm_required',
            message: `${live.label} declares part; pass confirm: true`,
            details: { featureId: live.id, dependents: base.count },
          },
        };
      }
      const result = deleteFeatureEdit(script, live);
      if (!result.ok) return { error: { code: 'delete_failed', message: result.message } };
      return {
        source: result.buffer,
        message: `Delete ${live.label}`,
        featureId: live.id,
        warning: base ? 'base deleted' : null,
      };
    },
    runCount: () => runs,
  };
  return h;
}

test('deleting the base feature needs confirm: true and leaves the script alone', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  await api.call('run', {});
  const refused = await api.call('delete_feature', { id: 'cube0' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'confirm_required');
  assert.deepEqual(refused.error.details, { featureId: 'cube0', dependents: 1 });
  assert.equal(h.getScript(), SCRIPT);
  const status = await api.call('status', {});
  assert.equal(status.result.runState, 'ok');
  assert.equal(status.result.volume, 109554);
});

test('status and errors are current right after the confirmed delete, without run', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  await api.call('run', {});
  const runsBefore = h.runCount();
  const deleted = await api.call('delete_feature', { id: 'cube0', confirm: true });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.equal(deleted.result.deletedId, 'cube0');
  assert.equal(deleted.result.deleted, true, 'the block is gone even though the run after it failed (follow-up 8)');
  assert.equal(deleted.result.ok, false);
  assert.equal(deleted.result.warning, 'base deleted');
  assert.ok(deleted.result.errors.some((row) => row.includes('part is not defined')), deleted.result.errors);
  assert.equal(h.runCount(), runsBefore + 1, 'delete ran the part once');

  const script = await api.call('get_script', {});
  assert.doesNotMatch(script.result.source, /let part/);
  const status = await api.call('status', {});
  assert.equal(status.result.runState, 'failed');
  assert.equal(status.result.volume, null);
  assert.doesNotMatch(status.result.script, /let part/);
  const errors = await api.call('errors', {});
  assert.equal(errors.result.errors.length >= 1, true);
  assert.ok(errors.result.errors.some((row) => row.message.includes('part is not defined')));
  assert.equal(h.runCount(), runsBefore + 1, 'status and errors did not run again');
});

test('a feature that does not declare part deletes without confirm and refreshes status', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  await api.call('run', {});
  const deleted = await api.call('delete_feature', { id: 'rb1' });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.equal(deleted.result.ok, true);
  assert.equal(deleted.result.deletedId, 'rb1');
  assert.equal(deleted.result.warning, undefined);
  assert.equal(deleted.result.status.volume, 24000);
  const status = await api.call('status', {});
  assert.equal(status.result.runState, 'ok');
  assert.equal(status.result.volume, 24000);
  assert.doesNotMatch(status.result.script, /roundedBox/);
  const errors = await api.call('errors', {});
  assert.deepEqual(errors.result.errors, []);
});

test('delete_feature lists confirm in its schema', async () => {
  const api = createSurfcadBridge({ resolve: () => host() });
  const listed = await api.call('list_commands', {});
  const row = listed.result.commands.find((c) => c.name === 'delete_feature');
  assert.equal(row.schema.properties.confirm.type, 'boolean');
});
