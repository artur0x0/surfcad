import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import { MOLD_DRAFT_RGB } from './moldDraft.js';
import { detachMoldDraftSkin, syncMoldDraftSkin, MOLD_DRAFT_SKIN_RENDER_ORDER } from './moldDraftSkin.js';

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

const report = {
  violationCount: 1,
  triangleCount: 1,
  minDraftDeg: 0,
  triangles: [{ index: 0, draftDeg: 0 }],
};

test('the mold-draft skin paints the violation and hides face paint', () => {
  const host = hostWithPaint();
  const skin = syncMoldDraftSkin(host, report);
  assert.ok(skin);
  assert.equal(skin.name, 'mold-draft-skin');
  assert.equal(skin.renderOrder, MOLD_DRAFT_SKIN_RENDER_ORDER);
  assert.equal(host.userData.faceColorSkin.visible, false);
  const colors = skin.geometry.getAttribute('color').array;
  assert.equal(colors.length, 9);
  assert.ok(Math.abs(colors[0] - MOLD_DRAFT_RGB[0]) < 1e-6);
});

test('turning the mold-draft skin off restores face paint', () => {
  const host = hostWithPaint();
  syncMoldDraftSkin(host, report);
  detachMoldDraftSkin(host);
  assert.equal(host.userData.moldDraftSkin, null);
  assert.equal(host.userData.faceColorSkin.visible, true);
});

test('paint stays hidden while a side-action skin is still up', () => {
  const host = hostWithPaint();
  syncMoldDraftSkin(host, report);
  host.userData.sideActionSkin = {};
  detachMoldDraftSkin(host);
  assert.equal(host.userData.faceColorSkin.visible, false);
});

test('an empty report removes the skin', () => {
  const host = hostWithPaint();
  syncMoldDraftSkin(host, report);
  assert.equal(syncMoldDraftSkin(host, { triangles: [] }), null);
  assert.equal(host.userData.faceColorSkin.visible, true);
});
