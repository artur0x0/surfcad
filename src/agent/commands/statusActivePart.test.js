import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';

const BOX = 'let part = Manifold.cube([10, 10, 10], true);\nreturn part;\n';
const SPHERE = 'let part = Manifold.sphere(5, 32);\nreturn part;\n';

function host() {
  let activeId = 'part-a';
  const scripts = {
    'part-a': BOX,
    'part-b': SPHERE,
  };
  const runs = {
    'part-a': { ok: true, mesh: { vertProperties: new Float32Array(9) }, bodyCount: 1 },
  };
  return {
    getScript: () => scripts[activeId] || '',
    setEditor(src) {
      scripts[activeId] = src;
    },
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory() {},
    async execute(src) {
      const ok = !src.includes('fail');
      return {
        ok,
        errors: ok ? [] : ['boom'],
        volume: ok ? 1000 : null,
        bbox: ok ? { min: [-5, -5, -5], max: [5, 5, 5] } : null,
        partName: activeId === 'part-a' ? 'Cube' : 'Sphere',
      };
    },
    screenshot: () => 'data:image/png;base64,',
    readParts: () => ({
      activeId,
      assemblyName: 'Asm',
      parts: [
        { id: 'part-a', name: 'Cube', visible: true },
        { id: 'part-b', name: 'Sphere', visible: true },
      ],
    }),
    readActivePartStatus() {
      const script = scripts[activeId] || '';
      const run = runs[activeId];
      if (!run) {
        return {
          partId: activeId,
          partName: activeId === 'part-a' ? 'Cube' : 'Sphere',
          script,
          runState: 'not_run_yet',
          volume: null,
          bbox: null,
          featureCount: 0,
          bodyCount: null,
        };
      }
      return {
        partId: activeId,
        partName: activeId === 'part-a' ? 'Cube' : 'Sphere',
        script,
        runState: 'ok',
        volume: 1000,
        bbox: { min: [-5, -5, -5], max: [5, 5, 5] },
        featureCount: 1,
        bodyCount: 1,
      };
    },
    setActivePart(partId) {
      if (!scripts[partId]) return { error: { code: 'unknown_part', message: 'missing' } };
      activeId = partId;
      return { ok: true };
    },
  };
}

test('status follows the active part after create and switch without another run', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  await api.call('set_script', { source: BOX });
  const afterRun = await api.call('status', {});
  assert.equal(afterRun.result.partId, 'part-a');
  assert.equal(afterRun.result.partName, 'Cube');
  assert.equal(afterRun.result.runState, 'ok');

  await api.call('set_active_part', { part_id: 'part-b' });
  const onB = await api.call('status', {});
  assert.equal(onB.result.partId, 'part-b');
  assert.equal(onB.result.partName, 'Sphere');
  assert.equal(onB.result.runState, 'not_run_yet');
  assert.match(onB.result.script, /sphere/i);

  await api.call('set_active_part', { part_id: 'part-a' });
  const backOnA = await api.call('status', {});
  assert.equal(backOnA.result.partId, 'part-a');
  assert.equal(backOnA.result.partName, 'Cube');
  assert.equal(backOnA.result.runState, 'ok');
});
