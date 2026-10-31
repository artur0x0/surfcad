import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { bindStressField, bindVectorField } from './stressMap.js';
import {
  readDisplacementField,
  readVonMisesField,
  summarizeBoundField,
  thinWallHotSpot,
} from './studyFieldRead.js';

function geometry(index, faceIDs) {
  return {
    index: { array: index },
    attributes: { faceID: { array: faceIDs } },
  };
}

function snapshot(field) {
  const faces = [];
  for (const [face, bucket] of field.byFace) {
    faces.push([face, [...bucket.entries()]]);
  }
  return faces;
}

test('summarizeBoundField reports peak and p95 without writing the maps', () => {
  const index = new Uint32Array([0, 1, 2]);
  const faceIDs = new Float32Array([1]);
  const mesh = geometry(index, faceIDs);
  const field = bindStressField(mesh, new Float32Array([10, 100, 10]), faceIDs);
  const before = snapshot(field);
  const summary = summarizeBoundField(field);
  assert.equal(summary.peak, 100);
  assert.equal(summary.min, 10);
  assert.equal(summary.count, 3);
  assert.ok(summary.p95 >= 10 && summary.p95 <= 100);
  assert.deepEqual(snapshot(field), before);
  assert.equal(summarizeBoundField(null), null);
  assert.equal(summarizeBoundField({ byFace: new Map() }), null);
});

test('a vector corner contributes its length and the components stay put', () => {
  const index = new Uint32Array([0, 1, 2]);
  const faceIDs = new Float32Array([1]);
  const mesh = geometry(index, faceIDs);
  const field = bindVectorField(mesh, new Float32Array([3, 4, 0, 0, 0, 0, 0, 0, 0]), faceIDs);
  const before = snapshot(field);
  const summary = summarizeBoundField(field);
  assert.equal(summary.peak, 5);
  assert.equal(summary.min, 0);
  assert.deepEqual(snapshot(field), before);
});

test('von Mises prefers the nodal field and ignores a displacement or contact map', () => {
  const index = new Uint32Array([0, 1, 2]);
  const faceIDs = new Float32Array([1]);
  const mesh = geometry(index, faceIDs);
  const nodal = bindStressField(mesh, new Float32Array([1, 2, 3]), faceIDs);
  const other = bindStressField(mesh, new Float32Array([9, 9, 9]), faceIDs);
  assert.equal(readVonMisesField({
    nodalStress: () => nodal,
    stressMap: () => ({ field: other, ramp: 'stress' }),
  }), nodal);
  assert.equal(readVonMisesField({
    nodalStress: () => null,
    stressMap: () => ({ field: other, ramp: 'displacement' }),
  }), null);
  assert.equal(readVonMisesField({
    nodalStress: () => null,
    stressMap: () => ({ field: other, contactOverlay: true }),
  }), null);
  assert.equal(readVonMisesField({
    nodalStress: () => null,
    stressMap: () => ({ field: other }),
  }), other);
  assert.equal(readVonMisesField(null), null);
});

test('displacement is the displacement accessor, not the stress map', () => {
  const index = new Uint32Array([0, 1, 2]);
  const faceIDs = new Float32Array([1]);
  const mesh = geometry(index, faceIDs);
  const field = bindStressField(mesh, new Float32Array([0.2, 1.4, 0.3]), faceIDs);
  assert.equal(readDisplacementField({ displacementField: () => field }), field);
  assert.equal(readDisplacementField({
    displacementField: () => null,
    stressMap: () => ({ field, ramp: 'displacement' }),
  }), null);
  assert.equal(readDisplacementField({}), null);
});

test('a hot spot is a thin triangle at 80 percent of the peak, on the same geometry', () => {
  const index = new Uint32Array([0, 1, 2]);
  const faceIDs = new Float32Array([1]);
  const mesh = geometry(index, faceIDs);
  const field = bindStressField(mesh, new Float32Array([10, 100, 10]), faceIDs);
  const wall = { field: [{ index: 0, thickness: 0.4, flag: 'thin' }] };
  assert.equal(thinWallHotSpot({ geometry: mesh, wall, stressField: field }), true);
  assert.equal(thinWallHotSpot({
    geometry: mesh,
    wall: { field: [{ index: 0, thickness: 1, flag: 'nominal' }] },
    stressField: field,
  }), false);
  assert.equal(thinWallHotSpot({
    geometry: geometry(index, faceIDs),
    wall,
    stressField: field,
  }), false);
  const pairIndex = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const pairFaces = new Float32Array([1, 2]);
  const pair = geometry(pairIndex, pairFaces);
  const mild = bindStressField(pair, new Float32Array([10, 10, 10, 100, 10, 10]), pairFaces);
  assert.equal(thinWallHotSpot({ geometry: pair, wall, stressField: mild }), false);
  const onThin = bindStressField(pair, new Float32Array([10, 100, 10, 20, 20, 20]), pairFaces);
  assert.equal(thinWallHotSpot({ geometry: pair, wall, stressField: onThin }), true);
  assert.equal(thinWallHotSpot({ geometry: mesh, wall, stressField: null }), false);
});

test('the study session accessors only return stored fields', () => {
  const source = readFileSync(new URL('./useFeaStudy.js', import.meta.url), 'utf8');
  const start = source.indexOf('nodalStress() {');
  const end = source.indexOf('stressMap() {', start);
  assert.ok(start > 0 && end > start);
  const block = source.slice(start, source.indexOf('};', end));
  assert.match(block, /return stressFieldRef\.current\?\.field \?\? null/);
  assert.match(block, /return displacementFieldRef\.current\?\.field \?\? null/);
  assert.match(block, /return getStressSkinSource\(\)/);
  assert.equal(block.includes('solve'), false);
  assert.equal(block.includes('.current ='), false);
  assert.equal(block.includes('setStressSkinSource'), false);
  const reader = readFileSync(new URL('./studyFieldRead.js', import.meta.url), 'utf8');
  assert.equal(/\bsolve\s*\(/.test(reader), false);
  assert.equal(reader.includes('setStressSkinSource'), false);
  assert.equal(reader.includes('surfcad-fea'), false);
});
