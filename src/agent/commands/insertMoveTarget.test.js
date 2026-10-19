import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { checkMoveTargetArgs, moveTargetArgs } from './invokeHelper.js';
import { composeHelperInsert } from '../../utils/helperPaletteSnippets.js';

/**
 * Bike acceptance PR 1: insert_move names the body it moves. The host
 * resolves body_index / at / face / face_id / the selection to a centroid;
 * nothing named and nothing selected is no_body, never the origin.
 */

const TWO_BODIES = 'let part = Manifold.cube([20, 20, 20], true);\npart = part.add(Manifold.cube([10, 10, 10], true).translate([40, 0, 0]), { merge: false });\nreturn part;\n';
const BODY_A = [0, 0, 0];
const BODY_B = [40, 0, 0];

function host(overrides = {}) {
  const prepared = [];
  const resolved = [];
  return {
    prepared,
    resolved,
    getScript: () => TWO_BODIES,
    setEditor: () => {},
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory: () => {},
    execute: async () => ({ ok: true, errors: [], volume: 9000, bbox: null, partName: 'frame', bodyCount: 2 }),
    readBodies: () => ({ partId: 'p1', bodies: [{ index: 0, at: BODY_A, triangleCount: 12 }, { index: 1, at: BODY_B, triangleCount: 12 }] }),
    resolveMoveAnchor(target) {
      resolved.push(target);
      if (target.bodyIndex != null) {
        const at = [BODY_A, BODY_B][target.bodyIndex];
        return at ? { at, bodyIndex: target.bodyIndex } : { error: { code: 'no_body', message: 'body_index 7 is not one of the 2 bodies; call list_bodies' } };
      }
      if (target.at) return { at: target.at, bodyIndex: 1 };
      if (target.faceId === 'f3' || target.face) return { at: BODY_B, bodyIndex: 1 };
      if (target.useSelection) return { at: BODY_A, bodyIndex: 0 };
      return { error: { code: 'no_body', message: 'insert_move needs a body: pass body_index or at (from list_bodies), face or face_id (from list_faces), or select a face first.' } };
    },
    prepareHelperInsert(payload) {
      prepared.push(payload);
      const source = composeHelperInsert(TWO_BODIES, payload.helperId, null, payload.params, payload.faceContext, payload.edgeContext);
      return typeof source === 'string' ? { source } : { error: { code: 'insert_failed', message: 'nope' } };
    },
    ...overrides,
  };
}

test('list_bodies lists the bodies with their centroids', async () => {
  const api = createSurfcadBridge({ resolve: () => host() });
  const env = await api.call('list_bodies', {});
  assert.equal(env.ok, true);
  assert.deepEqual(env.result, {
    partId: 'p1',
    bodies: [{ index: 0, at: BODY_A, triangleCount: 12 }, { index: 1, at: BODY_B, triangleCount: 12 }],
  });
});

test('insert_move with nothing named and nothing selected is no_body, and writes nothing', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const env = await api.call('insert_move', { dx: 5 });
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'no_body');
  assert.match(env.error.message, /list_bodies/);
  assert.equal(h.prepared.length, 0);
});

test('insert_move body_index moves that body: the generated move names its centroid', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const env = await api.call('insert_move', { body_index: 1, dx: 0, dy: 15, dz: 0 });
  assert.equal(env.ok, true, JSON.stringify(env));
  assert.equal(h.resolved[0].bodyIndex, 1);
  assert.deepEqual(h.prepared[0].params.at, BODY_B);
  assert.match(h.prepared[0].source ?? '', /^$|./);
  const script = composeHelperInsert(TWO_BODIES, 'move', null, h.prepared[0].params);
  assert.match(script, /move\(part, \[0, 15, 0\], \{ bodies: \[\{ at: \[40, 0, 0\] \}\] \}\)/);
});

test('insert_move at, face_id, face, and use_selection each resolve through the host', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  await api.call('insert_move', { at: BODY_B, dx: 1 });
  await api.call('insert_move', { face_id: 'f3', dx: 1 });
  await api.call('insert_move', { face: { at: [45, 0, 0], n: [1, 0, 0], area: 100 }, dx: 1 });
  await api.call('insert_move', { use_selection: true, dx: 1 });
  assert.deepEqual(h.resolved.map((t) => [t.at, t.faceId, !!t.face, t.useSelection]), [
    [BODY_B, null, false, false],
    [null, 'f3', false, false],
    [null, null, true, false],
    [null, null, false, true],
  ]);
  assert.deepEqual(h.prepared.map((p) => p.params.at), [BODY_B, BODY_B, BODY_B, BODY_A]);
});

test('insert_move rejects a malformed target before the host sees it', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const badAt = await api.call('insert_move', { at: [1, 2], dx: 1 });
  assert.equal(badAt.error.code, 'bad_args');
  const badIndex = await api.call('insert_move', { body_index: -1, dx: 1 });
  assert.equal(badIndex.error.code, 'bad_args');
  const outOfRange = await api.call('insert_move', { body_index: 7, dx: 1 });
  assert.equal(outOfRange.error.code, 'no_body');
  assert.equal(h.prepared.length, 0);
});

test('moveTargetArgs reads top-level or params fields; checkMoveTargetArgs shapes them', () => {
  assert.deepEqual(moveTargetArgs({ params: { body_index: 2 }, use_selection: true }), {
    at: null, face: null, faceId: null, bodyIndex: 2, useSelection: true,
  });
  assert.equal(checkMoveTargetArgs({ at: [1, 2, 3] }), null);
  assert.equal(checkMoveTargetArgs({ face_id: 12 })?.code, 'bad_args');
  assert.equal(checkMoveTargetArgs({ face: [1] })?.code, 'bad_args');
});
