import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { UNJOINTED_PART_HINT } from '../state/unjointedParts.js';

const FRAME = '2026-10-07-20-56-31-0423-a3f9';
const WHEEL = '2026-10-07-20-56-31-0423-b4e1';

/**
 * A two-part assembly whose joint list the commands read. `precomputed`
 * is what App.readParts already attached; leave it null to force the
 * fallback that reads readJoints.
 */
function assembly({ joints = [], precomputed = null, parts = null } = {}) {
  const rows = parts || [
    { id: 'frame', name: 'Frame', visible: true },
    { id: 'wheel', name: 'Wheel', visible: true },
  ];
  const poses = new Map(rows.map((row) => [row.id, { position: [0, 0, 0], rotation: [0, 0, 0] }]));
  return {
    readParts() {
      const state = {
        activeId: rows[0]?.id ?? null,
        assemblyName: 'Bike',
        parts: rows.map((row) => ({ ...row })),
      };
      if (precomputed) state.unjointedParts = precomputed.slice();
      return state;
    },
    readJoints: () => joints.map((joint) => JSON.parse(JSON.stringify(joint))),
    agentSetPartTransform({ partId, position, rotation }) {
      const pose = poses.get(partId);
      if (!pose) return { error: { code: 'unknown_part', message: `missing ${partId}` } };
      if (position) pose.position = position.slice();
      if (rotation) pose.rotation = rotation.slice();
      return {
        result: {
          part: partId,
          partId,
          position: pose.position.slice(),
          rotation: pose.rotation.slice(),
          eulerOrder: 'XYZ',
        },
      };
    },
    agentCreatePart({ name, position } = {}) {
      const id = name === 'Seat' ? 'seat' : 'new-part';
      rows.push({ id, name: name || 'Part', visible: true });
      poses.set(id, { position: (position || [0, 0, 0]).slice(), rotation: [0, 0, 0] });
      return { result: { partId: id, partCount: rows.length } };
    },
    agentInsertPart({ partId, instance, position, assemblyId, copy } = {}) {
      if (instance) {
        const id = 'wheel-2';
        rows.push({ id, name: 'Wheel (2)', visible: true, instanceOf: partId });
        poses.set(id, { position: (position || [80, 0, 0]).slice(), rotation: [0, 0, 0] });
        return { result: { partId: id, instanceOf: partId, added: [id], partCount: rows.length } };
      }
      return { result: { partId, assemblyId: assemblyId || null, copy: copy === true, added: [partId], partCount: rows.length } };
    },
    getScript: () => '',
    setEditor() {},
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory() {},
    async execute() {
      return { ok: true, errors: [], volume: 1, bbox: null, partName: 'Frame' };
    },
    prepareHelperInsert() {
      return { source: 'let part = Manifold.cube([10,10,10], true);\nreturn part;\n' };
    },
  };
}

function bridge(host) {
  return createSurfcadBridge({ resolve: () => host });
}

function warningOf(env) {
  assert.equal(env.ok, true, JSON.stringify(env));
  return env.result.warning;
}

test('part_set_transform warns when a part in a multi-part assembly is in no joint', async () => {
  const api = bridge(assembly());
  const moved = await api.call('part_set_transform', { part_id: 'wheel', position: [40, 0, 0] });
  assert.deepEqual(warningOf(moved), {
    code: 'unjointed_part',
    part_id: 'wheel',
    hint: UNJOINTED_PART_HINT,
  });
  assert.deepEqual(moved.result.position, [40, 0, 0]);
});

test('part_set_transform does not warn for a jointed part', async () => {
  const api = bridge(assembly({
    joints: [{ a: { part: 'frame' }, b: { part: 'wheel' } }],
  }));
  const moved = await api.call('part_set_transform', { part_id: 'wheel', position: [12, 0, 0] });
  assert.equal(warningOf(moved), undefined);
});

test('part_set_transform does not warn for a single part', async () => {
  const api = bridge(assembly({ parts: [{ id: 'frame', name: 'Frame', visible: true }] }));
  const moved = await api.call('part_set_transform', { part_id: 'frame', position: [1, 0, 0] });
  assert.equal(warningOf(moved), undefined);
});

test('part_set_transform does not warn for the base part that has a fixed joint', async () => {
  const api = bridge(assembly({ joints: [{ type: 'fixed', a: { part: 'frame' } }] }));
  const base = await api.call('part_set_transform', { part_id: 'frame', position: [0, 0, 0] });
  assert.equal(warningOf(base), undefined);
  const other = await api.call('part_set_transform', { part_id: 'wheel', position: [40, 0, 0] });
  assert.equal(warningOf(other).part_id, 'wheel');
});

test('a refused transform is not wrapped with a warning', async () => {
  const api = bridge(assembly());
  const missing = await api.call('part_set_transform', { part_id: 'ghost', position: [1, 0, 0] });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'unknown_part');
});

test('create_part and insert_part warn only when a position is set', async () => {
  const host = assembly();
  const api = bridge(host);
  const bare = await api.call('create_part', { name: 'Seat' });
  assert.equal(warningOf(bare), undefined);
  const placed = await api.call('create_part', { name: 'Seat', position: [0, 40, 0] });
  assert.equal(warningOf(placed).code, 'unjointed_part');
  assert.equal(warningOf(placed).part_id, 'seat');

  const reference = await api.call('insert_part', { part_id: FRAME });
  assert.equal(warningOf(reference), undefined);

  const instance = await api.call('insert_part', { part_id: WHEEL, instance: true, position: [80, 0, 0] });
  assert.equal(warningOf(instance).part_id, 'wheel-2');
  const staggered = await api.call('insert_part', { part_id: WHEEL, instance: true });
  assert.equal(warningOf(staggered), undefined);
});

test('insert_cube inside a part does not warn', async () => {
  const api = bridge(assembly());
  const inserted = await api.call('insert_cube', { x: 20, y: 0, z: 0 });
  assert.equal(inserted.ok, true, JSON.stringify(inserted));
  assert.equal(inserted.result.warning, undefined);
  assert.equal(inserted.result.helperId, 'cube');
});

test('parts and status report unjointed ids, and a precomputed list is trusted', async () => {
  const open = bridge(assembly());
  const parts = await open.call('parts', {});
  assert.deepEqual(parts.result.unjointedParts, ['frame', 'wheel']);
  const status = await open.call('status', {});
  assert.deepEqual(status.result.unjointedParts, ['frame', 'wheel']);

  const grounded = bridge(assembly({ joints: [{ type: 'fixed', a: { part: 'frame' } }] }));
  assert.deepEqual((await grounded.call('parts', {})).result.unjointedParts, ['wheel']);

  const trusted = bridge(assembly({ precomputed: ['wheel'], joints: [] }));
  assert.deepEqual((await trusted.call('parts', {})).result.unjointedParts, ['wheel']);
  const moved = await trusted.call('part_set_transform', { part_id: 'frame', position: [1, 0, 0] });
  assert.equal(warningOf(moved), undefined);
  const wheel = await trusted.call('part_set_transform', { part_id: 'wheel', position: [2, 0, 0] });
  assert.equal(warningOf(wheel).part_id, 'wheel');
});

test('a row whose public id is not the surf id is jointed when the joint names the surf id', async () => {
  const api = bridge(assembly({
    parts: [
      { id: 'frame-row', surfId: FRAME, name: 'Frame', visible: true },
      { id: 'wheel-row', surfId: WHEEL, name: 'Wheel', visible: true },
    ],
    joints: [{ type: 'fixed', a: { part: FRAME } }],
  }));
  assert.deepEqual((await api.call('parts', {})).result.unjointedParts, ['wheel-row']);
  const base = await api.call('part_set_transform', { part_id: 'frame-row', position: [0, 0, 0] });
  assert.equal(warningOf(base), undefined);
  const wheel = await api.call('part_set_transform', { part_id: 'wheel-row', position: [40, 0, 0] });
  assert.equal(warningOf(wheel).part_id, 'wheel-row');
});
