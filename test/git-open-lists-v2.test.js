/**
 * Open part / Open assembly on a v2 vault (`assemblies/<id>.surf.json`,
 * `parts/<id>.js`). The index names every row from the assembly files and
 * keeps the id as the key. A v1 tree still lists by folder name.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { assemblyIdPath, partIdPath } from '../src/utils/git/idPaths.js';
import {
  LOOSE_PARTS_LABEL,
  UNTITLED_PART_NAME,
  filterVaultOpenIndex,
  filterVaultPartItems,
  groupVaultOpenPartRows,
  listVaultBrowseItems,
  vaultOpenAssemblies,
  vaultOpenPartRows,
  vaultOpenPartSubtitle,
} from '../src/utils/git/gitWorkspace.js';
import { listV2BrowseItems } from '../src/utils/git/v2VaultRead.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const BIKE = '2026-10-19-02-06-17-0527-d326';
const DEMO = '2026-10-19-12-52-24-0347-1d76';
const FRAME = '2026-10-08-22-23-34-0299-c431';
const WHEEL = '2026-10-09-01-19-00-0384-baa9';
const BOLT = '2026-10-12-13-20-20-0849-f197';
const SPARE = '2026-10-14-03-56-32-0495-e6c7';
const BLANK = '2026-10-15-14-40-29-0886-05ea';
const FORK = '2026-10-18-02-06-59-0014-b2df';

function v2Assembly(id, name, parts) {
  return `${JSON.stringify({
    format: 'surfcad.assembly',
    version: 2,
    id,
    name,
    activeId: parts[0]?.id ?? null,
    parts: parts.map((part, order) => ({ id: part.id, name: part.name, visible: true, order })),
  }, null, 2)}\n`;
}

function script(id, name) {
  return `// @surf-id ${id}\n${name ? `// @name ${name}\n` : ''}return Manifold.cube([10, 10, 10], true);\n`;
}

function seedV2(gh, extra = {}) {
  const repo = gh._seedRepo({
    name: 'surfcad-vault',
    files: {
      'surfcad.json': JSON.stringify({ kind: 'surfcad-vault', version: 2 }),
      [assemblyIdPath(BIKE)]: v2Assembly(BIKE, 'Hubless Bike', [
        { id: FRAME, name: 'Frame' },
        { id: WHEEL, name: 'Wheel' },
        { id: FORK, name: 'Fork' },
      ]),
      [assemblyIdPath(DEMO)]: v2Assembly(DEMO, 'Demo', [
        { id: WHEEL, name: 'Wheel' },
        { id: BOLT, name: 'M3 bolt' },
        // Demo's committed row name lags a rename; the header is the truth.
        { id: FORK, name: 'Old fork' },
      ]),
      [partIdPath(FRAME)]: script(FRAME, 'Frame'),
      [partIdPath(WHEEL)]: script(WHEEL, 'Wheel'),
      [partIdPath(BOLT)]: script(BOLT, 'M3 bolt'),
      [partIdPath(FORK)]: script(FORK, 'Fork'),
      // No assembly lists these two: one has a header, one has nothing.
      [partIdPath(SPARE)]: script(SPARE, 'Spare'),
      [partIdPath(BLANK)]: script(BLANK, ''),
      ...extra,
    },
  });
  return { owner: repo.owner, name: repo.name };
}

test('v2 Open index: every assembly and part by name, ids kept as the key', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = seedV2(gh);
  const browse = await listVaultBrowseItems(gh, repo, 'main');

  assert.deepEqual(browse.assemblies.map((a) => [a.id, a.name, a.kind]), [
    [DEMO, 'Demo', 'assembly'],
    [BIKE, 'Hubless Bike', 'assembly'],
  ]);
  assert.deepEqual(vaultOpenAssemblies(browse).map((a) => a.label), ['Demo', 'Hubless Bike']);

  const byId = new Map(browse.parts.map((p) => [p.id, p]));
  assert.equal(browse.parts.length, 6, 'every parts/<id>.js is a row');
  assert.equal(byId.get(FRAME).name, 'Frame');
  assert.equal(byId.get(WHEEL).name, 'Wheel');
  assert.equal(byId.get(BOLT).name, 'M3 bolt');
  assert.equal(byId.get(SPARE).name, 'Spare', 'a part no assembly lists reads its @name header');
  assert.equal(byId.get(BLANK).name, UNTITLED_PART_NAME, 'nothing names it: readable fallback, not the id');
  assert.equal(byId.get(FORK).name, 'Fork', 'parents disagree: the header wins');
  for (const row of browse.parts) {
    assert.equal(row.path, partIdPath(row.id));
    assert.notEqual(row.name, row.id, 'the id is never the title');
    assert.equal(row.label, row.name);
  }
  assert.deepEqual(byId.get(WHEEL).assemblies.map((a) => a.name), ['Demo', 'Hubless Bike']);
  assert.deepEqual(byId.get(SPARE).assemblies, []);
});

test('v2 Open index reads each assembly file once and only orphan or disputed part headers', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = seedV2(gh);
  const reads = [];
  const readFile = gh.readFile.bind(gh);
  gh.readFile = async (r, path, ref) => {
    reads.push(path);
    return readFile(r, path, ref);
  };
  await listVaultBrowseItems(gh, repo, 'main');
  const assemblyReads = reads.filter((p) => p.startsWith('assemblies/'));
  const partReads = reads.filter((p) => p.startsWith('parts/')).sort();
  assert.deepEqual(assemblyReads.sort(), [assemblyIdPath(BIKE), assemblyIdPath(DEMO)]);
  assert.deepEqual(partReads, [partIdPath(BLANK), partIdPath(FORK), partIdPath(SPARE)].sort(),
    'named parts are not fetched one by one');
});

test('v2 Open Part rows: current assembly first, parents, loose, in-doc by id, never foreign', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = seedV2(gh);
  const browse = await listVaultBrowseItems(gh, repo, 'main');
  const rows = vaultOpenPartRows(browse.parts, {
    currentAssembly: 'Hubless Bike',
    currentAssemblyId: BIKE,
    inDoc: [FRAME, WHEEL],
  });
  const row = (id) => rows.find((r) => r.id === id);
  assert.equal(row(FRAME).inDoc, true);
  assert.equal(row(WHEEL).inDoc, true);
  assert.equal(row(BOLT).inDoc, false);
  assert.ok(rows.every((r) => r.foreign === false), 'v2 parts all live in parts/');
  assert.equal(row(WHEEL).source, 'Hubless Bike', 'a shared part groups under the open assembly');
  assert.equal(row(BOLT).source, 'Demo');
  assert.equal(row(SPARE).source, LOOSE_PARTS_LABEL);

  const groups = groupVaultOpenPartRows(rows, { currentAssembly: 'Hubless Bike' });
  assert.deepEqual(groups.map((g) => [g.label, g.current, g.loose]), [
    ['Hubless Bike', true, false],
    ['Demo', false, false],
    [LOOSE_PARTS_LABEL, false, true],
  ]);
  assert.deepEqual(groups[0].parts.map((p) => p.name), ['Fork', 'Frame', 'Wheel']);
  assert.deepEqual(groups[1].parts.map((p) => p.name), ['M3 bolt']);
  assert.deepEqual(groups[2].parts.map((p) => p.name), ['Spare', UNTITLED_PART_NAME]);

  assert.equal(vaultOpenPartSubtitle(row(FRAME)), 'in this assembly');
  assert.equal(vaultOpenPartSubtitle(row(BOLT)), 'in Demo');
  assert.equal(vaultOpenPartSubtitle(row(SPARE)), 'not in any assembly');
  assert.equal(vaultOpenPartSubtitle({ foreign: true, source: 'Cover' }), 'links from Cover');
  assert.equal(vaultOpenPartSubtitle({ scope: 'shared' }), '', 'a v1 loose part says nothing');

  // Without the open assembly id, the name still marks the current group.
  const byName = vaultOpenPartRows(browse.parts, { currentAssembly: 'Demo', inDoc: [] });
  assert.equal(byName.find((r) => r.id === WHEEL).source, 'Demo');
});

test('two v2 parts with one name stay distinct rows that open by their own id', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const TWIN = '2026-10-17-13-50-24-0258-0d91';
  const repo = seedV2(gh, { [partIdPath(TWIN)]: script(TWIN, 'Frame') });
  const browse = await listVaultBrowseItems(gh, repo, 'main');
  const rows = vaultOpenPartRows(browse.parts, { currentAssemblyId: BIKE, inDoc: [] });
  const frames = rows.filter((r) => r.name === 'Frame');
  assert.deepEqual(frames.map((r) => r.id).sort(), [FRAME, TWIN].sort());
  assert.ok(frames.every((r) => r.sameName));
  assert.deepEqual(frames.map((r) => r.path).sort(), [partIdPath(FRAME), partIdPath(TWIN)].sort());
});

test('v2 Open search matches the name, the id, and a parent assembly', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = seedV2(gh);
  const browse = await listVaultBrowseItems(gh, repo, 'main');
  const rows = vaultOpenPartRows(browse.parts, { currentAssemblyId: BIKE, inDoc: [] });
  const names = (list) => list.map((r) => r.name).sort();
  assert.deepEqual(names(filterVaultOpenIndex({ parts: rows }, 'bolt').parts), ['M3 bolt']);
  assert.deepEqual(names(filterVaultPartItems(rows, 'wheel')), ['Wheel']);
  assert.deepEqual(names(filterVaultOpenIndex({ parts: rows }, FRAME.slice(0, 10)).parts), ['Frame']);
  assert.deepEqual(names(filterVaultOpenIndex({ parts: rows }, 'demo').parts), ['Fork', 'M3 bolt', 'Wheel']);
  assert.deepEqual(names(filterVaultOpenIndex({ parts: rows }, 'loose').parts), ['Spare', UNTITLED_PART_NAME]);
  assert.deepEqual(filterVaultOpenIndex({ parts: rows }, 'zzz-none').parts, []);
  assert.equal(filterVaultOpenIndex({ parts: rows }, '  ').parts.length, rows.length);
  const asm = filterVaultOpenIndex({ assemblies: vaultOpenAssemblies(browse), parts: [] }, 'bike').assemblies;
  assert.deepEqual(asm.map((a) => a.id), [BIKE]);
});

test('a version-1 marker is not browsed', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = gh._seedRepo({
    name: 'surfcad-vault',
    files: {
      'surfcad.json': JSON.stringify({ kind: 'surfcad-vault', version: 1 }),
      'assemblies/Gearbox/.surf.json': '{}',
      'assemblies/Gearbox/Lid.js': 'return 1;',
      'parts/Bracket.js': 'return 1;',
      [assemblyIdPath(BIKE)]: v2Assembly(BIKE, 'Hubless Bike', [{ id: FRAME, name: 'Frame' }]),
      [partIdPath(FRAME)]: script(FRAME, 'Frame'),
    },
  });
  const writes = gh._log.filter((row) => row.op === 'commitFiles').length;
  await assert.rejects(
    () => listVaultBrowseItems(gh, { owner: repo.owner, name: repo.name }, 'main'),
    (err) => err?.code === 'unsupported_vault_version' && err?.message === 'unsupported vault version',
  );
  assert.equal(gh._log.filter((row) => row.op === 'commitFiles').length, writes);
});

test('an assembly file that cannot be read fails the index instead of listing ids', async () => {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const repo = seedV2(gh);
  const readFile = gh.readFile.bind(gh);
  gh.readFile = async (r, path, ref) => {
    if (path === assemblyIdPath(DEMO)) throw new Error('GitHub 502');
    return readFile(r, path, ref);
  };
  await assert.rejects(listV2BrowseItems(gh, repo, 'main'), /GitHub 502/);
  await assert.rejects(listVaultBrowseItems(gh, repo, 'main'), /GitHub 502/);
});

test('Open dialog wiring: rows open by id, the subtitle helper replaces "opens by reference"', () => {
  const feed = readFileSync(join(ROOT, 'src/components/PartFeed.jsx'), 'utf8');
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const list = readFileSync(join(ROOT, 'src/components/DeleteAssemblyDialog.jsx'), 'utf8');
  assert.match(feed, /vaultOpenPartSubtitle\(item\)/);
  assert.doesNotMatch(feed, /opens by reference/);
  assert.match(feed, /data-git-open-part-id=\{item\.id/);
  assert.match(feed, /currentAssemblyId: assemblyId/);
  assert.match(feed, /onOpenVaultPart\(partPath, \{ id: item\?\.id/);
  assert.match(feed, /runOpenAssembly\(openPicker\.assemblyName, openPicker\.assemblyId/);
  assert.match(list, /onOpen\?\.\(name, item\)/);
  assert.match(app, /assemblyId=\{assemblyDoc\?\.id \|\| ''\}/);
  const open = app.slice(app.indexOf('const handleOpenVaultPart'), app.indexOf('const handleCopyPartToAssembly'));
  assert.match(open, /parseIdPath\(path\)/);
  assert.match(open, /openV2VaultPart\(v2Part\.id, meta\)/);
  const v2 = app.slice(app.indexOf('const openV2VaultPart'), app.indexOf('const handleOpenVaultPart'));
  assert.match(v2, /loadVaultPartRows\(\{ partId \}\)/);
  assert.match(v2, /insertReferencedParts\(\{ rows \}\)/);
  assert.doesNotMatch(v2, /commitFiles|enqueueGit|flushGitOps/);
  const asmStart = app.indexOf('const handleOpenVaultAssembly');
  const asm = app.slice(asmStart, app.indexOf('openVaultAssemblyRef.current = handleOpenVaultAssembly', asmStart));
  assert.match(asm, /if \(isV2SurfId\(name\)\) return handleOpenV2VaultAssembly\(name, adapter\)/);
});
