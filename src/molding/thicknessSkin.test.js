import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import { viridis } from '../fea/colormap.js';
import { detachThicknessSkin, syncThicknessSkin, WALL_SKIN_RENDER_ORDER } from './thicknessSkin.js';

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

const wall = {
  nominal: 2,
  max: 2,
  sampleCount: 1,
  thresholds: { thinRatio: 0.6, thickRatio: 1.5 },
  field: [{ index: 0, thickness: 2, flag: 'nominal' }],
};

test('the heatmap paints the triangle and hides face paint', () => {
  const host = hostWithPaint();
  const skin = syncThicknessSkin(host, wall);
  assert.ok(skin);
  assert.equal(skin.name, 'wall-thickness-skin');
  assert.equal(skin.renderOrder, WALL_SKIN_RENDER_ORDER);
  assert.equal(host.userData.faceColorSkin.visible, false);
  const colors = skin.geometry.getAttribute('color').array;
  const expected = viridis(0.5);
  assert.ok(Math.abs(colors[0] - expected[0]) < 1e-6);
  assert.ok(Math.abs(colors[1] - expected[1]) < 1e-6);
  assert.ok(Math.abs(colors[2] - expected[2]) < 1e-6);
});

test('turning the skin off restores face paint and the part mesh', () => {
  const host = hostWithPaint();
  syncThicknessSkin(host, wall);
  detachThicknessSkin(host);
  assert.equal(host.userData.wallSkin, null);
  assert.equal(host.userData.faceColorSkin.visible, true);
  assert.equal(host.children.some((child) => child.name === 'wall-thickness-skin'), false);
  assert.equal(host.children.some((child) => child.name === 'face-color-skin'), true);
});

test('a missing nominal removes the skin', () => {
  const host = hostWithPaint();
  syncThicknessSkin(host, wall);
  const skin = syncThicknessSkin(host, { nominal: null, field: [] });
  assert.equal(skin, null);
  assert.equal(host.userData.faceColorSkin.visible, true);
});
