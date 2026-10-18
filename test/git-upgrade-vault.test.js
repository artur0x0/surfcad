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
  partSurfId,
} from '../src/utils/git/surfId.js';
import { validateSurfJson } from '../src/utils/git/surfJson.js';
import { assemblyIdPath, partIdPath, partMeshIdPath } from '../src/utils/git/idPaths.js';
import { parseBranchTip, parseAssemblyCommit } from '../src/utils/git/lastCommit.js';
import { stringifySurfJsonV2, validateSurfJsonV2 } from '../src/utils/git/surfJsonV2.js';
import { partRepoPath } from '../src/utils/git/partIdentity.js';
import {
  detectVaultLayout,
  executeUpgrade,
  executeUpgradeConflictChoice,
  knownReadmeSeedFor,
  planUpgrade,
  planWorkingCopyFollowup,
  mapWorkingCopyToPlan,
  mapWorkingCopyToV2Tip,
  adoptUpgradeWorkingCopy,
  upgradePersistIncomplete,
  orphanUpgradeScriptIds,
  rollbackFailedUpgradeDocSave,
  workingCopyUnpersistedResult,
  workingCopyUnmappedResult,
  workingCopyMatchesVaultTip,
  WORKING_COPY_UNPERSISTED_HINT,
  applyUpgradeReload,
  isKnownReadmeSeed,
  openLegacyAssembly,
  SURFCAD_JSON_V2,
} from '../src/utils/git/legacyVault/index.js';
import { upgradeVaultEnabled, UPGRADE_UNAVAILABLE } from '../src/utils/git/upgradeVaultEnabled.js';
import { isUpgradeWorkingCopyDirty } from '../src/utils/git/gitWorkspace.js';
import { persistCollapsedWorkingCopy } from '../src/utils/git/wcIdentity.js';
import { rewriteFeaStudyPartIds } from '../src/utils/git/feaStudyIds.js';

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
const ALPHA_ID = mintSurfId({ now: NOW, rand: 'a1fa' });
const BETA_ID = mintSurfId({ now: NOW, rand: 'b3fa' });
const GAMMA_ID = mintSurfId({ now: NOW, rand: 'c3fa' });
const X_ID = mintSurfId({ now: NOW, rand: 'aaa1' });
const Y_ID = mintSurfId({ now: NOW, rand: 'bbb1' });
const GEAR_B_ID = mintSurfId({ now: new Date('2026-10-18T04:00:00.000Z'), rand: '9eb2' });
const GEAR_A_ID = mintSurfId({ now: NOW, rand: '9ea1' });
const F1_PIN_MINTED_ID = mintSurfId({ now: NOW, rand: '9999' });
const N5_COPY_ID = mintSurfId({ now: NOW, rand: 'c0c2' });
const N6_ORPHAN_ID = mintSurfId({ now: NOW, rand: '0f0a' });
const G1_ROW_ID = mintSurfId({ now: new Date('2026-10-18T05:00:00.000Z'), rand: 'r0w1' });
const G1_HEADER_ID = mintSurfId({ now: new Date('2026-10-18T05:00:01.000Z'), rand: 'hdr2' });
const A1_ID = mintSurfId({ now: NOW, rand: 'aa01' });
const A2_ID = mintSurfId({ now: NOW, rand: 'aa02' });
const A3_ID = mintSurfId({ now: NOW, rand: 'aa03' });
const GEAR_PATH = 'parts/Gear.js';

const SHAFT_PATH = 'parts/Shaft.js';
const BRACKET_PATH = 'parts/Bracket.js';
const LID_PATH = 'assemblies/Gearbox/Lid.js';
const PLATE_PATH = 'assemblies/Cover/parts/Plate.js';
const MISSING_PATH = 'parts/MissingGear.js';
const BLANK_PATH = 'parts/Blank.js';
const PIN_PATH = 'parts/Pin.js';
const PIN_COPY_PATH = 'assemblies/Box/PinCopy.js';
const PIN_COPY_SCENARIO_PATH = 'assemblies/Box/Pin copy.js';
const BOX_PIN_PATH = 'assemblies/Box/Pin.js';
const PIN_COPY_SHARED_PATH = 'parts/PinCopy.js';
const ORPHAN_PATH = 'parts/Orphan.js';
const GEAR_A_PATH = 'parts/GearA.js';
const GEAR_B_PATH = 'parts/GearB.js';
const EMPTY_HEADER_PATH = 'parts/Empty.js';
const BOGUS_HEADER_PATH = 'parts/Bogus.js';
const SCENARIO_L_PIN_ID = mintSurfId({ now: new Date('2026-10-18T00:00:02.000Z'), rand: 'b1a0' });
const SCENARIO_L_COPY_ID = mintSurfId({ now: NOW, rand: 'c0c1' });
const SCENARIO_L_JOINT_ID = mintSurfId({ now: NOW, rand: 'j01a' });
const SCENARIO_L_BLOCK_ID = mintSurfId({ now: NOW, rand: 'b10c' });
const BLOCK_PATH = 'parts/Block.js';
const A3_COPY_PATH = 'assemblies/A3/Copy.js';
const DELETED_ID = mintSurfId({ now: NOW, rand: 'de1e' });
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
  if (path === PIN_COPY_SCENARIO_PATH) return 'c0c1';
  if (path === BLOCK_PATH) return 'b10c';
  if (path === GEAR_A_PATH) return '9ea1';
  if (path === PIN_COPY_SHARED_PATH) return 'c0c2';
  if (path === ORPHAN_PATH) return '0f0a';
  if (part?.id === '$assembly') {
    if (part.name === 'Cover') return '0002';
    if (part.name === 'Gearbox') return '0001';
    if (part.name === 'Box') return 'b0x1';
    if (part.name === 'Alpha') return 'a1fa';
    if (part.name === 'Beta') return 'b3fa';
    if (part.name === 'Gamma') return 'c3fa';
    if (part.name === 'X') return 'aaa1';
    if (part.name === 'Y') return 'bbb1';
    if (part.name === 'A1') return 'aa01';
    if (part.name === 'A2') return 'aa02';
    if (part.name === 'A3') return 'aa03';
    return 'aa00';
  }
  if (part?.id === '$group') return 'eeee';
  return '9999';
}

function v2PartJs(plan) {
  return Object.keys(plan.writes || {}).filter((path) => /^parts\/[^/]+\.js$/.test(path)).sort();
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
  const opened = await openLegacyAssembly(clean.gh, clean.repo, 'Gearbox', {
    branch: 'main',
    pathIndex: cleanStore.pathIndexFor(clean.repo),
  });
  assert.equal(isUpgradeWorkingCopyDirty({
    doc: opened.doc,
    scripts: opened.scripts,
    baseline: opened.baseline,
    liveScript: '',
    editorLive: false,
  }), false);
  const cleanOut = await executeUpgrade(upgradeOpts(clean.gh, clean.repo, {
    store: cleanStore,
    workingCopy: {
      dirty: isUpgradeWorkingCopyDirty({
        doc: opened.doc,
        scripts: opened.scripts,
        baseline: opened.baseline,
      }),
      doc: opened.doc,
      scripts: opened.scripts,
    },
  }));
  assert.equal(cleanOut.status, 'upgraded');
  assert.equal(cleanOut.commits, 1);
  assert.equal(commits(clean.gh).length, cleanWrites + 1);

  const dirty = await seedGearboxVault();
  const dirtyStore = await storeFor(dirty.repo);
  const dirtyOpened = await openLegacyAssembly(dirty.gh, dirty.repo, 'Gearbox', {
    branch: 'main',
    pathIndex: dirtyStore.pathIndexFor(dirty.repo),
    knownAssemblyId: GEARBOX_ID,
    assemblyIdIndex: { Gearbox: GEARBOX_ID, Cover: COVER_ID },
  });
  const shaftRow = dirtyOpened.doc.parts.find((p) => p.name === 'Shaft');
  const editedScripts = {
    ...dirtyOpened.scripts,
    [shaftRow.id]: withSurfId('return "dirty-shaft";\n', shaftRow.id),
  };
  assert.equal(isUpgradeWorkingCopyDirty({
    doc: dirtyOpened.doc,
    scripts: editedScripts,
    baseline: dirtyOpened.baseline,
  }), true);
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

test('Scenario L: a copy header never steals a row-owned Pin id', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: PIN_PATH,
    parts: [
      { path: PIN_COPY_SCENARIO_PATH, name: 'Pin copy', visible: true, order: 0 },
      { id: SCENARIO_L_PIN_ID, path: PIN_PATH, name: 'Pin', visible: true, order: 1 },
      { id: SCENARIO_L_BLOCK_ID, path: BLOCK_PATH, name: 'Block', visible: true, order: 2 },
    ],
    groups: [{
      id: GROUP_ID,
      name: 'Hardware',
      partIds: [SCENARIO_L_PIN_ID],
    }],
    colors: { [SCENARIO_L_PIN_ID]: { part: '#cc0000' } },
    joints: [{
      id: SCENARIO_L_JOINT_ID,
      name: 'Fixed 1',
      type: 'fixed',
      a: { part: SCENARIO_L_PIN_ID },
    }],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed scenario L',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', SCENARIO_L_PIN_ID)),
      fileWrite(PIN_COPY_SCENARIO_PATH, withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID)),
      fileWrite(BLOCK_PATH, withSurfId('return "block";\n', SCENARIO_L_BLOCK_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  assert.equal(result.commits, 1);
  const box = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BOX_ID)));
  assert.equal(validateSurfJsonV2(box).ok, true, validateSurfJsonV2(box).errors?.join('; '));
  const pin = box.parts.find((p) => p.name === 'Pin');
  const copy = box.parts.find((p) => p.name === 'Pin copy');
  assert.equal(pin.id, SCENARIO_L_PIN_ID);
  assert.equal(copy.id, SCENARIO_L_COPY_ID);
  assert.notEqual(copy.id, pin.id);
  assert.equal(copy.copiedFrom, undefined, 'header-only loser mints with no copiedFrom (rule 4)');
  assert.equal(pin.copiedFrom, undefined);
  assert.deepEqual(box.groups[0].partIds, [SCENARIO_L_PIN_ID]);
  assert.equal(box.colors[SCENARIO_L_PIN_ID].part, '#cc0000');
  assert.equal(Object.hasOwn(box.colors, copy.id), false);
  assert.equal(box.joints[0].a.part, SCENARIO_L_PIN_ID);
  assert.equal(readSurfId(await readText(gh, vault.repo, partIdPath(SCENARIO_L_PIN_ID))), SCENARIO_L_PIN_ID);
  assert.equal(readSurfId(await readText(gh, vault.repo, partIdPath(SCENARIO_L_COPY_ID))), SCENARIO_L_COPY_ID);
  assert.match(await readText(gh, vault.repo, partIdPath(SCENARIO_L_COPY_ID)), /pin-copy/);
});

test('shared Pin path keeps one id across assemblies with no minted copy (ownership A)', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const alpha = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Alpha',
    activeId: PIN_PATH,
    parts: [
      { path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
    ],
  };
  const beta = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Beta',
    activeId: PIN_PATH,
    parts: [
      { id: SCENARIO_L_PIN_ID, path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed shared pin across Alpha and Beta',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Alpha/.surf.json', `${JSON.stringify(alpha, null, 2)}\n`),
      fileWrite('assemblies/Beta/.surf.json', `${JSON.stringify(beta, null, 2)}\n`),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', SCENARIO_L_PIN_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Alpha: ALPHA_ID, Beta: BETA_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const alphaDoc = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(ALPHA_ID)));
  const betaDoc = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BETA_ID)));
  assert.equal(validateSurfJsonV2(alphaDoc).ok, true, validateSurfJsonV2(alphaDoc).errors?.join('; '));
  assert.equal(validateSurfJsonV2(betaDoc).ok, true, validateSurfJsonV2(betaDoc).errors?.join('; '));
  assert.equal(alphaDoc.parts[0].id, SCENARIO_L_PIN_ID);
  assert.equal(betaDoc.parts[0].id, SCENARIO_L_PIN_ID);
  assert.equal(alphaDoc.parts[0].copiedFrom, undefined);
  assert.equal(betaDoc.parts[0].copiedFrom, undefined);
  assert.equal(result.plan.mintedPartIds.length, 0);
  const pinDest = partIdPath(SCENARIO_L_PIN_ID);
  const partJs = Object.keys(result.plan.writes).filter((path) => /^parts\/[^/]+\.js$/.test(path));
  assert.deepEqual(partJs, [pinDest]);
  assert.equal(readSurfId(await readText(gh, vault.repo, pinDest)), SCENARIO_L_PIN_ID);
  const treeJs = (await treePaths(gh, vault.repo)).filter((path) => /^parts\/[^/]+\.js$/.test(path));
  assert.deepEqual(treeJs, [pinDest]);
});

test('Scenario L variant: copy listed first with Pin id still mints (ownership B)', async () => {
  for (const copyExtra of [{}, { copiedFrom: SCENARIO_L_PIN_ID }]) {
    const label = Object.hasOwn(copyExtra, 'copiedFrom') ? 'id+copiedFrom' : 'id';
    const gh = createMockGithubAdapter({ login: 'artur' });
    const vault = await findOrCreateVault(gh);
    const raw = {
      format: 'surfcad.assembly',
      version: 1,
      name: 'Box',
      activeId: PIN_PATH,
      parts: [
        {
          id: SCENARIO_L_PIN_ID,
          ...copyExtra,
          path: PIN_COPY_SCENARIO_PATH,
          name: 'Pin copy',
          visible: true,
          order: 0,
        },
        { id: SCENARIO_L_PIN_ID, path: PIN_PATH, name: 'Pin', visible: true, order: 1 },
        { id: SCENARIO_L_BLOCK_ID, path: BLOCK_PATH, name: 'Block', visible: true, order: 2 },
      ],
      groups: [{
        id: GROUP_ID,
        name: 'Hardware',
        partIds: [SCENARIO_L_PIN_ID],
      }],
      colors: { [SCENARIO_L_PIN_ID]: { part: '#cc0000' } },
      joints: [{
        id: SCENARIO_L_JOINT_ID,
        name: 'Fixed 1',
        type: 'fixed',
        a: { part: SCENARIO_L_PIN_ID },
      }],
    };
    await gh.commitFiles(vault.repo, {
      branch: 'main',
      message: `seed scenario L variant ${label}`,
      baseSha: vault.headSha,
      files: [
        fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
        fileWrite(PIN_PATH, withSurfId('return "pin";\n', SCENARIO_L_PIN_ID)),
        fileWrite(PIN_COPY_SCENARIO_PATH, withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID)),
        fileWrite(BLOCK_PATH, withSurfId('return "block";\n', SCENARIO_L_BLOCK_ID)),
      ],
    });
    const store = await storeFor(vault.repo, { Box: BOX_ID });
    const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
    assert.equal(result.status, 'upgraded', label);
    const box = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BOX_ID)));
    assert.equal(validateSurfJsonV2(box).ok, true, `${label}: ${validateSurfJsonV2(box).errors?.join('; ')}`);
    const pin = box.parts.find((p) => p.name === 'Pin');
    const copy = box.parts.find((p) => p.name === 'Pin copy');
    assert.equal(pin.id, SCENARIO_L_PIN_ID, label);
    assert.equal(copy.id, SCENARIO_L_COPY_ID, label);
    assert.notEqual(copy.id, pin.id, label);
    assert.equal(copy.copiedFrom, SCENARIO_L_PIN_ID, label);
    assert.equal(pin.copiedFrom, undefined, label);
    assert.notEqual(copy.copiedFrom, copy.id, label);
    assert.deepEqual(box.groups[0].partIds, [SCENARIO_L_PIN_ID], label);
    assert.equal(box.colors[SCENARIO_L_PIN_ID].part, '#cc0000', label);
    assert.equal(Object.hasOwn(box.colors, copy.id), false, label);
    assert.equal(box.joints[0].a.part, SCENARIO_L_PIN_ID, label);
    assert.equal(readSurfId(await readText(gh, vault.repo, partIdPath(SCENARIO_L_PIN_ID))), SCENARIO_L_PIN_ID, label);
    assert.equal(readSurfId(await readText(gh, vault.repo, partIdPath(SCENARIO_L_COPY_ID))), SCENARIO_L_COPY_ID, label);
    assert.match(await readText(gh, vault.repo, partIdPath(SCENARIO_L_COPY_ID)), /pin-copy/);
  }
});

test('copy row that carries Pin id owns it when the shared Pin row has no id (F1)', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: PIN_COPY_SCENARIO_PATH,
    parts: [
      { id: SCENARIO_L_PIN_ID, path: PIN_COPY_SCENARIO_PATH, name: 'Pin copy', visible: true, order: 0 },
      { path: PIN_PATH, name: 'Pin', visible: true, order: 1 },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed F1 copy row vs shared header-only Pin',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', SCENARIO_L_PIN_ID)),
      fileWrite(PIN_COPY_SCENARIO_PATH, withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const box = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BOX_ID)));
  assert.equal(validateSurfJsonV2(box).ok, true, validateSurfJsonV2(box).errors?.join('; '));
  const pin = box.parts.find((p) => p.name === 'Pin');
  const copy = box.parts.find((p) => p.name === 'Pin copy');
  assert.equal(copy.id, SCENARIO_L_PIN_ID);
  assert.equal(pin.id, F1_PIN_MINTED_ID);
  assert.equal(copy.copiedFrom, undefined);
  assert.equal(pin.copiedFrom, undefined);
  const ownedText = await readText(gh, vault.repo, partIdPath(SCENARIO_L_PIN_ID));
  const mintedText = await readText(gh, vault.repo, partIdPath(F1_PIN_MINTED_ID));
  assert.equal(readSurfId(ownedText), SCENARIO_L_PIN_ID);
  assert.match(ownedText, /pin-copy/);
  assert.equal(readSurfId(mintedText), F1_PIN_MINTED_ID);
  assert.match(mintedText, /return "pin"/);
  assert.equal(mintedText.includes('pin-copy'), false);
  assert.deepEqual(v2PartJs(result.plan), [partIdPath(F1_PIN_MINTED_ID), partIdPath(SCENARIO_L_PIN_ID)].sort());
});

test('assembly-folder Pin with a row id beats a shared header-only copy (N5)', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: BOX_PIN_PATH,
    parts: [
      { id: SCENARIO_L_PIN_ID, path: BOX_PIN_PATH, name: 'Pin', visible: true, order: 0 },
      { path: PIN_COPY_SHARED_PATH, name: 'PinCopy', visible: true, order: 1 },
    ],
    groups: [{
      id: GROUP_ID,
      name: 'Hardware',
      partIds: [SCENARIO_L_PIN_ID],
    }],
    colors: { [SCENARIO_L_PIN_ID]: { part: '#cc0000' } },
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed N5 assembly Pin vs shared header-only copy',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(BOX_PIN_PATH, withSurfId('return "pin";\n', SCENARIO_L_PIN_ID)),
      fileWrite(PIN_COPY_SHARED_PATH, withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const box = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BOX_ID)));
  assert.equal(validateSurfJsonV2(box).ok, true, validateSurfJsonV2(box).errors?.join('; '));
  const pin = box.parts.find((p) => p.name === 'Pin');
  const copy = box.parts.find((p) => p.name === 'PinCopy');
  assert.equal(pin.id, SCENARIO_L_PIN_ID);
  assert.equal(copy.id, N5_COPY_ID);
  assert.equal(copy.copiedFrom, undefined);
  assert.equal(pin.copiedFrom, undefined);
  assert.deepEqual(box.groups[0].partIds, [SCENARIO_L_PIN_ID]);
  assert.equal(box.colors[SCENARIO_L_PIN_ID].part, '#cc0000');
  assert.equal(Object.hasOwn(box.colors, copy.id), false);
  const pinText = await readText(gh, vault.repo, partIdPath(SCENARIO_L_PIN_ID));
  assert.match(pinText, /return "pin"/);
  assert.equal(pinText.includes('pin-copy'), false);
  assert.match(await readText(gh, vault.repo, partIdPath(N5_COPY_ID)), /pin-copy/);
});

test('unreferenced header-only file does not claim a row-owned id (N6)', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: BOX_PIN_PATH,
    parts: [
      { id: SCENARIO_L_PIN_ID, path: BOX_PIN_PATH, name: 'Pin', visible: true, order: 0 },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed N6 orphan header next to row-owned Pin',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(BOX_PIN_PATH, withSurfId('return "pin";\n', SCENARIO_L_PIN_ID)),
      fileWrite(ORPHAN_PATH, withSurfId('return "orphan";\n', SCENARIO_L_PIN_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const box = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BOX_ID)));
  assert.equal(validateSurfJsonV2(box).ok, true, validateSurfJsonV2(box).errors?.join('; '));
  assert.equal(box.parts[0].id, SCENARIO_L_PIN_ID);
  assert.equal(box.parts[0].copiedFrom, undefined);
  const pinText = await readText(gh, vault.repo, partIdPath(SCENARIO_L_PIN_ID));
  assert.match(pinText, /return "pin"/);
  assert.equal(pinText.includes('orphan'), false);
  const orphanText = await readText(gh, vault.repo, partIdPath(N6_ORPHAN_ID));
  assert.equal(readSurfId(orphanText), N6_ORPHAN_ID);
  assert.match(orphanText, /orphan/);
  assert.equal(result.plan.partIdByPath[ORPHAN_PATH], N6_ORPHAN_ID);
  assert.equal(result.plan.partIdByPath[BOX_PIN_PATH], SCENARIO_L_PIN_ID);
});

test('shared sibling files mint once across assemblies when one row owns the id (N3)', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const x = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'X',
    activeId: GEAR_B_PATH,
    parts: [
      { path: GEAR_A_PATH, name: 'GearA', visible: true, order: 0 },
      { id: GEAR_B_ID, path: GEAR_B_PATH, name: 'GearB', visible: true, order: 1 },
    ],
  };
  const y = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Y',
    activeId: GEAR_B_PATH,
    parts: [
      { path: GEAR_A_PATH, name: 'GearA', visible: true, order: 0 },
      { id: GEAR_B_ID, path: GEAR_B_PATH, name: 'GearB', visible: true, order: 1 },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed N3 shared GearA/GearB across X and Y',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/X/.surf.json', `${JSON.stringify(x, null, 2)}\n`),
      fileWrite('assemblies/Y/.surf.json', `${JSON.stringify(y, null, 2)}\n`),
      fileWrite(GEAR_A_PATH, withSurfId('return "gear-a";\n', GEAR_B_ID)),
      fileWrite(GEAR_B_PATH, withSurfId('return "gear-b";\n', GEAR_B_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { X: X_ID, Y: Y_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const xDoc = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(X_ID)));
  const yDoc = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(Y_ID)));
  assert.equal(validateSurfJsonV2(xDoc).ok, true, validateSurfJsonV2(xDoc).errors?.join('; '));
  assert.equal(validateSurfJsonV2(yDoc).ok, true, validateSurfJsonV2(yDoc).errors?.join('; '));
  const xA = xDoc.parts.find((p) => p.name === 'GearA');
  const xB = xDoc.parts.find((p) => p.name === 'GearB');
  const yA = yDoc.parts.find((p) => p.name === 'GearA');
  const yB = yDoc.parts.find((p) => p.name === 'GearB');
  assert.equal(xB.id, GEAR_B_ID);
  assert.equal(yB.id, GEAR_B_ID);
  assert.equal(xA.id, GEAR_A_ID);
  assert.equal(yA.id, GEAR_A_ID);
  assert.equal(xA.copiedFrom, undefined);
  assert.equal(yA.copiedFrom, undefined);
  assert.equal(xB.copiedFrom, undefined);
  assert.deepEqual(v2PartJs(result.plan), [partIdPath(GEAR_A_ID), partIdPath(GEAR_B_ID)].sort());
  const treeJs = (await treePaths(gh, vault.repo)).filter((path) => /^parts\/[^/]+\.js$/.test(path));
  assert.deepEqual(treeJs, [partIdPath(GEAR_A_ID), partIdPath(GEAR_B_ID)].sort());
  assert.match(await readText(gh, vault.repo, partIdPath(GEAR_B_ID)), /gear-b/);
  assert.match(await readText(gh, vault.repo, partIdPath(GEAR_A_ID)), /gear-a/);
});

test('F1 Pin stays one minted file when a second assembly also uses it (N7)', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const box = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: PIN_COPY_SCENARIO_PATH,
    parts: [
      { id: SCENARIO_L_PIN_ID, path: PIN_COPY_SCENARIO_PATH, name: 'Pin copy', visible: true, order: 0 },
      { path: PIN_PATH, name: 'Pin', visible: true, order: 1 },
    ],
  };
  const alpha = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Alpha',
    activeId: PIN_PATH,
    parts: [
      { path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed N7 F1 plus second assembly sharing Pin',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(box, null, 2)}\n`),
      fileWrite('assemblies/Alpha/.surf.json', `${JSON.stringify(alpha, null, 2)}\n`),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', SCENARIO_L_PIN_ID)),
      fileWrite(PIN_COPY_SCENARIO_PATH, withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID, Alpha: ALPHA_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const boxDoc = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BOX_ID)));
  const alphaDoc = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(ALPHA_ID)));
  assert.equal(validateSurfJsonV2(boxDoc).ok, true, validateSurfJsonV2(boxDoc).errors?.join('; '));
  assert.equal(validateSurfJsonV2(alphaDoc).ok, true, validateSurfJsonV2(alphaDoc).errors?.join('; '));
  const boxCopy = boxDoc.parts.find((p) => p.name === 'Pin copy');
  const boxPin = boxDoc.parts.find((p) => p.name === 'Pin');
  assert.equal(boxCopy.id, SCENARIO_L_PIN_ID);
  assert.equal(boxPin.id, F1_PIN_MINTED_ID);
  assert.equal(alphaDoc.parts[0].id, F1_PIN_MINTED_ID);
  assert.equal(boxPin.copiedFrom, undefined);
  assert.equal(alphaDoc.parts[0].copiedFrom, undefined);
  assert.deepEqual(v2PartJs(result.plan), [partIdPath(F1_PIN_MINTED_ID), partIdPath(SCENARIO_L_PIN_ID)].sort());
});

test('three assemblies sharing one file keep one id', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const make = (name) => ({
    format: 'surfcad.assembly',
    version: 1,
    name,
    activeId: PIN_PATH,
    parts: [{ path: PIN_PATH, name: 'Pin', visible: true, order: 0 }],
  });
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed three assemblies sharing Pin',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Alpha/.surf.json', `${JSON.stringify(make('Alpha'), null, 2)}\n`),
      fileWrite('assemblies/Beta/.surf.json', `${JSON.stringify(make('Beta'), null, 2)}\n`),
      fileWrite('assemblies/Gamma/.surf.json', `${JSON.stringify(make('Gamma'), null, 2)}\n`),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', SCENARIO_L_PIN_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Alpha: ALPHA_ID, Beta: BETA_ID, Gamma: GAMMA_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const docs = [];
  for (const id of [ALPHA_ID, BETA_ID, GAMMA_ID]) {
    const doc = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(id)));
    assert.equal(validateSurfJsonV2(doc).ok, true, validateSurfJsonV2(doc).errors?.join('; '));
    assert.equal(doc.parts[0].id, SCENARIO_L_PIN_ID);
    assert.equal(doc.parts[0].copiedFrom, undefined);
    docs.push(doc);
  }
  assert.equal(result.plan.mintedPartIds.length, 0);
  assert.deepEqual(v2PartJs(result.plan), [partIdPath(SCENARIO_L_PIN_ID)]);
});

test('empty or invalid @surf-id headers restamp without stacking', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: EMPTY_HEADER_PATH,
    parts: [
      { path: EMPTY_HEADER_PATH, name: 'Empty', visible: true, order: 0 },
      { path: BOGUS_HEADER_PATH, name: 'Bogus', visible: true, order: 1 },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed empty and invalid surf-id headers',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(EMPTY_HEADER_PATH, '// @surf-id\nreturn "empty";\n'),
      fileWrite(BOGUS_HEADER_PATH, '// @surf-id not-an-id\nreturn "bogus";\n'),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const box = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BOX_ID)));
  assert.equal(validateSurfJsonV2(box).ok, true, validateSurfJsonV2(box).errors?.join('; '));
  assert.equal(box.parts.length, 2);
  assert.equal(new Set(box.parts.map((p) => p.id)).size, 2);
  for (const part of box.parts) {
    const text = await readText(gh, vault.repo, partIdPath(part.id));
    assert.equal((text.match(/\/\/ @surf-id/g) || []).length, 1);
    assert.equal(readSurfId(text), part.id);
    assert.equal(text.startsWith(`// @surf-id ${part.id}\n`), true);
  }
});

test('Upgrade restamp keeps extra text on an invalid @surf-id line', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: BOGUS_HEADER_PATH,
    parts: [
      { path: BOGUS_HEADER_PATH, name: 'Bogus', visible: true, order: 0 },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed invalid header with extra text',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(BOGUS_HEADER_PATH, '// @surf-id not-an-id keep this\nreturn "bogus";\n'),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const box = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BOX_ID)));
  const text = await readText(gh, vault.repo, partIdPath(box.parts[0].id));
  assert.equal((text.match(/\/\/ @surf-id/g) || []).length, 1);
  assert.equal(readSurfId(text), box.parts[0].id);
  assert.equal(text.includes('keep this'), true, 'extra text on the invalid header line must survive');
  assert.equal(text.includes('not-an-id'), false);
  assert.match(text, /return "bogus"/);
});

test('explicit row id beats the same file\'s header-only id (G1)', async () => {
  for (const [rowId, headerId] of [
    [G1_ROW_ID, G1_HEADER_ID],
    [G1_HEADER_ID, G1_ROW_ID],
  ]) {
    const label = `row ${rowId} header ${headerId}`;
    const gh = createMockGithubAdapter({ login: 'artur' });
    const vault = await findOrCreateVault(gh);
    const raw = {
      format: 'surfcad.assembly',
      version: 1,
      name: 'Box',
      activeId: GEAR_PATH,
      parts: [
        { id: rowId, path: GEAR_PATH, name: 'Gear', visible: true, order: 0 },
      ],
      groups: [{
        id: GROUP_ID,
        name: 'Hardware',
        partIds: [rowId],
      }],
      joints: [{
        id: SCENARIO_L_JOINT_ID,
        name: 'Fixed 1',
        type: 'fixed',
        a: { part: rowId },
      }],
    };
    await gh.commitFiles(vault.repo, {
      branch: 'main',
      message: `seed G1 ${label}`,
      baseSha: vault.headSha,
      files: [
        fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
        fileWrite(GEAR_PATH, withSurfId('return "gear";\n', headerId)),
      ],
    });
    const store = await storeFor(vault.repo, { Box: BOX_ID });
    const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
    assert.equal(result.status, 'upgraded', label);
    const box = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BOX_ID)));
    assert.equal(validateSurfJsonV2(box).ok, true, `${label}: ${validateSurfJsonV2(box).errors?.join('; ')}`);
    assert.equal(box.parts[0].id, rowId, label);
    assert.equal(box.parts[0].copiedFrom, undefined, label);
    assert.deepEqual(box.groups[0].partIds, [rowId], label);
    assert.equal(box.joints[0].a.part, rowId, label);
    const gearText = await readText(gh, vault.repo, partIdPath(rowId));
    assert.equal(readSurfId(gearText), rowId, label);
    assert.match(gearText, /return "gear"/);
    assert.equal(result.plan.writes[partIdPath(headerId)], undefined, label);
  }
});

test('folded same-file row ids do not set copiedFrom (G2)', async () => {
  const three = async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    const vault = await findOrCreateVault(gh);
    const make = (name, extra = {}) => ({
      format: 'surfcad.assembly',
      version: 1,
      name,
      activeId: PIN_PATH,
      parts: [{ ...extra, path: PIN_PATH, name: 'Pin', visible: true, order: 0 }],
    });
    await gh.commitFiles(vault.repo, {
      branch: 'main',
      message: 'seed G2 three assemblies A3 row R1 header R2',
      baseSha: vault.headSha,
      files: [
        fileWrite('assemblies/A1/.surf.json', `${JSON.stringify(make('A1'), null, 2)}\n`),
        fileWrite('assemblies/A2/.surf.json', `${JSON.stringify(make('A2'), null, 2)}\n`),
        fileWrite('assemblies/A3/.surf.json', `${JSON.stringify(make('A3', { id: G1_ROW_ID }), null, 2)}\n`),
        fileWrite(PIN_PATH, withSurfId('return "pin";\n', G1_HEADER_ID)),
      ],
    });
    const store = await storeFor(vault.repo, { A1: A1_ID, A2: A2_ID, A3: A3_ID });
    const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
    assert.equal(result.status, 'upgraded');
    for (const id of [A1_ID, A2_ID, A3_ID]) {
      const doc = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(id)));
      assert.equal(validateSurfJsonV2(doc).ok, true, validateSurfJsonV2(doc).errors?.join('; '));
      assert.equal(doc.parts[0].id, G1_ROW_ID);
      assert.equal(doc.parts[0].copiedFrom, undefined);
    }
    assert.equal(readSurfId(await readText(gh, vault.repo, partIdPath(G1_ROW_ID))), G1_ROW_ID);
    assert.deepEqual(v2PartJs(result.plan), [partIdPath(G1_ROW_ID)]);
  };

  const noHeaderA1 = async () => {
    const gh = createMockGithubAdapter({ login: 'artur' });
    const vault = await findOrCreateVault(gh);
    const make = (name, extra = {}) => ({
      format: 'surfcad.assembly',
      version: 1,
      name,
      activeId: PIN_PATH,
      parts: [{ ...extra, path: PIN_PATH, name: 'Pin', visible: true, order: 0 }],
    });
    await gh.commitFiles(vault.repo, {
      branch: 'main',
      message: 'seed G2 no-header A1 with R2',
      baseSha: vault.headSha,
      files: [
        fileWrite('assemblies/A1/.surf.json', `${JSON.stringify(make('A1', { id: G1_HEADER_ID }), null, 2)}\n`),
        fileWrite('assemblies/A2/.surf.json', `${JSON.stringify(make('A2'), null, 2)}\n`),
        fileWrite('assemblies/A3/.surf.json', `${JSON.stringify(make('A3'), null, 2)}\n`),
        fileWrite(PIN_PATH, 'return "pin";\n'),
      ],
    });
    const store = await storeFor(vault.repo, { A1: A1_ID, A2: A2_ID, A3: A3_ID });
    const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
    assert.equal(result.status, 'upgraded');
    for (const id of [A1_ID, A2_ID, A3_ID]) {
      const doc = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(id)));
      assert.equal(validateSurfJsonV2(doc).ok, true, validateSurfJsonV2(doc).errors?.join('; '));
      assert.equal(doc.parts[0].id, G1_HEADER_ID);
      assert.equal(doc.parts[0].copiedFrom, undefined);
    }
    assert.equal(readSurfId(await readText(gh, vault.repo, partIdPath(G1_HEADER_ID))), G1_HEADER_ID);
    assert.deepEqual(v2PartJs(result.plan), [partIdPath(G1_HEADER_ID)]);
  };

  await three();
  await noHeaderA1();
});

test('clean and dirty Upgrade agree on F1 ids and copiedFrom (G3)', async () => {
  async function seedF1() {
    const gh = createMockGithubAdapter({ login: 'artur' });
    const vault = await findOrCreateVault(gh);
    const raw = {
      format: 'surfcad.assembly',
      version: 1,
      name: 'Box',
      activeId: PIN_COPY_SCENARIO_PATH,
      parts: [
        { id: SCENARIO_L_PIN_ID, path: PIN_COPY_SCENARIO_PATH, name: 'Pin copy', visible: true, order: 0 },
        { path: PIN_PATH, name: 'Pin', visible: true, order: 1 },
      ],
    };
    await gh.commitFiles(vault.repo, {
      branch: 'main',
      message: 'seed G3 F1',
      baseSha: vault.headSha,
      files: [
        fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
        fileWrite(PIN_PATH, withSurfId('return "pin";\n', SCENARIO_L_PIN_ID)),
        fileWrite(PIN_COPY_SCENARIO_PATH, withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID)),
      ],
    });
    return { gh, repo: vault.repo };
  }

  const cleanSeed = await seedF1();
  const cleanStore = await storeFor(cleanSeed.repo, { Box: BOX_ID });
  const openedClean = await openLegacyAssembly(cleanSeed.gh, cleanSeed.repo, 'Box', {
    branch: 'main',
    pathIndex: cleanStore.pathIndexFor(cleanSeed.repo),
    knownAssemblyId: BOX_ID,
    assemblyIdIndex: { Box: BOX_ID },
  });
  const collapsedPin = openedClean.doc.parts.find((p) => p.name === 'Pin');
  assert.equal(collapsedPin.copiedFrom, SCENARIO_L_PIN_ID, 'collapse tags Pin with copiedFrom PIN');
  const cleanOut = await executeUpgrade(upgradeOpts(cleanSeed.gh, cleanSeed.repo, {
    store: cleanStore,
    workingCopy: {
      dirty: false,
      doc: openedClean.doc,
      scripts: openedClean.scripts,
    },
  }));
  assert.equal(cleanOut.status, 'upgraded');
  assert.equal(cleanOut.commits, 1);
  const cleanBox = JSON.parse(await readText(cleanSeed.gh, cleanSeed.repo, assemblyIdPath(BOX_ID)));
  const cleanPin = cleanBox.parts.find((p) => p.name === 'Pin');
  const cleanCopy = cleanBox.parts.find((p) => p.name === 'Pin copy');
  assert.equal(cleanCopy.id, SCENARIO_L_PIN_ID);
  assert.equal(cleanPin.id, F1_PIN_MINTED_ID);
  assert.equal(cleanCopy.copiedFrom, undefined);
  assert.equal(cleanPin.copiedFrom, undefined);

  const dirtySeed = await seedF1();
  const dirtyStore = await storeFor(dirtySeed.repo, { Box: BOX_ID });
  const openedDirty = await openLegacyAssembly(dirtySeed.gh, dirtySeed.repo, 'Box', {
    branch: 'main',
    pathIndex: dirtyStore.pathIndexFor(dirtySeed.repo),
    knownAssemblyId: BOX_ID,
    assemblyIdIndex: { Box: BOX_ID },
  });
  const dirtyPinWc = openedDirty.doc.parts.find((p) => p.name === 'Pin');
  assert.equal(dirtyPinWc.copiedFrom, SCENARIO_L_PIN_ID);
  const dirtyOut = await executeUpgrade(upgradeOpts(dirtySeed.gh, dirtySeed.repo, {
    store: dirtyStore,
    workingCopy: {
      dirty: true,
      doc: openedDirty.doc,
      scripts: openedDirty.scripts,
    },
  }));
  assert.equal(dirtyOut.commits, 1);
  assert.equal(dirtyOut.status, 'upgraded');
  const dirtyBox = JSON.parse(await readText(dirtySeed.gh, dirtySeed.repo, assemblyIdPath(BOX_ID)));
  const dirtyPin = dirtyBox.parts.find((p) => p.name === 'Pin');
  const dirtyCopy = dirtyBox.parts.find((p) => p.name === 'Pin copy');
  assert.equal(dirtyCopy.id, cleanCopy.id);
  assert.equal(dirtyPin.id, cleanPin.id);
  assert.equal(dirtyCopy.copiedFrom, cleanCopy.copiedFrom);
  assert.equal(dirtyPin.copiedFrom, cleanPin.copiedFrom);
  assert.equal(dirtyPin.copiedFrom, undefined);
});

async function seedF1WithBlock() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: PIN_COPY_SCENARIO_PATH,
    parts: [
      { id: SCENARIO_L_PIN_ID, path: PIN_COPY_SCENARIO_PATH, name: 'Pin copy', visible: true, order: 0 },
      { path: PIN_PATH, name: 'Pin', visible: true, order: 1 },
      { id: SCENARIO_L_BLOCK_ID, path: BLOCK_PATH, name: 'Block', visible: true, order: 2 },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed F1 with Block',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', SCENARIO_L_PIN_ID)),
      fileWrite(PIN_COPY_SCENARIO_PATH, withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID)),
      fileWrite(BLOCK_PATH, withSurfId('return "block";\n', SCENARIO_L_BLOCK_ID)),
    ],
  });
  return { gh, repo: vault.repo };
}

function f1PartIdentity(doc) {
  const pin = doc.parts.find((p) => p.name === 'Pin');
  const copy = doc.parts.find((p) => p.name === 'Pin copy');
  const block = doc.parts.find((p) => p.id === SCENARIO_L_BLOCK_ID);
  return {
    pinId: pin?.id,
    pinCopied: pin?.copiedFrom,
    copyId: copy?.id,
    copyCopied: copy?.copiedFrom,
    blockId: block?.id,
    blockCopied: block?.copiedFrom,
  };
}

async function cleanF1WithBlockIds() {
  const seed = await seedF1WithBlock();
  const store = await storeFor(seed.repo, { Box: BOX_ID });
  const out = await executeUpgrade(upgradeOpts(seed.gh, seed.repo, { store }));
  assert.equal(out.status, 'upgraded');
  const box = JSON.parse(await readText(seed.gh, seed.repo, assemblyIdPath(BOX_ID)));
  assert.equal(validateSurfJsonV2(box).ok, true, validateSurfJsonV2(box).errors?.join('; '));
  const ids = f1PartIdentity(box);
  assert.equal(ids.copyId, SCENARIO_L_PIN_ID);
  assert.equal(ids.pinId, F1_PIN_MINTED_ID);
  assert.equal(ids.blockId, SCENARIO_L_BLOCK_ID);
  assert.equal(ids.pinCopied, undefined);
  assert.equal(ids.copyCopied, undefined);
  assert.equal(ids.blockCopied, undefined);
  return ids;
}

async function dirtyF1WithBlockEdit(edit, assertCommit2) {
  const cleanIds = await cleanF1WithBlockIds();
  const seed = await seedF1WithBlock();
  const store = await storeFor(seed.repo, { Box: BOX_ID });
  const opened = await openLegacyAssembly(seed.gh, seed.repo, 'Box', {
    branch: 'main',
    pathIndex: store.pathIndexFor(seed.repo),
    knownAssemblyId: BOX_ID,
    assemblyIdIndex: { Box: BOX_ID },
  });
  const collapsedPin = opened.doc.parts.find((p) => p.name === 'Pin');
  assert.equal(collapsedPin.copiedFrom, SCENARIO_L_PIN_ID, 'collapse tags Pin with copiedFrom PIN');
  const doc = {
    ...opened.doc,
    parts: opened.doc.parts.map((part) => ({ ...part })),
  };
  edit(doc);
  const snapshots = [];
  const orig = seed.gh.commitFiles.bind(seed.gh);
  seed.gh.commitFiles = async (dest, opts) => {
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
  const out = await executeUpgrade(upgradeOpts(seed.gh, seed.repo, {
    store,
    workingCopy: {
      dirty: true,
      doc,
      scripts: opened.scripts,
    },
  }));
  assert.equal(out.status, 'upgraded_and_saved');
  assert.equal(out.commits, 2);
  assert.equal(snapshots.length, 2);
  const asmFile = snapshots[1].files.find((f) => f.path === assemblyIdPath(BOX_ID));
  assert.ok(asmFile, 'commit 2 rewrites the assembly for the working-copy edit');
  const commit2 = JSON.parse(asmFile.content);
  assert.equal(validateSurfJsonV2(commit2).ok, true, validateSurfJsonV2(commit2).errors?.join('; '));
  const dirtyIds = f1PartIdentity(commit2);
  assert.equal(dirtyIds.pinId, cleanIds.pinId);
  assert.equal(dirtyIds.copyId, cleanIds.copyId);
  assert.equal(dirtyIds.blockId, cleanIds.blockId);
  assert.equal(dirtyIds.pinCopied, cleanIds.pinCopied);
  assert.equal(dirtyIds.copyCopied, cleanIds.copyCopied);
  assert.equal(dirtyIds.blockCopied, cleanIds.blockCopied);
  assert.equal(dirtyIds.pinCopied, undefined);
  const pin = commit2.parts.find((p) => p.name === 'Pin');
  assert.equal(Object.hasOwn(pin, 'copiedFrom'), false);
  assertCommit2(commit2);
}

test('F1 dirty rename matches clean Upgrade ids and copiedFrom (H1)', async () => {
  await dirtyF1WithBlockEdit((doc) => {
    const block = doc.parts.find((p) => p.name === 'Block');
    block.name = 'Block renamed';
  }, (json) => {
    const block = json.parts.find((p) => p.id === SCENARIO_L_BLOCK_ID);
    assert.equal(block.name, 'Block renamed');
  });
});

test('F1 dirty visibility change matches clean Upgrade ids and copiedFrom (H1)', async () => {
  await dirtyF1WithBlockEdit((doc) => {
    const block = doc.parts.find((p) => p.name === 'Block');
    block.visible = false;
  }, (json) => {
    const block = json.parts.find((p) => p.id === SCENARIO_L_BLOCK_ID);
    assert.equal(block.visible, false);
  });
});

test('F1 dirty placement change matches clean Upgrade ids and copiedFrom (H1)', async () => {
  const placement = { t: [4, 5, 6], q: [0, 0, 0.6, 0.8] };
  await dirtyF1WithBlockEdit((doc) => {
    const block = doc.parts.find((p) => p.name === 'Block');
    block.placement = { t: placement.t.slice(), q: placement.q.slice() };
    block.position = placement.t.slice();
  }, (json) => {
    const block = json.parts.find((p) => p.id === SCENARIO_L_BLOCK_ID);
    assert.deepEqual(block.position, [4, 5, 6]);
    assert.deepEqual(block.placement, placement);
  });
});

test('v1 copiedFrom remaps through a folded row id (H2)', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const make = (name, parts) => ({
    format: 'surfcad.assembly',
    version: 1,
    name,
    activeId: PIN_PATH,
    parts,
  });
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed H2 A3 Copy copiedFrom R1 folds to PIN',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/A1/.surf.json', `${JSON.stringify(make('A1', [
        { id: PIN_ID, path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
      ]), null, 2)}\n`),
      fileWrite('assemblies/A3/.surf.json', `${JSON.stringify(make('A3', [
        {
          id: G1_ROW_ID,
          path: PIN_PATH,
          name: 'Pin',
          visible: true,
          order: 0,
          copiedFrom: G1_ROW_ID,
        },
        {
          id: COPY_ID,
          path: A3_COPY_PATH,
          name: 'Copy',
          visible: true,
          order: 1,
          copiedFrom: G1_ROW_ID,
        },
        {
          id: N6_ORPHAN_ID,
          path: ORPHAN_PATH,
          name: 'Ghost',
          visible: true,
          order: 2,
          copiedFrom: DELETED_ID,
        },
      ]), null, 2)}\n`),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', PIN_ID)),
      fileWrite(A3_COPY_PATH, withSurfId('return "copy";\n', COPY_ID)),
      fileWrite(ORPHAN_PATH, withSurfId('return "ghost";\n', N6_ORPHAN_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { A1: A1_ID, A3: A3_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const a1 = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(A1_ID)));
  const a3 = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(A3_ID)));
  assert.equal(validateSurfJsonV2(a1).ok, true, validateSurfJsonV2(a1).errors?.join('; '));
  assert.equal(validateSurfJsonV2(a3).ok, true, validateSurfJsonV2(a3).errors?.join('; '));
  assert.equal(a1.parts[0].id, PIN_ID);
  assert.equal(a1.parts[0].copiedFrom, undefined);
  const pin = a3.parts.find((p) => p.name === 'Pin');
  const copy = a3.parts.find((p) => p.name === 'Copy');
  const ghost = a3.parts.find((p) => p.name === 'Ghost');
  assert.equal(pin.id, PIN_ID);
  assert.equal(pin.copiedFrom, undefined, 'remapped copiedFrom equal to own final id is dropped');
  assert.equal(copy.id, COPY_ID);
  assert.equal(copy.copiedFrom, PIN_ID, 'R1 folded into PIN');
  assert.equal(ghost.id, N6_ORPHAN_ID);
  assert.equal(ghost.copiedFrom, DELETED_ID, 'copiedFrom naming a deleted part is kept');
  assert.equal(readSurfId(await readText(gh, vault.repo, partIdPath(PIN_ID))), PIN_ID);
  assert.equal(result.plan.writes[partIdPath(G1_ROW_ID)], undefined);
});

test('duplicate copy row after Pin does not steal v1 copiedFrom PIN (I1 same assembly)', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: PIN_PATH,
    parts: [
      { id: PIN_ID, path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
      { id: PIN_ID, path: PIN_COPY_PATH, name: 'Copy', visible: true, order: 1 },
      {
        id: SCENARIO_L_BLOCK_ID,
        path: BLOCK_PATH,
        name: 'Other',
        visible: true,
        order: 2,
        copiedFrom: PIN_ID,
      },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed I1 same-assembly duplicate copy after Pin',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', PIN_ID)),
      fileWrite(PIN_COPY_PATH, withSurfId('return "pin-copy";\n', PIN_ID)),
      fileWrite(BLOCK_PATH, withSurfId('return "other";\n', SCENARIO_L_BLOCK_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const box = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BOX_ID)));
  assert.equal(validateSurfJsonV2(box).ok, true, validateSurfJsonV2(box).errors?.join('; '));
  const pin = box.parts.find((p) => p.name === 'Pin');
  const copy = box.parts.find((p) => p.name === 'Copy');
  const other = box.parts.find((p) => p.name === 'Other');
  assert.equal(pin.id, PIN_ID);
  assert.equal(pin.copiedFrom, undefined);
  assert.notEqual(copy.id, PIN_ID);
  assert.equal(other.id, SCENARIO_L_BLOCK_ID);
  assert.equal(other.copiedFrom, PIN_ID, 'v1 copiedFrom PIN still names Pin, not the copy');
});

test('duplicate copy row after Pin does not steal v1 copiedFrom PIN (I1 across assemblies)', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const make = (name, parts) => ({
    format: 'surfcad.assembly',
    version: 1,
    name,
    activeId: parts[0].path,
    parts,
  });
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed I1 cross-assembly duplicate copy after Pin',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Alpha/.surf.json', `${JSON.stringify(make('Alpha', [
        { id: PIN_ID, path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
      ]), null, 2)}\n`),
      fileWrite('assemblies/Beta/.surf.json', `${JSON.stringify(make('Beta', [
        { id: PIN_ID, path: PIN_COPY_PATH, name: 'Copy', visible: true, order: 0 },
        {
          id: SCENARIO_L_BLOCK_ID,
          path: BLOCK_PATH,
          name: 'Other',
          visible: true,
          order: 1,
          copiedFrom: PIN_ID,
        },
      ]), null, 2)}\n`),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', PIN_ID)),
      fileWrite(PIN_COPY_PATH, withSurfId('return "pin-copy";\n', PIN_ID)),
      fileWrite(BLOCK_PATH, withSurfId('return "other";\n', SCENARIO_L_BLOCK_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Alpha: ALPHA_ID, Beta: BETA_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, { store }));
  assert.equal(result.status, 'upgraded');
  const alpha = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(ALPHA_ID)));
  const beta = JSON.parse(await readText(gh, vault.repo, assemblyIdPath(BETA_ID)));
  assert.equal(validateSurfJsonV2(alpha).ok, true, validateSurfJsonV2(alpha).errors?.join('; '));
  assert.equal(validateSurfJsonV2(beta).ok, true, validateSurfJsonV2(beta).errors?.join('; '));
  assert.equal(alpha.parts[0].id, PIN_ID);
  assert.equal(alpha.parts[0].copiedFrom, undefined);
  const copy = beta.parts.find((p) => p.name === 'Copy');
  const other = beta.parts.find((p) => p.name === 'Other');
  assert.notEqual(copy.id, PIN_ID);
  assert.equal(other.id, SCENARIO_L_BLOCK_ID);
  assert.equal(other.copiedFrom, PIN_ID, 'v1 copiedFrom PIN still names Pin, not the copy');
});

test('follow-up ignores copiedFrom-only differences so commit 2 does not churn', () => {
  const pinScript = withSurfId('return "pin";\n', PIN_ID);
  const copyScript = withSurfId('return "pin-copy";\n', COPY_ID);
  const json = v1Surf('Box', [
    { id: PIN_ID, path: PIN_PATH, name: 'Pin' },
    { id: COPY_ID, path: PIN_COPY_PATH, name: 'PinCopy' },
  ]);
  const plan = planUpgrade({
    tree: [
      { path: 'assemblies/Box/.surf.json' },
      { path: PIN_PATH },
      { path: PIN_COPY_PATH },
    ],
    files: {
      'assemblies/Box/.surf.json': json,
      [PIN_PATH]: pinScript,
      [PIN_COPY_PATH]: withSurfId('return "pin-copy";\n', PIN_ID),
    },
    assemblyIdByFolder: { Box: BOX_ID },
    now: NOW,
    randFor,
    workingCopy: {
      doc: {
        id: BOX_ID,
        name: 'Box',
        activeId: PIN_ID,
        parts: [
          { id: PIN_ID, path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
          { id: COPY_ID, path: PIN_COPY_PATH, name: 'PinCopy', visible: true, order: 1, copiedFrom: PIN_ID },
        ],
      },
      scripts: { [PIN_ID]: pinScript, [COPY_ID]: copyScript },
    },
  });
  const box = JSON.parse(plan.writes[assemblyIdPath(BOX_ID)]);
  const copy = box.parts.find((p) => p.name === 'PinCopy');
  assert.equal(copy.id, COPY_ID);
  assert.equal(copy.copiedFrom, undefined, 'WC copiedFrom is not carried unless rule 4 allows it');
  const followup = planWorkingCopyFollowup(plan, {
    dirty: true,
    doc: {
      id: BOX_ID,
      name: 'Box',
      activeId: PIN_ID,
      parts: [
        { id: PIN_ID, path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
        { id: COPY_ID, path: PIN_COPY_PATH, name: 'PinCopy', visible: true, order: 1, copiedFrom: PIN_ID },
      ],
    },
    scripts: {
      [PIN_ID]: pinScript,
      [COPY_ID]: copyScript,
    },
  });
  assert.equal(followup.some((f) => f.path === assemblyIdPath(BOX_ID)), false);
});

test('jointed default placement is normalized so commit 2 does not rewrite .surf.json', () => {
  const pinScript = withSurfId('return "pin";\n', PIN_ID);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: PIN_PATH,
    parts: [
      { id: PIN_ID, path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
    ],
    joints: [{
      id: SCENARIO_L_JOINT_ID,
      name: 'Fixed 1',
      type: 'fixed',
      a: { part: PIN_ID },
    }],
  };
  const plan = planUpgrade({
    tree: [
      { path: 'assemblies/Box/.surf.json' },
      { path: PIN_PATH },
    ],
    files: {
      'assemblies/Box/.surf.json': `${JSON.stringify(raw, null, 2)}\n`,
      [PIN_PATH]: pinScript,
    },
    assemblyIdByFolder: { Box: BOX_ID },
    now: NOW,
    randFor,
  });
  const box = JSON.parse(plan.writes[assemblyIdPath(BOX_ID)]);
  assert.equal(validateSurfJsonV2(box).ok, true, validateSurfJsonV2(box).errors?.join('; '));
  assert.deepEqual(box.parts[0].placement, { t: [0, 0, 0], q: [0, 0, 0, 1] });
  const followup = planWorkingCopyFollowup(plan, {
    dirty: true,
    doc: {
      id: BOX_ID,
      name: 'Box',
      activeId: PIN_ID,
      parts: [{
        id: PIN_ID,
        path: PIN_PATH,
        name: 'Pin',
        visible: true,
        order: 0,
        placement: { t: [0, 0, 0], q: [0, 0, 0, 1] },
      }],
      joints: box.joints,
    },
    scripts: { [PIN_ID]: pinScript },
  });
  assert.equal(followup.some((f) => f.path === assemblyIdPath(BOX_ID)), false);
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
    paths: [partIdPath(SHAFT_ID)],
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

test('Get latest with no paths returns an error and writes nothing', async () => {
  const { gh, repo } = await seedGearboxVault();
  const writes = commits(gh).length;
  let listed = false;
  const origList = gh.listTree.bind(gh);
  gh.listTree = async (...args) => {
    listed = true;
    return origList(...args);
  };
  const missing = await executeUpgradeConflictChoice({
    action: 'reload',
    adapter: gh,
    repo,
    files: [fileWrite(partIdPath(SHAFT_ID), withSurfId('return "local-shaft";\n', SHAFT_ID))],
  });
  assert.equal(missing.status, 'error');
  assert.equal(missing.code, 'bad_args');
  assert.equal(listed, false);
  assert.equal(commits(gh).length, writes);

  const empty = await executeUpgradeConflictChoice({
    action: 'reload',
    adapter: gh,
    repo,
    files: [fileWrite(partIdPath(SHAFT_ID), withSurfId('return "local-shaft";\n', SHAFT_ID))],
    paths: [],
  });
  assert.equal(empty.status, 'error');
  assert.equal(empty.code, 'bad_args');
  assert.equal(listed, false);
  assert.equal(commits(gh).length, writes);
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

test('App Upgrade re-key uses persistCollapsedWorkingCopy after an IDB snapshot', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const persistHelper = app.slice(
    app.indexOf('const persistUpgradeWorkingCopy'),
    app.indexOf('const handleUpgradeVault'),
  );
  assert.match(persistHelper, /persistCollapsedWorkingCopy\(/);
  assert.match(persistHelper, /heldScripts: sourceScripts/);
  assert.match(persistHelper, /saveDoc: saveAssemblyDocument/);
  assert.match(persistHelper, /load: loadPartScript/);
  assert.match(persistHelper, /rollbackFailedUpgradeDocSave/);
  const upgrade = app.slice(
    app.indexOf('const handleUpgradeVault'),
    app.indexOf('const handleUpgradeConflict'),
  );
  assert.match(upgrade, /loadAssemblyDocumentStatus\(/);
  assert.match(upgrade, /loadPartScripts\(snapshotIds\)/);
  assert.ok(upgrade.indexOf('loadAssemblyDocumentStatus') < upgrade.indexOf('executeUpgrade'));
  assert.match(upgrade, /persistUpgradeWorkingCopy\(/);
  assert.match(upgrade, /adoptUpgradeWorkingCopy\(/);
  assert.match(upgrade, /workingCopyUnpersistedResult/);
  assert.equal(/replaceScriptKeys/.test(upgrade), false);
  assert.match(upgrade, /already_upgraded/);
  assert.match(upgrade, /journalPairs/);
  const conflict = app.slice(
    app.indexOf('const handleUpgradeConflict'),
    app.indexOf('const absorbOverwriteFiles'),
  );
  assert.match(conflict, /persistUpgradeWorkingCopy\(/);
  assert.match(conflict, /persistConflictWorkingCopy/);
  assert.equal(/replaceScriptKeys/.test(conflict), false);
  assert.match(conflict, /action === 'overwrite'|status === 'committed'/);
  assert.match(conflict, /status === 'reloaded'/);
  assert.match(conflict, /status === 'branched'/);
});

test('handleUpgradeVault uses isUpgradeWorkingCopyDirty vs the open baseline', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const start = app.indexOf('const handleUpgradeVault');
  const slice = app.slice(start, app.indexOf('const handleUpgradeConflict', start));
  assert.match(slice, /isUpgradeWorkingCopyDirty\(/);
  assert.equal(/scripts\[doc\.activeId\] = live/.test(slice.split('isUpgradeWorkingCopyDirty')[0]), false);
});

test('already_upgraded does not mark a dirty working copy clean', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const start = app.indexOf('const handleUpgradeVault');
  const end = app.indexOf('const handleUpgradeConflict', start);
  const slice = app.slice(start, end);
  assert.match(slice, /result\.status === 'already_upgraded'/);
  assert.match(slice, /result\.status !== 'already_upgraded' \|\| !dirty/);
  const recapture = slice.slice(slice.indexOf('const recapture'));
  const recaptureBlock = recapture.slice(0, recapture.indexOf('} else if'));
  assert.match(recaptureBlock, /already_upgraded' \|\| !dirty/);
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
  assert.match(gitCommit, /doc\.vaultLayout === 'v2' && upgradeVaultEnabled\(\)/);
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
  const committingAt = feed.indexOf('>Committing…</p>');
  assert.ok(committingAt >= 0);
  const busy = feed.slice(feed.lastIndexOf('{commitFlow.stage === \'busy\'', committingAt), committingAt + 20);
  assert.match(busy, /upgradeAvailable/);
  assert.match(busy, /commitFlow.upgrading/);
  assert.match(busy, /phase === 'upgrade'/);
  assert.match(busy, /phase === 'save'/);
  assert.match(busy, /className="text-xs text-chrome-secondary" data-git-dialog-loading="">Committing…/);
});

function staticRelativeImports(file) {
  const specs = [];
  const text = readFileSync(file, 'utf8');
  const patterns = [
    /(?:^|\n)\s*import(?:\s+type)?[\s\S]*?from\s+['"](\.[^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+\{[\s\S]*?\}\s*from\s+['"](\.[^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+\*(?:\s+as\s+\w+)?\s+from\s+['"](\.[^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) specs.push(m[1]);
  }
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
  const index = join(ROOT, 'src/utils/git/legacyVault/index.js');
  const lastText = readFileSync(last, 'utf8');
  assert.equal(/legacyVault\/index/.test(lastText), false);
  assert.equal(/from ['"][^'"]*legacyVault['"]/.test(lastText), false);
  assert.match(lastText, /from ['"][^'"]*legacyVault\/reader\.js['"]/);
  const fromIndex = reachableFrom(index);
  assert.equal(fromIndex.has(upgrade), true, 'export { … } from upgrade.js must be followed');
  const fromLast = reachableFrom(last);
  assert.equal(fromLast.has(upgrade), false);
  assert.equal(fromLast.has(index), false);
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

test('executeUpgrade does not pass workingCopy to planUpgrade', () => {
  const text = readFileSync(join(ROOT, 'src/utils/git/legacyVault/upgrade.js'), 'utf8');
  const call = text.slice(text.indexOf('plan = planUpgrade({'), text.indexOf('});', text.indexOf('plan = planUpgrade({')) + 2);
  assert.equal(/workingCopy/.test(call), false);
});

function studyBlock(partId) {
  return `// --- fea-study begin ---\n// @fea-study ${JSON.stringify({
    fixtures: [{ faces: [{ part: partId, faceID: 0, at: [0, 0, 0], n: [0, 0, 1], area: 1 }] }],
    contacts: [{ a: { part: partId }, b: { part: partId } }],
    scope: { ids: [partId] },
    parts: [{ id: partId }],
  })}\n// --- fea-study end ---\n`;
}

test('mapWorkingCopyToPlan rewrites studies and copiedFrom from the plan', () => {
  const planJson = {
    format: 'surfcad.assembly',
    version: 2,
    id: BOX_ID,
    name: 'Box',
    parts: [
      { id: PIN_ID, name: 'Pin' },
      { id: COPY_ID, name: 'Copy', copiedFrom: PIN_ID },
    ],
  };
  const plan = {
    partIdByPath: { [PIN_PATH]: PIN_ID, [PIN_COPY_PATH]: COPY_ID },
    keptPartIds: [PIN_ID],
    mintedPartIds: [COPY_ID],
    folderToId: { Box: BOX_ID },
    writes: { [assemblyIdPath(BOX_ID)]: `${JSON.stringify(planJson)}\n` },
  };
  const wcCopyId = mintSurfId({ now: NOW, rand: 'wcc0' });
  const script = `return "copy";\n${studyBlock(wcCopyId)}`;
  const mapped = mapWorkingCopyToPlan(plan, {
    doc: {
      id: BOX_ID,
      name: 'Box',
      parts: [
        { id: PIN_ID, path: PIN_PATH, name: 'Pin' },
        { id: wcCopyId, path: PIN_COPY_PATH, name: 'Copy', copiedFrom: wcCopyId },
      ],
      groups: [{ id: GROUP_ID, partIds: [PIN_ID, wcCopyId] }],
      colors: { [wcCopyId]: { part: '#cc0000' } },
      joints: [{ id: SCENARIO_L_JOINT_ID, a: { part: wcCopyId } }],
    },
    scripts: {
      [PIN_ID]: 'return "pin";\n',
      [wcCopyId]: script,
    },
  });
  assert.equal(mapped.ok, true);
  const copy = mapped.doc.parts.find((part) => part.name === 'Copy');
  assert.equal(copy.id, COPY_ID);
  assert.equal(copy.copiedFrom, PIN_ID);
  assert.deepEqual(mapped.doc.groups[0].partIds, [PIN_ID, COPY_ID]);
  assert.equal(mapped.doc.colors[COPY_ID].part, '#cc0000');
  assert.equal(mapped.doc.joints[0].a.part, COPY_ID);
  const rewritten = rewriteFeaStudyPartIds(mapped.scripts[COPY_ID], new Map([[wcCopyId, COPY_ID]]));
  assert.equal(rewritten, mapped.scripts[COPY_ID]);
  assert.equal(mapped.scripts[COPY_ID].includes(wcCopyId), false);
  assert.equal(mapped.scripts[COPY_ID].includes(COPY_ID), true);
  assert.equal(readSurfId(mapped.scripts[COPY_ID]), COPY_ID);
});

async function persistUpgradeRekey({
  nextDoc,
  nextScripts,
  pairs,
  sourceDoc,
  sourceScripts,
  save,
  load,
  remove,
  saveDoc,
  apply,
}) {
  return persistCollapsedWorkingCopy({
    collapsed: { doc: nextDoc, scripts: nextScripts, pairs },
    sourceDoc,
    sourceScripts,
    heldScripts: sourceScripts,
    save,
    load,
    remove,
    saveDoc,
    apply,
  });
}

function cloneDoc(doc) {
  return JSON.parse(JSON.stringify(doc));
}

/** Same as App.jsx vault-open: remember each WC row's surf id at its path. */
async function seedAppPathIndex(store, repo, doc) {
  for (const part of doc?.parts || []) {
    const sid = partSurfId(part);
    const path = partRepoPath(part);
    if (sid && path) await store.rememberPathId(repo, path, sid);
  }
}

function f1AppOpenDoc() {
  return {
    id: BOX_ID,
    name: 'Box',
    source: 'git',
    vaultLayout: 'legacy',
    activeId: SCENARIO_L_PIN_ID,
    parts: [
      {
        id: SCENARIO_L_PIN_ID,
        path: PIN_COPY_SCENARIO_PATH,
        name: 'Pin copy',
        visible: true,
        order: 0,
      },
      {
        id: F1_PIN_MINTED_ID,
        path: PIN_PATH,
        name: 'Pin',
        visible: true,
        order: 1,
        copiedFrom: SCENARIO_L_PIN_ID,
      },
    ],
  };
}

function f1AppOpenScripts() {
  return {
    [SCENARIO_L_PIN_ID]: withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID),
    [F1_PIN_MINTED_ID]: withSurfId('return "pin";\n', F1_PIN_MINTED_ID),
  };
}

async function seedF1AppOpenHost() {
  const env = await seedF1BoxVault();
  const sourceDoc = f1AppOpenDoc();
  const sourceScripts = f1AppOpenScripts();
  await seedAppPathIndex(env.store, env.repo, sourceDoc);
  env.workingCopy = { dirty: false, doc: sourceDoc, scripts: sourceScripts };
  env.ctx = {
    idb: new Map(Object.entries(sourceScripts)),
    savedDoc: cloneDoc(sourceDoc),
    memory: { doc: cloneDoc(sourceDoc), scripts: { ...sourceScripts } },
    journal: [],
    idbOps: 0,
  };
  return env;
}

async function seedF1BoxVault() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: PIN_COPY_SCENARIO_PATH,
    parts: [
      { id: SCENARIO_L_PIN_ID, path: PIN_COPY_SCENARIO_PATH, name: 'Pin copy', visible: true, order: 0 },
      { path: PIN_PATH, name: 'Pin', visible: true, order: 1 },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed F1 for WC rekey persist',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', SCENARIO_L_PIN_ID)),
      fileWrite(PIN_COPY_SCENARIO_PATH, withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const sourceDoc = {
    id: BOX_ID,
    name: 'Box',
    source: 'git',
    activeId: SCENARIO_L_PIN_ID,
    parts: [
      { id: SCENARIO_L_PIN_ID, path: PIN_COPY_SCENARIO_PATH, name: 'Pin copy', visible: true, order: 0 },
      { id: PIN_PATH, path: PIN_PATH, name: 'Pin', visible: true, order: 1 },
    ],
  };
  const sourceScripts = {
    [SCENARIO_L_PIN_ID]: withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID),
    [PIN_PATH]: withSurfId('return "pin";\n', SCENARIO_L_PIN_ID),
  };
  return {
    gh,
    repo: vault.repo,
    store,
    workingCopy: { dirty: false, doc: sourceDoc, scripts: sourceScripts },
    ctx: {
      idb: new Map(Object.entries(sourceScripts)),
      savedDoc: cloneDoc(sourceDoc),
      memory: { doc: cloneDoc(sourceDoc), scripts: { ...sourceScripts } },
      journal: [],
    },
  };
}

async function seedTwoMintHost() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: PIN_PATH,
    parts: [
      { path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
      { path: BLOCK_PATH, name: 'Block', visible: true, order: 1 },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed two minted WC rows',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(PIN_PATH, 'return "pin";\n'),
      fileWrite(BLOCK_PATH, 'return "block";\n'),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const sourceDoc = {
    id: BOX_ID,
    name: 'Box',
    source: 'git',
    activeId: PIN_PATH,
    parts: [
      { id: PIN_PATH, path: PIN_PATH, name: 'Pin', visible: true, order: 0 },
      { id: BLOCK_PATH, path: BLOCK_PATH, name: 'Block', visible: true, order: 1 },
    ],
  };
  const sourceScripts = {
    [PIN_PATH]: 'return "pin";\n',
    [BLOCK_PATH]: 'return "block";\n',
  };
  return {
    gh,
    repo: vault.repo,
    store,
    workingCopy: { dirty: false, doc: sourceDoc, scripts: sourceScripts },
    ctx: {
      idb: new Map(Object.entries(sourceScripts)),
      savedDoc: cloneDoc(sourceDoc),
      memory: { doc: cloneDoc(sourceDoc), scripts: { ...sourceScripts } },
      journal: [],
    },
    minted: { pin: F1_PIN_MINTED_ID, block: SCENARIO_L_BLOCK_ID },
  };
}

async function hostUpgradeOnce(env, {
  failPutFor = new Set(),
  saveDocFails = false,
  saveDocThrows = false,
  crashAfter,
} = {}) {
  const workingCopy = {
    ...env.workingCopy,
    doc: env.ctx.memory.doc,
    scripts: env.ctx.memory.scripts,
  };
  const snapshotDoc = cloneDoc(env.ctx.savedDoc);
  const snapshotScripts = Object.fromEntries(env.ctx.idb);
  const memoryIds = (env.ctx.memory.doc?.parts || []).map((part) => part.id).filter(Boolean);
  for (const id of memoryIds) {
    if (typeof env.ctx.memory.scripts[id] === 'string' && !snapshotScripts[id]) {
      snapshotScripts[id] = env.ctx.memory.scripts[id];
    }
  }
  env.ctx.idbOps = 0;
  const restoreIdb = async (id, bytes) => {
    env.ctx.idbOps += 1;
    env.ctx.idb.set(id, bytes);
  };
  const removeIdb = async (id) => {
    env.ctx.idbOps += 1;
    env.ctx.idb.delete(id);
  };
  const result = await executeUpgrade(upgradeOpts(env.gh, env.repo, {
    store: env.store,
    workingCopy,
  }));
  const adopted = await adoptUpgradeWorkingCopy({
    result,
    workingCopy,
    adapter: env.gh,
    repo: env.repo,
    branch: 'main',
    store: env.store,
    sourceDoc: snapshotDoc,
    journalPairs: env.ctx.journal,
    persist: async ({ nextDoc, nextScripts, pairs }) => {
      const persisted = await persistCollapsedWorkingCopy({
        collapsed: { doc: nextDoc, scripts: nextScripts, pairs },
        sourceDoc: snapshotDoc,
        sourceScripts: snapshotScripts,
        heldScripts: snapshotScripts,
        save: async (id, script) => {
          env.ctx.idbOps += 1;
          if (failPutFor.has(id)) return false;
          env.ctx.idb.set(id, script);
          return true;
        },
        load: async (id) => env.ctx.idb.get(id),
        remove: async (id) => { await removeIdb(id); },
        saveDoc: async (doc) => {
          if (saveDocThrows) throw new Error('saveDoc boom');
          if (saveDocFails) return null;
          env.ctx.savedDoc = cloneDoc(doc);
          return doc;
        },
        apply: ({ doc, scripts }) => {
          env.ctx.memory.doc = cloneDoc(doc);
          env.ctx.memory.scripts = { ...scripts };
        },
        saveJournal: async (journal) => {
          env.ctx.journal = Array.isArray(journal?.pairs) ? journal.pairs.map((row) => ({ ...row })) : [];
        },
        clearJournal: async () => { env.ctx.journal = []; },
        crashAfter,
      });
      await rollbackFailedUpgradeDocSave(persisted, {
        sourceDoc: snapshotDoc,
        restore: restoreIdb,
        remove: removeIdb,
      });
      return persisted;
    },
    restoreScripts: restoreIdb,
    removeOrphans: async (ids) => {
      for (const id of ids || []) await removeIdb(id);
    },
  });
  if (adopted.status === 'ok' && adopted.persisted) {
    env.ctx.memory.doc = cloneDoc(adopted.persisted.doc);
    env.ctx.memory.scripts = { ...adopted.persisted.scripts };
    env.ctx.savedDoc = cloneDoc(adopted.persisted.doc);
  }
  return { result, adopted };
}

async function assertHostWcBytesEqualVault(env, { assemblyId = BOX_ID } = {}) {
  const vaultJson = await readText(env.gh, env.repo, assemblyIdPath(assemblyId));
  assert.equal(stringifySurfJsonV2(env.ctx.memory.doc), vaultJson);
  assert.equal(stringifySurfJsonV2(env.ctx.savedDoc), vaultJson);
  const box = JSON.parse(vaultJson);
  const vaultIds = box.parts.map((part) => part.id).sort();
  assert.deepEqual([...env.ctx.memory.doc.parts.map((part) => part.id)].sort(), vaultIds);
  assert.deepEqual([...env.ctx.idb.keys()].sort(), vaultIds);
  assert.equal(workingCopyMatchesVaultTip(
    env.ctx.memory.doc,
    env.ctx.memory.scripts,
    { assemblyText: vaultJson, json: box, partScripts: Object.fromEntries(await Promise.all(
      box.parts.map(async (part) => [part.id, await readText(env.gh, env.repo, partIdPath(part.id))]),
    )) },
  ), true);
  for (const part of box.parts) {
    const vaultScript = await readText(env.gh, env.repo, partIdPath(part.id));
    assert.equal(env.ctx.idb.get(part.id), vaultScript, `${part.name} IDB script`);
    assert.equal(env.ctx.memory.scripts[part.id], vaultScript, `${part.name} memory script`);
    assert.equal(readSurfName(vaultScript), part.name);
  }
}

async function assertHostWcEqualsVault(env, { pinId, copyId, pinName = 'Pin', copyName = 'Pin copy' } = {}) {
  const box = JSON.parse(await readText(env.gh, env.repo, assemblyIdPath(BOX_ID)));
  const byName = Object.fromEntries(box.parts.map((part) => [part.name, part]));
  const pin = env.ctx.memory.doc.parts.find((part) => part.name === pinName);
  const copy = env.ctx.memory.doc.parts.find((part) => part.name === copyName);
  assert.equal(pin.id, pinId || byName[pinName].id);
  if (copyName) assert.equal(copy.id, copyId || byName[copyName].id);
  const vaultIds = box.parts.map((part) => part.id).sort();
  assert.deepEqual([...env.ctx.memory.doc.parts.map((part) => part.id)].sort(), vaultIds);
  assert.deepEqual([...env.ctx.idb.keys()].sort(), vaultIds);
  for (const id of vaultIds) {
    assert.equal(readSurfId(env.ctx.idb.get(id)), id);
    assert.equal(readSurfId(env.ctx.memory.scripts[id]), id);
  }
}

test('clean Upgrade rekey maps F1 WC ids onto vault minted ids', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const raw = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Box',
    activeId: PIN_COPY_SCENARIO_PATH,
    parts: [
      { id: SCENARIO_L_PIN_ID, path: PIN_COPY_SCENARIO_PATH, name: 'Pin copy', visible: true, order: 0 },
      { path: PIN_PATH, name: 'Pin', visible: true, order: 1 },
    ],
  };
  await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed F1 for WC rekey',
    baseSha: vault.headSha,
    files: [
      fileWrite('assemblies/Box/.surf.json', `${JSON.stringify(raw, null, 2)}\n`),
      fileWrite(PIN_PATH, withSurfId('return "pin";\n', SCENARIO_L_PIN_ID)),
      fileWrite(PIN_COPY_SCENARIO_PATH, withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID)),
    ],
  });
  const store = await storeFor(vault.repo, { Box: BOX_ID });
  const result = await executeUpgrade(upgradeOpts(gh, vault.repo, {
    store,
    workingCopy: {
      dirty: false,
      doc: {
        id: BOX_ID,
        name: 'Box',
        activeId: SCENARIO_L_PIN_ID,
        parts: [
          { id: SCENARIO_L_PIN_ID, path: PIN_COPY_SCENARIO_PATH, name: 'Pin copy', visible: true, order: 0 },
          { id: PIN_PATH, path: PIN_PATH, name: 'Pin', visible: true, order: 1 },
        ],
      },
      scripts: {
        [SCENARIO_L_PIN_ID]: withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID),
        [PIN_PATH]: withSurfId('return "pin";\n', SCENARIO_L_PIN_ID),
      },
    },
  }));
  assert.equal(result.status, 'upgraded');
  assert.equal(result.commits, 1);
  const copy = result.rekey.doc.parts.find((part) => part.name === 'Pin copy');
  const pin = result.rekey.doc.parts.find((part) => part.name === 'Pin');
  assert.equal(copy.id, SCENARIO_L_PIN_ID);
  assert.equal(pin.id, F1_PIN_MINTED_ID);
  assert.equal(readSurfId(result.rekey.scripts[copy.id]), SCENARIO_L_PIN_ID);
  assert.equal(readSurfId(result.rekey.scripts[pin.id]), F1_PIN_MINTED_ID);
  const sourceScripts = {
    [SCENARIO_L_PIN_ID]: withSurfId('return "pin-copy";\n', SCENARIO_L_PIN_ID),
    [PIN_PATH]: withSurfId('return "pin";\n', SCENARIO_L_PIN_ID),
  };
  const idb = new Map(Object.entries(sourceScripts));
  let savedDoc = {
    parts: [
      { id: SCENARIO_L_PIN_ID, name: 'Pin copy' },
      { id: PIN_PATH, name: 'Pin' },
    ],
  };
  const persisted = await persistUpgradeRekey({
    nextDoc: result.rekey.doc,
    nextScripts: result.rekey.scripts,
    pairs: result.rekey.pairs,
    sourceDoc: savedDoc,
    sourceScripts: Object.fromEntries(idb),
    save: async (id, script) => { idb.set(id, script); return true; },
    load: async (id) => idb.get(id),
    remove: async (id) => { idb.delete(id); },
    saveDoc: async (doc) => { savedDoc = doc; return doc; },
  });
  assert.equal(persisted.docSaved, true);
  assert.equal(persisted.doc.parts.find((part) => part.name === 'Pin copy').id, SCENARIO_L_PIN_ID);
  assert.equal(persisted.doc.parts.find((part) => part.name === 'Pin').id, F1_PIN_MINTED_ID);
  assert.equal(idb.get(SCENARIO_L_PIN_ID) != null, true);
  assert.equal(idb.get(F1_PIN_MINTED_ID) != null, true);
  assert.equal(idb.has(PIN_PATH), false);
});

test('dirty Upgrade persist writes new keys before deleting from', async () => {
  const from = PIN_ID;
  const to = COPY_ID;
  const idb = new Map([[from, 'old pin']]);
  const order = [];
  let savedDoc = { parts: [{ id: from, name: 'Pin' }] };
  const persisted = await persistUpgradeRekey({
    nextDoc: { parts: [{ id: to, name: 'Copy' }], activeId: to },
    nextScripts: { [to]: 'new copy' },
    pairs: [{ from, to }],
    sourceDoc: savedDoc,
    sourceScripts: { [from]: 'old pin' },
    save: async (id, script) => {
      order.push(['save', id]);
      idb.set(id, script);
      return true;
    },
    load: async (id) => idb.get(id),
    remove: async (id) => {
      order.push(['delete', id]);
      idb.delete(id);
    },
    saveDoc: async (doc) => {
      order.push(['saveDoc']);
      savedDoc = doc;
      return doc;
    },
  });
  assert.equal(persisted.docSaved, true);
  assert.deepEqual(order[0], ['save', to]);
  const saveDocAt = order.findIndex((step) => step[0] === 'saveDoc');
  const deleteAt = order.findIndex((step) => step[0] === 'delete' && step[1] === from);
  assert.ok(saveDocAt > 0, 'saveDoc must run after putting the new key');
  assert.ok(deleteAt > saveDocAt, 'from is deleted only after saveDoc');
  assert.equal(idb.get(to), 'new copy');
  assert.equal(idb.has(from), false);
  assert.equal(savedDoc.parts[0].id, to);
});

test('failed putVerified leaves the old Upgrade WC', async () => {
  const from = PIN_ID;
  const to = COPY_ID;
  const idb = new Map([[from, 'old pin']]);
  let savedDoc = { parts: [{ id: from, name: 'Pin' }], activeId: from };
  const persisted = await persistUpgradeRekey({
    nextDoc: { parts: [{ id: to, name: 'Copy' }], activeId: to },
    nextScripts: { [to]: 'new copy' },
    pairs: [{ from, to }],
    sourceDoc: savedDoc,
    sourceScripts: { [from]: 'old pin' },
    save: async () => false,
    load: async (id) => idb.get(id),
    remove: async (id) => { idb.delete(id); },
    saveDoc: async (doc) => { savedDoc = doc; return doc; },
  });
  assert.equal(persisted.doc.parts[0].id, from);
  assert.equal(idb.has(from), true);
  assert.equal(idb.has(to), false);
});

test('failed saveDoc leaves the old Upgrade WC', async () => {
  const from = PIN_ID;
  const to = COPY_ID;
  const idb = new Map([[from, 'old pin']]);
  let savedDoc = { parts: [{ id: from, name: 'Pin' }], activeId: from };
  const memory = { doc: savedDoc, scripts: { [from]: 'old pin' } };
  const persisted = await persistUpgradeRekey({
    nextDoc: { parts: [{ id: to, name: 'Copy' }], activeId: to },
    nextScripts: { [to]: 'new copy' },
    pairs: [{ from, to }],
    sourceDoc: savedDoc,
    sourceScripts: { [from]: 'old pin' },
    save: async (id, script) => { idb.set(id, script); return true; },
    load: async (id) => idb.get(id),
    remove: async (id) => { idb.delete(id); },
    saveDoc: async () => null,
    apply: ({ doc, scripts }) => {
      memory.doc = doc;
      memory.scripts = scripts;
    },
  });
  assert.equal(persisted.docSaved, false);
  assert.equal(persisted.doc.parts[0].id, from);
  assert.equal(memory.doc.parts[0].id, from);
  assert.equal(idb.get(from), 'old pin');
});

test('saveDoc fails after the Upgrade commit, then retry: WC == vault, no orphan keys, no extra git writes', async () => {
  const env = await seedF1BoxVault();
  const writesAfterSeed = commits(env.gh).length;
  const first = await hostUpgradeOnce(env, { saveDocFails: true });
  assert.equal(first.result.status, 'upgraded');
  assert.equal(first.adopted.status, 'error');
  assert.equal(first.adopted.result.code, 'working_copy_unpersisted');
  assert.equal(first.adopted.result.hint, WORKING_COPY_UNPERSISTED_HINT);
  assert.equal(commits(env.gh).length, writesAfterSeed + 1);
  assert.equal(env.ctx.idb.has(PIN_PATH), true);
  assert.equal(env.ctx.idb.has(F1_PIN_MINTED_ID), false, 'orphan to-key cleaned after saveDoc fail');
  assert.equal(env.ctx.memory.doc.parts.find((part) => part.name === 'Pin').id, PIN_PATH);

  const retry = await hostUpgradeOnce(env);
  assert.equal(retry.result.status, 'already_upgraded');
  assert.equal(retry.adopted.status, 'ok');
  assert.equal(commits(env.gh).length, writesAfterSeed + 1, 'retry must not write git');
  await assertHostWcEqualsVault(env, { pinId: F1_PIN_MINTED_ID, copyId: SCENARIO_L_PIN_ID });
});

test('put fails for one to-key: working_copy_unpersisted, then retry gives WC == vault', async () => {
  const env = await seedTwoMintHost();
  const writesAfterSeed = commits(env.gh).length;
  const first = await hostUpgradeOnce(env, { failPutFor: new Set([env.minted.block]) });
  assert.equal(first.result.status, 'upgraded');
  assert.equal(first.adopted.status, 'error');
  assert.equal(first.adopted.result.code, 'working_copy_unpersisted');
  assert.equal(first.adopted.result.hint, WORKING_COPY_UNPERSISTED_HINT);
  assert.equal(upgradePersistIncomplete(first.adopted.persisted), true);
  assert.ok(first.adopted.persisted.failedFrom.size > 0);
  const pin = env.ctx.memory.doc.parts.find((part) => part.name === 'Pin');
  const block = env.ctx.memory.doc.parts.find((part) => part.name === 'Block');
  assert.equal(pin.id, env.minted.pin);
  assert.equal(block.id, BLOCK_PATH);
  assert.equal(env.ctx.idb.has(env.minted.pin), true);
  assert.equal(env.ctx.idb.has(env.minted.block), false);
  assert.equal(commits(env.gh).length, writesAfterSeed + 1);

  const retry = await hostUpgradeOnce(env);
  assert.equal(retry.result.status, 'already_upgraded');
  assert.equal(retry.adopted.status, 'ok');
  assert.equal(commits(env.gh).length, writesAfterSeed + 1);
  await assertHostWcEqualsVault(env, {
    pinId: env.minted.pin,
    copyId: env.minted.block,
    copyName: 'Block',
  });
});

test('crash after each persist step, then retry: WC == vault', async () => {
  for (const step of [0, 1, 2, 3]) {
    const env = await seedF1BoxVault();
    const writesAfterSeed = commits(env.gh).length;
    const first = await hostUpgradeOnce(env, { crashAfter: step });
    assert.equal(first.result.status, 'upgraded', `crashAfter ${step}: upgrade committed`);
    assert.equal(first.adopted.status, 'error', `crashAfter ${step}: persist incomplete`);
    assert.equal(first.adopted.result.code, 'working_copy_unpersisted', `crashAfter ${step}`);
    assert.equal(commits(env.gh).length, writesAfterSeed + 1, `crashAfter ${step}: no extra git write`);

    const retry = await hostUpgradeOnce(env);
    assert.equal(retry.result.status, 'already_upgraded', `crashAfter ${step}: retry is already_upgraded`);
    assert.equal(retry.adopted.status, 'ok', `crashAfter ${step}: retry persist ok`);
    assert.equal(commits(env.gh).length, writesAfterSeed + 1, `crashAfter ${step}: retry writes no git`);
    await assertHostWcEqualsVault(env, { pinId: F1_PIN_MINTED_ID, copyId: SCENARIO_L_PIN_ID });
  }
});

test('orphanUpgradeScriptIds lists unreferenced to-keys only when saveDoc failed', () => {
  const sourceDoc = { parts: [{ id: PIN_PATH }] };
  assert.deepEqual(orphanUpgradeScriptIds({
    docSaved: false,
    saved: new Set([PIN_PATH, F1_PIN_MINTED_ID]),
  }, sourceDoc), [F1_PIN_MINTED_ID]);
  assert.deepEqual(orphanUpgradeScriptIds({
    docSaved: false,
    saved: new Set([PIN_PATH]),
    snapshot: { [PIN_PATH]: 'unstamped' },
  }, sourceDoc), [], 'same-key snapshot writes are not orphans');
  assert.deepEqual(orphanUpgradeScriptIds({
    docSaved: true,
    saved: new Set([F1_PIN_MINTED_ID]),
    failedFrom: new Set([PIN_PATH]),
  }, sourceDoc), []);
  assert.equal(workingCopyUnpersistedResult().hint, WORKING_COPY_UNPERSISTED_HINT);
  assert.equal(workingCopyUnmappedResult({ missing: ['x'] }).code, 'working_copy_unmapped');
});

test('already_upgraded with a vault part missing from the WC is working_copy_unmapped', async () => {
  const { gh, repo } = await seedGearboxVault();
  const store = await storeFor(repo);
  const first = await executeUpgrade(upgradeOpts(gh, repo, { store }));
  assert.equal(first.status, 'upgraded');
  const writes = commits(gh).length;
  const workingCopy = {
    dirty: false,
    doc: { id: GEARBOX_ID, name: 'Gearbox', parts: [{ id: SHAFT_ID, name: 'Shaft' }] },
    scripts: { [SHAFT_ID]: 'return 1;\n' },
  };
  const second = await executeUpgrade(upgradeOpts(gh, repo, { store, workingCopy }));
  assert.equal(second.status, 'already_upgraded');
  assert.equal(second.rekey, undefined);
  assert.equal(commits(gh).length, writes);
  let persisted = false;
  const adopted = await adoptUpgradeWorkingCopy({
    result: second,
    workingCopy,
    adapter: gh,
    repo,
    branch: 'main',
    store,
    persist: async () => {
      persisted = true;
      return { docSaved: true, failedFrom: new Set(), saved: new Set() };
    },
  });
  assert.equal(adopted.status, 'error');
  assert.equal(adopted.result.code, 'working_copy_unmapped');
  assert.match(adopted.result.message, /missing from the working copy/);
  assert.equal(adopted.persisted, undefined);
  assert.equal(persisted, false);
  assert.equal(commits(gh).length, writes);
});

test('Upgrade conflict overwrite, reload, and branch persist through persistUpgradeWorkingCopy', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const conflict = app.slice(
    app.indexOf('const handleUpgradeConflict'),
    app.indexOf('const absorbOverwriteFiles'),
  );
  assert.match(conflict, /persistConflictWorkingCopy/);
  assert.match(conflict, /upgradePersistIncomplete/);
  assert.match(conflict, /result\.status === 'reloaded'/);
  assert.match(conflict, /result\.status === 'committed'/);
  assert.match(conflict, /result\.status === 'branched'/);
  assert.equal(/replaceScriptKeys/.test(conflict), false);
});

test('mapWorkingCopyToV2Tip remaps leftover WC ids from the v2 tip and path index', async () => {
  const env = await seedF1BoxVault();
  const upgraded = await executeUpgrade(upgradeOpts(env.gh, env.repo, {
    store: env.store,
    workingCopy: env.workingCopy,
  }));
  assert.equal(upgraded.status, 'upgraded');
  const writes = commits(env.gh).length;
  const mapped = await mapWorkingCopyToV2Tip({
    adapter: env.gh,
    repo: env.repo,
    branch: 'main',
    store: env.store,
    workingCopy: env.workingCopy,
  });
  assert.equal(mapped.ok, true);
  const pin = mapped.doc.parts.find((part) => part.name === 'Pin');
  const copy = mapped.doc.parts.find((part) => part.name === 'Pin copy');
  assert.equal(pin.id, F1_PIN_MINTED_ID);
  assert.equal(copy.id, SCENARIO_L_PIN_ID);
  assert.equal(mapped.pairs.some((row) => row.from === PIN_PATH && row.to === F1_PIN_MINTED_ID), true);
  assert.equal(commits(env.gh).length, writes);
});

test('App Upgrade persist restores same-key snapshot bytes and recaptures after persist', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const persist = app.slice(
    app.indexOf('const persistUpgradeWorkingCopy'),
    app.indexOf('const handleUpgradeVault'),
  );
  assert.match(persist, /rollbackFailedUpgradeDocSave/);
  assert.match(persist, /savePartScript\(id, bytes\)/);
  const upgrade = app.slice(
    app.indexOf('const handleUpgradeVault'),
    app.indexOf('const handleUpgradeConflict'),
  );
  assert.match(upgrade, /restoreScripts/);
  assert.match(upgrade, /adopted\.persisted/);
  assert.match(upgrade, /rememberGitBaseline/);
  assert.match(app, /rememberPathId\(vault\.repo, partRepoPath\(part\), sid\)/);
});

test('App-seeded path index (M3 A): saveDoc fail then retry, WC stringify and scripts equal vault', async () => {
  for (const fail of [{ saveDocFails: true }, { saveDocThrows: true }]) {
    const env = await seedF1AppOpenHost();
    const writesAfterSeed = commits(env.gh).length;
    const first = await hostUpgradeOnce(env, fail);
    assert.equal(first.result.status, 'upgraded', JSON.stringify(fail));
    assert.deepEqual(first.result.rekey.pairs, [], 'App-seeded WC ids reuse vault ids');
    assert.equal(first.adopted.status, 'error');
    assert.equal(first.adopted.result.code, 'working_copy_unpersisted');
    assert.equal(commits(env.gh).length, writesAfterSeed + 1);
    const pin = env.ctx.memory.doc.parts.find((part) => part.name === 'Pin');
    assert.equal(pin.copiedFrom, SCENARIO_L_PIN_ID, 'backward copiedFrom kept after saveDoc fail');

    const retry = await hostUpgradeOnce(env);
    assert.equal(retry.result.status, 'already_upgraded');
    assert.equal(retry.adopted.status, 'ok', JSON.stringify(fail));
    assert.ok(retry.adopted.persisted, 'retry must persist copiedFrom/@name, not skip on ids');
    assert.equal(commits(env.gh).length, writesAfterSeed + 1, 'retry writes no git');
    await assertHostWcBytesEqualVault(env);
    const vaultPin = JSON.parse(stringifySurfJsonV2(env.ctx.memory.doc)).parts.find((part) => part.name === 'Pin');
    assert.equal(vaultPin.copiedFrom, undefined);

    const third = await hostUpgradeOnce(env);
    assert.equal(third.result.status, 'already_upgraded');
    assert.equal(third.adopted.status, 'ok');
    assert.equal(third.adopted.persisted, null, 'already equal to vault: skip persist');
    assert.equal(commits(env.gh).length, writesAfterSeed + 1);
  }
});

test('App-seeded path index (M3 B): crash after snapshot then retry stamps @name to match vault', async () => {
  const env = await seedF1AppOpenHost();
  const writesAfterSeed = commits(env.gh).length;
  const first = await hostUpgradeOnce(env, { crashAfter: 0 });
  assert.equal(first.result.status, 'upgraded');
  assert.deepEqual(first.result.rekey.pairs, []);
  assert.equal(first.adopted.status, 'error');
  assert.equal(first.adopted.result.code, 'working_copy_unpersisted');
  assert.equal(env.ctx.idbOps, 0, 'crash after step 0 writes no IDB');
  assert.equal(readSurfName(env.ctx.idb.get(F1_PIN_MINTED_ID)), null);
  assert.equal(readSurfName(env.ctx.idb.get(SCENARIO_L_PIN_ID)), null);
  assert.equal(commits(env.gh).length, writesAfterSeed + 1);

  const retry = await hostUpgradeOnce(env);
  assert.equal(retry.result.status, 'already_upgraded');
  assert.equal(retry.adopted.status, 'ok');
  assert.ok(retry.adopted.persisted);
  assert.ok(env.ctx.idbOps > 0, 'retry must persist stamped scripts');
  assert.equal(commits(env.gh).length, writesAfterSeed + 1);
  await assertHostWcBytesEqualVault(env);
  assert.equal(readSurfName(env.ctx.memory.scripts[F1_PIN_MINTED_ID]), 'Pin');
  assert.equal(readSurfName(env.ctx.memory.scripts[SCENARIO_L_PIN_ID]), 'Pin copy');
});

test('App-seeded path index (L4): saveDoc fail restores same-key snapshot bytes, then retry equals vault', async () => {
  const env = await seedF1AppOpenHost();
  const original = f1AppOpenScripts();
  const writesAfterSeed = commits(env.gh).length;
  const first = await hostUpgradeOnce(env, { saveDocFails: true });
  assert.equal(first.result.status, 'upgraded');
  assert.deepEqual(first.result.rekey.pairs, []);
  assert.equal(first.adopted.status, 'error');
  assert.equal(first.adopted.result.code, 'working_copy_unpersisted');
  assert.equal(env.ctx.idb.get(F1_PIN_MINTED_ID), original[F1_PIN_MINTED_ID]);
  assert.equal(env.ctx.idb.get(SCENARIO_L_PIN_ID), original[SCENARIO_L_PIN_ID]);
  assert.equal(readSurfName(env.ctx.idb.get(F1_PIN_MINTED_ID)), null);
  assert.equal(env.ctx.memory.doc.parts.find((part) => part.name === 'Pin').copiedFrom, SCENARIO_L_PIN_ID);
  assert.deepEqual([...env.ctx.idb.keys()].sort(), [F1_PIN_MINTED_ID, SCENARIO_L_PIN_ID].sort());
  assert.equal(commits(env.gh).length, writesAfterSeed + 1);

  const retry = await hostUpgradeOnce(env);
  assert.equal(retry.result.status, 'already_upgraded');
  assert.equal(retry.adopted.status, 'ok');
  assert.equal(commits(env.gh).length, writesAfterSeed + 1);
  await assertHostWcBytesEqualVault(env);
});

test('App-seeded path index (L5): missing vault Pin is working_copy_unmapped, then full WC retry equals vault', async () => {
  const env = await seedF1AppOpenHost();
  const writesAfterSeed = commits(env.gh).length;
  const first = await hostUpgradeOnce(env);
  assert.equal(first.result.status, 'upgraded');
  assert.equal(first.adopted.status, 'ok');
  assert.equal(commits(env.gh).length, writesAfterSeed + 1);
  await assertHostWcBytesEqualVault(env);

  const copyOnlyDoc = {
    ...f1AppOpenDoc(),
    parts: f1AppOpenDoc().parts.filter((part) => part.name === 'Pin copy'),
  };
  const copyOnlyScripts = { [SCENARIO_L_PIN_ID]: env.ctx.memory.scripts[SCENARIO_L_PIN_ID] };
  env.workingCopy = { dirty: false, doc: copyOnlyDoc, scripts: copyOnlyScripts };
  env.ctx.memory = { doc: cloneDoc(copyOnlyDoc), scripts: { ...copyOnlyScripts } };
  env.ctx.savedDoc = cloneDoc(copyOnlyDoc);
  await seedAppPathIndex(env.store, env.repo, copyOnlyDoc);

  const missing = await hostUpgradeOnce(env);
  assert.equal(missing.result.status, 'already_upgraded');
  assert.equal(missing.adopted.status, 'error');
  assert.equal(missing.adopted.result.code, 'working_copy_unmapped');
  assert.ok(missing.adopted.result.missing.includes(F1_PIN_MINTED_ID));
  assert.equal(missing.adopted.persisted, undefined);
  assert.equal(commits(env.gh).length, writesAfterSeed + 1);

  const fullDoc = f1AppOpenDoc();
  const fullScripts = f1AppOpenScripts();
  env.workingCopy = { dirty: false, doc: fullDoc, scripts: fullScripts };
  env.ctx.memory = { doc: cloneDoc(fullDoc), scripts: { ...fullScripts } };
  env.ctx.savedDoc = cloneDoc(fullDoc);
  env.ctx.idb = new Map(Object.entries(fullScripts));
  await seedAppPathIndex(env.store, env.repo, fullDoc);

  const retry = await hostUpgradeOnce(env);
  assert.equal(retry.result.status, 'already_upgraded');
  assert.equal(retry.adopted.status, 'ok');
  assert.equal(commits(env.gh).length, writesAfterSeed + 1);
  await assertHostWcBytesEqualVault(env);
});

