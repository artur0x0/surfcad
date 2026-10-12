import assert from 'node:assert/strict';
import test from 'node:test';
import { faceColorKey } from '../utils/faceColorMatch.js';
import {
  STUDY_VERSION,
  StudyValidationError,
  UNITS_NOTE,
  defaultStudy,
  studyJson,
  validateStudy,
} from './studySchema.js';

function face(extra = {}) {
  return {
    faceID: 1,
    at: [0, 0, 0],
    n: [0, 0, -1],
    area: 400,
    ...extra,
  };
}

test('defaultStudy fills a linear-static study in millimetres and newtons', () => {
  const study = defaultStudy();
  assert.equal(study.v, STUDY_VERSION);
  assert.equal(study.id, 's1');
  assert.equal(study.name, 'Static 1');
  assert.equal(study.type, 'linear-static');
  assert.deepEqual(study.units, { length: 'mm', force: 'N', stress: 'MPa', note: UNITS_NOTE });
  assert.deepEqual(study.material, { id: 'al-6061-t6' });
  assert.equal(study.model, 'auto');
  assert.deepEqual(study.fixtures, []);
  assert.deepEqual(study.loads, []);
  assert.deepEqual(study.mesh, { target: 'auto' });
  assert.equal(study.result, null);
  assert.equal(studyJson(study), JSON.stringify(study));
  assert.equal(JSON.stringify(JSON.parse(studyJson(study))), studyJson(study));
});

test('a study accepts a library material or a custom E/nu/yield', () => {
  const custom = defaultStudy({
    id: 'custom-1',
    material: { name: 'Custom alloy', E_MPa: 200000, nu: 0.3, yield_MPa: 250 },
  });
  assert.deepEqual(custom.material, { name: 'Custom alloy', E_MPa: 200000, nu: 0.3, yield_MPa: 250 });

  const mixed = validateStudy({
    ...defaultStudy(),
    material: { id: 'al-6061-t6', E_MPa: 68900, nu: 0.33, yield_MPa: 276 },
  });
  assert.equal(mixed.ok, false);
  assert.ok(mixed.errors.some((error) => error.includes('not both')));
});

test('validation names the bad field', () => {
  const bad = validateStudy({
    ...defaultStudy(),
    v: 2,
    id: '1bad',
    type: 'buckling',
    units: { length: 'in', force: 'lbf', stress: 'psi', note: 'inches' },
    material: { id: 'unobtanium' },
    model: 'beam',
    result: { vonMises: [1] },
    fixtures: [{ kind: 'pinned', faces: [] }],
    loads: [
      { kind: 'force', faces: [face()], vector: [0, 0, 0] },
      { kind: 'pressure', faces: [face({ faceID: 2 })], pressure_MPa: 0 },
      { kind: 'gravity', faces: [face()] },
    ],
    extra: true,
  });
  assert.equal(bad.ok, false);
  const text = bad.errors.join('\n');
  assert.match(text, /study\.v must be 1/);
  assert.match(text, /study\.id/);
  assert.match(text, /linear-static/);
  assert.match(text, /units\.length must be "mm"/);
  assert.match(text, /unknown material id "unobtanium"/);
  assert.match(text, /model must be/);
  assert.match(text, /result must be null/);
  assert.match(text, /kind must be "fixed"/);
  assert.match(text, /vector is \[0, 0, 0\]/);
  assert.match(text, /pressure_MPa/);
  assert.match(text, /kind must be "force" or "pressure"/);
  assert.match(text, /unknown study key "extra"/);
  assert.throws(() => defaultStudy({ material: { nu: 0.5, E_MPa: 1, yield_MPa: 1 } }), StudyValidationError);
});

test('faces carry faceID plus the face-paint fingerprint', () => {
  const key = faceColorKey({ at: [10, 0, 2], n: [0, 1, 0], area: 80, src: -4, ord: 1 });
  assert.ok(key);
  const study = defaultStudy({
    fixtures: [{ kind: 'fixed', faces: [{ faceID: 7, ...key }] }],
    loads: [
      { kind: 'force', faces: [face({ faceID: 8, at: [50, 0, 10], n: [0, 0, 1], area: 100 })], vector: [0, 0, -200] },
      { kind: 'pressure', faces: [face({ faceID: 9, at: [0, 15, 0], n: [0, 1, 0], area: 200 })], pressure_MPa: -0.25 },
    ],
  });
  assert.deepEqual(study.fixtures[0].faces[0], { faceID: 7, ...key });
  assert.deepEqual(study.loads[0].vector, [0, 0, -200]);
  assert.equal(study.loads[1].pressure_MPa, -0.25);

  const directed = defaultStudy({
    loads: [{
      kind: 'force',
      faces: [face({ faceID: 8, at: [50, 0, 10], n: [0, 0, 1], area: 100 })],
      vector: [0, 0, -200],
      direction: '-z',
    }],
  });
  assert.equal(directed.loads[0].direction, '-z');
  const badDirection = validateStudy({
    ...defaultStudy(),
    loads: [{
      kind: 'force',
      faces: [face()],
      vector: [1, 0, 0],
      direction: 'sideways',
    }],
  });
  assert.equal(badDirection.ok, false);
  assert.match(badDirection.errors.join('\n'), /direction must be normal/);

  const sloppy = validateStudy({
    ...defaultStudy(),
    fixtures: [{
      kind: 'fixed',
      faces: [{ faceID: -1, at: [0, 0], n: [0, 0, -2], area: 0, ord: 1 }],
    }],
  });
  const text = sloppy.errors.join('\n');
  assert.match(text, /faceID must be a non-negative integer/);
  assert.match(text, /at must be three finite numbers/);
  assert.match(text, /unit vector/);
  assert.match(text, /area must be a positive/);
  assert.match(text, /ord requires src/);
});

test('mesh.refine is optional and only off or auto', () => {
  assert.deepEqual(defaultStudy().mesh, { target: 'auto' });
  const auto = defaultStudy({ mesh: { target: 4, refine: 'auto' } });
  assert.deepEqual(auto.mesh, { target: 4, refine: 'auto' });
  assert.equal(JSON.parse(studyJson(auto)).mesh.refine, 'auto');
  const off = validateStudy({ ...defaultStudy(), mesh: { target: 'auto', refine: 'off' } });
  assert.equal(off.ok, true);
  assert.deepEqual(off.study.mesh, { target: 'auto', refine: 'off' });
  const omitted = validateStudy(defaultStudy());
  assert.equal(omitted.ok, true);
  assert.deepEqual(omitted.study.mesh, { target: 'auto' });
  const bad = validateStudy({ ...defaultStudy(), mesh: { target: 'auto', refine: 'yes' } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('\n'), /refine/);
});

test('a v1 study omits scope, parts, and contacts until an assembly is stored', () => {
  const study = defaultStudy();
  assert.equal(Object.hasOwn(study, 'scope'), false);
  assert.equal(Object.hasOwn(study, 'parts'), false);
  assert.equal(Object.hasOwn(study, 'contacts'), false);
  const text = studyJson(study);
  assert.equal(text.includes('"scope"'), false);
  assert.equal(text.includes('"contacts"'), false);
  const stored = validateStudy(JSON.parse(text));
  assert.equal(stored.ok, true);
  assert.equal(studyJson(stored.study), text);
});

test('an assembly study round-trips scope, per-part materials, and a disabled bond', () => {
  const study = defaultStudy({
    scope: { kind: 'assembly' },
    parts: [
      { id: 'part-a', material: { id: 'al-6061-t6' } },
      { id: 'left/cube.scad', material: { name: 'Soft', E_MPa: 70000, nu: 0.3, yield_MPa: 95 } },
    ],
    contacts: [
      {
        a: { part: 'part-a', faceID: 3 },
        b: { part: 'left/cube.scad', faceID: 1 },
        kind: 'bonded',
        enabled: false,
      },
    ],
    fixtures: [{
      kind: 'fixed',
      faces: [{ ...face(), part: 'part-a' }],
    }],
  });
  assert.deepEqual(study.scope, { kind: 'assembly' });
  assert.equal(study.parts[1].material.E_MPa, 70000);
  assert.equal(study.contacts[0].enabled, false);
  assert.equal(study.fixtures[0].faces[0].part, 'part-a');
  const again = validateStudy(JSON.parse(studyJson(study)));
  assert.equal(again.ok, true);
  assert.equal(studyJson(again.study), studyJson(study));

  const frictional = validateStudy({
    ...defaultStudy(),
    contacts: [{ a: { part: 'part-a', faceID: 1 }, b: { part: 'part-b', faceID: 2 }, kind: 'friction' }],
  });
  assert.equal(frictional.ok, false);
  assert.match(frictional.errors.join('\n'), /bonded/);

  const sliding = validateStudy({
    ...defaultStudy(),
    contacts: [{ a: { part: 'part-a', faceID: 1 }, b: { part: 'part-b', faceID: 2 }, kind: 'frictional' }],
  });
  assert.equal(sliding.ok, true, sliding.errors.join('; '));
  assert.equal(sliding.study.contacts[0].kind, 'frictional');
  assert.equal(sliding.study.contacts[0].mu, 0.2);
  const againMu = validateStudy(JSON.parse(studyJson(sliding.study)));
  assert.equal(againMu.ok, true, againMu.errors.join('; '));
  assert.equal(againMu.study.contacts[0].mu, 0.2);
  const smooth = validateStudy({
    ...defaultStudy(),
    contacts: [{ a: { part: 'part-a', faceID: 1 }, b: { part: 'part-b', faceID: 2 }, kind: 'frictionless', mu: 0.4 }],
  });
  assert.equal(smooth.ok, true, smooth.errors.join('; '));
  assert.equal(smooth.study.contacts[0].kind, 'frictionless');
  assert.equal(smooth.study.contacts[0].mu, undefined);
});

test('a partial study does not validate as a stored study', () => {
  const partial = validateStudy({ id: 's1', name: 'Static 1' });
  assert.equal(partial.ok, false);
  assert.ok(partial.errors.some((error) => error.includes('result')));
});

test('a modal study is schema-compatible and keeps fixtures', () => {
  const study = defaultStudy({
    type: 'modal',
    fixtures: [{ kind: 'fixed', faces: [face()] }],
    loads: [{ kind: 'force', faces: [face({ faceID: 2 })], vector: [0, 0, -10] }],
  });
  assert.equal(study.type, 'modal');
  assert.equal(study.fixtures.length, 1);
  assert.equal(study.loads.length, 1);
  const again = validateStudy(study);
  assert.equal(again.ok, true, again.errors.join('; '));
  const custom = validateStudy({
    ...defaultStudy({ type: 'modal' }),
    material: { name: 'Dense', E_MPa: 1000, nu: 0.3, yield_MPa: 10, density_kg_m3: 1200 },
  });
  assert.equal(custom.ok, true, custom.errors.join('; '));
  assert.equal(custom.study.material.density_kg_m3, 1200);
});
