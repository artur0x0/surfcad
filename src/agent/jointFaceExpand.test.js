import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, BufferGeometry } from 'three';
import { agentFaceFingerprints } from './faceCatalog.js';
import { describeExpandedFaceJointPick } from './jointFaceExpand.js';
import { serializeFaceKey } from './state/listPickables.js';

function tessellatedCylinderGeometry(segments = 32) {
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

test('describeExpandedFaceJointPick returns axis for merged cylinder wall key', () => {
  const { geometry, faceIDs } = tessellatedCylinderGeometry(64);
  const faces = agentFaceFingerprints(geometry, faceIDs);
  const wall = faces.find((row) => Math.abs(row.n[2]) < 0.45);
  assert.ok(wall, 'wall row');
  const key = serializeFaceKey(wall);
  const out = describeExpandedFaceJointPick({ geometry, faceIDs, key });
  assert.equal(out.error, undefined);
  assert.equal(out.kind, 'axis');
  assert.equal(out.axis, true);
  assert.ok(Number(out.key?.radius) > 0);
});
