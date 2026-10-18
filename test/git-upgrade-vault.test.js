/**
 * save-model v2 PR 4: Upgrade vault. Mock GitHub only — no network.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  knownReadmeSeedFor,
  planUpgrade,
  planWorkingCopyFollowup,
  SURFCAD_JSON_V2,
} from '../src/utils/git/legacyVault/index.js';

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
          { id: SHAFT_ID, name: 'Shaft', visible: true, order: 0 },
          { id: LID_ID, name: 'Lid', visible: true, order: 1 },
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

test('Save on a legacy vault prompts Upgrade and does not write v1', () => {
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const feed = readFileSync(join(ROOT, 'src/components/PartFeed.jsx'), 'utf8');

  const startCommit = feed.slice(
    feed.indexOf('const startCommit'),
    feed.indexOf('const runNewAssembly'),
  );
  assert.match(startCommit, /vaultLayout === 'legacy'/);
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
  assert.match(legacyGate, /upgrade_required/);
  assert.match(legacyGate, /git_upgrade_vault \{ confirm: true \}/);
  assert.equal(/ensureGitVault/.test(legacyGate), false);
  assert.equal(/assembleCommitFiles/.test(legacyGate), false);

  assert.match(feed, /data-git-upgrade-confirm=""/);
  assert.match(feed, /data-git-upgrade-dismiss=""/);
  const promptAt = feed.indexOf('data-git-upgrade-prompt');
  assert.ok(promptAt >= 0);
  const prompt = feed.slice(promptAt, promptAt + 900);
  assert.match(prompt, /Chrome/);
  assert.equal(/Edge/.test(prompt), false);
  assert.match(feed, /surface-success/);
  assert.match(feed, /text-on-dark/);

  const open = app.slice(
    app.indexOf('const handleOpenVaultAssembly'),
    app.indexOf('openVaultAssemblyRef.current'),
  );
  assert.equal(/executeUpgrade\(\{/.test(open), false);
});
