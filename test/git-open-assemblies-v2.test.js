/**
 * Open assembly on a v2 vault: discovery of `assemblies/<id>.surf.json`
 * by name, the empty message only for a repo that truly has none, and a
 * read failure as an error. Insert parts into current works by id.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { assemblyIdPath, partIdPath } from '../src/utils/git/idPaths.js';
import {
  OPEN_LIST_EMPTY_COPY,
  filterVaultOpenIndex,
  listVaultAssemblies,
  listVaultBrowseItems,
  vaultOpenAssemblies,
  vaultOpenEmptyMessage,
} from '../src/utils/git/gitWorkspace.js';
import { hidePendingDeletedAssemblies } from '../src/utils/git/gitDeleteAssembly.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const BIKE = '2026-10-19-02-06-17-0527-d326';
const JOINTS = '2026-10-19-13-06-48-0120-d108';
const FASTENED = '2026-10-20-04-47-11-0528-b746';
const DEMO = '2026-10-19-12-52-24-0347-1d76';
const PLAIN = '2026-10-19-12-52-31-0886-cdcb';
const FRAME = '2026-10-08-22-23-34-0299-c431';
const WHEEL = '2026-10-09-01-19-00-0384-baa9';

function v2Assembly(id, name, parts = []) {
  return `${JSON.stringify({
    format: 'surfcad.assembly',
    version: 2,
    id,
    name,
    activeId: parts[0]?.id ?? null,
    parts: parts.map((part, order) => ({ id: part.id, name: part.name, visible: true, order })),
  }, null, 2)}\n`;
}

const MARKER = JSON.stringify({ kind: 'surfcad-vault', version: 2 });

function seed(gh, files) {
  const repo = gh._seedRepo({ name: 'surfcad-vault', files: { 'surfcad.json': MARKER, ...files } });
  return { owner: repo.owner, name: repo.name };
}

function seedBikeVault(gh) {
  return seed(gh, {
    [assemblyIdPath(BIKE)]: v2Assembly(BIKE, 'Hubless Bike', [{ id: FRAME, name: 'Frame' }, { id: WHEEL, name: 'Wheel' }]),
    [assemblyIdPath(JOINTS)]: v2Assembly(JOINTS, 'Hubless Bike (Mechanical Joints)', [{ id: FRAME, name: 'Frame' }]),
    [assemblyIdPath(FASTENED)]: v2Assembly(FASTENED, 'Hubless Bike (Fastened)', [{ id: WHEEL, name: 'Wheel' }]),
    [assemblyIdPath(DEMO)]: v2Assembly(DEMO, 'Demo', [{ id: WHEEL, name: 'Wheel' }]),
    [assemblyIdPath(PLAIN)]: v2Assembly(PLAIN, 'Assembly'),
    [partIdPath(FRAME)]: `// @surf-id ${FRAME}\n// @name Frame\nreturn Manifold.cube([10, 10, 10], true);\n`,
    [partIdPath(WHEEL)]: `// @surf-id ${WHEEL}\n// @name Wheel\nreturn Manifold.cylinder(5, 20, 20, 64);\n`,
  });
}

test('every v2 assembly on the branch is listed by name, in name order, keyed by id', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = seedBikeVault(gh);
  const browse = await listVaultBrowseItems(gh, repo, 'main');
  const rows = vaultOpenAssemblies(browse);
  assert.deepEqual(rows.map((row) => [row.name, row.id]), [
    ['Assembly', PLAIN],
    ['Demo', DEMO],
    ['Hubless Bike', BIKE],
    ['Hubless Bike (Fastened)', FASTENED],
    ['Hubless Bike (Mechanical Joints)', JOINTS],
  ]);
  assert.ok(rows.every((row) => row.kind === 'assembly' && row.label === row.name && !row.path));
  assert.equal(vaultOpenEmptyMessage('open-assembly', { assemblies: rows }), '');
  // The branch list (switch, agent) sees the same names.
  assert.deepEqual(await listVaultAssemblies(gh, repo, 'main'), rows.map((row) => row.name));
  // Search by name; the id is not what the user types, but it still hits.
  assert.deepEqual(filterVaultOpenIndex({ assemblies: rows, parts: [] }, 'fastened').assemblies.map((r) => r.id), [FASTENED]);
  assert.deepEqual(filterVaultOpenIndex({ assemblies: rows, parts: [] }, 'bike').assemblies.length, 3);
  assert.deepEqual(filterVaultOpenIndex({ assemblies: rows, parts: [] }, 'zzz').assemblies, []);
});

test('an assembly with no parts, and one whose name is only in the file, are still listed', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = seed(gh, {
    [assemblyIdPath(PLAIN)]: v2Assembly(PLAIN, 'Assembly'),
    [assemblyIdPath(DEMO)]: `${JSON.stringify({ format: 'surfcad.assembly', version: 2, id: DEMO, name: 'Demo', parts: [] })}\n`,
  });
  const rows = vaultOpenAssemblies(await listVaultBrowseItems(gh, repo, 'main'));
  assert.deepEqual(rows.map((row) => row.name), ['Assembly', 'Demo']);
});

test('the empty message shows only when the repo truly has no assemblies', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = seed(gh, { 'assemblies/.gitkeep': '', 'parts/.gitkeep': '' });
  const browse = await listVaultBrowseItems(gh, repo, 'main');
  assert.deepEqual(browse.assemblies, []);
  assert.deepEqual(browse.parts, []);
  assert.equal(vaultOpenEmptyMessage('open-assembly', browse), OPEN_LIST_EMPTY_COPY['open-assembly']);
  assert.equal(vaultOpenEmptyMessage('open-part', browse), OPEN_LIST_EMPTY_COPY['open-part']);
  assert.equal(OPEN_LIST_EMPTY_COPY['open-assembly'], 'No assemblies in the repo yet.');
  // Parts without assemblies: Open assembly is empty, Open part is not.
  const gh2 = createMockGithubAdapter({ login: 'artur' });
  const repo2 = seed(gh2, { [partIdPath(FRAME)]: `// @surf-id ${FRAME}\n// @name Frame\nreturn 1;\n` });
  const browse2 = await listVaultBrowseItems(gh2, repo2, 'main');
  assert.equal(vaultOpenEmptyMessage('open-assembly', browse2), OPEN_LIST_EMPTY_COPY['open-assembly']);
  assert.equal(vaultOpenEmptyMessage('open-part', browse2), '');
});

test('a failed repo read rejects instead of reporting an empty repo', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = seedBikeVault(gh);
  const listTree = gh.listTree.bind(gh);
  gh.listTree = async () => { throw new Error('GitHub 503'); };
  await assert.rejects(listVaultBrowseItems(gh, repo, 'main'), /GitHub 503/);
  gh.listTree = listTree;
  const readFile = gh.readFile.bind(gh);
  gh.readFile = async (r, path, ref) => {
    if (path === assemblyIdPath(BIKE)) throw new Error('rate limited');
    return readFile(r, path, ref);
  };
  await assert.rejects(listVaultBrowseItems(gh, repo, 'main'), /rate limited/);
  // A missing branch is not an empty vault either.
  gh.readFile = readFile;
  await assert.rejects(listVaultBrowseItems(gh, repo, 'no-such-branch'));
});

test('a queued delete hides that assembly from the v2 list by name', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = seedBikeVault(gh);
  const browse = await listVaultBrowseItems(gh, repo, 'main');
  const hidden = hidePendingDeletedAssemblies(browse, [{ op: 'delete-assembly', status: 'queued', payload: { name: 'Demo' } }]);
  assert.deepEqual(hidden.assemblies.map((row) => row.name).includes('Demo'), false);
  assert.equal(hidden.parts.length, browse.parts.length, 'v2 parts live in parts/ and are not folder-scoped');
});

test('an older marker is not browsed', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = gh._seedRepo({
    name: 'surfcad-vault',
    files: {
      'surfcad.json': JSON.stringify({ kind: 'surfcad-vault', version: 1 }),
      'assemblies/Gearbox/.surf.json': '{}',
      'assemblies/Cover/Cover.surf.json': '{}',
      [assemblyIdPath(BIKE)]: v2Assembly(BIKE, 'Hubless Bike'),
    },
  });
  await assert.rejects(
    () => listVaultBrowseItems(gh, { owner: repo.owner, name: repo.name }, 'main'),
    (err) => err?.code === 'unsupported_vault_version' && err?.message === 'unsupported vault version',
  );
  await assert.rejects(
    () => listVaultAssemblies(gh, { owner: repo.owner, name: repo.name }, 'main'),
    (err) => err?.code === 'unsupported_vault_version',
  );
});

test('Open assembly wiring: rows open and insert by id, a read error is shown, the empty copy is the helper', () => {
  const feed = readFileSync(join(ROOT, 'src/components/PartFeed.jsx'), 'utf8');
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  assert.match(feed, /error: vaultOpenEmptyMessage\(kind, \{ assemblies, parts \}\)/);
  assert.doesNotMatch(feed, /'No assemblies in the repo yet\.'/);
  assert.match(feed, /setOpenPicker\(\{ \.\.\.blank, error: err\?\.message \|\| 'Could not browse repo' \}\)/);
  assert.match(feed, /onInsertVaultAssemblyParts\?\.\(id \|\| name\)/);
  assert.match(feed, /runInsertAssemblyParts\(openPicker\.assemblyName, openPicker\.assemblyId/);
  const insert = app.slice(app.indexOf('const insertV2VaultAssemblyParts'), app.indexOf('const handleInsertVaultAssemblyParts'));
  assert.match(insert, /openV2Assembly\(ctx\.adapter, ctx\.vault\.repo, assemblyId/);
  assert.match(insert, /insertReferencedParts\(\{ rows \}\)/);
  assert.match(insert, /withInsertedGroup\(assemblyRef\.current, \{\s*name: sourceName,\s*source: assemblyId,/);
  assert.doesNotMatch(insert, /commitFiles|enqueueGit|flushGitOps|enqueueAssemblySave/);
  const handler = app.slice(app.indexOf('const handleInsertVaultAssemblyParts'), app.indexOf('const handleOpenVaultPart'));
  assert.match(handler, /if \(isV2SurfId\(sourceName\)\)/);
});
