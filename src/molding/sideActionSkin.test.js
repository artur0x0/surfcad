import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import { SIDE_ACTION_KIND_RGB } from './sideActions.js';
import { detachSideActionSkin, syncSideActionSkin, SIDE_ACTION_SKIN_RENDER_ORDER } from './sideActionSkin.js';

function hostWithPaint() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    1, 0, 0, 1, 1, 0, 0, 1, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  const host = new Mesh(geometry, new MeshStandardMaterial());
  const paint = new Mesh(geometry, new MeshStandardMaterial());
  paint.name = 'face-color-skin';
  paint.visible = true;
  host.add(paint);
  host.userData.faceColorSkin = paint;
  return host;
}

const actions = {
  count: 1,
  slideCount: 1,
  lifterCount: 0,
  groups: [{
    id: 0,
    kind: 'slide',
    pull: [1, 0, 0],
    triangles: [0],
  }],
};

test('the side-action skin paints the undercut and hides face paint', () => {
  const host = hostWithPaint();
  const skin = syncSideActionSkin(host, actions);
  assert.ok(skin);
  assert.equal(skin.name, 'mold-side-action-skin');
  assert.equal(skin.renderOrder, SIDE_ACTION_SKIN_RENDER_ORDER);
  assert.equal(host.userData.faceColorSkin.visible, false);
  const colors = skin.geometry.getAttribute('color').array;
  assert.equal(colors.length, 9);
  assert.ok(Math.abs(colors[0] - SIDE_ACTION_KIND_RGB.slide[0]) < 1e-6);
  assert.ok(Math.abs(colors[1] - SIDE_ACTION_KIND_RGB.slide[1]) < 1e-6);
  assert.ok(Math.abs(colors[2] - SIDE_ACTION_KIND_RGB.slide[2]) < 1e-6);
});

test('turning the side-action skin off restores face paint', () => {
  const host = hostWithPaint();
  syncSideActionSkin(host, actions);
  detachSideActionSkin(host);
  assert.equal(host.userData.sideActionSkin, null);
  assert.equal(host.userData.faceColorSkin.visible, true);
  assert.equal(host.children.some((child) => child.name === 'mold-side-action-skin'), false);
});

test('paint stays hidden while a wall skin is still up', () => {
  const host = hostWithPaint();
  syncSideActionSkin(host, actions);
  host.userData.wallSkin = {};
  detachSideActionSkin(host);
  assert.equal(host.userData.faceColorSkin.visible, false);
});

test('an empty group list removes the skin', () => {
  const host = hostWithPaint();
  syncSideActionSkin(host, actions);
  assert.equal(syncSideActionSkin(host, { groups: [] }), null);
  assert.equal(host.userData.faceColorSkin.visible, true);
});
