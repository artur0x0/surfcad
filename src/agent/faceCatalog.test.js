import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, BufferGeometry } from 'three';
import { agentFaceFingerprints } from './faceCatalog.js';

/** Minimal tessellated cylinder side: many facets, one Manifold face id. */
function tessellatedCylinderGeometry(segments = 16) {
  const positions = [];
  const indices = [];
  const faceIDs = [];
  const r = 5;
  const h = 30;
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    positions.push(x, y, 0, x, y, h);
  }
  for (let i = 0; i < segments; i += 1) {
    const i0 = i * 2;
    const i1 = i0 + 1;
    const i2 = i0 + 2;
    const i3 = i0 + 3;
    indices.push(i0, i2, i1, i1, i2, i3);
    faceIDs.push(2, 2);
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setIndex(indices);
  geom.setAttribute('faceID', new BufferAttribute(new Float32Array(faceIDs), 1));
  geom.computeVertexNormals();
  return { geometry: geom, faceIDs };
}

test('agentFaceFingerprints merges tessellated cylinder wall facets', () => {
  const { geometry, faceIDs } = tessellatedCylinderGeometry(32);
  const faces = agentFaceFingerprints(geometry, faceIDs);
  const walls = faces.filter((row) => Math.abs(row.n[2]) < 0.45);
  assert.ok(walls.length <= 2, `expected one wall row, got ${walls.length}`);
  assert.ok(walls[0].area > 100, 'wall area should be the full side');
});
