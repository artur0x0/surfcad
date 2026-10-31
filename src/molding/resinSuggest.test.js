import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { bindStressField } from '../fea/stressMap.js';
import {
  formatStudyHint,
  heuristicFillFlags,
  studyStiffnessHint,
  suggestResins,
} from './resinSuggest.js';

const resins = [
  { grade: 'PP', tensileModulusMpa: 1500, shrinkHighPct: 2.5, wallMinMm: 0.8, wallMaxMm: 4 },
  { grade: 'ABS', tensileModulusMpa: 2300, shrinkHighPct: 0.7, wallMinMm: 1.2, wallMaxMm: 3.5 },
  { grade: 'PC', tensileModulusMpa: 2400, shrinkHighPct: 0.7, wallMinMm: 1, wallMaxMm: 3.8 },
  { grade: 'HDPE', tensileModulusMpa: 900, shrinkHighPct: 4, wallMinMm: 0.8, wallMaxMm: 4 },
];

describe('heuristic fill flags', () => {
  test('a chunky part has no fill flags', () => {
    const fill = heuristicFillFlags({
      bounds: { min: [0, 0, 0], max: [20, 20, 20] },
      wall: { nominal: 2, thinCount: 0 },
    });
    assert.equal(fill.heuristic, true);
    assert.match(fill.disclaimer, /Heuristic/);
    assert.match(fill.disclaimer, /Not a mold-flow result/);
    assert.deepEqual(fill.flags, []);
  });

  test('thin triangles, a long edge, and a skinny box are flagged', () => {
    const fill = heuristicFillFlags({
      bounds: { min: [0, 0, 0], max: [200, 10, 10] },
      wall: { nominal: 1, thinCount: 2 },
    });
    assert.deepEqual(fill.flags.map((flag) => flag.code), ['thin_sections', 'high_aspect', 'long_flow']);
    assert.equal(fill.flags.every((flag) => flag.heuristic === true), true);
    assert.match(fill.flags.find((flag) => flag.code === 'long_flow').text, /not a melt path/);
  });

  test('an unknown wall uses the long edge alone', () => {
    const fill = heuristicFillFlags({
      bounds: { min: [0, 0, 0], max: [220, 40, 40] },
      wall: { nominal: null, thinCount: 0 },
    });
    assert.deepEqual(fill.flags.map((flag) => flag.code), ['long_flow']);
  });
});

describe('study stiffness hint', () => {
  test('a stale or modal result is ignored', () => {
    assert.equal(studyStiffnessHint({
      study: { type: 'linear-static', material: { E_MPa: 2300 } },
      result: { stale: true, p95: 10, safetyFactor: 1 },
    }, () => null), null);
    assert.equal(studyStiffnessHint({
      study: { type: 'modal', material: { E_MPa: 2300 } },
      result: { source: 'modal', p95: 1, safetyFactor: null },
    }, () => null), null);
  });

  test('a library id resolves through the lookup and a low safety factor prefers stiffness', () => {
    const hint = studyStiffnessHint({
      study: { type: 'linear-static', material: { id: 'abs-m30' } },
      result: { source: 'solid', stale: false, p95: 40, safetyFactor: 0.8 },
    }, (id) => (id === 'abs-m30' ? { name: 'ABS-M30', E_MPa: 2400 } : null));
    assert.equal(hint.modulusMpa, 2400);
    assert.equal(hint.materialName, 'ABS-M30');
    assert.equal(hint.preferStiffer, true);
    assert.equal(hint.peakMpa, null);
    assert.equal(hint.maxDisplacementMm, null);
    const text = formatStudyHint(hint);
    assert.match(text, /stiffness hint, not a fill result/);
    assert.doesNotMatch(text, /Peak |Max displacement|mold-flow|certified/i);
  });
});

describe('resin suggestions', () => {
  test('wall fit leads when there is no study', () => {
    const fill = heuristicFillFlags({
      bounds: { min: [0, 0, 0], max: [30, 20, 10] },
      wall: { nominal: 2, thinCount: 0 },
    });
    const picked = suggestResins(resins, { wall: { nominal: 2 }, fill, study: null });
    assert.deepEqual(picked.map((row) => row.grade), ['PP', 'ABS', 'PC']);
    assert.equal(picked[0].usdPerKg, undefined);
    assert.match(picked[1].reason, /inside/);
  });

  test('a low safety factor prefers the stiffer grades and leaves prices off', () => {
    const study = studyStiffnessHint({
      study: { material: { name: 'Study ABS', E_MPa: 2000 } },
      result: { safetyFactor: 1.1, p95: 30 },
    }, () => null);
    const picked = suggestResins(resins, {
      wall: { nominal: 2 },
      fill: { flags: [] },
      study,
    });
    assert.deepEqual(picked.map((row) => row.grade), ['ABS', 'PC', 'PP']);
    assert.match(picked[0].reason, /stiffer than the study material/);
    assert.equal(JSON.stringify(picked).includes('usd'), false);
  });

  test('a long stand-in flow prefers the lower shrink grade inside the wall band', () => {
    const fill = heuristicFillFlags({
      bounds: { min: [0, 0, 0], max: [300, 20, 20] },
      wall: { nominal: 1.5, thinCount: 0 },
    });
    const picked = suggestResins(resins, { wall: { nominal: 1.5 }, fill, study: null });
    assert.equal(picked[0].grade, 'ABS');
    assert.match(picked[0].reason, /shrink/);
  });

  test('a nodal peak ranks the higher modulus and names it as a strain hint', () => {
    const index = new Uint32Array([0, 1, 2]);
    const faceIDs = new Float32Array([1]);
    const geometry = {
      index: { array: index },
      attributes: { faceID: { array: faceIDs } },
    };
    const field = bindStressField(geometry, new Float32Array([10, 40, 10]), faceIDs);
    const study = studyStiffnessHint({
      study: { material: { name: 'Study ABS', E_MPa: 2000 } },
      result: { safetyFactor: 4, p95: 2 },
      nodalStress: () => field,
    }, () => null);
    assert.equal(study.peakMpa, 40);
    assert.equal(study.preferStiffer, true);
    const text = formatStudyHint(study);
    assert.match(text, /Peak 40 MPa/);
    assert.match(text, /modulus, not a strength allowable/);
    assert.match(text, /stiffness hint, not a fill result/);
    assert.doesNotMatch(text, /mold-flow|CalculiX|certified/i);
    const picked = suggestResins(resins, {
      wall: { nominal: 2 },
      fill: { flags: [] },
      study,
    });
    assert.deepEqual(picked.map((row) => row.grade), ['PC', 'ABS', 'PP']);
    assert.match(picked[0].reason, /peak 40 MPa vs modulus 2400 MPa/);
    assert.equal(JSON.stringify(picked).includes('usd'), false);
  });

  test('a mild peak is shown and leaves the wall-fit ranking in place', () => {
    const index = new Uint32Array([0, 1, 2]);
    const faceIDs = new Float32Array([1]);
    const geometry = {
      index: { array: index },
      attributes: { faceID: { array: faceIDs } },
    };
    const field = bindStressField(geometry, new Float32Array([1, 10, 1]), faceIDs);
    const study = studyStiffnessHint({
      study: { material: { name: 'Study ABS', E_MPa: 2000 } },
      result: { safetyFactor: 4, p95: 2 },
      nodalStress: () => field,
    }, () => null);
    assert.equal(study.peakMpa, 10);
    assert.equal(study.preferStiffer, false);
    assert.match(formatStudyHint(study), /Peak 10 MPa/);
    const picked = suggestResins(resins, {
      wall: { nominal: 2 },
      fill: { flags: [] },
      study,
    });
    assert.deepEqual(picked.map((row) => row.grade), ['PP', 'ABS', 'PC']);
  });

  test('displacement comes from the field, and a stored max does not', () => {
    const index = new Uint32Array([0, 1, 2]);
    const faceIDs = new Float32Array([1]);
    const geometry = {
      index: { array: index },
      attributes: { faceID: { array: faceIDs } },
    };
    const field = bindStressField(geometry, new Float32Array([0.25, 2, 0.5]), faceIDs);
    const fromField = studyStiffnessHint({
      study: { material: { name: 'Study ABS', E_MPa: 2000 } },
      result: { safetyFactor: 4, p95: 2, displacementMax: 9 },
      displacementField: () => field,
    }, () => null);
    assert.equal(fromField.maxDisplacementMm, 2);
    assert.equal(fromField.preferStiffer, true);
    assert.match(formatStudyHint(fromField), /Max displacement 2 mm/);
    const storedOnly = studyStiffnessHint({
      study: { material: { name: 'Study ABS', E_MPa: 2000 } },
      result: { safetyFactor: 4, p95: 2, displacementMax: 9 },
    }, () => null);
    assert.equal(storedOnly.maxDisplacementMm, null);
    assert.equal(storedOnly.preferStiffer, false);
    assert.doesNotMatch(formatStudyHint(storedOnly), /Max displacement|Peak /);
  });
});

describe('thin-wall stress flag', () => {
  test('a hot corner on a thin triangle is flagged, and a nominal one is not', () => {
    const index = new Uint32Array([0, 1, 2]);
    const faceIDs = new Float32Array([1]);
    const geometry = {
      index: { array: index },
      attributes: {
        position: { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
        faceID: { array: faceIDs },
      },
    };
    const stressField = bindStressField(geometry, new Float32Array([10, 100, 10]), faceIDs);
    const hot = heuristicFillFlags({
      bounds: { min: [0, 0, 0], max: [20, 20, 20] },
      wall: { nominal: 1, thinCount: 1, field: [{ index: 0, thickness: 0.4, flag: 'thin' }] },
      geometry,
      stressField,
    });
    assert.deepEqual(hot.flags.map((flag) => flag.code), ['thin_sections', 'thin_stress']);
    assert.match(hot.flags.find((flag) => flag.code === 'thin_stress').text, /Heuristic/);
    assert.match(hot.flags.find((flag) => flag.code === 'thin_stress').text, /Not a mold-flow result/);
    const cool = heuristicFillFlags({
      bounds: { min: [0, 0, 0], max: [20, 20, 20] },
      wall: { nominal: 1, thinCount: 0, field: [{ index: 0, thickness: 1, flag: 'nominal' }] },
      geometry,
      stressField,
    });
    assert.deepEqual(cool.flags, []);
    const other = heuristicFillFlags({
      bounds: { min: [0, 0, 0], max: [20, 20, 20] },
      wall: { nominal: 1, thinCount: 1, field: [{ index: 0, thickness: 0.4, flag: 'thin' }] },
      geometry: { ...geometry },
      stressField,
    });
    assert.deepEqual(other.flags.map((flag) => flag.code), ['thin_sections']);
  });
});
