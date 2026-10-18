/**
 * PR 2: isolated v1 vault reader. Mock adapter only — no network, no git writes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import { mintSurfId, withSurfId, readSurfId } from '../src/utils/git/surfId.js';
import { validateSurfJson } from '../src/utils/git/surfJson.js';
import { switchVaultBranch } from '../src/utils/git/gitBranch.js';
import {
  detectVaultLayout,
  openLegacyAssembly,
  listLegacyAssemblies,
} from '../src/utils/git/legacyVault/index.js';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const SHAFT_ID = mintSurfId({ now: new Date('2026-10-18T00:00:00.000Z'), rand: 'aaaa' });
const LID_ID = mintSurfId({ now: new Date('2026-10-18T00:00:01.000Z'), rand: 'bbbb' });
const BRACKET_ID = mintSurfId({ now: new Date('2026-10-18T00:00:02.000Z'), rand: 'cccc' });
const PLATE_ID = mintSurfId({ now: new Date('2026-10-18T00:00:03.000Z'), rand: 'dddd' });
const GROUP_ID = mintSurfId({ now: new Date('2026-10-18T00:00:04.000Z'), rand: 'eeee' });
const MISSING_ID = mintSurfId({ now: NOW, rand: 'ffff' });
const ASM_ID = mintSurfId({ now: NOW, rand: '0001' });

const SHAFT_PATH = 'parts/Shaft.js';
const BRACKET_PATH = 'parts/Bracket.js';
const LID_PATH = 'assemblies/Gearbox/Lid.js';
const PLATE_PATH = 'assemblies/Cover/parts/Plate.js';
const MISSING_PATH = 'parts/MissingGear.js';

function v1Surf(name, parts, extra = {}) {
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name,
    activeId: extra.activeId || parts[0].path,
    parts: parts.map((part, order) => ({
      ...(part.id ? { id: part.id } : {}),
      path: part.path,
      name: part.name,
      visible: true,
      order,
    })),
    ...extra.groups ? { groups: extra.groups } : {},
  };
  const check = validateSurfJson(raw);
  assert.equal(check.ok, true, check.errors?.join('; '));
  return `${JSON.stringify(raw, null, 2)}\n`;
}

function commits(gh) {
  return gh._log.filter((row) => row.op === 'commitFiles' || row.op === 'createRepo');
}

async function seedGearboxVault() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const gearbox = v1Surf('Gearbox', [
    { id: SHAFT_ID, path: SHAFT_PATH, name: 'Shaft' },
    { path: LID_PATH, name: 'Lid' },
    { path: MISSING_PATH, name: 'Missing gear' },
    { id: BRACKET_ID, path: BRACKET_PATH, name: 'Bracket' },
  ], {
    activeId: SHAFT_PATH,
    groups: [{
      id: GROUP_ID,
      name: 'Hardware',
      source: 'assemblies/Cover/.surf.json',
      partIds: [SHAFT_ID],
    }],
  });
  const cover = v1Surf('Cover', [
    { id: SHAFT_ID, path: SHAFT_PATH, name: 'Shaft' },
    { id: PLATE_ID, path: PLATE_PATH, name: 'Plate' },
  ]);
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed gearbox v1',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Gearbox/.surf.json', gearbox),
      fileWrite('assemblies/Cover/.surf.json', cover),
      fileWrite(SHAFT_PATH, withSurfId('return Manifold.cylinder(40, 6, 6, 24, true);\n', SHAFT_ID)),
      fileWrite(LID_PATH, withSurfId('return Manifold.cylinder(2, 20, 20, 32, true);\n', LID_ID)),
      fileWrite(BRACKET_PATH, withSurfId('return Manifold.cube([20, 12, 4], true);\n', BRACKET_ID)),
      fileWrite(PLATE_PATH, withSurfId('return Manifold.cube([30, 30, 2], true);\n', PLATE_ID)),
    ],
  });
  return { gh, repo: vault.repo, headSha: (await gh.getBranch(vault.repo, 'main')).sha };
}

function randFor(part) {
  const path = part?.path || part?.id;
  if (path === MISSING_PATH) return 'ffff';
  if (part?.id === '$assembly') return '0001';
  return '9999';
}

const openOpts = {
  branch: 'main',
  now: NOW,
  randFor,
};

test('detectVaultLayout reports a Gearbox-style v1 tree as legacy', async () => {
  const { gh, repo } = await seedGearboxVault();
  const detected = await detectVaultLayout(gh, repo, 'main');
  assert.equal(detected.layout, 'legacy');
  assert.equal(detected.markerVersion, 1);
  const names = await listLegacyAssemblies(gh, repo, 'main');
  assert.deepEqual(names, ['Cover', 'Gearbox']);
});

test('openLegacyAssembly maps a Gearbox-style vault by surf-id, keeps a missing row, and does not write', async () => {
  const { gh, repo, headSha } = await seedGearboxVault();
  const writesBefore = commits(gh).length;

  const first = await openLegacyAssembly(gh, repo, 'Gearbox', { ...openOpts, headSha });
  const cover = await openLegacyAssembly(gh, repo, 'Cover', { ...openOpts, headSha });

  assert.equal(commits(gh).length, writesBefore, 'open must not commitFiles or createRepo');
  assert.equal(first.vaultLayout, 'legacy');
  assert.equal(first.doc.vaultLayout, 'legacy');
  assert.equal(first.doc.id, ASM_ID);
  assert.equal(first.doc.name, 'Gearbox');
  assert.equal(first.doc.activeId, SHAFT_ID);
  assert.equal(first.baseline?.legacyCleanup, undefined);

  const byName = Object.fromEntries(first.doc.parts.map((part) => [part.name, part]));
  assert.equal(byName.Shaft.id, SHAFT_ID);
  assert.equal(byName.Lid.id, LID_ID);
  assert.equal(byName.Bracket.id, BRACKET_ID);
  assert.equal(byName['Missing gear'].id, MISSING_ID);
  assert.equal(byName['Missing gear'].missing, true);
  assert.equal(Object.hasOwn(first.scripts, byName['Missing gear'].id), false);
  assert.equal(first.scripts[SHAFT_ID].includes('cylinder'), true);
  assert.notEqual(first.scripts[SHAFT_ID], '');
  assert.equal(typeof first.scripts[MISSING_ID], 'undefined');
  assert.equal(Object.values(first.scripts).some((text) => text === ''), false);

  const coverShaft = cover.doc.parts.find((part) => part.name === 'Shaft');
  const coverPlate = cover.doc.parts.find((part) => part.name === 'Plate');
  assert.equal(coverShaft.id, SHAFT_ID, 'shared part keeps the same id in both assemblies');
  assert.equal(coverPlate.id, PLATE_ID);
  assert.equal(coverPlate.path, PLATE_PATH);
  assert.equal(cover.vaultLayout, 'legacy');

  const pathIndex = Object.fromEntries(first.identities.cached.map((hit) => [hit.path, hit.id]));
  const second = await openLegacyAssembly(gh, repo, 'Gearbox', {
    ...openOpts,
    headSha,
    pathIndex,
    knownAssemblyId: first.doc.id,
  });
  assert.equal(commits(gh).length, writesBefore);
  assert.deepEqual(second.doc.parts.map((part) => part.id), first.doc.parts.map((part) => part.id));
  assert.equal(second.doc.id, first.doc.id);
  assert.equal(second.doc.parts.find((part) => part.missing)?.id, MISSING_ID);
  assert.equal(readSurfId(second.scripts[LID_ID]), LID_ID);
});

test('ids stay stable across reload without restamping headers', async () => {
  const { gh, repo, headSha } = await seedGearboxVault();
  const first = await openLegacyAssembly(gh, repo, 'Gearbox', { ...openOpts, headSha });
  const pathIndex = Object.fromEntries(first.identities.cached.map((hit) => [hit.path, hit.id]));
  const second = await openLegacyAssembly(gh, repo, 'Gearbox', {
    ...openOpts,
    headSha,
    pathIndex,
    knownAssemblyId: first.doc.id,
  });
  assert.deepEqual(
    second.doc.parts.map((part) => ({ id: part.id, name: part.name, missing: !!part.missing })),
    first.doc.parts.map((part) => ({ id: part.id, name: part.name, missing: !!part.missing })),
  );
  assert.equal(second.scripts[SHAFT_ID], first.scripts[SHAFT_ID]);
  assert.equal(second.scripts[SHAFT_ID].startsWith(`// @surf-id ${SHAFT_ID}`), true);
  assert.equal(/\n\/\/ @name /.test(second.scripts[SHAFT_ID]), false);
});

test('detectVaultLayout and openLegacyAssembly do not write git', async () => {
  const { gh, repo } = await seedGearboxVault();
  const writesBefore = commits(gh).length;
  await detectVaultLayout(gh, repo, 'main');
  await openLegacyAssembly(gh, repo, 'Gearbox', { ...openOpts });
  assert.equal(commits(gh).length, writesBefore);
});

test('switchVaultBranch can open a v1 tree through the legacy reader', async () => {
  const { gh, repo } = await seedGearboxVault();
  const writesBefore = commits(gh).length;
  const opened = await switchVaultBranch(gh, repo, 'Gearbox', 'main', {
    openAssembly: (adapter, dest, name, opts) => openLegacyAssembly(adapter, dest, name, {
      ...openOpts,
      ...opts,
    }),
  });
  assert.equal(commits(gh).length, writesBefore);
  assert.equal(opened.vaultLayout, 'legacy');
  assert.equal(opened.doc.vaultLayout, 'legacy');
  assert.equal(opened.doc.parts.find((part) => part.name === 'Shaft')?.id, SHAFT_ID);
  assert.equal(opened.doc.parts.find((part) => part.missing)?.id, MISSING_ID);
});

test('detectVaultLayout treats a v2 id-named tree as v2', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const partId = mintSurfId({ now: NOW, rand: 'ab01' });
  const assemblyId = mintSurfId({ now: NOW, rand: 'ab02' });
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'v2 layout',
    baseSha: vault.headSha,
    files: [
      fileWrite('surfcad.json', `${JSON.stringify({ kind: 'surfcad-vault', version: 2 }, null, 2)}\n`),
      fileWrite(`assemblies/${assemblyId}.surf.json`, '{}'),
      fileWrite(`parts/${partId}.js`, `// @surf-id ${partId}\nreturn 1;\n`),
    ],
  });
  const detected = await detectVaultLayout(gh, vault.repo, 'main');
  assert.equal(detected.layout, 'v2');
  assert.equal(detected.markerVersion, 2);
});
