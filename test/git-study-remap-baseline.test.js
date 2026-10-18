/**
 * Open-time FEA study remaps must stay dirty against the git tip so the
 * next Save commits the rewritten part file with the .surf.json rewrite.
 * Mock adapter only. No git write on open.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import { mintSurfId, readSurfId, withSurfId } from '../src/utils/git/surfId.js';
import { assemblyFilePath, assemblyPartPath } from '../src/utils/git/vaultLayout.js';
import {
  assembleCommitFiles,
  commitWorkspace,
} from '../src/utils/git/gitCommit.js';
import { openLegacyAssembly } from '../src/utils/git/legacyVault/index.js';
import { FEA_STUDY_BEGIN, FEA_STUDY_END } from '../src/utils/git/feaStudyIds.js';
import {
  baselineScriptsKeepingTip,
  captureBaseline,
  captureBaselineFromTip,
  dirtyPartIds,
  isPartDirty,
  isWorkspaceDirty,
} from '../src/utils/git/gitWorkspace.js';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const NOW = new Date('2026-10-18T12:00:00.000Z');
const FIRST = mintSurfId({ now: new Date('2026-10-18T00:00:00.000Z'), rand: 'a3f9' });
const SECOND = mintSurfId({ now: new Date('2026-10-18T00:00:01.000Z'), rand: 'b10c' });
const UUID = '5f0c3c1e-0000-4000-8000-000000000001';
const ASM = 'StudyRemap';
const CUBE = 'return Manifold.cube([10, 10, 10], true);\n';
const OTHER = 'return Manifold.cube([6, 6, 6], true);\n';

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

function readStudyPart(script) {
  const tag = '// @fea-study ';
  const line = String(script || '').split('\n').find((row) => row.startsWith(tag));
  assert.ok(line, 'missing @fea-study line');
  return JSON.parse(line.slice(tag.length));
}

function studyIds(script) {
  const study = readStudyPart(script);
  return {
    fixture: study.fixtures[0].faces[0].part,
    scope: study.scope.ids[0],
    part: study.parts[0].id,
  };
}

function assertStudyMatchesRow(script, rowId) {
  const ids = studyIds(script);
  assert.equal(ids.fixture, rowId);
  assert.equal(ids.scope, rowId);
  assert.equal(ids.part, rowId);
}

function recaptureFromOpened(opened, wcScripts) {
  return captureBaseline({
    assemblyPath: opened.baseline.assemblyPath,
    assemblyName: opened.baseline.assemblyName,
    doc: opened.doc,
    scripts: baselineScriptsKeepingTip(
      opened.doc.parts,
      wcScripts,
      opened.baseline.scripts,
    ),
    assets: opened.baseline.assets,
    branch: opened.baseline.branch,
    headSha: opened.baseline.headSha,
  });
}

async function seedVault({ name = ASM, parts, scriptsByPath }) {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name,
    activeId: parts[0].id,
    parts: parts.map((part) => {
      const row = {
        path: part.path,
        name: part.name,
        visible: part.visible !== false,
        order: part.order,
      };
      if (part.id && part.id !== part.path) row.id = part.id;
      return row;
    }),
  };
  const files = [
    fileWrite(assemblyFilePath(name), `${JSON.stringify(raw, null, 2)}\n`),
    ...parts.map((part) => fileWrite(part.path, scriptsByPath[part.path])),
  ];
  const seeded = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed',
    baseSha: vault.headSha,
    files,
  });
  return { gh, repo: vault.repo, headSha: seeded.sha, parts, name };
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
  assert.match(afterBody, /baselineScriptsKeepingTip\(/);
  assert.match(afterBody, /opened\.baseline\?\.scripts/);
  assert.equal(/scripts:\s*nextScripts,/.test(applyBody), false);
  assert.equal(/scripts:\s*openedScripts,/.test(afterBody), false);
});

test('UUID row plus unedited study: open, edit the other part, Save, re-open', async () => {
  const basePath = assemblyPartPath(ASM, 'Base');
  const otherPath = assemblyPartPath(ASM, 'Other');
  const tipBase = withSurfId(`${CUBE}${studyBlock(UUID)}`, FIRST);
  const tipOther = withSurfId(OTHER, SECOND);
  const { gh, repo, headSha } = await seedVault({
    parts: [
      { id: UUID, path: basePath, name: 'Base', visible: true, order: 0 },
      { id: SECOND, path: otherPath, name: 'Other', visible: true, order: 1 },
    ],
    scriptsByPath: { [basePath]: tipBase, [otherPath]: tipOther },
  });

  const writesBefore = gh._log.filter((row) => row.op === 'commitFiles').length;
  const opened = await openLegacyAssembly(gh, repo, ASM, {
    branch: 'main',
    headSha,
    now: NOW,
  });
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writesBefore);
  assert.equal(opened.doc.parts.find((row) => row.name === 'Base')?.id, FIRST);
  assert.equal(opened.doc.parts.find((row) => row.name === 'Other')?.id, SECOND);
  assertStudyMatchesRow(opened.scripts[FIRST], FIRST);
  assert.equal(readSurfId(opened.scripts[FIRST]), FIRST);
  assert.equal(opened.baseline.scripts[FIRST], tipBase);
  assert.notEqual(opened.scripts[FIRST], opened.baseline.scripts[FIRST]);
  assert.deepEqual([...dirtyPartIds(opened.doc, opened.scripts, opened.baseline)].sort(), [FIRST]);

  const recaptured = recaptureFromOpened(opened, opened.scripts);
  assert.equal(isPartDirty(FIRST, opened.scripts[FIRST], recaptured), true);
  assert.equal(isPartDirty(SECOND, opened.scripts[SECOND], recaptured), false);
  const wiped = captureBaseline({
    assemblyPath: opened.baseline.assemblyPath,
    assemblyName: opened.baseline.assemblyName,
    doc: opened.doc,
    scripts: opened.scripts,
    branch: opened.baseline.branch,
    headSha: opened.baseline.headSha,
  });
  assert.equal(
    isPartDirty(FIRST, opened.scripts[FIRST], wiped),
    false,
    'capturing the baseline from remapped WC scripts would hide the study rewrite',
  );
  const fromTip = captureBaselineFromTip({
    tipDoc: opened.doc,
    tipBaseline: opened.baseline,
  });
  assert.equal(isPartDirty(FIRST, opened.scripts[FIRST], fromTip), true);

  const edited = `${opened.scripts[SECOND]}\n// edit\n`;
  const scripts = { ...opened.scripts, [SECOND]: edited };
  const planned = await assembleCommitFiles(gh, repo, {
    doc: opened.doc,
    scripts,
    baseline: opened.baseline,
    message: 'Save Other',
  });
  assert.equal(planned.status, 'ready', planned.error);
  const jsWrites = planned.files
    .filter((file) => !file.delete && typeof file.path === 'string' && file.path.endsWith('.js'))
    .map((file) => file.path)
    .sort();
  assert.deepEqual(jsWrites, [basePath, otherPath].sort());
  const asmWrite = planned.files.find((file) => file.path === assemblyFilePath(ASM) && !file.delete);
  assert.ok(asmWrite, 'Save must rewrite .surf.json with the remapped row id');
  const nextRaw = JSON.parse(asmWrite.content);
  assert.deepEqual(nextRaw.parts.map((row) => row.id).sort(), [FIRST, SECOND].sort());
  const baseWrite = planned.files.find((file) => file.path === basePath && !file.delete);
  assertStudyMatchesRow(baseWrite.content, FIRST);

  const saved = await commitWorkspace(gh, repo, {
    doc: opened.doc,
    scripts,
    baseline: opened.baseline,
    message: 'Save Other',
  });
  assert.equal(saved.status, 'committed', saved.error);

  const reopened = await openLegacyAssembly(gh, repo, ASM, {
    branch: 'main',
    headSha: saved.sha,
    now: NOW,
  });
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writesBefore + 1);
  const rowIds = new Set(reopened.doc.parts.map((row) => row.id));
  assert.ok(rowIds.has(FIRST));
  assertStudyMatchesRow(reopened.scripts[FIRST], FIRST);
  assert.equal(readSurfId(reopened.scripts[FIRST]), FIRST);
  const tipStudy = readStudyPart((await gh.readFile(repo, basePath, 'main')).content);
  assert.ok(rowIds.has(tipStudy.fixtures[0].faces[0].part));
  assert.ok(rowIds.has(tipStudy.scope.ids[0]));
  assert.deepEqual([...dirtyPartIds(reopened.doc, reopened.scripts, reopened.baseline)], []);
});

test('a vault with no collapse changes is clean right after open', async () => {
  const basePath = assemblyPartPath(ASM, 'Base');
  const otherPath = assemblyPartPath(ASM, 'Other');
  const tipBase = withSurfId(`${CUBE}${studyBlock(FIRST)}`, FIRST);
  const tipOther = withSurfId(OTHER, SECOND);
  const { gh, repo, headSha } = await seedVault({
    parts: [
      { id: FIRST, path: basePath, name: 'Base', visible: true, order: 0 },
      { id: SECOND, path: otherPath, name: 'Other', visible: true, order: 1 },
    ],
    scriptsByPath: { [basePath]: tipBase, [otherPath]: tipOther },
  });

  const writesBefore = gh._log.filter((row) => row.op === 'commitFiles').length;
  const opened = await openLegacyAssembly(gh, repo, ASM, {
    branch: 'main',
    headSha,
    now: NOW,
  });
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writesBefore);
  assert.equal(opened.scripts[FIRST], tipBase);
  assert.equal(opened.baseline.scripts[FIRST], tipBase);
  assert.deepEqual([...dirtyPartIds(opened.doc, opened.scripts, opened.baseline)], []);
  assert.equal(isWorkspaceDirty(opened.doc, opened.scripts, opened.baseline), false);
  const recaptured = recaptureFromOpened(opened, opened.scripts);
  assert.equal(isWorkspaceDirty(opened.doc, opened.scripts, recaptured), false);
  const planned = await assembleCommitFiles(gh, repo, {
    doc: opened.doc,
    scripts: opened.scripts,
    baseline: opened.baseline,
    message: 'noop',
  });
  assert.equal(planned.status, 'clean');
});

test('v1 path-id study is not dirty after open; Save of another part skips it', async () => {
  const name = 'Gear';
  const basePath = assemblyPartPath(name, 'Base');
  const otherPath = assemblyPartPath(name, 'Other');
  const tipBase = withSurfId(`${CUBE}${studyBlock(basePath)}`, FIRST);
  const tipOther = withSurfId(OTHER, SECOND);
  const { gh, repo, headSha } = await seedVault({
    name,
    parts: [
      { id: basePath, path: basePath, name: 'Base', visible: true, order: 0 },
      { id: SECOND, path: otherPath, name: 'Other', visible: true, order: 1 },
    ],
    scriptsByPath: { [basePath]: tipBase, [otherPath]: tipOther },
  });

  const writesBefore = gh._log.filter((row) => row.op === 'commitFiles').length;
  const opened = await openLegacyAssembly(gh, repo, name, {
    branch: 'main',
    headSha,
    now: NOW,
  });
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writesBefore);
  assert.equal(opened.doc.parts.find((row) => row.name === 'Base')?.id, FIRST);
  assertStudyMatchesRow(opened.scripts[FIRST], FIRST);
  assert.equal(opened.scripts[FIRST], opened.baseline.scripts[FIRST]);
  assert.notEqual(opened.scripts[FIRST], tipBase);
  assert.deepEqual([...dirtyPartIds(opened.doc, opened.scripts, opened.baseline)], []);
  assert.equal(isWorkspaceDirty(opened.doc, opened.scripts, opened.baseline), false);
  const recaptured = recaptureFromOpened(opened, opened.scripts);
  assert.equal(isWorkspaceDirty(opened.doc, opened.scripts, recaptured), false);

  const edited = `${opened.scripts[SECOND]}\n// edit\n`;
  const scripts = { ...opened.scripts, [SECOND]: edited };
  const planned = await assembleCommitFiles(gh, repo, {
    doc: opened.doc,
    scripts,
    baseline: opened.baseline,
    message: 'Save Other',
  });
  assert.equal(planned.status, 'ready', planned.error);
  const jsWrites = planned.files
    .filter((file) => !file.delete && typeof file.path === 'string' && file.path.endsWith('.js'))
    .map((file) => file.path)
    .sort();
  assert.deepEqual(jsWrites, [otherPath]);
  assert.equal(planned.files.some((file) => file.path === basePath && !file.delete), false);
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
  const carried = baselineScriptsKeepingTip(
    parts,
    { [FIRST]: wc },
    { [FIRST]: tip },
  );
  assert.equal(carried[FIRST], tip);
  const same = baselineScriptsKeepingTip(
    parts,
    { [FIRST]: tip },
    { [FIRST]: tip },
  );
  assert.equal(same[FIRST], tip);
});
