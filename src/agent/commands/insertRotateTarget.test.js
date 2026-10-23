import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { composeHelperInsert } from '../../utils/helperPaletteSnippets.js';

/**
 * insert_rotate names the body it turns the way insert_move does: the host
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
      return { error: { code: 'no_body', message: 'insert_rotate needs a body: pass body_index or at (from list_bodies), face or face_id (from list_faces), or select a face first.' } };
    },
    prepareHelperInsert(payload) {
      prepared.push(payload);
      const source = composeHelperInsert(TWO_BODIES, payload.helperId, null, payload.params, payload.faceContext, payload.edgeContext);
      return typeof source === 'string' ? { source } : { error: { code: 'insert_failed', message: 'nope' } };
    },
    ...overrides,
  };
}

test('insert_rotate with nothing named and nothing selected is no_body, and writes nothing', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const env = await api.call('insert_rotate', { angle: 30 });
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'no_body');
  assert.match(env.error.message, /insert_rotate/);
  assert.match(env.error.message, /list_bodies/);
  assert.equal(h.prepared.length, 0);
});

test('insert_rotate body_index turns that body: the generated call names its centroid', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const env = await api.call('insert_rotate', { body_index: 1, axis: 'z', angle: 30 });
  assert.equal(env.ok, true, JSON.stringify(env));
  assert.equal(env.result.usedSelection, false);
  assert.equal(h.resolved[0].bodyIndex, 1);
  assert.deepEqual(h.prepared[0].params.at, BODY_B);
  const script = composeHelperInsert(TWO_BODIES, 'rotate', null, h.prepared[0].params);
  assert.match(script, /rotateAbout\(part, 'z', 30, null, \{ bodies: \[\{ at: \[40, 0, 0\] \}\] \}\)/);
  assert.match(script, /\/\/ --- rotate begin ---/);
});

test('insert_rotate takes a vector axis, a center, and the move target forms', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const vec = await api.call('insert_rotate', { at: BODY_B, axis: [0, 1, 0], angle: -15, center: [40, 0, 10] });
  assert.equal(vec.ok, true, JSON.stringify(vec));
  const script = composeHelperInsert(TWO_BODIES, 'rotate', null, h.prepared[0].params);
  assert.match(script, /rotateAbout\(part, \[0, 1, 0\], -15, \[40, 0, 10\], \{ bodies: \[\{ at: \[40, 0, 0\] \}\] \}\)/);
  await api.call('insert_rotate', { face_id: 'f3', angle: 1 });
  await api.call('insert_rotate', { face: { at: [45, 0, 0], n: [1, 0, 0], area: 100 }, angle: 1 });
  const sel = await api.call('insert_rotate', { use_selection: true, angle: 1 });
  assert.equal(sel.result.usedSelection, true);
  assert.deepEqual(h.prepared.map((p) => p.params.at), [BODY_B, BODY_B, BODY_B, BODY_A]);
});

test('insert_rotate defaults: z axis, 90 degrees, the body centroid as center', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const env = await api.call('insert_rotate', { body_index: 0 });
  assert.equal(env.ok, true, JSON.stringify(env));
  const script = composeHelperInsert(TWO_BODIES, 'rotate', null, h.prepared[0].params);
  assert.match(script, /rotateAbout\(part, 'z', 90, null, \{ bodies: \[\{ at: \[0, 0, 0\] \}\] \}\)/);
});

test('insert_rotate rejects a bad axis, center, or target before the host sees it', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const badAxis = await api.call('insert_rotate', { body_index: 0, axis: 'w', angle: 10 });
  assert.equal(badAxis.error.code, 'bad_args');
  assert.match(badAxis.error.message, /axis/i);
  const zeroAxis = await api.call('insert_rotate', { body_index: 0, axis: [0, 0, 0], angle: 10 });
  assert.equal(zeroAxis.error.code, 'bad_args');
  const badCenter = await api.call('insert_rotate', { body_index: 0, center: [1, 2], angle: 10 });
  assert.equal(badCenter.error.code, 'bad_args');
  const badAngle = await api.call('insert_rotate', { body_index: 0, angle: 'ninety' });
  assert.equal(badAngle.error.code, 'bad_args');
  const badAt = await api.call('insert_rotate', { at: [1, 2], angle: 1 });
  assert.equal(badAt.error.code, 'bad_args');
  assert.match(badAt.error.message, /insert_rotate at/);
  const outOfRange = await api.call('insert_rotate', { body_index: 7, angle: 1 });
  assert.equal(outOfRange.error.code, 'no_body');
  assert.equal(h.prepared.length, 0);
});
