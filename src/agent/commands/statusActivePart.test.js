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
  const runs = {};
  const volumes = { 'part-a': 1000, 'part-b': 523.6 };
  const bboxes = {
    'part-a': { min: [-5, -5, -5], max: [5, 5, 5] },
    'part-b': { min: [-5, -5, -5], max: [5, 5, 5] },
  };
  function partNameOf(id) {
    return id === 'part-a' ? 'Cube' : 'Sphere';
  }
  return {
    getScript: () => scripts[activeId] || '',
    setEditor(src) {
      scripts[activeId] = src;
    },
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory() {},
    async execute(src) {
      const ok = !src.includes('fail');
      if (ok) {
        runs[activeId] = {
          ok: true,
          mesh: { vertProperties: new Float32Array(9) },
          volume: volumes[activeId],
          bbox: bboxes[activeId],
          bodyCount: 1,
        };
      }
      return {
        ok,
        errors: ok ? [] : ['boom'],
        volume: ok ? volumes[activeId] : null,
        bbox: ok ? bboxes[activeId] : null,
        partName: partNameOf(activeId),
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
          partName: partNameOf(activeId),
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
        partName: partNameOf(activeId),
        script,
        runState: 'ok',
        volume: run.volume,
        bbox: run.bbox,
        featureCount: 1,
        bodyCount: run.bodyCount,
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

test('status after running A then B then switching to A keeps A\'s volume and bbox', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  await api.call('set_script', { source: BOX });
  const afterA = await api.call('status', {});
  assert.equal(afterA.result.volume, 1000);
  assert.deepEqual(afterA.result.bbox.max, [5, 5, 5]);

  await api.call('set_active_part', { part_id: 'part-b' });
  await api.call('set_script', { source: SPHERE });
  const afterB = await api.call('status', {});
  assert.equal(afterB.result.partId, 'part-b');
  assert.equal(afterB.result.volume, 523.6);

  await api.call('set_active_part', { part_id: 'part-a' });
  const backOnA = await api.call('status', {});
  assert.equal(backOnA.result.partId, 'part-a');
  assert.equal(backOnA.result.volume, 1000);
  assert.deepEqual(backOnA.result.bbox, { min: [-5, -5, -5], max: [5, 5, 5] });
});
