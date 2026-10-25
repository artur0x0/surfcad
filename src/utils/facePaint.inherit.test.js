/**
 * Paint on a definition is drawn on its instances. An entry stored on the
 * instance replaces that paint. The skin and the viewport both resolve
 * through colorEntryForPlacement.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { colorEntryForPlacement } from './facePaint.js';
import { syncFaceColorSkin, detachFaceColorSkin } from './faceColorSkin.js';

const DEF = '2026-10-24-19-00-00-0004-0e01';
const INST = '2026-10-24-19-05-00-0011-00b2';

const RED = { part: '#ff0000' };
const GREEN = { part: '#00ff00' };
const FACE = {
  faces: [{ color: '#0000ff', key: { at: [0, 0, 0], n: [0, 0, 1], area: 1 } }],
};

test('an instance inherits the definition paint and its own entry replaces it', () => {
  const colors = { [DEF]: RED };
  assert.equal(colorEntryForPlacement(colors, INST, DEF), RED);
  assert.equal(colorEntryForPlacement(colors, DEF, DEF), RED);
  assert.equal(colorEntryForPlacement(colors, DEF, null), RED);

  const overridden = { [DEF]: RED, [INST]: GREEN };
  assert.equal(colorEntryForPlacement(overridden, INST, DEF), GREEN);
  assert.equal(colorEntryForPlacement(overridden, DEF, DEF), RED);

  const facesOnly = { [DEF]: RED, [INST]: FACE };
  assert.equal(colorEntryForPlacement(facesOnly, INST, DEF), FACE);

  assert.equal(colorEntryForPlacement(colors, INST, null), null);
  assert.equal(colorEntryForPlacement(null, INST, DEF), null);
  assert.equal(colorEntryForPlacement({ [DEF]: RED, [INST]: { faces: [] } }, INST, DEF), RED);
});

function triangleHost(surfId) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  const host = new Mesh(geometry);
  host.userData.surfId = surfId;
  return host;
}

function skinRed(host) {
  const attr = host.userData.faceColorSkin?.geometry?.getAttribute('color');
  if (!attr) return null;
  return [attr.getX(0), attr.getY(0), attr.getZ(0)];
}

test('the face skin paints an instance from the definition color', () => {
  const host = triangleHost(INST);
  const inherited = syncFaceColorSkin(host, {
    surfId: INST,
    definitionId: DEF,
    colors: { [DEF]: RED },
  });
  assert.ok(inherited, 'skin missing');
  const rgb = skinRed(host);
  assert.ok(rgb && rgb[0] > 0.9 && rgb[1] < 0.05 && rgb[2] < 0.05, JSON.stringify(rgb));

  detachFaceColorSkin(host);
  const own = syncFaceColorSkin(host, {
    surfId: INST,
    definitionId: DEF,
    colors: { [DEF]: RED, [INST]: GREEN },
  });
  assert.ok(own);
  const green = skinRed(host);
  assert.ok(green && green[1] > 0.9 && green[0] < 0.05, JSON.stringify(green));
  detachFaceColorSkin(host);
});
