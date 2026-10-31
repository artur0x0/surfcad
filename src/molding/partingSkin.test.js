import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import { PARTING_ROLE_RGB } from './parting.js';
import { detachPartingSkin, syncPartingSkin, PARTING_SKIN_RENDER_ORDER } from './partingSkin.js';

function hostWithPaint() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2]);
  const host = new Mesh(geometry, new MeshStandardMaterial());
  const paint = new Mesh(geometry, new MeshStandardMaterial());
  paint.name = 'face-color-skin';
  paint.visible = true;
  host.add(paint);
  host.userData.faceColorSkin = paint;
  return host;
}

const parting = {
  neutralDeg: 10,
  counts: { cavity: 1, core: 0, parting: 0 },
  lines: [],
  triangles: [{ index: 0, role: 'cavity' }],
};

test('the parting skin paints the triangle and hides face paint', () => {
  const host = hostWithPaint();
  const skin = syncPartingSkin(host, parting);
  assert.ok(skin);
  assert.equal(skin.name, 'mold-parting-skin');
  assert.equal(skin.renderOrder, PARTING_SKIN_RENDER_ORDER);
  assert.equal(host.userData.faceColorSkin.visible, false);
  const colors = skin.geometry.getAttribute('color').array;
  assert.ok(Math.abs(colors[0] - PARTING_ROLE_RGB.cavity[0]) < 1e-6);
  assert.ok(Math.abs(colors[1] - PARTING_ROLE_RGB.cavity[1]) < 1e-6);
  assert.ok(Math.abs(colors[2] - PARTING_ROLE_RGB.cavity[2]) < 1e-6);
});

test('turning the parting skin off restores face paint', () => {
  const host = hostWithPaint();
  syncPartingSkin(host, parting);
  detachPartingSkin(host);
  assert.equal(host.userData.partingSkin, null);
  assert.equal(host.userData.faceColorSkin.visible, true);
  assert.equal(host.children.some((child) => child.name === 'mold-parting-skin'), false);
});

test('a missing classification removes the skin', () => {
  const host = hostWithPaint();
  syncPartingSkin(host, parting);
  assert.equal(syncPartingSkin(host, null), null);
  assert.equal(host.userData.faceColorSkin.visible, true);
});
