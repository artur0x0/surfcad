import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';

const SURF = '2026-10-18-07-19-33-0215-1e48';
const BODY = 'let part = Manifold.cube([30, 20, 16], true);\nreturn part;\n';

test('set_script and run pass through droppedPaints from the host', async () => {
  let buffer = `// @surf-id ${SURF}\n${BODY}`;
  const dropped = [{
    surfId: SURF,
    color: '#aa1122',
    key: { at: [0, -10, 0], n: [0, -1, 0], area: 480 },
    reason: 'missing',
  }];
  const api = createSurfcadBridge({
    resolve: () => ({
      getScript: () => buffer,
      setEditor(src) { buffer = src; },
      readHistory: () => ({ commits: [], head: -1 }),
      writeHistory() {},
      readActivePartSurfId: () => SURF,
      readParts: () => ({
        activeId: SURF,
        assemblyName: 'Asm',
        parts: [{ id: SURF, name: 'Cube', visible: true }],
      }),
      async execute() {
        return {
          ok: true,
          errors: [],
          volume: 9600,
          bbox: null,
          partName: 'Cube',
          droppedPaints: dropped,
        };
      },
    }),
  });

  const ran = await api.call('set_script', { part_id: SURF, source: BODY });
  assert.equal(ran.ok, true);
  assert.equal(ran.result.ok, true);
  assert.deepEqual(ran.result.droppedPaints, dropped);
  const again = await api.call('run', {});
  assert.deepEqual(again.result.droppedPaints, dropped);
});

test('a run without droppedPaints omits the field', async () => {
  let buffer = BODY;
  const api = createSurfcadBridge({
    resolve: () => ({
      getScript: () => buffer,
      setEditor(src) { buffer = src; },
      readHistory: () => ({ commits: [], head: -1 }),
      writeHistory() {},
      async execute() {
        return { ok: true, errors: [], volume: 1, bbox: null, partName: 'Part' };
      },
    }),
  });
  const ran = await api.call('run', {});
  assert.equal(ran.result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(ran.result, 'droppedPaints'), false);
});
