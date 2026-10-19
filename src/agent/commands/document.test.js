import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';

const CUBE = `// --- cube begin id=cube1 ---
let part = Manifold.cube([20, 20, 20], true);
// --- cube end ---
return part;
`;

const FAIL = `// --- cube begin id=cube1 ---
throw new Error('Cube failed: result is not a valid solid (NotManifold)');
let part = Manifold.cube([20, 20, 20], true);
// --- cube end ---
return part;
`;

const UI = 'Cube failed: result is not a valid solid (NotManifold)';

function world() {
  const gitLog = [];
  let active = 'old-part';
  const parts = [{ id: 'old-part', name: 'Base', visible: true }];
  const host = {
    gitLog,
    getScript: () => '',
    setEditor() {},
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory() {},
    readParts: () => ({
      activeId: active,
      assemblyName: 'Asm',
      parts: parts.map((row) => ({ ...row })),
    }),
    readActivePartStatus: () => ({
      partId: active,
      partName: 'Cube',
      script: '',
      runState: 'ok',
      volume: 8000,
      bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
      featureCount: 1,
      bodyCount: 1,
    }),
    async agentCreatePart({ name, script } = {}) {
      gitLog.push('agentCreatePart');
      const id = name === 'Bad' ? 'failed-part' : 'new-part';
      parts.push({ id, name: name || 'Part', visible: true });
      active = id;
      if (typeof script !== 'string' || !script.trim()) {
        return { result: { partId: id, partCount: parts.length } };
      }
      const failed = script.includes('throw');
      return {
        result: {
          partId: id,
          partCount: parts.length,
          script,
          run: failed
            ? {
              ok: false,
              errors: [UI],
              volume: null,
              bbox: null,
              partName: name || 'Part',
              runFailure: { id: 'cube1', kind: 'cube', message: UI },
            }
            : {
              ok: true,
              errors: [],
              volume: 8000,
              bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
              partName: name || 'Part',
              runFailure: null,
              bodyCount: 1,
            },
        },
      };
    },
    async agentOpenAssembly({ assemblyId }) {
      gitLog.push(`open:${assemblyId}`);
      if (assemblyId === 'missing-id') {
        return {
          error: {
            code: 'unknown_assembly',
            message: 'Unknown assembly id: missing-id. Call list_assemblies and retry with a listed assembly_id.',
          },
        };
      }
      return { result: { assemblyId, assemblyName: 'Asm', activeId: active, partCount: parts.length } };
    },
    commitFiles() { gitLog.push('commitFiles'); },
    enqueueGit() { gitLog.push('enqueueGit'); },
  };
  return host;
}

test('create_part with a script returns the new id and the run result', async () => {
  const host = world();
  const api = createSurfcadBridge({ resolve: () => host });
  const created = await api.call('create_part', { name: 'Cube', script: CUBE });
  assert.equal(created.ok, true);
  assert.equal(created.result.partId, 'new-part');
  assert.notEqual(created.result.partId, 'old-part');
  assert.equal(created.result.ok, true);
  assert.deepEqual(created.result.errors, []);
  assert.deepEqual(created.result.failures, []);
  assert.equal(created.result.status.runState, 'ok');
  assert.equal(created.result.status.volume, 8000);
  assert.equal(created.result.status.bodyCount, 1);
  assert.equal(created.result.status.partId, 'new-part');
  assert.equal(host.gitLog.includes('commitFiles'), false);
  assert.equal(host.gitLog.includes('enqueueGit'), false);
});

test('create_part without a script returns only the new id', async () => {
  const host = world();
  const api = createSurfcadBridge({ resolve: () => host });
  const created = await api.call('create_part', { name: 'Pin' });
  assert.equal(created.ok, true);
  assert.equal(created.result.partId, 'new-part');
  assert.equal(created.result.ok, undefined);
  assert.equal(created.result.failures, undefined);
  assert.equal(host.gitLog.filter((row) => row === 'commitFiles').length, 0);
});

test('a failed create_part script keeps the new id and feature_failed', async () => {
  const host = world();
  const api = createSurfcadBridge({ resolve: () => host });
  const created = await api.call('create_part', { name: 'Bad', script: FAIL });
  assert.equal(created.ok, true);
  assert.equal(created.result.partId, 'failed-part');
  assert.equal(created.result.ok, false);
  assert.equal(created.result.failures.length, 1);
  assert.equal(created.result.failures[0].code, 'feature_failed');
  assert.equal(created.result.failures[0].message, UI);
  assert.equal(created.result.failures[0].featureType, 'cube');
  assert.equal(created.result.failures[0].featureLabel, 'Cube');
  const listed = await api.call('errors', {});
  assert.equal(listed.result.errors[0].code, 'feature_failed');
  assert.equal(listed.result.errors[0].featureLabel, 'Cube');
  assert.equal(host.gitLog.includes('commitFiles'), false);
});

test('open_assembly of a missing id is unknown_assembly and makes no git write', async () => {
  const host = world();
  const api = createSurfcadBridge({ resolve: () => host });
  const opened = await api.call('open_assembly', { assembly_id: 'missing-id' });
  assert.equal(opened.ok, false);
  assert.equal(opened.error.code, 'unknown_assembly');
  assert.match(opened.error.message, /missing-id/);
  assert.equal(JSON.stringify(opened).includes('assemblies/'), false);
  assert.equal(host.gitLog.includes('commitFiles'), false);
  assert.equal(host.gitLog.includes('enqueueGit'), false);

  const byName = await api.call('open_assembly', { name: 'does-not-exist' });
  assert.equal(byName.ok, false);
  assert.equal(byName.error.code, 'bad_args');
  assert.equal(host.gitLog.includes('commitFiles'), false);
});

test('create_part refuses a position beyond the limit and accepts a 2 m one (bike PR 2)', async () => {
  const host = world();
  const api = createSurfcadBridge({ resolve: () => host });
  const far = await api.call('create_part', { name: 'Far', position: [0, 0, 1000001] });
  assert.equal(far.ok, false);
  assert.equal(far.error.code, 'bad_args');
  assert.match(far.error.message, /1000000/);
  const near = await api.call('create_part', { name: 'Near', position: [0, 0, 2000] });
  assert.equal(near.ok, true, JSON.stringify(near));
});
