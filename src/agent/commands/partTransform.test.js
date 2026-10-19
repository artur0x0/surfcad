import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';

function host(overrides = {}) {
  const parts = new Map([
    ['a', { position: [0, 0, 0], placement: { t: [0, 0, 0], q: [0, 0, 0, 1] } }],
    ['b', { position: [40, 0, 0], placement: { t: [40, 0, 0], q: [0, 0, 0, 1] } }],
  ]);
  return {
    getScript: () => '',
    setEditor() {},
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory() {},
    async execute() {
      return { ok: true, errors: [], volume: null, bbox: null, partName: '' };
    },
    screenshot: () => 'data:image/png;base64,',
    agentGetPartTransform({ partId }) {
      const row = parts.get(partId);
      if (!row) return { error: { code: 'unknown_part', message: 'missing' } };
      return {
        result: {
          part: partId,
          position: row.placement.t.slice(),
          rotation: [0, 0, 0],
          eulerOrder: 'XYZ',
        },
      };
    },
    agentSetPartTransform({ partId, position }) {
      const row = parts.get(partId);
      if (!row) return { error: { code: 'unknown_part', message: 'missing' } };
      row.placement.t = position.slice();
      row.position = position.slice();
      return {
        result: {
          part: partId,
          position: position.slice(),
          rotation: [0, 0, 0],
          eulerOrder: 'XYZ',
        },
      };
    },
    agentCreatePart({ position } = {}) {
      const id = parts.size === 0 ? 'a' : 'c';
      const t = position || [0, 0, 0];
      parts.set(id, { position: t.slice(), placement: { t: t.slice(), q: [0, 0, 0, 1] } });
      return { result: { partId: id, partCount: parts.size } };
    },
    ...overrides,
  };
}

test('part_get_transform and part_set_transform round-trip through the bridge', async () => {
  const api = createSurfcadBridge({ resolve: () => host() });
  const read = await api.call('part_get_transform', { part_id: 'b' });
  assert.equal(read.ok, true);
  assert.deepEqual(read.result.position, [40, 0, 0]);

  const moved = await api.call('part_set_transform', { part_id: 'b', position: [12, 0, 0] });
  assert.equal(moved.ok, true);
  assert.deepEqual(moved.result.position, [12, 0, 0]);
});

test('create_part forwards optional position to the host', async () => {
  let seen = null;
  const api = createSurfcadBridge({
    resolve: () => host({
      agentCreatePart(args) {
        seen = args;
        return { result: { partId: 'new', partCount: 3 } };
      },
    }),
  });
  const created = await api.call('create_part', { name: 'Pin', position: [3, 4, 5] });
  assert.equal(created.ok, true);
  assert.deepEqual(seen?.position, [3, 4, 5]);
});

test('part_set_transform refuses a position beyond the limit, NaN, or Infinity before the host (bike PR 2)', async () => {
  const api = createSurfcadBridge({ resolve: () => host() });
  const far = await api.call('part_set_transform', { part_id: 'a', position: [0, 0, 1000001] });
  assert.equal(far.ok, false);
  assert.equal(far.error.code, 'bad_args');
  assert.match(far.error.message, /1000000/);
  const bad = await api.call('part_set_transform', { part_id: 'a', position: [0, 0, 'NaN'] });
  assert.equal(bad.error.code, 'bad_args');
  const ok = await api.call('part_set_transform', { part_id: 'a', position: [0, 0, 2000] });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});
