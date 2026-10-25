import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Plane,
  ShaderMaterial,
  Vector3,
} from 'three';
import { verifyAssemblySectionClip } from './sectionClipFixture.js';
import {
  adoptSectionClip,
  beginSectionClip,
  endSectionClip,
  sectionClipSession,
} from './sectionClip.js';

test('assembly section clip is view-only in world space', () => {
  verifyAssemblySectionClip();

  const keep = new Plane(new Vector3(0, 1, 0), -4);
  const mat = new MeshStandardMaterial();
  mat.clippingPlanes = [keep];
  mat.clipShadows = true;
  mat.clipIntersection = true;
  beginSectionClip([0, 0, 1], 2);
  adoptSectionClip(mat);
  try {
    const session = sectionClipSession();
    assert.equal(mat.clippingPlanes, session.planes);
    assert.equal(mat.clipShadows, true);
    assert.equal(mat.clipIntersection, true);
    assert.notEqual(mat.clippingPlanes[0], keep);
  } finally {
    endSectionClip();
  }
  assert.equal(mat.clippingPlanes.length, 1);
  assert.equal(mat.clippingPlanes[0], keep);
  assert.equal(mat.clipShadows, true);
  assert.equal(mat.clipIntersection, true);

  const shader = new ShaderMaterial();
  const exempt = new MeshStandardMaterial();
  exempt.userData.sectionClipExempt = true;
  const host = new Mesh(new BufferGeometry(), exempt);
  host.add(new Mesh(new BufferGeometry(), shader));
  beginSectionClip([1, 0, 0], 0);
  try {
    adoptSectionClip(shader);
    adoptSectionClip(exempt);
    adoptSectionClip(host.material);
    assert.equal(shader.clippingPlanes, null);
    assert.equal(exempt.clippingPlanes, null);
  } finally {
    endSectionClip();
  }
});
