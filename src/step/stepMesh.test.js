import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEP_ERROR_MESSAGES,
  STEP_MODULE_ABI,
  StepImportError,
  decodeStepBlob,
  meshStep,
} from './stepMesh.js';
import { boxStepText, cylinderStepText, soupBounds, soupVolume } from './stepFixtures.js';

const encode = (text) => new TextEncoder().encode(text);

function close(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} is not within ${tolerance} of ${expected}`);
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof StepImportError, `expected StepImportError, got ${error}`);
    assert.equal(error.code, code);
    assert.equal(error.message, STEP_ERROR_MESSAGES[code]);
    return true;
  });
}

test('a faceted box converts to a closed soup with the box volume and bounds', async () => {
  const result = await meshStep(encode(boxStepText([20, 20, 40])));
  assert.equal(result.solids, 1);
  assert.equal(result.faces, 6);
  assert.equal(result.facesWithoutMesh, 0);
  assert.equal(result.triVerts.length, 12 * 3);
  assert.ok(result.vertProperties instanceof Float32Array);
  assert.ok(result.triVerts instanceof Uint32Array);
  close(soupVolume(result.vertProperties, result.triVerts), 16000, 1e-3, 'volume');
  const { min, max } = soupBounds(result.vertProperties);
  assert.deepEqual(min, [0, 0, 0]);
  assert.deepEqual(max, [20, 20, 40]);
});

test('an exact cylinder is tessellated inside the chord tolerance, facing outward', async () => {
  const exact = Math.PI * 10 * 10 * 20;
  const coarse = await meshStep(encode(cylinderStepText(10, 20)), { deflection: 0.1 });
  assert.equal(coarse.solids, 1);
  assert.equal(coarse.faces, 3);
  const coarseVolume = soupVolume(coarse.vertProperties, coarse.triVerts);
  // Chords sit inside the circle, so the mesh is smaller than the solid, and
  // positive: a reversed face or a mirrored location would flip the sign.
  assert.ok(coarseVolume > exact * 0.97 && coarseVolume < exact, `coarse volume ${coarseVolume} vs ${exact}`);
  const { min, max } = soupBounds(coarse.vertProperties);
  close(min[2], 0, 1e-6, 'z min');
  close(max[2], 20, 1e-6, 'z max');
  close(max[0], 10, 1e-4, 'x max');

  const fine = await meshStep(encode(cylinderStepText(10, 20)), { deflection: 0.01 });
  const fineVolume = soupVolume(fine.vertProperties, fine.triVerts);
  assert.ok(fine.triVerts.length > coarse.triVerts.length, 'a smaller deflection adds triangles');
  assert.ok(exact - fineVolume < exact - coarseVolume, 'a smaller deflection is closer to the exact volume');
});

test('every vertex index is inside the vertex list', async () => {
  const result = await meshStep(encode(cylinderStepText()));
  const count = result.vertProperties.length / 3;
  for (const index of result.triVerts) assert.ok(index < count);
  for (const value of result.vertProperties) assert.ok(Number.isFinite(value));
});

test('a file that is not STEP fails with the unreadable message', async () => {
  await rejectsWith(meshStep(encode('solid wedge\nendsolid wedge\n')), 'unreadable');
  await rejectsWith(meshStep(new Uint8Array(0)), 'unreadable');
  await rejectsWith(meshStep('ISO-10303-21;'), 'unreadable');
});

test('a STEP file with a header and no geometry fails with the empty message', async () => {
  const text = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION((''),'2;1');",
    "FILE_NAME('empty','2026-01-01T00:00:00',(''),(''),'','','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    "#1=APPLICATION_CONTEXT('core data for automotive mechanical design processes');",
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
  await rejectsWith(meshStep(encode(text)), 'empty');
});

test('the triangle cap stops a mesh that is too detailed', async () => {
  await rejectsWith(meshStep(encode(boxStepText()), { maxTriangles: 4 }), 'too_detailed');
  const capped = await meshStep(encode(boxStepText()), { maxTriangles: 12 });
  assert.equal(capped.triVerts.length, 36);
});

test('the module still converts after a failed file', async () => {
  await rejectsWith(meshStep(encode('not a step file')), 'unreadable');
  const result = await meshStep(encode(boxStepText([10, 10, 10])));
  close(soupVolume(result.vertProperties, result.triVerts), 1000, 1e-3, 'volume');
});

test('decodeStepBlob reads the packed layout and rejects a truncated blob', () => {
  const message = 'boom';
  const bytes = new Uint8Array(32 + 8 + 9 * 4 + 3 * 4);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 0, true);
  view.setUint32(4, 3, true);
  view.setUint32(8, 1, true);
  view.setUint32(12, message.length, true);
  view.setUint32(16, 1, true);
  view.setUint32(20, 2, true);
  view.setUint32(24, 1, true);
  bytes.set(new TextEncoder().encode(message), 32);
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  positions.forEach((value, i) => view.setFloat32(40 + i * 4, value, true));
  [0, 1, 2].forEach((value, i) => view.setUint32(40 + 36 + i * 4, value, true));

  const decoded = decodeStepBlob(bytes);
  assert.equal(decoded.status, 0);
  assert.equal(decoded.message, message);
  assert.equal(decoded.solids, 1);
  assert.equal(decoded.faces, 2);
  assert.equal(decoded.facesWithoutMesh, 1);
  assert.deepEqual([...decoded.vertProperties], positions);
  assert.deepEqual([...decoded.triVerts], [0, 1, 2]);

  assert.throws(() => decodeStepBlob(bytes.subarray(0, bytes.length - 4)), StepImportError);
  assert.throws(() => decodeStepBlob(new Uint8Array(8)), StepImportError);
});

test('the interface version this file expects is the one the wrapper source declares', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../packages/surfcad-step/src/api.cpp', import.meta.url), 'utf8');
  const declared = source.match(/constexpr uint32_t kAbi = (\d+);/);
  assert.ok(declared, 'api.cpp declares kAbi');
  assert.equal(Number(declared[1]), STEP_MODULE_ABI);
});
