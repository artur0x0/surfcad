import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
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
    assert.match(formatStudyHint(hint), /stiffness hint, not a fill result/);
    assert.doesNotMatch(formatStudyHint(hint), /mold-flow|certified/i);
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
});
