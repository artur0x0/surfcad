import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from 'three';
import { applyActivePartAnchor, shiftLocalPoint } from './activePartOverlay.js';
import { eulerDegreesToQuaternion, worldPoint } from './partPose.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function ghostAt(local) {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(local), 3));
  return new Mesh(geom);
}

test('an anchored overlay lands where the posed part lands: world = pose × local', () => {
  // The bike fixture: a part 340 mm up and turned 30° about Z.
  const t = [0, 0, 340];
  const q = eulerDegreesToQuaternion([0, 0, 30]);
  const local = [10, 0, 5];
  const ghost = ghostAt(local);
  const group = new Group();
  group.add(ghost);
  applyActivePartAnchor(group, t, q);
  const world = ghost.localToWorld(new Vector3(local[0], local[1], local[2]));
  const expected = worldPoint(local, { t, q });
  assert.ok(near(world.x, expected[0]) && near(world.y, expected[1]) && near(world.z, expected[2]),
    `${[world.x, world.y, world.z]} vs ${expected}`);
  // And not the translation-only answer the old Boolean preview gave.
  const cos30 = Math.cos(Math.PI / 6);
  assert.ok(near(world.x, 10 * cos30, 1e-6), `x ${world.x}`);
  assert.ok(near(world.y, 5, 1e-6), `y ${world.y}`);
  assert.ok(near(world.z, 345, 1e-6), `z ${world.z}`);
  const shifted = shiftLocalPoint(local, t, q);
  assert.ok(near(shifted[0], world.x) && near(shifted[1], world.y) && near(shifted[2], world.z));
  assert.equal(group.userData.anchorToActivePart, true);
});

test('a mesh anchored directly (no group) is posed the same way', () => {
  const t = [12, -4, 7];
  const q = eulerDegreesToQuaternion([90, 0, 0]);
  const local = [0, 3, 0];
  const mesh = ghostAt(local);
  applyActivePartAnchor(mesh, t, q);
  const world = mesh.localToWorld(new Vector3(local[0], local[1], local[2]));
  const expected = worldPoint(local, { t, q });
  for (let i = 0; i < 3; i += 1) {
    assert.ok(near([world.x, world.y, world.z][i], expected[i]), `axis ${i}`);
  }
  assert.ok(near(world.z, 7 + 3), 'a +Y local point turns into +Z under rx=90');
});

test('a missing or identity quaternion keeps the translation-only anchor', () => {
  const mesh = ghostAt([1, 2, 3]);
  applyActivePartAnchor(mesh, [5, 6, 7], null);
  assert.deepEqual([mesh.position.x, mesh.position.y, mesh.position.z], [5, 6, 7]);
  assert.deepEqual([mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w], [0, 0, 0, 1]);
  applyActivePartAnchor(mesh, [5, 6, 7], [0, 0, 0, 1]);
  assert.deepEqual([mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w], [0, 0, 0, 1]);
});

test('re-anchoring replaces the pose instead of accumulating it', () => {
  const mesh = ghostAt([1, 0, 0]);
  applyActivePartAnchor(mesh, [0, 0, 340], eulerDegreesToQuaternion([0, 0, 30]));
  applyActivePartAnchor(mesh, [0, 0, 0], eulerDegreesToQuaternion([0, 0, 0]));
  const world = mesh.localToWorld(new Vector3(1, 0, 0));
  assert.ok(near(world.x, 1) && near(world.y, 0) && near(world.z, 0), `${[world.x, world.y, world.z]}`);
});
