import assert from 'node:assert/strict';
import test from 'node:test';
import { getMaterial } from './materials.js';
import { composeFeaStudy, readFeaStudy } from './studyScript.js';
import {
  applyFacePick,
  assumptionFields,
  customAssumptionFields,
  emptyDraft,
  forceVector,
  formatSolveSummary,
  freshStudy,
  highlightIndicesForStudy,
  majorityFaceId,
  meshArraysFromGeometry,
  sameStudyFace,
  solverRequestMaterial,
  studyFaceFromPick,
  namedDirection,
  studyWithForceDirection,
  studyWithForceMagnitude,
  studyWithLoadVector,
  studyWithPressureValue,
  studyWithMaterialId,
  studyWithType,
  studyWithoutFixture,
  studyWithoutLoad,
} from './studyPanel.js';

const top = {
  faceID: 4,
  at: [0, 0, 10],
  n: [0, 0, 1],
  area: 400,
};
const side = {
  faceID: 2,
  at: [10, 0, 0],
  n: [1, 0, 0],
  area: 400,
};

test('assumption badges mark an assumed Poisson ratio and a missing yield', () => {
  assert.deepEqual(assumptionFields(getMaterial('al-6061-t6')), []);
  assert.deepEqual(assumptionFields(getMaterial('pla-ultimaker')), ['nu']);
  assert.deepEqual(assumptionFields(getMaterial('pa12-hp-mjf')), ['nu', 'yield']);
  assert.deepEqual(customAssumptionFields({ nu: '', yield_MPa: '' }), ['nu', 'yield']);
  assert.deepEqual(customAssumptionFields({ nu: 0.3, yield_MPa: 100 }), []);
});

test('a paint pick becomes a study face and toggles off on the second tap', () => {
  const face = studyFaceFromPick({
    key: { at: [0, 0, 10], n: [0, 0, 1], area: 400 },
    indices: [1, 2, 3],
  }, 4);
  assert.deepEqual(face, top);
  assert.equal(sameStudyFace(face, { ...top }), true);
  assert.equal(sameStudyFace(face, side), false);
  assert.equal(majorityFaceId([0, 0, 1], [4, 4, 9]), 4);

  const draft = { ...emptyDraft(), target: 'fixture' };
  const added = applyFacePick(freshStudy(), draft, face);
  assert.equal(added.ok, true);
  assert.equal(added.study.fixtures.length, 1);
  const removed = applyFacePick(added.study, draft, face);
  assert.equal(removed.ok, true);
  assert.equal(removed.study.fixtures.length, 0);
});

test('force uses the face normal and newtons, pressure uses MPa', () => {
  assert.deepEqual(forceVector('normal', 200, [0, 0, 1]), [0, 0, 200]);
  assert.deepEqual(forceVector('-normal', 50, [0, 0, 1]), [0, 0, -50]);
  assert.deepEqual(forceVector('+x', 10, [0, 0, 1]), [10, 0, 0]);
  assert.equal(forceVector('normal', 0, [0, 0, 1]), null);

  const study = freshStudy();
  const loaded = applyFacePick(study, { ...emptyDraft(), target: 'force', magnitudeN: 200, direction: 'normal' }, top);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.study.loads[0].vector, [0, 0, 200]);
  const pressed = applyFacePick(loaded.study, { ...emptyDraft(), target: 'pressure', pressureMPa: 2 }, side);
  assert.equal(pressed.ok, true);
  assert.equal(pressed.study.loads[1].pressure_MPa, 2);
  assert.equal(studyWithoutLoad(pressed.study, 0).study.loads.length, 1);
  assert.equal(studyWithoutFixture(pressed.study, 0).ok, true);
});

test('a library id and a custom material both resolve for solve()', () => {
  const pla = studyWithMaterialId(freshStudy(), 'pla-ultimaker');
  assert.equal(pla.ok, true);
  const resolved = solverRequestMaterial(pla.study);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.material.nu, 0.36);
  assert.equal(resolved.material.density_kg_m3, 1240);
  assert.equal(resolved.material.yield_MPa, 52.5);
  assert.equal(resolved.assumptions[0].source, 'assumed');
  assert.equal(resolved.anisotropic, true);

  const missing = solverRequestMaterial(studyWithMaterialId(freshStudy(), 'pa12-hp-mjf').study);
  assert.equal(missing.material.yield_MPa, null);
  assert.ok(missing.warnings.some((warning) => warning.code === 'missing-yield'));
});

test('the summary prints MPa and n/a when the safety factor is missing', () => {
  const stub = formatSolveSummary({
    source: 'stub',
    min: 0,
    p95: 12.345,
    max: 40,
    safetyFactor: 2,
    warnings: [{ code: 'stub', msg: 'STUB, not a real result' }],
  });
  assert.equal(stub.stub, true);
  assert.equal(stub.min, '0');
  assert.equal(stub.p95, '12.35');
  assert.equal(stub.max, '40');
  assert.equal(stub.fos, '2');
  assert.match(stub.warning, /STUB, not a real result/);

  const missing = formatSolveSummary({
    source: 'stub',
    min: 1,
    p95: 4,
    max: 8,
    safetyFactor: null,
    warnings: [{ code: 'missing-yield', msg: 'yield strength is not on the cited datasheet' }],
  });
  assert.equal(missing.fos, 'n/a');
  assert.match(missing.warning, /datasheet/);
  assert.equal(formatSolveSummary(null).fos, 'n/a');

  const index = formatSolveSummary({
    source: 'tet10',
    min: 1,
    p95: 4,
    max: 8,
    safetyFactor: 10,
    warnings: [{
      code: 'cholesky-index',
      msg: 'Cholesky fill does not fit in a 32-bit index, so this solve used PCG.',
    }],
  });
  assert.match(index.warning, /32-bit index/);
  assert.match(index.warning, /PCG/);
});

test('highlight indices follow a paint match, and the mesh copy does not alias', () => {
  const fingerprints = [{
    id: 4,
    tris: [7, 8],
    at: top.at,
    n: top.n,
    area: top.area,
  }];
  const study = applyFacePick(freshStudy(), { ...emptyDraft(), target: 'fixture' }, top).study;
  assert.deepEqual(highlightIndicesForStudy(fingerprints, study), [7, 8]);

  const positions = new Float32Array([0, 0, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  const faceIDs = new Uint32Array([3]);
  const geometry = {
    attributes: { position: { array: positions } },
    index: { array: indices },
  };
  const mesh = meshArraysFromGeometry(geometry, faceIDs);
  mesh.positions[0] = 9;
  assert.equal(positions[0], 0);
  assert.equal(mesh.faceIDs[0], 3);
  assert.notEqual(mesh.positions.buffer, positions.buffer);
});

test('the panel study round-trips through the part script', () => {
  const script = 'const part = Manifold.cube([20, 20, 20], true);\nreturn part;\n';
  const picked = studyWithMaterialId(freshStudy(), 'steel-a36');
  const fixed = applyFacePick(picked.study, { ...emptyDraft(), target: 'fixture' }, top);
  const loaded = applyFacePick(fixed.study, { ...emptyDraft(), target: 'force', magnitudeN: 200, direction: 'normal' }, side);
  const next = composeFeaStudy(script, loaded.study);
  const again = readFeaStudy(next);
  assert.equal(again.material.id, 'steel-a36');
  assert.equal(again.fixtures.length, 1);
  assert.equal(again.loads.length, 1);
  assert.deepEqual(again.loads[0].vector, [200, 0, 0]);
  assert.equal(again.loads[0].direction, 'normal');
  assert.equal(again.result, null);
  assert.match(next, /return part;/);
});

test('the direction picker retargets force loads and keeps pressure', () => {
  const drafted = applyFacePick(freshStudy(), {
    ...emptyDraft(),
    target: 'force',
    magnitudeN: 200,
    direction: '-z',
  }, top);
  assert.equal(drafted.study.loads[0].direction, '-z');
  assert.deepEqual(drafted.study.loads[0].vector, [0, 0, -200]);
  const pressed = applyFacePick(drafted.study, { ...emptyDraft(), target: 'pressure', pressureMPa: 2 }, side);
  const sideways = studyWithForceDirection(pressed.study, '+x');
  assert.equal(sideways.changed, true);
  assert.equal(sideways.study.loads[0].direction, '+x');
  assert.deepEqual(sideways.study.loads[0].vector, [200, 0, 0]);
  assert.equal(sideways.study.loads[1].pressure_MPa, 2);
  assert.equal(sideways.study.loads[1].direction, undefined);
  const normal = studyWithForceDirection(sideways.study, 'normal');
  assert.equal(normal.study.loads[0].direction, 'normal');
  assert.deepEqual(normal.study.loads[0].vector, [0, 0, 200]);
  const same = studyWithForceDirection(normal.study, 'normal');
  assert.equal(same.changed, false);
  assert.equal(same.study, normal.study);
  const tilted = studyWithLoadVector(sideways.study, 0, [0, 30, -40]);
  assert.equal(tilted.study.loads[0].direction, 'custom');
  assert.equal(namedDirection([0, 0, -5], [1, 0, 0]), '-z');
  assert.equal(namedDirection([0, 0, 5], [0, 0, 1]), '+z');
});

test('a magnitude edit rewrites stored forces and leaves pressure', () => {
  const drafted = applyFacePick(freshStudy(), {
    ...emptyDraft(),
    target: 'force',
    magnitudeN: 200,
    direction: '-z',
  }, top);
  const pressed = applyFacePick(drafted.study, { ...emptyDraft(), target: 'pressure', pressureMPa: 2 }, side);
  const doubled = studyWithForceMagnitude(pressed.study, 400);
  assert.equal(doubled.changed, true);
  assert.equal(doubled.study.loads[0].direction, '-z');
  assert.deepEqual(doubled.study.loads[0].vector, [0, 0, -400]);
  assert.equal(doubled.study.loads[1].pressure_MPa, 2);
  const same = studyWithForceMagnitude(doubled.study, 400);
  assert.equal(same.changed, false);
  assert.equal(same.study, doubled.study);
  const tilted = studyWithLoadVector(doubled.study, 0, [0, 30, -40]);
  const scaled = studyWithForceMagnitude(tilted.study, 100);
  assert.equal(scaled.study.loads[0].direction, 'custom');
  assert.deepEqual(scaled.study.loads[0].vector, [0, 60, -80]);
  const pressure = studyWithPressureValue(scaled.study, 5);
  assert.equal(pressure.changed, true);
  assert.equal(pressure.study.loads[1].pressure_MPa, 5);
  assert.deepEqual(pressure.study.loads[0].vector, [0, 60, -80]);
  const held = studyWithPressureValue(pressure.study, 5);
  assert.equal(held.changed, false);
  assert.equal(held.study, pressure.study);
});

test('a new phone study refines by default', () => {
  assert.equal(freshStudy('phone').mesh.refine, 'auto');
  assert.equal(freshStudy('desktop').mesh.refine, 'auto');
  assert.equal(freshStudy().mesh.refine, undefined);
});

test('modal switches the study type and still resolves density', () => {
  const modal = studyWithType(freshStudy(), 'modal');
  assert.equal(modal.ok, true);
  assert.equal(modal.study.type, 'modal');
  const resolved = solverRequestMaterial(modal.study);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.material.density_kg_m3, 2700);
  const custom = studyWithType(freshStudy(), 'modal');
  const bare = solverRequestMaterial({
    ...custom.study,
    material: { name: 'Custom', E_MPa: 1000, nu: 0.3, yield_MPa: 10 },
  });
  assert.equal(bare.ok, false);
  assert.match(bare.errors.join(' '), /density/);
});
