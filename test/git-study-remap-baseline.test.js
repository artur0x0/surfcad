/**
 * Open-time FEA study remaps must stay dirty against the git tip so the
 * next Save commits the rewritten part file with the .surf.json rewrite.
 * Mock adapter only. No git write on open.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { mintSurfId, withSurfId } from '../src/utils/git/surfId.js';
import { assemblyPartPath } from '../src/utils/git/vaultLayout.js';
import { FEA_STUDY_BEGIN, FEA_STUDY_END } from '../src/utils/git/feaStudyIds.js';
import { baselineScriptsKeepingTip } from '../src/utils/git/gitWorkspace.js';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const FIRST = mintSurfId({ now: new Date('2026-10-18T00:00:00.000Z'), rand: 'a3f9' });
const UUID = '5f0c3c1e-0000-4000-8000-000000000001';
const ASM = 'StudyRemap';
const CUBE = 'return Manifold.cube([10, 10, 10], true);\n';

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `missing slice ${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

function studyBlock(partId) {
  const study = {
    v: 1,
    id: 's1',
    name: 'Static 1',
    type: 'linear-static',
    material: { id: 'al-6061-t6' },
    fixtures: [{
      kind: 'fixed',
      faces: [{ faceID: 1, at: [0, 0, 0], n: [0, 0, 1], area: 10, part: partId }],
    }],
    loads: [],
    scope: { kind: 'parts', ids: [partId] },
    parts: [{ id: partId, material: { id: 'al-6061-t6' } }],
    result: null,
  };
  return `${FEA_STUDY_BEGIN}\n// @fea-study ${JSON.stringify(study)}\n${FEA_STUDY_END}\n`;
}

test('App adoptVaultOpening recapture keeps tip scripts that collapse changed', () => {
  const adopt = sliceBetween(APP, 'const adoptVaultOpening', 'const handleOpenVaultAssembly');
  const applyAt = adopt.indexOf('rememberGitBaseline(captureBaseline(');
  const afterAt = adopt.indexOf('const baseline = captureBaseline(');
  assert.ok(applyAt >= 0 && afterAt > applyAt);
  const applyBody = adopt.slice(applyAt, afterAt);
  const afterBody = adopt.slice(afterAt, adopt.indexOf('rememberGitBaseline(baseline)'));
  assert.match(applyBody, /baselineScriptsKeepingTip\(/);
  assert.match(applyBody, /opened\.baseline\?\.scripts/);
  assert.match(applyBody, /openedScripts:\s*opened\.scripts/);
  assert.match(afterBody, /baselineScriptsKeepingTip\(/);
  assert.match(afterBody, /opened\.baseline\?\.scripts/);
  assert.match(afterBody, /openedScripts:\s*opened\.scripts/);
  assert.equal(/scripts:\s*nextScripts,/.test(applyBody), false);
  assert.equal(/scripts:\s*openedScripts,/.test(afterBody), false);
});

test('baselineScriptsKeepingTip keeps tip bytes only for UUID → surf-id remaps', () => {
  const path = assemblyPartPath(ASM, 'Base');
  const tip = withSurfId(`${CUBE}${studyBlock(UUID)}`, FIRST);
  const wc = withSurfId(`${CUBE}${studyBlock(FIRST)}`, FIRST);
  const parts = [{ id: FIRST, path, name: 'Base', visible: true, order: 0 }];
  const kept = baselineScriptsKeepingTip(
    parts,
    { [FIRST]: wc },
    { [path]: tip, [UUID]: tip },
    [{ from: UUID, to: FIRST }],
  );
  assert.equal(kept[FIRST], tip);
  const pathTip = withSurfId(`${CUBE}${studyBlock(path)}`, FIRST);
  const pathWc = withSurfId(`${CUBE}${studyBlock(FIRST)}`, FIRST);
  const pathKept = baselineScriptsKeepingTip(
    parts,
    { [FIRST]: pathWc },
    { [path]: pathTip },
    [{ from: path, to: FIRST }],
  );
  assert.equal(pathKept[FIRST], pathWc);
  const emptyPairs = baselineScriptsKeepingTip(
    parts,
    { [FIRST]: pathWc },
    { [path]: pathTip, [FIRST]: pathTip },
    [],
  );
  assert.equal(emptyPairs[FIRST], pathWc);
  const carried = baselineScriptsKeepingTip(
    parts,
    { [FIRST]: wc },
    { [FIRST]: tip },
    { openedScripts: { [FIRST]: wc } },
  );
  assert.equal(carried[FIRST], tip);
  const readerChoseWc = baselineScriptsKeepingTip(
    parts,
    { [FIRST]: pathWc },
    { [FIRST]: pathWc },
    { openedScripts: { [FIRST]: pathWc } },
  );
  assert.equal(readerChoseWc[FIRST], pathWc);
  const same = baselineScriptsKeepingTip(
    parts,
    { [FIRST]: tip },
    { [FIRST]: tip },
  );
  assert.equal(same[FIRST], tip);
});
