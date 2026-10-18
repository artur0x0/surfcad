/**
 * One part id at create: row id = @surf-id = parts[].id.
 * Mock adapter only. No git write on load / reload / edit.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { serializeAssembly } from '../src/utils/assembly.js';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import { mintSurfId, readSurfId, withSurfId, isSurfId } from '../src/utils/git/surfId.js';
import { stampMissingSurfIds } from '../src/utils/git/partIdentity.js';
import { assemblyFilePath, assemblyPartPath } from '../src/utils/git/vaultLayout.js';
import { validateSurfJson } from '../src/utils/git/surfJson.js';
import {
  assembleCommitFiles,
  commitWorkspace,
  firstCommitBaseline,
} from '../src/utils/git/gitCommit.js';
import { openLegacyAssembly } from '../src/utils/git/legacyVault/index.js';
import { FEA_STUDY_BEGIN, FEA_STUDY_END } from '../src/utils/git/feaStudyIds.js';
import { mintGroupId } from '../src/utils/partGroups.js';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const NOW = new Date('2026-10-18T12:00:00.000Z');
const FIRST = mintSurfId({ now: new Date('2026-10-18T00:00:00.000Z'), rand: 'a3f9' });
const SECOND = mintSurfId({ now: new Date('2026-10-18T00:00:01.000Z'), rand: 'b10c' });
const ASM_ID = mintSurfId({ now: NOW, rand: 'aa01' });
const GROUP = mintGroupId({ now: NOW, rand: 'cc01' });
const JOINT = mintSurfId({ now: NOW, rand: 'j01a' });
const UUID = '5f0c3c1e-0000-4000-8000-000000000001';
const ASM = 'Assembly';
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

function gitSeedDoc({ firstId = FIRST, secondId = null, extra = {} } = {}) {
  const parts = [{
    id: firstId,
    name: 'Part (1)',
    visible: true,
    order: 0,
    surfId: firstId,
    isSynced: false,
  }];
  const scripts = { [firstId]: withSurfId(CUBE, firstId) };
  if (secondId) {
    parts.push({
      id: secondId,
      name: 'Part (2)',
      visible: true,
      order: 1,
      surfId: secondId,
      isSynced: false,
    });
    scripts[secondId] = withSurfId(OTHER, secondId);
  }
  const doc = serializeAssembly({
    id: ASM_ID,
    source: 'git',
    name: ASM,
    activeId: firstId,
    parts,
    ...extra,
  });
  return { doc, scripts };
}

async function setupSave(doc, scripts) {
  const gh = createMockGithubAdapter({ login: 'agent' });
  const vault = await findOrCreateVault(gh);
  const stamped = stampMissingSurfIds(doc, scripts);
  const saved = await commitWorkspace(gh, vault.repo, {
    doc: stamped.doc,
    scripts: stamped.scripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save Assembly',
  });
  assert.equal(saved.status, 'committed', saved.error);
  return { gh, repo: vault.repo, saved, stamped };
}

function assertRowMatchesHeader(raw, scriptsByPath) {
  for (const row of raw.parts) {
    const text = scriptsByPath[row.path];
    assert.ok(typeof text === 'string', `missing script ${row.path}`);
    assert.equal(row.id, readSurfId(text), `${row.path} parts[].id must equal @surf-id`);
  }
}

test('App mints one surf-id at create (not a UUID row id)', () => {
  const created = sliceBetween(APP, 'const handleNewAssembly', 'const handleAddPart');
  assert.match(created, /const seedId = mintSurfId\(\)/);
  assert.equal(/newLocalPartId/.test(created), false);

  const add = sliceBetween(APP, 'const handleAddPart', 'const handleDeletePart');
  assert.match(add, /id = mintSurfId\(\)/);
  assert.equal(/newLocalPartId/.test(add), false);
  assert.equal(/doc\.source === 'git' \? mintSurfId\(\) : /.test(add), false);

  assert.match(APP, /const seedOpenAssembly = async \(script\) => \{\s*const seedId = mintSurfId\(\)/);
  assert.equal(/const seedId = newLocalPartId\(\)/.test(APP), false);

  const imp = sliceBetween(APP, 'const name = dedupedImportName', 'let starter = importMeshScript');
  assert.match(imp, /id = mintSurfId\(\)/);
  assert.equal(/newLocalPartId/.test(imp), false);

  const agentAsm = sliceBetween(APP, 'async agentCreateAssembly', 'agentGetPartTransform');
  assert.match(agentAsm, /seedAgentAssembly\(\{ name \}\)/);
  assert.equal(/handleNewAssembly\(/.test(agentAsm), false);
  const agentPart = sliceBetween(APP, 'async agentCreatePart', 'async agentOpenAssembly');
  assert.match(agentPart, /handleAddPart\(/);

  const assemblySrc = readFileSync(new URL('../src/utils/assembly.js', import.meta.url), 'utf8');
  assert.match(assemblySrc, /export function newLocalPartId\(\)/);
});

test('create_assembly then setup Save: parts[].id equals the file @surf-id', async () => {
  const { doc, scripts } = gitSeedDoc();
  const stamped = stampMissingSurfIds(doc, scripts);
  assert.equal(stamped.changed, false, 'a surf-id row must not grow a second id');
  assert.equal(stamped.doc.parts[0].id, FIRST);

  const { gh, repo, saved } = await setupSave(doc, scripts);
  const raw = JSON.parse((await gh.readFile(repo, assemblyFilePath(ASM), 'main')).content);
  assert.equal(validateSurfJson(raw).ok, true, validateSurfJson(raw).errors?.join('; '));
  const byPath = {};
  for (const row of raw.parts) {
    byPath[row.path] = (await gh.readFile(repo, row.path, 'main')).content;
  }
  assertRowMatchesHeader(raw, byPath);
  assert.equal(raw.parts[0].id, FIRST);
  assert.equal(saved.doc.parts[0].id, FIRST);
});

test('paint and a joint on the first part before the first Save succeed', async () => {
  const extra = {
    colors: { [FIRST]: { part: '#3b82f6' } },
    joints: [{ id: JOINT, name: 'Ground 1', type: 'fixed', a: { part: FIRST } }],
  };
  const { doc, scripts } = gitSeedDoc({ extra });
  assert.equal(doc.colors[FIRST].part, '#3b82f6');
  assert.equal(doc.joints[0].a.part, FIRST);

  const { gh, repo } = await setupSave(doc, scripts);
  const raw = JSON.parse((await gh.readFile(repo, assemblyFilePath(ASM), 'main')).content);
  assert.equal(validateSurfJson(raw).ok, true, validateSurfJson(raw).errors?.join('; '));
  assert.equal(raw.colors[FIRST].part, '#3b82f6');
  assert.equal(raw.joints[0].a.part, FIRST);
  assert.equal(raw.parts[0].id, FIRST);
  const text = (await gh.readFile(repo, raw.parts[0].path, 'main')).content;
  assert.equal(readSurfId(text), FIRST);
});

test('group + unedited FEA study survive setup Save, open, other-part Save, re-open', async () => {
  const firstScript = withSurfId(`${CUBE}${studyBlock(FIRST)}`, FIRST);
  const extra = {
    groups: [{
      id: GROUP,
      name: 'Hardware',
      source: null,
      partIds: [FIRST],
    }],
  };
  const { doc, scripts } = gitSeedDoc({ secondId: SECOND, extra });
  scripts[FIRST] = firstScript;

  const { gh, repo, saved } = await setupSave(doc, scripts);
  const firstRaw = JSON.parse((await gh.readFile(repo, assemblyFilePath(ASM), 'main')).content);
  assert.deepEqual(firstRaw.groups[0].partIds, [FIRST]);
  const firstPath = firstRaw.parts.find((row) => row.id === FIRST).path;
  const secondPath = firstRaw.parts.find((row) => row.id === SECOND)?.path
    || assemblyPartPath(ASM, 'Part (2)');
  assert.equal(firstRaw.parts.some((row) => row.id === SECOND), true);
  const studyOnTip = readStudyPart((await gh.readFile(repo, firstPath, 'main')).content);
  assert.equal(studyOnTip.fixtures[0].faces[0].part, FIRST);
  assert.equal(studyOnTip.scope.ids[0], FIRST);

  const writesBefore = gh._log.filter((row) => row.op === 'commitFiles').length;
  const opened = await openLegacyAssembly(gh, repo, ASM, {
    branch: 'main',
    headSha: saved.sha,
  });
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writesBefore);
  assert.deepEqual(opened.doc.groups[0].partIds, [FIRST]);
  assert.equal(readStudyPart(opened.scripts[FIRST]).fixtures[0].faces[0].part, FIRST);

  const edited = `${opened.scripts[SECOND]}\n// edit\n`;
  const planned = await assembleCommitFiles(gh, repo, {
    doc: opened.doc,
    scripts: { ...opened.scripts, [SECOND]: edited },
    baseline: opened.baseline,
    message: 'Save Part (2)',
  });
  assert.equal(planned.status, 'ready', planned.error);
  const partWrites = planned.files.filter((file) => (
    !file.delete && typeof file.path === 'string' && file.path.endsWith('.js')
  ));
  assert.deepEqual(partWrites.map((file) => file.path), [secondPath]);
  const asmWrite = planned.files.find((file) => file.path === assemblyFilePath(ASM) && !file.delete);
  if (asmWrite) {
    const nextRaw = JSON.parse(asmWrite.content);
    assert.deepEqual(nextRaw.parts.map((row) => row.id), firstRaw.parts.map((row) => row.id));
    assert.deepEqual(nextRaw.groups[0].partIds, [FIRST]);
    assert.equal(asmWrite.content, (await gh.readFile(repo, assemblyFilePath(ASM), 'main')).content);
  }

  const second = await commitWorkspace(gh, repo, {
    doc: opened.doc,
    scripts: { ...opened.scripts, [SECOND]: edited },
    baseline: opened.baseline,
    message: 'Save Part (2)',
  });
  assert.equal(second.status, 'committed', second.error);

  const reopened = await openLegacyAssembly(gh, repo, ASM, {
    branch: 'main',
    headSha: second.sha,
  });
  assert.deepEqual(reopened.doc.groups[0].partIds, [FIRST]);
  assert.equal(readStudyPart(reopened.scripts[FIRST]).scope.ids[0], FIRST);
  assert.equal(readSurfId(reopened.scripts[FIRST]), FIRST);
  const tipAsm = JSON.parse((await gh.readFile(repo, assemblyFilePath(ASM), 'main')).content);
  assert.equal(JSON.stringify(tipAsm), JSON.stringify(firstRaw));
});

test('UUID row whose header differs: open keeps group, colors, and joints on the header id', async () => {
  const path = assemblyPartPath('Split', 'Bracket');
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Split',
    activeId: path,
    parts: [{
      id: UUID,
      path,
      name: 'Bracket',
      visible: true,
      order: 0,
    }],
    groups: [{
      id: GROUP,
      name: 'Hardware',
      source: null,
      partIds: [FIRST],
    }],
    colors: { [FIRST]: { part: '#ff0000' } },
    joints: [{ id: JOINT, name: 'Ground 1', type: 'fixed', a: { part: FIRST } }],
  };
  assert.equal(validateSurfJson(raw).ok, false, 'membership fails while parts[].id is still the UUID');
  assert.equal(validateSurfJson(raw, { allowDanglingRefs: true }).ok, true, validateSurfJson(raw, { allowDanglingRefs: true }).errors?.join('; '));

  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const writesBefore = gh._log.filter((row) => row.op === 'commitFiles').length;
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'uuid row vs header',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Split/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(path, withSurfId(CUBE, FIRST)),
    ],
  });
  const opened = await openLegacyAssembly(gh, vault.repo, 'Split', {
    branch: 'main',
    now: NOW,
    randFor: (part) => (part?.id === '$assembly' ? 'aa01' : 'dead'),
  });
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writesBefore + 1);
  assert.equal(opened.doc.parts[0].id, FIRST);
  assert.deepEqual(opened.doc.groups[0].partIds, [FIRST]);
  assert.equal(opened.doc.colors[FIRST].part, '#ff0000');
  assert.equal(Object.hasOwn(opened.doc.colors, UUID), false);
  assert.equal(opened.doc.joints[0].a.part, FIRST);
  assert.equal(readSurfId(opened.scripts[FIRST]), FIRST);
});

test('local assemblies use a surf-id and do not split on stamp; UUID rows still stamp as before', () => {
  const localId = mintSurfId({ now: NOW, rand: 'loc1' });
  const localDoc = {
    source: 'local',
    name: 'Assembly',
    activeId: localId,
    parts: [{ id: localId, name: 'Part (1)', visible: true, order: 0 }],
  };
  const localScripts = { [localId]: CUBE };
  const stamped = stampMissingSurfIds(localDoc, localScripts);
  assert.equal(stamped.changed, false);
  assert.equal(stamped.doc.parts[0].id, localId);
  assert.equal(stamped.doc.parts[0].surfId, undefined);
  assert.equal(stamped.scripts[localId], CUBE);

  const uuidDoc = {
    source: 'local',
    name: 'Assembly',
    activeId: UUID,
    parts: [{ id: UUID, name: 'Part (1)', visible: true, order: 0 }],
  };
  const uuidStamped = stampMissingSurfIds(uuidDoc, { [UUID]: CUBE }, {
    now: NOW,
    randFor: () => 'bbbb',
  });
  assert.equal(uuidStamped.changed, true);
  assert.equal(uuidStamped.doc.parts[0].id, UUID);
  assert.ok(isSurfId(uuidStamped.doc.parts[0].surfId));
  assert.notEqual(uuidStamped.doc.parts[0].surfId, UUID);
});
