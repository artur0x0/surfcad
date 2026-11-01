/**
 * One part id at create: row id = @surf-id = parts[].id, and one script per
 * definition: an instance row (`instanceOf`) shares its definition's file
 * and never gets a file of its own.
 * Mock adapter only. No git write on load / reload / edit.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { partDefinitionId, serializeAssembly } from '../src/utils/assembly.js';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { mintSurfId, readSurfId, withSurfId, isSurfId } from '../src/utils/git/surfId.js';
import { stampMissingSurfIds } from '../src/utils/git/partIdentity.js';
import { assemblyFilePath } from '../src/utils/git/vaultLayout.js';
import { assemblyIdPath, partIdPath } from '../src/utils/git/idPaths.js';
import { planSave } from '../src/utils/git/planSave.js';
import { validateSurfJson } from '../src/utils/git/surfJson.js';
import {
  commitWorkspace,
  firstCommitBaseline,
} from '../src/utils/git/gitCommit.js';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const NOW = new Date('2026-10-18T12:00:00.000Z');
const FIRST = mintSurfId({ now: new Date('2026-10-18T00:00:00.000Z'), rand: 'a3f9' });
const ASM_ID = mintSurfId({ now: NOW, rand: 'aa01' });
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

test('one script per definition: an instance row shares the @surf-id file of the part it places', () => {
  const INSTANCE = mintSurfId({ now: new Date('2026-10-18T00:00:02.000Z'), rand: 'c0b2' });
  const doc = serializeAssembly({
    version: 1,
    source: 'git',
    id: ASM_ID,
    name: ASM,
    activeId: INSTANCE,
    vaultLayout: 'v2',
    parts: [
      { id: FIRST, name: 'Roller', visible: true, order: 0 },
      { id: INSTANCE, instanceOf: FIRST, name: 'Roller (2)', visible: true, order: 1, position: [0, 0, 120] },
    ],
  });
  const plan = planSave(null, null, { ...doc, scripts: { [FIRST]: withSurfId(CUBE, FIRST) }, now: NOW.getTime() }, null, null);
  const paths = plan.files.map((file) => file.path).sort();
  assert.deepEqual(paths, [assemblyIdPath(ASM_ID), partIdPath(FIRST)]);
  const script = plan.files.find((file) => file.path === partIdPath(FIRST)).content;
  assert.equal(readSurfId(script), FIRST, 'the file header is the definition id, not the instance row id');
  assert.equal(partDefinitionId(doc.parts[1]), FIRST);
  assert.equal(doc.parts[1].id, INSTANCE, 'the instance keeps its own row id');
});
