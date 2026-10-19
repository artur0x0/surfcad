import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { instrumentFeatureBlocks } from '../utils/featureFailure.js';
import { validateSurfJson } from '../utils/git/surfJson.js';
import {
  HELPER_PALETTE_ITEMS,
  composeHelperInsert,
  defaultParamsFor,
  helperNeedsBody,
  starterCubeScript,
} from '../utils/helperPaletteSnippets.js';
import { composeSheetMetalCommit } from '../utils/sheetMetal/sheetMetalScript.js';
import { solverMaterialForStudy } from './materials.js';
import {
  FEA_STUDY_BEGIN,
  FEA_STUDY_END,
  composeFeaStudies,
  composeFeaStudy,
  feaStudyBlock,
  readFeaStudies,
  readFeaStudy,
  scriptOutsideFeaStudy,
  stripFeaStudy,
} from './studyScript.js';
import { defaultStudy } from './studySchema.js';

const assembly = {
  format: 'surfcad.assembly',
  version: 1,
  name: 'Box',
  activeId: 'parts/Box.js',
  parts: [{
    id: '2026-10-07-20-56-31-0423-a3f9',
    path: 'parts/Box.js',
    name: 'Box',
    visible: true,
    order: 0,
  }],
};

function face(faceID, at, n, area) {
  return { faceID, at, n, area };
}

function sampleStudy(id, name) {
  return defaultStudy({
    id,
    name,
    fixtures: [{ kind: 'fixed', faces: [face(1, [0, 0, 0], [0, 0, -1], 400)] }],
    loads: [
      { kind: 'force', faces: [face(2, [50, 0, 10], [0, 0, 1], 100)], vector: [0, 0, -200] },
      { kind: 'pressure', faces: [face(3, [0, 15, 0], [0, 1, 0], 200)], pressure_MPa: 0.5 },
    ],
  });
}

/** Same injection shape as runtime.js: new Function(...scopeKeys, "use strict"; script). */
function runPart(script, scope) {
  const keys = Object.keys(scope);
  const fn = new Function(...keys, `"use strict";\n${script}`);
  return fn(...keys.map((key) => scope[key]));
}

const manifold = {
  cube(size, center) {
    const [x, y, z] = size;
    return { kind: 'cube', size: [x, y, z], center: !!center, volume: x * y * z };
  },
};

test('a missing block is an empty read and compose leaves the script identical', () => {
  const script = starterCubeScript();
  const read = readFeaStudies(script);
  assert.deepEqual(read, { studies: [], errors: [] });
  assert.equal(readFeaStudy(script), null);
  assert.equal(composeFeaStudies(script, read.studies), script);
  assert.equal(stripFeaStudy(script), script);
  assert.equal(stripFeaStudy(script, 's1'), script);
});

test('the block is comments, round-trips, and does not change the solid', () => {
  const study = sampleStudy('s1', 'Static 1');
  const block = feaStudyBlock(study);
  for (const line of block.trim().split('\n')) {
    assert.equal(line.startsWith('//'), true, line);
  }
  assert.equal(block.includes(FEA_STUDY_BEGIN), true);
  assert.equal(block.includes(FEA_STUDY_END), true);
  assert.equal(block.includes('return '), false);

  const starter = starterCubeScript();
  assert.equal(starter.endsWith('\n'), true);
  const withStudy = composeFeaStudy(starter, study);
  assert.equal(scriptOutsideFeaStudy(withStudy), starter);
  assert.deepEqual(readFeaStudy(withStudy), study);
  assert.equal(composeFeaStudies(withStudy, readFeaStudies(withStudy).studies), withStudy);
  assert.equal(composeFeaStudy(withStudy, study), withStudy);
  assert.deepEqual(runPart(withStudy, { Manifold: manifold }), runPart(starter, { Manifold: manifold }));

  const traced = instrumentFeatureBlocks(withStudy);
  const feaLines = traced.script.split('\n').filter((line) => line.includes('fea-study'));
  assert.ok(feaLines.length >= 2);
  for (const line of feaLines) assert.equal(line.startsWith('//'), true);
});

test('several studies upsert and remove without touching the other blocks', () => {
  const base = 'let part = { id: 1 };\nreturn part;\n';
  const first = sampleStudy('s1', 'Static 1');
  const second = sampleStudy('wind', 'Wind');
  let script = composeFeaStudy(base, first);
  script = composeFeaStudy(script, second);
  assert.deepEqual(readFeaStudies(script).studies.map((study) => study.id), ['s1', 'wind']);
  assert.equal(scriptOutsideFeaStudy(script), base);

  script = composeFeaStudy(script, { ...first, name: 'Renamed' });
  const studies = readFeaStudies(script).studies;
  assert.deepEqual(studies.map((study) => study.name), ['Renamed', 'Wind']);
  assert.equal(scriptOutsideFeaStudy(script), base);
  assert.equal(composeFeaStudies(script, studies), script);

  const stripped = stripFeaStudy(script, 'wind');
  assert.deepEqual(readFeaStudies(stripped).studies.map((study) => study.id), ['s1']);
  assert.equal(scriptOutsideFeaStudy(stripped), base);
  assert.equal(stripFeaStudy(script), base);
  assert.deepEqual(runPart(script, {}), runPart(base, {}));
});

test('a script with no trailing newline keeps its code and still returns the same value', () => {
  const base = 'let part = 7;\nreturn part;';
  const next = composeFeaStudy(base, sampleStudy('s1', 'Static 1'));
  assert.equal(scriptOutsideFeaStudy(next), `${base}\n`);
  assert.equal(runPart(next, {}), runPart(base, {}));
});

test('bad JSON and a duplicate id are reported and do not throw', () => {
  const broken = `${FEA_STUDY_BEGIN}\n// @fea-study {nope}\n${FEA_STUDY_END}\n`;
  const read = readFeaStudies(broken);
  assert.deepEqual(read.studies, []);
  assert.match(read.errors[0], /not valid JSON/);

  const good = composeFeaStudy('return part;\n', sampleStudy('s1', 'Static 1'));
  const mixed = `${broken}${good}`;
  const both = readFeaStudies(mixed);
  assert.equal(both.studies.length, 1);
  assert.equal(both.studies[0].id, 's1');
  assert.ok(both.errors.some((error) => /not valid JSON/.test(error)));

  const dup = `${good}${feaStudyBlock(sampleStudy('s1', 'Other'))}`;
  const dupRead = readFeaStudies(dup);
  assert.equal(dupRead.studies.length, 2);
  assert.ok(dupRead.errors.some((error) => /duplicate fea-study id "s1"/.test(error)));

  const unclosed = `${FEA_STUDY_BEGIN}\n// @fea-study {}\nlet part = 1;\nreturn part;\n`;
  const open = readFeaStudies(unclosed);
  assert.deepEqual(open.studies, []);
  assert.match(open.errors[0], /missing the end marker/);
  assert.equal(runPart(unclosed, {}), 1);
});

test('palette scripts and a sheet-metal script round-trip with no study block', () => {
  const scripts = [starterCubeScript()];
  for (const item of HELPER_PALETTE_ITEMS) {
    let script;
    try {
      // A helper that needs a body is refused on an empty part (bike PR 3): compose it onto the cube.
      script = composeHelperInsert(helperNeedsBody(item.id) ? starterCubeScript() : '', item.id, null, defaultParamsFor(item.id));
    } catch {
      continue;
    }
    if (typeof script !== 'string') continue;
    scripts.push(script);
  }
  const sheet = composeSheetMetalCommit('', { material: '5052 H32', sku: 'ALU-090', thickness: 2.286 });
  assert.equal(sheet.ok, true);
  scripts.push(sheet.buffer);
  assert.ok(scripts.length > 20);
  for (const script of scripts) {
    const read = readFeaStudies(script);
    assert.deepEqual(read.errors, []);
    assert.equal(composeFeaStudies(script, read.studies), script);
    const withStudy = composeFeaStudy(script, sampleStudy('s1', 'Static 1'));
    assert.equal(scriptOutsideFeaStudy(withStudy), script.endsWith('\n') || script === '' ? script : `${script}\n`);
    assert.equal(composeFeaStudies(withStudy, readFeaStudies(withStudy).studies), withStudy);
  }
});

test('saving a study does not touch an assembly document', () => {
  const before = JSON.stringify(assembly);
  const checked = validateSurfJson(JSON.parse(before));
  assert.deepEqual(checked.errors, []);
  composeFeaStudy('return part;\n', sampleStudy('s1', 'Static 1'));
  assert.equal(JSON.stringify(assembly), before);
  assert.equal(validateSurfJson(assembly).ok, true);
  const source = readFileSync(new URL('./studyScript.js', import.meta.url), 'utf8');
  assert.equal(source.includes('surfJson'), false);
  assert.equal(source.includes('writeFile'), false);
  assert.equal(source.includes('.surf.json'), true);
});

test('a stored study resolves to solver material props', () => {
  const script = composeFeaStudy('return part;\n', sampleStudy('s1', 'Static 1'));
  const resolved = solverMaterialForStudy(readFeaStudy(script));
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.material, { E_MPa: 68900, nu: 0.33, yield_MPa: 276 });
});
