/**
 * save-model v2 PR 4: Upgrade vault. Mock GitHub only — no network.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { createSyncStore } from '../src/utils/git/syncStore.js';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import {
  mintSurfId,
  withSurfId,
  readSurfId,
  readSurfName,
} from '../src/utils/git/surfId.js';
import { validateSurfJson } from '../src/utils/git/surfJson.js';
import { assemblyIdPath, partIdPath, partMeshIdPath } from '../src/utils/git/idPaths.js';
import { parseBranchTip, parseAssemblyCommit } from '../src/utils/git/lastCommit.js';
import { validateSurfJsonV2 } from '../src/utils/git/surfJsonV2.js';
import {
  detectVaultLayout,
  executeUpgrade,
  executeUpgradeConflictChoice,
  knownReadmeSeedFor,
  planUpgrade,
  planWorkingCopyFollowup,
  mapWorkingCopyToPlan,
  applyUpgradeReload,
  isKnownReadmeSeed,
  SURFCAD_JSON_V2,
} from '../src/utils/git/legacyVault/index.js';
import { upgradeVaultEnabled, UPGRADE_UNAVAILABLE } from '../src/utils/git/upgradeVaultEnabled.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-10-18T12:00:00.000Z');
const SHAFT_ID = mintSurfId({ now: new Date('2026-10-18T00:00:00.000Z'), rand: 'aaaa' });
const LID_ID = mintSurfId({ now: new Date('2026-10-18T00:00:01.000Z'), rand: 'bbbb' });
const BRACKET_ID = mintSurfId({ now: new Date('2026-10-18T00:00:02.000Z'), rand: 'cccc' });
const PLATE_ID = mintSurfId({ now: new Date('2026-10-18T00:00:03.000Z'), rand: 'dddd' });
const GROUP_ID = mintSurfId({ now: new Date('2026-10-18T00:00:04.000Z'), rand: 'eeee' });
const MISSING_ID = mintSurfId({ now: NOW, rand: 'ffff' });
const BLANK_ID = mintSurfId({ now: NOW, rand: 'b1a0' });
const GEARBOX_ID = mintSurfId({ now: NOW, rand: '0001' });
const COVER_ID = mintSurfId({ now: NOW, rand: '0002' });
const PIN_ID = mintSurfId({ now: new Date('2026-10-18T03:00:00.000Z'), rand: 'p1n0' });
const COPY_ID = mintSurfId({ now: new Date('2026-10-18T03:00:01.000Z'), rand: 'c0c0' });
const BOX_ID = mintSurfId({ now: NOW, rand: 'b0x1' });
const DUP_COPY_ID = mintSurfId({ now: NOW, rand: 'd0d0' });

const SHAFT_PATH = 'parts/Shaft.js';
const BRACKET_PATH = 'parts/Bracket.js';
const LID_PATH = 'assemblies/Gearbox/Lid.js';
const PLATE_PATH = 'assemblies/Cover/parts/Plate.js';
const MISSING_PATH = 'parts/MissingGear.js';
const BLANK_PATH = 'parts/Blank.js';
const PIN_PATH = 'parts/Pin.js';
const PIN_COPY_PATH = 'assemblies/Box/PinCopy.js';
const SHAFT_MESH = Uint8Array.from([7, 7, 7, 9]);

function v1Surf(name, parts, extra = {}) {
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name,
    activeId: extra.activeId || parts[0].path,
    parts: parts.map((part, order) => ({
      ...(part.id ? { id: part.id } : {}),
      ...(part.copiedFrom ? { copiedFrom: part.copiedFrom } : {}),
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

function randFor(part) {
  const path = part?.path || part?.id;
  if (path === MISSING_PATH) return 'ffff';
  if (path === BLANK_PATH) return 'b1a0';
  if (path === PIN_COPY_PATH) return 'd0d0';
  if (part?.id === '$assembly') {
    if (part.name === 'Cover') return '0002';
    if (part.name === 'Gearbox') return '0001';
    if (part.name === 'Box') return 'b0x1';
    return 'aa00';
  }
  if (part?.id === '$group') return 'eeee';
  return '9999';
}

async function seedGearboxVault({ readme, extraFiles = [] } = {}) {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const gearbox = v1Surf('Gearbox', [
    { id: SHAFT_ID, path: SHAFT_PATH, name: 'Shaft' },
    { path: LID_PATH, name: 'Lid' },
    { path: MISSING_PATH, name: 'Missing gear' },
    { id: BRACKET_ID, path: BRACKET_PATH, name: 'Bracket' },
    { path: BLANK_PATH, name: 'Blank' },
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
  const files = [
    fileWrite('assemblies/Gearbox/.surf.json', gearbox),
    fileWrite('assemblies/Cover/.surf.json', cover),
    fileWrite(SHAFT_PATH, withSurfId('return Manifold.cylinder(40, 6, 6, 24, true);\n', SHAFT_ID)),
    fileWrite(LID_PATH, withSurfId('return Manifold.cylinder(2, 20, 20, 32, true);\n', LID_ID)),
    fileWrite(BRACKET_PATH, withSurfId('return Manifold.cube([20, 12, 4], true);\n', BRACKET_ID)),
    fileWrite(PLATE_PATH, withSurfId('return Manifold.cube([30, 30, 2], true);\n', PLATE_ID)),
    fileWrite(BLANK_PATH, 'return Manifold.cube([1, 1, 1], true);\n'),
    fileWrite('parts/Shaft.mesh', SHAFT_MESH),
    ...extraFiles,
  ];
  if (typeof readme === 'string') files.push(fileWrite('README.md', readme));
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed gearbox v1',
    baseSha: vault.headSha,
    files,
  });
  return { gh, repo: vault.repo, headSha: (await gh.getBranch(vault.repo, 'main')).sha };
}

async function storeFor(repo, ids = { Gearbox: GEARBOX_ID, Cover: COVER_ID }) {
  const store = createSyncStore({ persist: false });
  await store.ready();
  for (const [folder, id] of Object.entries(ids)) {
    await store.rememberAssemblyId(repo, folder, id);
  }
  return store;
}

async function treePaths(adapter, repo, ref = 'main') {
  const tree = await adapter.listTree(repo, ref);
  return (tree || []).map((row) => row.path).sort();
}

async function readText(adapter, repo, path, ref = 'main') {
  const got = await adapter.readFile(repo, path, ref);
  return got?.content ?? null;
}

function upgradeOpts(gh, repo, extra = {}) {
  return {
    adapter: gh,
    repo,
    branch: 'main',
    now: NOW,
    randFor,
    ...extra,
  };
}

test('Gearbox-style v1 fixture upgrades to the exact v2 tree with deletes', async () => {
  const { gh, repo } = await seedGearboxVault();
  const store = await storeFor(repo);
  const writesBefore = commits(gh).length;
  const createdBefore = gh._log.filter((row) => row.op === 'createRepo').length;

  const result = await executeUpgrade(upgradeOpts(gh, repo, { store }));
  assert.equal(result.status, 'upgraded');
  assert.equal(result.commits, 1);
  assert.equal(result.plan.readmeDeleted, true);
  assert.equal(commits(gh).length, writesBefore + 1);
  assert.equal(gh._log.filter((row) => row.op === 'createRepo').length, createdBefore);

  const detected = await detectVaultLayout(gh, repo, 'main');
  assert.equal(detected.layout, 'v2');
  assert.equal(detected.markerVersion, 2);

  const paths = await treePaths(gh, repo);
  assert.deepEqual(paths, [
    assemblyIdPath(COVER_ID),
    assemblyIdPath(GEARBOX_ID),
    partIdPath(BLANK_ID),
    partIdPath(BRACKET_ID),
    partIdPath(LID_ID),
    partIdPath(PLATE_ID),
    partIdPath(SHAFT_ID),
    partMeshIdPath(SHAFT_ID),
    'surfcad.json',
  ].sort());

  assert.equal(await readText(gh, repo, 'surfcad.json'), SURFCAD_JSON_V2);
  for (const gone of [
    'README.md',
    'assemblies/.gitkeep',
    'parts/.gitkeep',
    'assemblies/Gearbox/.surf.json',
    'assemblies/Gearbox/Lid.js',
    'assemblies/Cover/.surf.json',
    'assemblies/Cover/parts/Plate.js',
    SHAFT_PATH,
    BRACKET_PATH,
    BLANK_PATH,
    'parts/Shaft.mesh',
  ]) {
    assert.equal(paths.includes(gone), false, `legacy path ${gone} must be deleted`);
  }

  const gearbox = JSON.parse(await readText(gh, repo, assemblyIdPath(GEARBOX_ID)));
  const cover = JSON.parse(await readText(gh, repo, assemblyIdPath(COVER_ID)));
  assert.equal(validateSurfJsonV2(gearbox).ok, true, validateSurfJsonV2(gearbox).errors?.join('; '));
  assert.equal(validateSurfJsonV2(cover).ok, true, validateSurfJsonV2(cover).errors?.join('; '));
  assert.equal(gearbox.id, GEARBOX_ID);
  assert.equal(gearbox.name, 'Gearbox');
  assert.equal(gearbox.activeId, SHAFT_ID);
  assert.equal(gearbox.parts.some((p) => Object.hasOwn(p, 'path')), false);
  const byName = Object.fromEntries(gearbox.parts.map((p) => [p.name, p]));
  assert.equal(byName.Shaft.id, SHAFT_ID);
  assert.equal(byName.Lid.id, LID_ID);
  assert.equal(byName.Bracket.id, BRACKET_ID);
  assert.equal(byName['Missing gear'].id, MISSING_ID);
  assert.equal(byName.Blank.id, BLANK_ID);
  assert.equal(paths.includes(partIdPath(MISSING_ID)), false, 'missing blob is a row, not a file');
  assert.equal(gearbox.groups[0].source, COVER_ID);
  assert.deepEqual(gearbox.groups[0].partIds, [SHAFT_ID]);
  assert.equal(gearbox.groups[0].id, GROUP_ID);

  const coverShaft = cover.parts.find((p) => p.name === 'Shaft');
  assert.equal(coverShaft.id, SHAFT_ID, 'shared Shaft keeps the same id in both assemblies');
  assert.equal(cover.parts.find((p) => p.name === 'Plate').id, PLATE_ID);

  const ids = [...gearbox.parts, ...cover.parts].map((p) => p.id);
  assert.equal(new Set(ids).size, new Set([...ids]).size);

  assert.equal(readSurfId(await readText(gh, repo, partIdPath(SHAFT_ID))), SHAFT_ID);
  assert.equal(readSurfName(await readText(gh, repo, partIdPath(SHAFT_ID))), 'Shaft');
  assert.equal(readSurfId(await readText(gh, repo, partIdPath(LID_ID))), LID_ID);
  assert.equal(readSurfName(await readText(gh, repo, partIdPath(LID_ID))), 'Lid');
  assert.equal(readSurfId(await readText(gh, repo, partIdPath(BLANK_ID))), BLANK_ID);
  assert.equal(readSurfName(await readText(gh, repo, partIdPath(BLANK_ID))), 'Blank');

  const mesh = await gh.readFile(repo, partMeshIdPath(SHAFT_ID), 'main');
  assert.ok(mesh.content instanceof Uint8Array);
  assert.deepEqual([...mesh.content], [...SHAFT_MESH]);

  const tip = parseBranchTip(store.getBranchTip(repo, 'main'));
  assert.equal(tip?.tipSha, result.sha);
  const gearboxCommit = parseAssemblyCommit(store.getAssemblyCommit(repo, 'main', GEARBOX_ID));
  const coverCommit = parseAssemblyCommit(store.getAssemblyCommit(repo, 'main', COVER_ID));
  assert.ok(gearboxCommit);
  assert.ok(coverCommit);
  assert.equal(gearboxCommit.assemblyId, GEARBOX_ID);
  assert.equal(coverCommit.assemblyId, COVER_ID);
});

test('header ids are kept and missing ones are minted', async () => {
  const { gh, repo } = await seedGearboxVault();
  const plan = planUpgrade({
    tree: await gh.listTree(repo, 'main'),
    files: Object.fromEntries(await Promise.all(
      (await gh.listTree(repo, 'main')).map(async (entry) => {
        const got = await gh.readFile(repo, entry.path, 'main');
        return [entry.path, got.content];
      }),
    )),
    assemblyIdByFolder: { Gearbox: GEARBOX_ID, Cover: COVER_ID },
    now: NOW,
    randFor,
  });
  const gearbox = JSON.parse(plan.writes[assemblyIdPath(GEARBOX_ID)]);
  const byName = Object.fromEntries(gearbox.parts.map((p) => [p.name, p]));
  assert.equal(byName.Lid.id, LID_ID, 'Lid has no row id; keep // @surf-id');
  assert.equal(byName.Shaft.id, SHAFT_ID);
  assert.equal(byName.Blank.id, BLANK_ID, 'no header and no row id → mint');
  assert.equal(byName['Missing gear'].id, MISSING_ID);
  assert.equal(plan.keptPartIds.includes(LID_ID), true);
  assert.equal(plan.mintedPartIds.includes(BLANK_ID), true);
  assert.equal(plan.mintedPartIds.includes(MISSING_ID), true);
  assert.equal(readSurfId(plan.writes[partIdPath(BLANK_ID)]), BLANK_ID);
});

test('README is deleted only when it matches a known old seed', async () => {
  assert.equal(typeof knownReadmeSeedFor('surfcad-vault'), 'string');
  const custom = await seedGearboxVault({ readme: '# my notes\n' });
  const result = await executeUpgrade(upgradeOpts(custom.gh, custom.repo, {
    store: await storeFor(custom.repo),
  }));
  assert.equal(result.status, 'upgraded');
  assert.equal(result.plan.readmeKept, true);
  assert.equal(result.plan.readmeDeleted, false);
  assert.equal(await readText(custom.gh, custom.repo, 'README.md'), '# my notes\n');
});

test('second Upgrade is already_upgraded and writes nothing', async () => {
  const { gh, repo } = await seedGearboxVault();
  const store = await storeFor(repo);
  const first = await executeUpgrade(upgradeOpts(gh, repo, { store }));
  assert.equal(first.status, 'upgraded');
  const writes = commits(gh).length;
  const second = await executeUpgrade(upgradeOpts(gh, repo, { store }));
  assert.equal(second.status, 'already_upgraded');
  assert.equal(second.layout, 'v2');
  assert.equal(commits(gh).length, writes);
});

test('partial failure does not adopt v2 lastCommit and retry is idempotent', async () => {
  const { gh, repo } = await seedGearboxVault();
  const store = await storeFor(repo);
  const orig = gh.commitFiles.bind(gh);
  gh.commitFiles = async () => {
    throw new Error('boom');
  };
  const failed = await executeUpgrade(upgradeOpts(gh, repo, { store }));
  assert.equal(failed.status, 'error');
  assert.equal(failed.code, 'git_error');
  assert.equal((await detectVaultLayout(gh, repo, 'main')).layout, 'legacy');
  assert.equal(parseBranchTip(store.getBranchTip(repo, 'main')), null);
  assert.equal(parseAssemblyCommit(store.getAssemblyCommit(repo, 'main', GEARBOX_ID)), null);
  assert.equal(store.assemblyIdFor(repo, 'Gearbox'), GEARBOX_ID);

  gh.commitFiles = orig;
  const retried = await executeUpgrade(upgradeOpts(gh, repo, { store }));
  assert.equal(retried.status, 'upgraded');
  assert.equal((await detectVaultLayout(gh, repo, 'main')).layout, 'v2');
  const gearbox = JSON.parse(await readText(gh, repo, assemblyIdPath(GEARBOX_ID)));
  assert.equal(gearbox.id, GEARBOX_ID);
});

test('tip moved since the plan does not write Upgrade or lastCommit', async () => {
  const { gh, repo } = await seedGearboxVault();
  const store = await storeFor(repo);
  const orig = gh.commitFiles.bind(gh);
  gh.commitFiles = async (dest, opts) => {
    const head = (await gh.getBranch(dest, 'main')).sha;
    await orig(dest, {
      branch: 'main',
      message: 'race',
      files: [fileWrite('note.txt', 'x')],
      baseSha: head,
    });
    return orig(dest, opts);
  };
  const out = await executeUpgrade(upgradeOpts(gh, repo, { store }));
  assert.equal(out.status, 'conflict');
  assert.equal(out.code, 'conflict');
  assert.equal(out.phase, 'upgrade');
  assert.equal((await detectVaultLayout(gh, repo, 'main')).layout, 'legacy');
  assert.equal(parseBranchTip(store.getBranchTip(repo, 'main')), null);
  assert.equal(await readText(gh, repo, 'note.txt'), 'x');
});

test('clean working copy is one commit; dirty working copy is two', async () => {
  const clean = await seedGearboxVault();
  const cleanStore = await storeFor(clean.repo);
  const cleanWrites = commits(clean.gh).length;
  const cleanOut = await executeUpgrade(upgradeOpts(clean.gh, clean.repo, { store: cleanStore }));
  assert.equal(cleanOut.status, 'upgraded');
  assert.equal(cleanOut.commits, 1);
  assert.equal(commits(clean.gh).length, cleanWrites + 1);

  const dirty = await seedGearboxVault();
  const dirtyStore = await storeFor(dirty.repo);
  const snapshots = [];
  const orig = dirty.gh.commitFiles.bind(dirty.gh);
  dirty.gh.commitFiles = async (dest, opts) => {
    snapshots.push({
      message: opts.message,
      files: (opts.files || []).map((f) => ({
        path: f.path,
        delete: !!f.delete,
        content: typeof f.content === 'string' ? f.content : f.content,
      })),
    });
    return orig(dest, opts);
  };
  const dirtyScript = withSurfId('return "dirty-shaft";\n', SHAFT_ID);
  const out = await executeUpgrade(upgradeOpts(dirty.gh, dirty.repo, {
    store: dirtyStore,
    workingCopy: {
      dirty: true,
      message: 'Save after vault upgrade',
      doc: {
        id: GEARBOX_ID,
        name: 'Gearbox',
        activeId: SHAFT_ID,
        parts: [
          { id: SHAFT_ID, name: 'Shaft', visible: true, order: 0, path: SHAFT_PATH },
          { id: LID_ID, name: 'Lid', visible: true, order: 1, path: LID_PATH },
          { id: MISSING_ID, name: 'Missing gear', visible: true, order: 2, path: MISSING_PATH },
          { id: BRACKET_ID, name: 'Bracket', visible: true, order: 3, path: BRACKET_PATH },
          { id: BLANK_ID, name: 'Blank', visible: true, order: 4, path: BLANK_PATH },
        ],
      },
      scripts: { [SHAFT_ID]: dirtyScript },
    },
  }));
  assert.equal(out.status, 'upgraded_and_saved');
  assert.equal(out.commits, 2);
  assert.equal(snapshots.length, 2);
  const firstShaft = snapshots[0].files.find((f) => f.path === partIdPath(SHAFT_ID))?.content;
  const secondShaft = snapshots[1].files.find((f) => f.path === partIdPath(SHAFT_ID))?.content;
  assert.match(String(firstShaft), /cylinder/);
  assert.equal(String(firstShaft).includes('dirty-shaft'), false, 'commit 1 is remote bytes only');
  assert.match(String(secondShaft), /dirty-shaft/);
  assert.equal(readSurfId(await readText(dirty.gh, dirty.repo, partIdPath(SHAFT_ID))), SHAFT_ID);
  const followupPaths = snapshots[1].files.filter((f) => !f.delete).map((f) => f.path).sort();
  assert.deepEqual(followupPaths, [partIdPath(SHAFT_ID)]);
  const gearboxAfter = JSON.parse(await readText(dirty.gh, dirty.repo, assemblyIdPath(GEARBOX_ID)));
  assert.equal(gearboxAfter.groups[0].id, GROUP_ID, 'commit 2 keeps groups from the Upgrade commit');
  assert.equal(await readText(dirty.gh, dirty.repo, partIdPath(LID_ID)).then((t) => t.includes('dirty-shaft')), false);
});

test('copied PinCopy.js restamps a stale original header to the row id', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const json = v1Surf('Box', [
    { id: PIN_ID, path: PIN_PATH, name: 'Pin' },
    { id: COPY_ID, path: PIN_COPY_PATH, name: 'PinCopy' },
  ]);
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed stale copy header',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', json),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', PIN_ID)),
      fileWrite(PIN_COPY_PATH, withSurfId('return "pin-copy";\n', PIN_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const box = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BOX_ID)));
  assert.equal(validateSurfJsonV2(box).ok, true, validateSurfJsonV2(box).errors?.join('; '));
  const pin = box.parts.find((p) => p.name === 'Pin');
  const copy = box.parts.find((p) => p.name === 'PinCopy');
  assert.equal(pin.id, PIN_ID);
  assert.equal(copy.id, COPY_ID);
  assert.notEqual(pin.id, copy.id);
  assert.equal(readSurfId(await readText(gh, vault.repo, partIdPath(PIN_ID))), PIN_ID);
  assert.equal(readSurfId(await readText(gh, vault.repo, partIdPath(COPY_ID))), COPY_ID);
  assert.match(await readText(gh, vault.repo, partIdPath(COPY_ID)), /pin-copy/);
  assert.equal(readSurfName(await readText(gh, vault.repo, partIdPath(COPY_ID))), 'PinCopy');
});

test('duplicate ids in one v1 .surf.json mint a copy with copiedFrom', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: PIN_PATH,
    parts: [
      { id: PIN_ID, path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
      { id: PIN_ID, path: PIN_COPY_PATH, name: 'PinCopy', visible: true, order: 1 },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed duplicate ids',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', PIN_ID)),
      fileWrite(PIN_COPY_PATH, withSurfId('return "pin-copy";\n', PIN_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const box = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BOX_ID)));
  assert.equal(validateSurfJsonV2(box).ok, true, validateSurfJsonV2(box).errors?.join('; '));
  const pin = box.parts.find((p) => p.name === 'Pin');
  const copy = box.parts.find((p) => p.name === 'PinCopy');
  assert.equal(pin.id, PIN_ID);
  assert.equal(copy.id, DUP_COPY_ID);
  assert.equal(copy.copiedFrom, PIN_ID);
  assert.equal(pin.copiedFrom, undefined);
  assert.equal(new Set(box.parts.map((p) => p.id)).size, 2);
  assert.equal(readSurfId(await readText(gh, vault.repo, partIdPath(PIN_ID))), PIN_ID);
  assert.equal(readSurfId(await readText(gh, vault.repo, partIdPath(DUP_COPY_ID))), DUP_COPY_ID);
  assert.equal(box.activeId, PIN_ID);
});

test('planWorkingCopyFollowup is empty when the WC is clean', () => {
  const plan = { writes: { [assemblyIdPath(GEARBOX_ID)]: 'x' }, folderToId: {} };
  assert.deepEqual(planWorkingCopyFollowup(plan, { dirty: false, doc: { id: GEARBOX_ID } }), []);
  assert.deepEqual(planWorkingCopyFollowup(plan, null), []);
});

test('planWorkingCopyFollowup keeps an explicit empty groups list', () => {
  const prev = {
    version: 2,
    id: GEARBOX_ID,
    name: 'Gearbox',
    parts: [{ id: SHAFT_ID, name: 'Shaft', visible: true, order: 0 }],
    groups: [{ id: GROUP_ID, name: 'Hardware', partIds: [SHAFT_ID] }],
  };
  const prevText = `${JSON.stringify(prev, null, 2)}\n`;
  const plan = {
    writes: {
      [assemblyIdPath(GEARBOX_ID)]: prevText,
      [partIdPath(SHAFT_ID)]: withSurfId('return 1;\n', SHAFT_ID),
    },
    folderToId: { Gearbox: GEARBOX_ID },
    partIdByPath: { [SHAFT_PATH]: SHAFT_ID },
    keptPartIds: [SHAFT_ID],
  };
  const files = planWorkingCopyFollowup(plan, {
    dirty: true,
    doc: {
      id: GEARBOX_ID,
      name: 'Gearbox',
      activeId: SHAFT_ID,
      parts: [{ id: SHAFT_ID, name: 'Shaft', visible: true, order: 0 }],
      groups: [],
    },
    scripts: { [SHAFT_ID]: withSurfId('return 1;\n', SHAFT_ID) },
  });
  const jsonFile = files.find((f) => f.path === assemblyIdPath(GEARBOX_ID));
  assert.ok(jsonFile, 'empty groups must still rewrite the assembly vs the plan');
  const parsed = JSON.parse(jsonFile.content);
  assert.equal((parsed.groups || []).length, 0);
  assert.equal((parsed.groups || []).some((g) => g.id === GROUP_ID), false);
});

test('Save on a legacy vault prompts Upgrade and does not write v1', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const feed = readFileSync(join(ROOT, 'src/components/PartFeed.jsx'), 'utf8');

  const startCommit = feed.slice(
    feed.indexOf('const startCommit'),
    feed.indexOf('const runNewAssembly'),
  );
  assert.match(startCommit, /vaultLayout === 'legacy' && upgradeAvailable/);
  assert.match(startCommit, /stage: 'upgrade'/);
  assert.equal(/onGitCommit/.test(startCommit), false);

  const gitCommit = app.slice(
    app.indexOf('const handleGitCommit'),
    app.indexOf('const handleUpgradeVault'),
  );
  const legacyGate = gitCommit.slice(
    gitCommit.indexOf("doc.vaultLayout === 'legacy'"),
    gitCommit.indexOf("doc.vaultLayout === 'v2'"),
  );
  assert.match(legacyGate, /upgradeVaultEnabled\(\)/);
  assert.match(legacyGate, /upgrade_required/);
  assert.match(legacyGate, /git_upgrade_vault \{ confirm: true \}/);
  assert.equal(/ensureGitVault/.test(legacyGate), false);
  assert.equal(/assembleCommitFiles/.test(legacyGate), false);

  assert.match(feed, /data-git-upgrade-confirm=""/);
  assert.match(feed, /data-git-upgrade-dismiss=""/);
  assert.match(feed, /upgradeAvailable/);
  const promptAt = feed.indexOf('data-git-upgrade-prompt');
  assert.ok(promptAt >= 0);
  const prompt = feed.slice(promptAt, promptAt + 1600);
  assert.match(prompt, /not available in this build/);
  assert.equal(/Open SurfCAD in Chrome to confirm/.test(feed), false);
  assert.equal(/Older SurfCAD builds cannot open a v2 vault/.test(feed), false);
  assert.equal(/Edge/.test(prompt), false);
  assert.match(feed, /text-on-dark/);
  const overwriteAt = feed.indexOf("void runUpgradeConflict('overwrite')");
  assert.ok(overwriteAt > 0);
  const overwriteBtn = feed.slice(overwriteAt - 400, overwriteAt);
  assert.match(overwriteBtn, /data-git-conflict-overwrite/);
  assert.match(overwriteBtn, /surface-quiet/);
  assert.equal(/surface-success/.test(overwriteBtn), false);
  assert.match(feed, /Other local edits stay in the working copy/);
  assert.match(feed, /Nothing was written to git/);
  assert.match(feed, /switched the working copy/);
  const runConflict = feed.slice(
    feed.indexOf('const runUpgradeConflict'),
    feed.indexOf('const runCommit'),
  );
  assert.match(runConflict, /paths: prior\?\.paths/);

  const open = app.slice(
    app.indexOf('const handleOpenVaultAssembly'),
    app.indexOf('openVaultAssemblyRef.current'),
  );
  assert.equal(/executeUpgrade\(\{/.test(open), false);
});

test('PinCopy stale WC header does not write PinCopy script into Pin on commit 2', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const json = v1Surf('Box', [
    { id: PIN_ID, path: PIN_PATH, name: 'Pin' },
    { id: COPY_ID, path: PIN_COPY_PATH, name: 'PinCopy' },
    { id: SHAFT_ID, path: SHAFT_PATH, name: 'Shaft' },
  ]);
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed pin copy + shaft',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', json),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', PIN_ID)),
      fileWrite(PIN_COPY_PATH, withSurfId('return "pin-copy";\n', PIN_ID)),
      fileWrite(SHAFT_PATH, withSurfId('return Manifold.cylinder(40, 6, 6, 24, true);\n', SHAFT_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const snapshots = [];
  const orig = gh.commitFiles.bind(gh);
  gh.commitFiles = async (dest, opts) => {
    snapshots.push({
      message: opts.message,
      files: (opts.files || []).map((f) => ({
        path: f.path,
        delete: !!f.delete,
        content: typeof f.content === 'string' ? f.content : f.content,
      })),
    });
    return orig(dest, opts);
  };
  const stolenHeaderScript = withSurfId('return "pin-copy";\n', PIN_ID);
  const dirtyShaft = withSurfId('return "dirty-shaft";\n', SHAFT_ID);
  const pinWcId = mintSurfId({ now: NOW, rand: 'wcpn' });
  const out = await executeUpgrade(upgradeOpts(gh, vault.repo, {
    store,
    workingCopy: {
      dirty: true,
      doc: {
        id: BOX_ID,
        name: 'Box',
        activeId: pinWcId,
        parts: [
          { id: pinWcId, path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
          { id: PIN_ID, path: PIN_COPY_PATH, name: 'PinCopy', visible: true, order: 1 },
          { id: SHAFT_ID, path: SHAFT_PATH, name: 'Shaft', visible: true, order: 2 },
        ],
      },
      scripts: {
        [PIN_ID]: stolenHeaderScript,
        [pinWcId]: withSurfId('return "pin";\n', pinWcId),
        [SHAFT_ID]: dirtyShaft,
      },
    },
  }));
  assert.equal(out.status, 'upgraded_and_saved');
  assert.equal(out.commits, 2);
  assert.equal(snapshots.length, 2);
  const firstPin = snapshots[0].files.find((f) => f.path === partIdPath(PIN_ID))?.content;
  const second = snapshots[1].files.filter((f) => !f.delete);
  assert.match(String(firstPin), /return "pin"/);
  assert.equal(String(firstPin).includes('pin-copy'), false);
  assert.equal(second.some((f) => f.path === partIdPath(PIN_ID)), false, 'commit 2 must not rewrite Pin');
  const secondCopy = second.find((f) => f.path === partIdPath(COPY_ID));
  assert.equal(secondCopy, undefined, 'untouched PinCopy bytes are not rewritten');
  const secondShaft = second.find((f) => f.path === partIdPath(SHAFT_ID));
  assert.match(String(secondShaft?.content), /dirty-shaft/);
  assert.match(await readText(gh, vault.repo, partIdPath(PIN_ID)), /return "pin"/);
  assert.equal((await readText(gh, vault.repo, partIdPath(PIN_ID))).includes('pin-copy'), false);
  assert.match(await readText(gh, vault.repo, partIdPath(COPY_ID)), /pin-copy/);
  assert.equal(readSurfId(await readText(gh, vault.repo, partIdPath(COPY_ID))), COPY_ID);
  assert.equal(out.rekey.pairs.some((row) => row.from === PIN_ID && row.to === COPY_ID), true);
});

test('a WC part with no legacy path is added on commit 2', async () => {
  const { gh, repo } = await seedGearboxVault();
  const store = await storeFor(repo);
  const addedId = mintSurfId({ now: NOW, rand: 'add0' });
  const snapshots = [];
  const orig = gh.commitFiles.bind(gh);
  gh.commitFiles = async (dest, opts) => {
    snapshots.push({
      message: opts.message,
      files: (opts.files || []).map((f) => ({ path: f.path, delete: !!f.delete, content: f.content })),
    });
    return orig(dest, opts);
  };
  const out = await executeUpgrade(upgradeOpts(gh, repo, {
    store,
    workingCopy: {
      dirty: true,
      doc: {
        id: GEARBOX_ID,
        name: 'Gearbox',
        activeId: SHAFT_ID,
        parts: [
          { id: SHAFT_ID, path: SHAFT_PATH, name: 'Shaft', visible: true, order: 0 },
          { id: addedId, name: 'New', visible: true, order: 1 },
        ],
      },
      scripts: {
        [SHAFT_ID]: withSurfId('return Manifold.cylinder(40, 6, 6, 24, true);\n', SHAFT_ID),
        [addedId]: withSurfId('return "new-part";\n', addedId),
      },
    },
  }));
  assert.equal(out.status, 'upgraded_and_saved');
  assert.equal(out.commits, 2);
  assert.equal(snapshots.length, 2);
  const second = snapshots[1].files.filter((f) => !f.delete);
  const addedFile = second.find((f) => f.path === partIdPath(addedId));
  assert.match(String(addedFile?.content), /new-part/);
  const jsonFile = second.find((f) => f.path === assemblyIdPath(GEARBOX_ID));
  assert.ok(jsonFile, 'commit 2 writes the assembly so the new part is listed');
  const json = JSON.parse(jsonFile.content);
  assert.equal(json.parts.some((part) => part.id === addedId && part.name === 'New'), true);
  assert.match(await readText(gh, repo, partIdPath(addedId)), /new-part/);
});

test('follow-up is refused when two WC rows map to the same plan id', async () => {
  const { gh, repo } = await seedGearboxVault();
  const store = await storeFor(repo);
  const writesBefore = commits(gh).length;
  const out = await executeUpgrade(upgradeOpts(gh, repo, {
    store,
    workingCopy: {
      dirty: true,
      doc: {
        id: GEARBOX_ID,
        name: 'Gearbox',
        parts: [
          { id: SHAFT_ID, path: SHAFT_PATH, name: 'Shaft', visible: true, order: 0 },
          { id: LID_ID, path: SHAFT_PATH, name: 'AlsoShaft', visible: true, order: 1 },
        ],
      },
      scripts: {
        [SHAFT_ID]: withSurfId('return "a";\n', SHAFT_ID),
        [LID_ID]: withSurfId('return "b";\n', LID_ID),
      },
    },
  }));
  assert.equal(out.status, 'error');
  assert.equal(out.code, 'working_copy_unmapped');
  assert.match(out.message, /same upgraded id/);
  assert.equal(out.commits, 1);
  assert.equal(out.sha, out.upgradeSha);
  assert.equal(commits(gh).length, writesBefore + 1);
  assert.equal((await detectVaultLayout(gh, repo, 'main')).layout, 'v2');
});

test('unparseable legacy .surf.json aborts the whole upgrade', async () => {
  const { gh, repo } = await seedGearboxVault({
    extraFiles: [fileWrite('assemblies/Broken/.surf.json', '{ not json')],
  });
  const store = await storeFor(repo, { Gearbox: GEARBOX_ID, Cover: COVER_ID });
  const writes = commits(gh).length;
  const out = await executeUpgrade(upgradeOpts(gh, repo, { store }));
  assert.equal(out.status, 'error');
  assert.equal(out.code, 'unreadable_legacy_json');
  assert.match(out.message, /assemblies\/Broken\/\.surf\.json/);
  assert.equal(commits(gh).length, writes);
  assert.equal((await detectVaultLayout(gh, repo, 'main')).layout, 'legacy');
  assert.equal(await readText(gh, repo, 'assemblies/Broken/.surf.json'), '{ not json');
});

test('reads blobs by sha so a 1 MB file is copied; empty files stay empty', async () => {
  const big = `return ${'x'.repeat(1024 * 1024)};\n`;
  const emptyId = mintSurfId({ now: NOW, rand: 'emp0' });
  const bigId = mintSurfId({ now: NOW, rand: 'big0' });
  const { gh, repo } = await seedGearboxVault({
    extraFiles: [
      fileWrite('parts/Empty.js', ''),
      fileWrite('parts/Huge.js', withSurfId(big, bigId)),
    ],
  });
  const origReadFile = gh.readFile.bind(gh);
  gh.readFile = async (dest, path, ref) => {
    const got = await origReadFile(dest, path, ref);
    if (got && typeof got.content === 'string' && got.content.length > 1024 * 1024) {
      return { ...got, content: '' };
    }
    return got;
  };
  const store = await storeFor(repo);
  const tree = await gh.listTree(repo, 'main');
  const files = {};
  for (const entry of tree) {
    const got = await origReadFile(repo, entry.path, 'main');
    files[entry.path] = got.content;
  }
  const plan = planUpgrade({
    tree,
    files,
    assemblyIdByFolder: { Gearbox: GEARBOX_ID, Cover: COVER_ID },
    now: NOW,
    randFor: (part) => {
      if (part?.path === 'parts/Empty.js') return 'emp0';
      if (part?.path === 'parts/Huge.js') return 'big0';
      return randFor(part);
    },
  });
  assert.equal(plan.writes[partIdPath(emptyId)], '');
  assert.equal(typeof plan.writes[partIdPath(bigId)], 'string');
  assert.ok(plan.writes[partIdPath(bigId)].length > 1024 * 1024);

  const result = await executeUpgrade(upgradeOpts(gh, repo, {
    store,
    randFor: (part) => {
      if (part?.path === 'parts/Empty.js') return 'emp0';
      if (part?.path === 'parts/Huge.js') return 'big0';
      return randFor(part);
    },
  }));
  assert.equal(result.status, 'upgraded');
  gh.readFile = origReadFile;
  assert.equal(await readText(gh, repo, partIdPath(emptyId)), '');
  const huge = await readText(gh, repo, partIdPath(bigId));
  assert.ok(huge.length > 1024 * 1024);
  assert.match(huge, /return x/);
  assert.equal(readSurfId(huge), bigId);
});

test('a failed blob read aborts upgrade and writes nothing', async () => {
  const { gh, repo } = await seedGearboxVault();
  const store = await storeFor(repo);
  const writes = commits(gh).length;
  gh.readBlob = async () => null;
  const out = await executeUpgrade(upgradeOpts(gh, repo, { store }));
  assert.equal(out.status, 'error');
  assert.equal(out.code, 'git_error');
  assert.match(out.message, /Could not read vault file/);
  assert.equal(commits(gh).length, writes);
  assert.equal((await detectVaultLayout(gh, repo, 'main')).layout, 'legacy');
});

test('non-SurfCAD files under assemblies/<Name>/ are kept and listed', async () => {
  const { gh, repo } = await seedGearboxVault({
    extraFiles: [
      fileWrite('assemblies/Gearbox/notes.txt', 'keep me\n'),
      fileWrite('assemblies/Gearbox/photo.png', 'png-bytes'),
    ],
  });
  const store = await storeFor(repo);
  const result = await executeUpgrade(upgradeOpts(gh, repo, { store }));
  assert.equal(result.status, 'upgraded');
  assert.deepEqual(result.leftoverFiles, [
    'assemblies/Gearbox/notes.txt',
    'assemblies/Gearbox/photo.png',
  ]);
  assert.equal(await readText(gh, repo, 'assemblies/Gearbox/notes.txt'), 'keep me\n');
  assert.equal(await readText(gh, repo, 'assemblies/Gearbox/photo.png'), 'png-bytes');
  const paths = await treePaths(gh, repo);
  assert.equal(paths.includes('assemblies/Gearbox/.surf.json'), false);
  assert.equal(paths.includes('assemblies/Gearbox/Lid.js'), false);
});

test('historical README seeds from vaultSeedFiles are deleted', () => {
  assert.equal(isKnownReadmeSeed(knownReadmeSeedFor('surfcad-vault'), 'surfcad-vault'), true);
  assert.equal(isKnownReadmeSeed(
    '# surfcad\n\nSurfCAD vault.\n\n- `assemblies/<name>/<name>.surf.json` assembly, with its `parts/<part>.js`\n- `parts/<part>.js` shared parts, referenced by path\n',
    'surfcad',
  ), true);
  assert.equal(isKnownReadmeSeed(
    '# surfcad-vault\n\nSurfCAD vault.\n\n- `assemblies/<name>/.surf.json` assembly metadata; part scripts live in the same folder\n- `parts/<part>.js` shared parts, referenced by path\n',
    'surfcad-vault',
  ), true);
});

test('Get latest after a commit-2 conflict keeps a non-conflicting Pin edit', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const json = v1Surf('Box', [
    { id: PIN_ID, path: PIN_PATH, name: 'Pin' },
    { id: SHAFT_ID, path: SHAFT_PATH, name: 'Shaft' },
  ]);
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed pin + shaft',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', json),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', PIN_ID)),
      fileWrite(SHAFT_PATH, withSurfId('return Manifold.cylinder(40, 6, 6, 24, true);\n', SHAFT_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const orig = gh.commitFiles.bind(gh);
  let upgrades = 0;
  gh.commitFiles = async (dest, opts) => {
    const committed = await orig(dest, opts);
    upgrades += 1;
    if (upgrades === 1) {
      await orig(dest, {
        branch: 'main',
        message: 'remote shaft',
        files: [fileWrite(partIdPath(SHAFT_ID), withSurfId('return "remote-shaft";\n', SHAFT_ID))],
        baseSha: committed.sha,
      });
    }
    return committed;
  };
  const localPin = withSurfId('return "local-pin";\n', PIN_ID);
  const localShaft = withSurfId('return "local-shaft";\n', SHAFT_ID);
  const conflicted = await executeUpgrade(upgradeOpts(gh, vault.repo, {
    store,
    workingCopy: {
      dirty: true,
      doc: {
        id: BOX_ID,
        name: 'Box',
        activeId: PIN_ID,
        parts: [
          { id: PIN_ID, path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
          { id: SHAFT_ID, path: SHAFT_PATH, name: 'Shaft', visible: true, order: 1 },
        ],
      },
      scripts: {
        [PIN_ID]: localPin,
        [SHAFT_ID]: localShaft,
      },
    },
  }));
  assert.equal(conflicted.status, 'conflict');
  assert.equal(conflicted.phase, 'save');
  assert.equal((conflicted.paths || []).includes(partIdPath(SHAFT_ID)), true);
  assert.equal((conflicted.paths || []).includes(partIdPath(PIN_ID)), false);
  assert.equal((conflicted.files || []).some((f) => f.path === partIdPath(PIN_ID)), true);

  const writes = commits(gh).length;
  const reloaded = await executeUpgradeConflictChoice({
    action: 'reload',
    adapter: gh,
    repo: vault.repo,
    files: conflicted.files,
    paths: conflicted.paths,
  });
  assert.equal(reloaded.status, 'reloaded');
  assert.equal(commits(gh).length, writes);
  assert.match(String(reloaded.contents[partIdPath(SHAFT_ID)]), /remote-shaft/);
  assert.equal(reloaded.contents[partIdPath(PIN_ID)], undefined);

  const applied = applyUpgradeReload(
    {
      id: BOX_ID,
      name: 'Box',
      source: 'git',
      vaultLayout: 'v2',
      activeId: PIN_ID,
      parts: [
        { id: PIN_ID, name: 'Pin', visible: true, order: 0 },
        { id: SHAFT_ID, name: 'Shaft', visible: true, order: 1 },
      ],
    },
    { [PIN_ID]: localPin, [SHAFT_ID]: localShaft },
    reloaded.contents,
  );
  assert.match(applied.scripts[PIN_ID], /local-pin/);
  assert.match(applied.scripts[SHAFT_ID], /remote-shaft/);
});

test('Get latest applies remote bytes and writes no git; branch starts from tipSha', async () => {
  const { gh, repo } = await seedGearboxVault();
  const store = await storeFor(repo);
  const upgraded = await executeUpgrade(upgradeOpts(gh, repo, { store }));
  const upgradeSha = upgraded.sha;
  const orig = gh.commitFiles.bind(gh);
  await orig(repo, {
    branch: 'main',
    message: 'remote edit',
    files: [fileWrite(partIdPath(SHAFT_ID), withSurfId('return "remote-shaft";\n', SHAFT_ID))],
    baseSha: upgradeSha,
  });
  const writes = commits(gh).length;
  const reloaded = await executeUpgradeConflictChoice({
    action: 'reload',
    adapter: gh,
    repo,
    files: [fileWrite(partIdPath(SHAFT_ID), withSurfId('return "local-shaft";\n', SHAFT_ID))],
    store,
    assemblyId: GEARBOX_ID,
  });
  assert.equal(reloaded.status, 'reloaded');
  assert.match(String(reloaded.contents[partIdPath(SHAFT_ID)]), /remote-shaft/);
  assert.equal(commits(gh).length, writes);

  const branched = await executeUpgradeConflictChoice({
    action: 'branch',
    adapter: gh,
    repo,
    files: [fileWrite(partIdPath(SHAFT_ID), withSurfId('return "mine-shaft";\n', SHAFT_ID))],
    tipSha: upgradeSha,
    now: NOW.getTime(),
  });
  assert.equal(branched.status, 'branched');
  assert.equal(branched.fromSha, upgradeSha);
  assert.equal(branched.switched, true);
  const mine = await readText(gh, repo, partIdPath(SHAFT_ID), branched.branch);
  assert.match(mine, /mine-shaft/);
  const main = await readText(gh, repo, partIdPath(SHAFT_ID), 'main');
  assert.match(main, /remote-shaft/);
});

test('upgradeVaultEnabled is off in prod even with VITE_ or localStorage', () => {
  assert.equal(upgradeVaultEnabled({ enabled: false }), false);
  assert.equal(upgradeVaultEnabled({
    vite: { DEV: false, MODE: 'production', VITE_SURFCAD_UPGRADE_VAULT: '1' },
    localStorage: { getItem: () => '1' },
  }), false);
  assert.equal(upgradeVaultEnabled({
    vite: { DEV: true, MODE: 'development', VITE_SURFCAD_UPGRADE_VAULT: '1' },
  }), true);
  assert.equal(upgradeVaultEnabled({
    vite: { DEV: true, MODE: 'development' },
    localStorage: { getItem: (k) => (k === 'surfcadUpgradeVault' ? '1' : null) },
  }), true);
  assert.equal(typeof UPGRADE_UNAVAILABLE.hint, 'string');
});

test('already_upgraded does not mark a dirty working copy clean', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const start = app.indexOf('const handleUpgradeVault');
  const end = app.indexOf('const handleUpgradeConflict', start);
  const slice = app.slice(start, end);
  assert.match(slice, /result\.status === 'already_upgraded'/);
  const adopt = slice.slice(slice.indexOf("result.status === 'already_upgraded'"));
  const adoptedBlock = adopt.slice(0, adopt.indexOf('const adopted'));
  assert.equal(/clearWorkingCopySidecar/.test(adoptedBlock), false);
  assert.equal(/captureBaseline/.test(adoptedBlock), false);
  assert.match(adoptedBlock, /return result/);
});

test('v2 vault refuses leftover v1 writers and leaves the outbox unflushed', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const flush = app.slice(app.indexOf('const flushGitOps'), app.indexOf('flushGitSyncRef.current'));
  assert.match(flush, /vaultLayout === 'v2' && upgradeVaultEnabled\(\)/);
  assert.match(flush, /left unflushed/);
  const addStart = app.indexOf('const handleAddToRepo');
  const add = app.slice(addStart, app.indexOf('setPendingPartIds', addStart));
  assert.match(add, /vaultLayout === 'v2' && upgradeVaultEnabled\(\)/);
  const delStart = app.indexOf('const handleDeleteAssembly');
  const del = app.slice(delStart, app.indexOf('if (assemblyOpenLockRef.current)', delStart));
  assert.match(del, /vaultLayout === 'v2' && upgradeVaultEnabled\(\)/);
  const renameStart = app.indexOf('const handleRenameAssembly');
  const rename = app.slice(renameStart, app.indexOf('const current = assemblyName(doc)', renameStart));
  assert.match(rename, /vaultLayout === 'v2' && upgradeVaultEnabled\(\)/);
});

test('flag-off Save and Add to Repo keep main v1 writers', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const feed = readFileSync(join(ROOT, 'src/components/PartFeed.jsx'), 'utf8');
  const gitCommit = app.slice(
    app.indexOf('const handleGitCommit'),
    app.indexOf('const handleUpgradeVault'),
  );
  assert.match(gitCommit, /doc\.vaultLayout === 'legacy' && upgradeVaultEnabled\(\)/);
  assert.match(gitCommit, /ensureGitVault\(\{\s*create:\s*true\s*\}\)/);
  const addStart = app.indexOf('const handleAddToRepo');
  const add = app.slice(addStart, app.indexOf('const handleListBranches', addStart));
  assert.match(add, /commitPartToRepo/);
  assert.equal(/upgrade_required/.test(add), false);
  assert.match(add, /vaultLayout === 'v2' && upgradeVaultEnabled\(\)/);
  const startCommit = feed.slice(
    feed.indexOf('const startCommit'),
    feed.indexOf('const runNewAssembly'),
  );
  assert.match(startCommit, /stage: 'message'/);
  assert.match(startCommit, /upgradeAvailable/);
});

function staticRelativeImports(file) {
  const specs = [];
  const text = readFileSync(file, 'utf8');
  const re = /(?:^|\n)\s*(?:export\s+)?import\s[\s\S]*?from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) specs.push(m[1]);
  return specs;
}

function resolveImport(fromFile, spec) {
  let next = join(dirname(fromFile), spec);
  if (existsSync(next)) return next;
  if (existsSync(`${next}.js`)) return `${next}.js`;
  if (existsSync(`${next}.jsx`)) return `${next}.jsx`;
  const indexJs = join(next, 'index.js');
  if (existsSync(indexJs)) return indexJs;
  return next;
}

function reachableFrom(start) {
  const srcRoot = join(ROOT, 'src');
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file) || !file.startsWith(srcRoot)) continue;
    seen.add(file);
    for (const spec of staticRelativeImports(file)) {
      queue.push(resolveImport(file, spec));
    }
  }
  return seen;
}

test('lastCommit import graph never reaches upgrade.js', () => {
  const last = join(ROOT, 'src/utils/git/lastCommit.js');
  const upgrade = join(ROOT, 'src/utils/git/legacyVault/upgrade.js');
  const reader = join(ROOT, 'src/utils/git/legacyVault/reader.js');
  const fromLast = reachableFrom(last);
  assert.equal(fromLast.has(upgrade), false);
  assert.equal(fromLast.has(reader), true);
  const fromUpgrade = reachableFrom(upgrade);
  assert.equal(fromUpgrade.has(last), true);
  const upText = readFileSync(upgrade, 'utf8');
  assert.equal(/import\(['"]\.\.\/lastCommit\.js['"]\)/.test(upText), false);
  assert.match(upText, /from ['"]\.\.\/lastCommit\.js['"]/);
});

test('mapWorkingCopyToPlan uses the plan path map, not WC header ids', () => {
  const plan = {
    partIdByPath: { [PIN_COPY_PATH]: COPY_ID, [PIN_PATH]: PIN_ID },
    keptPartIds: [PIN_ID, COPY_ID],
    mintedPartIds: [],
    folderToId: { Box: BOX_ID },
    writes: {},
  };
  const mapped = mapWorkingCopyToPlan(plan, {
    dirty: true,
    doc: {
      id: BOX_ID,
      name: 'Box',
      parts: [
        { id: PIN_ID, path: PIN_PATH, name: 'Pin' },
        { id: COPY_ID, path: PIN_PATH, name: 'PinCopy' },
      ],
    },
    scripts: { [PIN_ID]: 'stolen' },
  });
  assert.equal(mapped.ok, false);
  assert.equal(mapped.code, 'working_copy_unmapped');
});

