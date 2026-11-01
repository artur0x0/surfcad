import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute, BufferGeometry, FrontSide, Mesh, MeshStandardMaterial } from 'three';
import {
  MOLD_DRAFT_NEEDS_WORK_RGB,
  MOLD_DRAFT_NEGATIVE_RGB,
  MOLD_DRAFT_POSITIVE_RGB,
} from './moldDraft.js';
import { detachMoldDraftSkin, makeDraftSkinMaterial, syncMoldDraftSkin, MOLD_DRAFT_SKIN_RENDER_ORDER } from './moldDraftSkin.js';

function hostWithPaint() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    1, 0, 0, 1, 1, 0, 0, 1, 0,
    0, 0, 1, 1, 0, 1, 0, 1, 1,
  ]), 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const host = new Mesh(geometry, new MeshStandardMaterial());
  const paint = new Mesh(geometry, new MeshStandardMaterial());
  paint.name = 'face-color-skin';
  paint.visible = true;
  host.add(paint);
  host.userData.faceColorSkin = paint;
  return host;
}

const report = {
  minDeg: 1,
  positive: { count: 1, area: 0.5 },
  negative: { count: 1, area: 0.5 },
  below: { count: 1, area: 0.5, positive: { count: 1, area: 0.5 }, negative: { count: 0, area: 0 } },
  triangles: [
    { index: 0, signedDeg: 3, state: 'positive', sign: 'positive' },
    { index: 1, signedDeg: 0.4, state: 'below', sign: 'positive' },
    { index: 2, signedDeg: -2, state: 'negative', sign: 'negative' },
  ],
};

test('the mold-draft skin paints cavity, core, and the needs-work hatch', () => {
  const host = hostWithPaint();
  const skin = syncMoldDraftSkin(host, report);
  assert.ok(skin);
  assert.equal(skin.name, 'mold-draft-skin');
  assert.equal(skin.renderOrder, MOLD_DRAFT_SKIN_RENDER_ORDER);
  assert.equal(skin.material.customProgramCacheKey(), 'mold-draft-hatch-v2');
  assert.equal(host.userData.faceColorSkin.visible, false);
  const colors = skin.geometry.getAttribute('color').array;
  const hatch = skin.geometry.getAttribute('draftNeedsWork').array;
  assert.equal(colors.length, 27);
  assert.ok(Math.abs(colors[0] - MOLD_DRAFT_POSITIVE_RGB[0]) < 1e-6);
  assert.ok(Math.abs(colors[1] - MOLD_DRAFT_POSITIVE_RGB[1]) < 1e-6);
  assert.ok(Math.abs(colors[2] - MOLD_DRAFT_POSITIVE_RGB[2]) < 1e-6);
  assert.ok(Math.abs(colors[10] - MOLD_DRAFT_NEEDS_WORK_RGB[1]) < 1e-6);
  assert.ok(Math.abs(colors[20] - MOLD_DRAFT_NEGATIVE_RGB[2]) < 1e-6);
  assert.equal(hatch[0], 0);
  assert.equal(hatch[3], 1);
  assert.equal(hatch[6], 0);
  const material = makeDraftSkinMaterial(FrontSide);
  assert.match(material.customProgramCacheKey(), /mold-draft-hatch-v2/);
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

test('a threshold change rebuilds the skin onto the needs-work colour', () => {
  const host = hostWithPaint();
  syncMoldDraftSkin(host, report);
  const first = host.userData.moldDraftSkin;
  const next = {
    ...report,
    minDeg: 5,
    positive: { count: 0, area: 0 },
    negative: { count: 0, area: 0 },
    below: { count: 3, area: 1.5, positive: { count: 2, area: 1 }, negative: { count: 1, area: 0.5 } },
    triangles: [
      { index: 0, signedDeg: 3, state: 'below', sign: 'positive' },
      { index: 1, signedDeg: 0.4, state: 'below', sign: 'positive' },
      { index: 2, signedDeg: -2, state: 'below', sign: 'negative' },
    ],
  };
  const skin = syncMoldDraftSkin(host, next);
  assert.notEqual(skin, first);
  const colors = skin.geometry.getAttribute('color').array;
  const hatch = skin.geometry.getAttribute('draftNeedsWork').array;
  assert.ok(Math.abs(colors[0] - MOLD_DRAFT_NEEDS_WORK_RGB[0]) < 1e-6);
  assert.equal(hatch[0], 1);
  assert.equal(hatch[6], 1);
});
