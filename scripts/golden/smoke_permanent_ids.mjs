#!/usr/bin/env node
/**
 * Permanent surf ids. A mint has no local- prefix. Add to Repo follows
 * isSynced. One migration strips a legacy prefix, keeps the body, and a
 * second pass is a no-op. It never deletes or overwrites a part file.
 * A reload between the commit and the local flag update does not leave
 * Add to Repo stuck.
 */
import { readFileSync } from 'node:fs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath } from '../../src/utils/git/vaultLayout.js';
import { parseSurfJson, stringifySurfJson } from '../../src/utils/git/surfJson.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { mintSurfId, withSurfId, readSurfId, stripSurfId, showAddToRepo } from '../../src/utils/git/surfId.js';
import {
  assertMigrationCommitSafe,
  assertPartFilesPreserved,
  migrateAssemblyRecords,
  migrateOutboxOp,
  planSurfIdMigrationCommit,
  reconcileSyncedFromTip,
} from '../../src/utils/git/surfIdMigration.js';
import { createSyncStore } from '../../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../../src/utils/git/syncWorker.js';
import { openVaultAssembly } from '../../src/utils/git/gitWorkspace.js';
import { newLocalPartId, scriptForRow, serializeAssembly } from '../../src/utils/assembly.js';
import { isVaultPartPath, sharedPartPath } from '../../src/utils/git/vaultLayout.js';
import { migrateLocalPartIds, rewriteSurfJsonLocalIds } from '../../src/utils/git/localPartIdMigration.js';
import { partListSubtitles } from '../../src/utils/git/partListSubtitle.js';

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}
function throws(name, fn, pattern) {
  try {
    fn();
    ok(name, false, 'did not throw');
  } catch (err) {
    ok(name, pattern.test(err?.message || ''), err?.message || '');
  }
}

const WHEN = new Date('2026-10-07T20:56:31.423Z');
const BODY = mintSurfId({ local: true, now: WHEN, rand: 'a3f9' });
const OTHER = mintSurfId({ now: new Date('2026-10-07T20:56:32.100Z'), rand: 'b10c' });
const LOCAL = `local-${BODY}`;
const LOCAL_OTHER = `local-${OTHER}`;
const GROUP = mintSurfId({ now: WHEN, rand: 'ab12' });
const GB = assemblyPartPath('Gearbox', 'Bracket');
const PLATE = assemblyPartPath('Gearbox', 'Plate');
const BRACKET_BODY = 'return Manifold.cube([10,10,10], true);\n';
const PLATE_BODY = 'return Manifold.cube([4,4,1], true);\n';

console.log('mint and Add to Repo');
{
  eq('create emits a bare id', BODY, '2026-10-07-20-56-31-0423-a3f9');
  ok('local option does not prefix', !BODY.startsWith('local-'));
  ok('unsynced offers Add to Repo', showAddToRepo({ id: GB, surfId: BODY, isSynced: false }));
  ok('synced does not', !showAddToRepo({ id: GB, surfId: BODY, isSynced: true }));
  ok('missing flag on a repo path does not', !showAddToRepo({ id: GB, surfId: BODY }));
  ok('missing flag on a stable id + path does not', !showAddToRepo({ id: BODY, path: GB }));
  ok('local: row id still offers it', showAddToRepo({ id: 'local:abc' }));
  ok('local- row id still offers it', showAddToRepo({ id: 'local-abc' }));
  const doc = serializeAssembly({
    source: 'git',
    name: 'Gearbox',
    activeId: GB,
    parts: [{ id: GB, name: 'Bracket', visible: true, order: 0, surfId: BODY, isSynced: false }],
  });
  ok('assembly document keeps isSynced', doc.parts[0].isSynced === false);
  ok('.surf.json omits isSynced', !stringifySurfJson(doc).includes('isSynced'));
}

console.log('\nmigration strips once and keeps every part file');
{
  const bracket = withSurfId(BRACKET_BODY, LOCAL);
  const plate = withSurfId(PLATE_BODY, OTHER);
  const asm = stringifySurfJson({
    source: 'git',
    name: 'Gearbox',
    activeId: GB,
    parts: [
      { id: GB, name: 'Bracket', visible: true, order: 0, surfId: LOCAL, copiedFrom: LOCAL_OTHER },
      { id: PLATE, name: 'Plate', visible: true, order: 1, surfId: OTHER },
    ],
    groups: [{ id: GROUP, name: 'Cover', source: assemblyFilePath('Cover'), partIds: [LOCAL] }],
  });
  const entries = [
    { path: GB, content: bracket },
    { path: PLATE, content: plate },
    { path: assemblyFilePath('Gearbox'), content: asm },
  ];
  const once = planSurfIdMigrationCommit(entries);
  ok('migration has no deletes', once.files.every((file) => !file.delete));
  ok('untouched part is not rewritten', !once.files.some((file) => file.path === PLATE));
  const after = entries.map((entry) => {
    const hit = once.files.find((file) => file.path === entry.path);
    return hit ? { path: entry.path, content: hit.content } : entry;
  });
  eq('header keeps the body', readSurfId(after.find((entry) => entry.path === GB).content), BODY);
  eq('script body unchanged', stripSurfId(after.find((entry) => entry.path === GB).content), BRACKET_BODY);
  eq('other part bytes unchanged', after.find((entry) => entry.path === PLATE).content, plate);
  const parsed = parseSurfJson(after.find((entry) => entry.path.endsWith('.surf.json')).content);
  eq('json id keeps the body', parsed.parts[0].surfId, BODY);
  eq('copiedFrom keeps the body', parsed.parts[0].copiedFrom, OTHER);
  eq('group partIds keep the body', parsed.groups[0].partIds, [BODY]);
  eq('group id stays', parsed.groups[0].id, GROUP);
  eq('part paths stay', parsed.parts.map((part) => part.id), [GB, PLATE]);
  const twice = planSurfIdMigrationCommit(after);
  ok('second pass is a no-op', twice.changed === false && twice.files.length === 0);
  const again = after.map((entry) => {
    const hit = twice.files.find((file) => file.path === entry.path);
    return hit ? { path: entry.path, content: hit.content } : entry;
  });
  eq('second pass bytes match', again.map((entry) => entry.content), after.map((entry) => entry.content));

  const stray = migrateAssemblyRecords({
    doc: {
      name: 'Gearbox',
      source: 'git',
      parts: [
        { id: 'local-abc', name: 'part1', surfId: LOCAL, copiedFrom: LOCAL_OTHER },
        { id: PLATE, name: 'Plate', surfId: OTHER },
      ],
      groups: [{ id: GROUP, name: 'Cover', source: null, partIds: [LOCAL] }],
    },
    scripts: { [GB]: bracket, [PLATE]: plate },
  });
  eq('row id local-abc is not sliced', stray.doc.parts[0].id, 'local-abc');
  eq('doc surf id keeps the body', stray.doc.parts[0].surfId, BODY);
  eq('doc copiedFrom keeps the body', stray.doc.parts[0].copiedFrom, OTHER);
  eq('doc group partIds keep the body', stray.doc.groups[0].partIds, [BODY]);
  const secondDoc = migrateAssemblyRecords({ doc: stray.doc, scripts: stray.scripts });
  ok('document second pass is a no-op', secondDoc.changed === false && secondDoc.doc === stray.doc);

  const op = {
    op: 'create',
    partIds: [GB],
    files: [fileWrite(GB, bracket), fileWrite(assemblyFilePath('Gearbox'), asm)],
    payload: {
      surfId: LOCAL,
      copiedFrom: LOCAL_OTHER,
      content: bracket,
      assemblyText: asm,
      before: { scripts: { [GB]: bracket } },
    },
  };
  const migratedOp = migrateOutboxOp(op);
  eq('outbox surf id keeps the body', migratedOp.payload.surfId, BODY);
  eq('outbox copiedFrom keeps the body', migratedOp.payload.copiedFrom, OTHER);
  eq('outbox header keeps the body', readSurfId(migratedOp.files[0].content), BODY);
  eq('outbox script body unchanged', stripSurfId(migratedOp.files[0].content), BRACKET_BODY);
  eq('outbox before-script keeps the body', readSurfId(migratedOp.payload.before.scripts[GB]), BODY);
  const opAgain = migrateOutboxOp(migratedOp);
  ok('outbox second pass is a no-op', opAgain === migratedOp);

  throws('lost part file is refused', () => assertPartFilesPreserved(entries, entries.filter((entry) => entry.path !== GB)), /lost part file/);
  throws('overwritten part body is refused', () => assertPartFilesPreserved(
    [{ path: GB, content: bracket }],
    [{ path: GB, content: withSurfId('return 2;\n', BODY) }],
  ), /overwrote part file/);
  throws('a delete is refused', () => assertMigrationCommitSafe([{ path: GB, delete: true }]), /refuses to delete/);
}

console.log('\nheader bytes stay except the id text');
{
  const blank = `// @surf-id ${LOCAL}\n\nconst a = 1;\n`;
  const indented = `// @surf-id ${LOCAL}\n  const a = 1;\n`;
  const crlf = `// @surf-id ${LOCAL}\r\n\r\n  const a = 1;\r\n`;
  const cases = [
    ['blank line', blank, assemblyPartPath('Gearbox', 'Blank')],
    ['indented first line', indented, assemblyPartPath('Gearbox', 'Indent')],
    ['crlf', crlf, assemblyPartPath('Gearbox', 'Crlf')],
  ];
  const entries = cases.map(([, before, path]) => ({ path, content: before }));
  const once = planSurfIdMigrationCommit(entries);
  for (const [label, before, path] of cases) {
    const next = once.files.find((file) => file.path === path)?.content;
    eq(`${label} is the same bytes except the id`, next, before.replace(LOCAL, BODY));
  }
  const after = entries.map((entry) => {
    const hit = once.files.find((file) => file.path === entry.path);
    return hit ? { path: entry.path, content: hit.content } : entry;
  });
  ok('header second pass is a no-op', planSurfIdMigrationCommit(after).changed === false);
}

console.log('\ngroup id is stripped in the repo and in IndexedDB');
{
  const localGroup = `local-${GROUP}`;
  const asm = stringifySurfJson({
    source: 'git',
    name: 'Gearbox',
    activeId: GB,
    parts: [{ id: GB, name: 'Bracket', visible: true, order: 0, surfId: BODY }],
    groups: [{ id: localGroup, name: 'Cover', source: null, partIds: [BODY] }],
  });
  const entries = [
    { path: GB, content: withSurfId(BRACKET_BODY, BODY) },
    { path: assemblyFilePath('Gearbox'), content: asm },
  ];
  const once = planSurfIdMigrationCommit(entries);
  const json = once.files.find((file) => file.path.endsWith('.surf.json'))?.content;
  const parsed = parseSurfJson(json);
  eq('repo group id drops the prefix', parsed.groups[0].id, GROUP);
  const local = migrateAssemblyRecords({
    doc: {
      name: 'Gearbox',
      source: 'git',
      parts: [{ id: GB, name: 'Bracket', surfId: BODY }],
      groups: [{ id: localGroup, name: 'Cover', source: null, partIds: [BODY] }],
    },
    scripts: {},
  });
  eq('indexeddb group id drops the prefix', local.doc.groups[0].id, GROUP);
  eq('repo and indexeddb group ids match', parsed.groups[0].id, local.doc.groups[0].id);
  const again = entries.map((entry) => {
    const hit = once.files.find((file) => file.path === entry.path);
    return hit ? { path: entry.path, content: hit.content } : entry;
  });
  ok('group id second pass is a no-op', planSurfIdMigrationCommit(again).changed === false);
  ok('indexeddb group id second pass is a no-op', migrateAssemblyRecords({ doc: local.doc, scripts: {} }).changed === false);
}

console.log('\ncolors keys drop the prefix');
{
  const painted = stringifySurfJson({
    source: 'git',
    name: 'Gearbox',
    activeId: GB,
    parts: [{ id: GB, name: 'Bracket', visible: true, order: 0, surfId: LOCAL }],
    colors: { [LOCAL]: { part: '#aabbcc' } },
  });
  const once = planSurfIdMigrationCommit([
    { path: GB, content: withSurfId(BRACKET_BODY, LOCAL) },
    { path: assemblyFilePath('Gearbox'), content: painted },
  ]);
  const json = once.files.find((file) => file.path.endsWith('.surf.json'))?.content;
  const parsed = parseSurfJson(json);
  eq('repo color key keeps the body', parsed.colors, { [BODY]: { part: '#aabbcc' } });
  const local = migrateAssemblyRecords({
    doc: {
      name: 'Gearbox',
      source: 'git',
      parts: [{ id: GB, name: 'Bracket', surfId: LOCAL }],
      colors: { [LOCAL]: { part: '#aabbcc' } },
    },
    scripts: {},
  });
  eq('indexeddb color key keeps the body', local.doc.colors, { [BODY]: { part: '#aabbcc' } });
  ok('color key second pass is a no-op', migrateAssemblyRecords({ doc: local.doc, scripts: {} }).changed === false);
}

console.log('\nreload between commit and local apply');
{
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const seeded = stringifySurfJson({
    source: 'git', name: 'Gearbox', activeId: GB,
    parts: [{ id: GB, name: 'Bracket', visible: true, order: 0, surfId: OTHER }],
  });
  const seed = await gh.commitFiles(vault.repo, {
    branch: 'main', message: 'seed', baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath('Gearbox'), seeded),
      fileWrite(GB, withSurfId(BRACKET_BODY, OTHER)),
    ],
  });
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(vault.repo, seed.sha);
  const shim = assemblyPartPath('Gearbox', 'Shim');
  const shimBody = 'return Manifold.cube([1,1,1], true);\n';
  const script = withSurfId(shimBody, BODY);
  const doc = {
    source: 'git', name: 'Gearbox', activeId: shim,
    parts: [
      { id: GB, name: 'Bracket', visible: true, order: 0, surfId: OTHER, isSynced: true },
      { id: shim, name: 'Shim', visible: true, order: 1, surfId: BODY, isSynced: false },
    ],
  };
  await store.enqueue(vault.repo, {
    op: 'create',
    message: 'Add Shim',
    partIds: [shim],
    files: [
      fileWrite(shim, script),
      fileWrite(assemblyFilePath('Gearbox'), stringifySurfJson(doc)),
    ],
  });
  const pushed = await flushSyncQueue({ store, adapter: gh, repo: vault.repo, branch: 'main', online: true });
  eq('create synced', pushed.status, 'synced');
  eq('committed header is the minted id', readSurfId((await gh.readFile(vault.repo, shim, 'main')).content), BODY);
  ok('Add to Repo still shows before the local apply', showAddToRepo(doc.parts[1]));
  const opened = await openVaultAssembly(gh, vault.repo, 'Gearbox', { branch: 'main', headSha: pushed.sha });
  const reconciled = reconcileSyncedFromTip(doc, opened.scripts);
  const shimRow = reconciled.doc.parts.find((part) => part.id === shim);
  ok('reload clears isSynced', shimRow.isSynced === true);
  ok('reload does not leave Add to Repo', !showAddToRepo(shimRow));
  eq('reload keeps the id', shimRow.surfId, BODY);
  eq('reload keeps the script body', stripSurfId(opened.scripts[shim]), shimBody);
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  ok('reseed reconciles isSynced from the tip', /reconcileSyncedFromTip\(/.test(app));
}

console.log('\nsync store keys and a delete guard on the worker');
{
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const store = createSyncStore({ persist: false });
  await store.rememberPathId(vault.repo, GB, LOCAL);
  await store.putPart(vault.repo, { surfId: LOCAL, path: GB, content: withSurfId(BRACKET_BODY, LOCAL), previousPath: PLATE });
  await store.enqueue(vault.repo, {
    op: 'save',
    message: 'edit',
    partIds: [GB],
    files: [fileWrite(GB, withSurfId(BRACKET_BODY, LOCAL))],
    payload: { surfId: LOCAL },
  });
  const first = await store.migrateLocalSurfIds();
  ok('store migration changes once', first.changed === true);
  eq('path index keeps the body', store.pathIndexFor(vault.repo)[GB], BODY);
  eq('part row is rekeyed', store.getPartById(vault.repo, BODY)?.surfId, BODY);
  ok('old part key is gone', store.getPartById(vault.repo, LOCAL) == null);
  eq('alias keeps the body', store.getAlias(vault.repo, PLATE), BODY);
  eq('outbox header keeps the body', readSurfId(store.ops()[0].files[0].content), BODY);
  eq('outbox payload keeps the body', store.ops()[0].payload.surfId, BODY);
  const second = await store.migrateLocalSurfIds();
  ok('store second pass is a no-op', second.changed === false);
  const order = createSyncStore({ persist: false });
  await order.enqueue(vault.repo, { op: 'save', message: 'later', partIds: [GB], files: [] });
  await order.enqueue(vault.repo, { op: 'migrate-ids', message: 'Keep part ids', partIds: [], files: [] }, { front: true });
  eq('id migration runs before queued edits', order.pending(vault.repo).map((op) => op.op), ['migrate-ids', 'save']);

  const head = (await gh.commitFiles(vault.repo, {
    branch: 'main', message: 'seed', baseSha: vault.headSha,
    files: [fileWrite(GB, withSurfId(BRACKET_BODY, OTHER))],
  })).sha;
  const guarded = createSyncStore({ persist: false });
  await guarded.setLastSyncedSha(vault.repo, head);
  await guarded.enqueue(vault.repo, {
    op: 'migrate-ids',
    message: 'Keep part ids',
    partIds: [],
    files: [{ path: GB, delete: true }],
  });
  const refused = await flushSyncQueue({ store: guarded, adapter: gh, repo: vault.repo, branch: 'main', online: true });
  eq('id migration is not written', refused.status, 'idle');
  ok('part file is still in the repo', !!(await gh.readFile(vault.repo, GB, 'main')));
  eq('part bytes were not replaced', (await gh.readFile(vault.repo, GB, 'main')).content, withSurfId(BRACKET_BODY, OTHER));
}

console.log('\nunsynced parts list does not show local:');
{
  const legacy = 'local:1791497027336-ma5euftim4c';
  const fresh = newLocalPartId();
  ok('new ids have no local: prefix', !fresh.startsWith('local:') && !fresh.startsWith('local-') && fresh.length > 8);
  const rows = [
    { id: legacy, name: 'Part (1)', visible: true, order: 0, isSynced: false },
    { id: sharedPartPath('Bracket'), name: 'Bracket', visible: true, order: 1, isSynced: true },
  ];
  const titles = partListSubtitles(rows);
  eq('unsynced subtitle is the Add to Repo path', titles.get(legacy), 'parts/Part (1).js');
  eq('synced subtitle stays the repo path', titles.get(sharedPartPath('Bracket')), sharedPartPath('Bracket'));
  ok('subtitle text has no local: prefix', ![...titles.values()].some((text) => String(text).includes('local:')));
  ok('a bare id still offers Add to Repo', showAddToRepo({ id: fresh, isSynced: false }));
  ok('synced flag hides Add to Repo even on a legacy id', !showAddToRepo({ id: legacy, isSynced: true }));
  const taken = partListSubtitles([
    { id: 'bare-1', name: 'Part (1)' },
    { id: 'bare-2', name: 'Part (1)' },
  ]);
  eq('second unsynced name gets the next free path', taken.get('bare-2'), 'parts/Part (1) (2).js');
  ok('no path is not invented for an empty feed', partListSubtitles([]).size === 0);
}

console.log('\nlegacy local: row id migrates and still opens');
{
  const legacy = 'local:1791497027336-ma5euftim4c';
  const body = mintSurfId({ now: WHEN, rand: 'c0de' });
  const cube = 'return Manifold.cube([10,10,10], true);\n';
  const syncedPath = sharedPartPath('Bracket');
  const surfJson = `${JSON.stringify({
    format: 'surfcad.assembly',
    version: 1,
    name: 'Assembly',
    activeId: legacy,
    parts: [{ id: body, path: legacy, name: 'Part (1)', visible: true, order: 0 }],
    colors: { [legacy]: { part: '#336699' }, [body]: { part: '#112233' } },
  }, null, 2)}\n`;
  const once = migrateLocalPartIds({
    doc: {
      source: 'git',
      name: 'Assembly',
      activeId: legacy,
      parts: [
        { id: legacy, name: 'Part (1)', visible: true, order: 0, surfId: body, isSynced: false },
        { id: syncedPath, name: 'Bracket', visible: true, order: 1, surfId: OTHER, isSynced: true },
        { id: 'local-abc', name: 'Kept', visible: true, order: 2, surfId: OTHER },
      ],
      colors: { [legacy]: { part: '#336699' }, [body]: { part: '#112233' } },
    },
    scripts: { [legacy]: cube, [syncedPath]: BRACKET_BODY },
    histories: {
      [legacy]: { commits: [{ id: 'seed:0', code: cube, partId: legacy }], head: 0 },
      __game__: { commits: [{ id: 'seed:0', code: 'game' }] },
    },
    selection: { activeId: legacy, cadPartId: legacy, edges: [{ partId: legacy, id: '0-1' }] },
    draftPartId: legacy,
    surfJson,
  });
  const clean = '1791497027336-ma5euftim4c';
  eq('legacy id keeps the body', once.doc.parts[0].id, clean);
  eq('active id is rewritten', once.doc.activeId, clean);
  ok('synced repo path is untouched', once.doc.parts[1].id === syncedPath && once.doc.parts[1].isSynced === true);
  eq('local- row id is not sliced', once.doc.parts[2].id, 'local-abc');
  eq('surf id is untouched', once.doc.parts[0].surfId, body);
  eq('script follows the clean id', once.scripts[clean], cube);
  ok('old script key is gone', once.scripts[legacy] === undefined);
  eq('color key follows the clean id', once.doc.colors[clean].part, '#336699');
  eq('surf color key stays', once.doc.colors[body].part, '#112233');
  eq('history key follows the clean id', once.histories[clean].commits[0].code, cube);
  eq('history commit id is not a part id', once.histories[clean].commits[0].id, 'seed:0');
  eq('history part ref follows the clean id', once.histories[clean].commits[0].partId, clean);
  ok('game history stays', once.histories.__game__.commits[0].code === 'game');
  eq('selection follows the clean id', once.selection, {
    activeId: clean, cadPartId: clean, edges: [{ partId: clean, id: '0-1' }],
  });
  eq('draft part id follows the clean id', once.draftPartId, clean);
  const surf = JSON.parse(once.surfJson);
  eq('surf.json path drops the prefix', surf.parts[0].path, clean);
  eq('surf.json activeId drops the prefix', surf.activeId, clean);
  eq('surf.json color key drops the prefix', surf.colors[clean].part, '#336699');
  eq('surf.json surf color stays', surf.colors[body].part, '#112233');
  ok('surf.json text has no local: prefix', !once.surfJson.includes('local:'));
  const opened = scriptForRow(once.doc, once.scripts, clean);
  ok('migrated part still opens', opened.ok === true && opened.script === cube);
  const twice = migrateLocalPartIds({
    doc: once.doc,
    scripts: once.scripts,
    histories: once.histories,
    selection: once.selection,
    draftPartId: once.draftPartId,
    surfJson: once.surfJson,
  });
  ok('second pass is a no-op', twice.changed === false && twice.doc === once.doc && twice.scripts === once.scripts);
  eq('second surf.json pass is the same text', rewriteSurfJsonLocalIds(once.surfJson), once.surfJson);

  const clash = migrateLocalPartIds({
    doc: {
      name: 'Assembly',
      activeId: 'abc',
      parts: [
        { id: 'abc', name: 'Bare', surfId: body },
        { id: 'local:abc', name: 'Legacy', surfId: OTHER, isSynced: true },
      ],
    },
    scripts: { abc: 'a', 'local:abc': 'b' },
  });
  eq('collision keeps the prefixed id', clash.doc.parts.map((part) => part.id), ['abc', 'local:abc']);
  ok('collision does not merge scripts', clash.scripts.abc === 'a' && clash.scripts['local:abc'] === 'b');
  ok('collision second look is a no-op', migrateLocalPartIds({ doc: clash.doc, scripts: clash.scripts }).changed === false);
  ok('synced path is a vault path', isVaultPartPath(syncedPath));
  ok('clean id is not a vault path', !isVaultPartPath(clean));

  const repoPath = sharedPartPath('Part (1)');
  const rawSurf = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Assembly',
    activeId: `local:${repoPath}`,
    parts: [{ id: BODY, path: `local:${repoPath}`, name: 'Part (1)', visible: true, order: 0 }],
    colors: { [`local:${BODY}`]: { part: '#336699' } },
  };
  const loaded = parseSurfJson(rawSurf);
  eq('parseSurfJson drops a local: path', loaded.parts[0].id, repoPath);
  eq('parseSurfJson active id is the repo path', loaded.activeId, repoPath);
  eq('parseSurfJson drops a local: color key', loaded.colors[BODY].part, '#336699');
  ok('parsed assembly has no local: text', !JSON.stringify(loaded).includes('local:'));
  const round = parseSurfJson(stringifySurfJson(loaded));
  eq('parsed surf json round-trips', round.parts[0].id, repoPath);
}

console.log('\nmigrated part renders, and the Parts list has no local: text');
{
  const { register } = await import('node:module');
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { build } = await import('esbuild');
  const legacy = 'local:1791497027336-ma5euftim4c';
  const cube = 'return Manifold.cube([10,10,10], true);\n';
  const moved = migrateLocalPartIds({
    doc: serializeAssembly({
      source: 'git',
      name: 'Assembly',
      activeId: legacy,
      parts: [{ id: legacy, name: 'Part (1)', visible: true, order: 0, isSynced: false }],
    }),
    scripts: { [legacy]: cube },
  });
  const clean = moved.doc.parts[0].id;
  ok('render seed migrated off local:', clean === '1791497027336-ma5euftim4c' && !String(clean).includes('local:'));

  const pending = new Map();
  let msgId = 0;
  const workerSelf = {
    onmessage: null,
    postMessage(msg) {
      if (msg.type === 'loaded') return;
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.type === 'error') waiter.reject(new Error(msg.payload?.message || 'worker error'));
      else waiter.resolve(msg);
    },
  };
  globalThis.self = workerSelf;
  const send = (type, payload = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => {
      if (!workerSelf.onmessage) {
        reject(new Error('sandboxWorker handler missing'));
        return;
      }
      workerSelf.onmessage({ data: { type, payload, id } });
    });
  });
  register('./manifold-resolve-hook.mjs', import.meta.url);
  await import('../../src/workers/sandboxWorker.js');
  await send('init');
  const { runAssemblyParts } = await import('../../src/utils/assemblyRun.js');
  const rendered = await runAssemblyParts({
    doc: moved.doc,
    scripts: moved.scripts,
    execute: async (script) => {
      const res = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
      return res.payload;
    },
  });
  ok('migrated part still renders a solid',
    rendered.solids.length === 1
    && rendered.solids[0].id === clean
    && rendered.solids[0].mesh?.vertProperties?.length > 0);

  const dir = mkdtempSync(join(tmpdir(), 'parts-list-'));
  const bundled = await build({
    stdin: {
      contents: `export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
export { default as PartFeed } from './src/components/PartFeed.jsx';`,
      resolveDir: new URL('../../', import.meta.url).pathname,
      loader: 'jsx',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'error',
  });
  const uiPath = join(dir, 'ui.mjs');
  writeFileSync(uiPath, bundled.outputFiles[0].text);
  const ui = await import(uiPath);
  const rowOf = (id) => ({
    id, name: 'Part (1)', visible: true, order: 0, action: 'add-to-repo', isSynced: false, dirty: true,
  });
  const markup = (id) => ui.renderToStaticMarkup(ui.createElement(ui.PartFeed, {
    placement: 'mobile',
    isMobile: false,
    source: 'git',
    assemblyName: 'Assembly',
    currentBranch: 'main',
    rows: [rowOf(id)],
    activeId: id,
  }));
  const visible = (html) => html.replace(/<[^>]+>/g, ' ');
  const unsyncedHtml = markup(legacy);
  const unsyncedText = visible(unsyncedHtml);
  ok('unsynced Parts list text has no local:', !unsyncedText.includes('local:'));
  ok('unsynced subtitle is parts/Part (1).js', unsyncedHtml.includes('data-part-subtitle="">parts/Part (1).js'));
  ok('unsynced row Save offers add-to-repo', unsyncedHtml.includes('data-part-add-to-repo=""'));
  const migratedHtml = markup(clean);
  ok('migrated Parts list markup has no local:', !migratedHtml.includes('local:'));
  ok('migrated row still shows the part', migratedHtml.includes('Part (1)') && migratedHtml.includes(`data-part-row="${clean}"`));
  rmSync(dir, { recursive: true, force: true });

  const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
  mkdirSync(shotDir, { recursive: true });
  const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', process.env.CHROME_PATH].find((p) => p && existsSync(p));
  ok('chrome available for the parts-list shot', !!chrome);
  if (chrome) {
    const postcss = (await import('postcss')).default;
    const tailwindcss = (await import('tailwindcss')).default;
    const autoprefixer = (await import('autoprefixer')).default;
    const { readFileSync } = await import('node:fs');
    const { chromium } = await import('playwright-core');
    const root = new URL('../../', import.meta.url).pathname;
    const css = await postcss([
      tailwindcss({ config: join(root, 'tailwind.config.js') }),
      autoprefixer(),
    ]).process(readFileSync(join(root, 'src/index.css'), 'utf8'), { from: join(root, 'src/index.css') });
    const pageBundle = await build({
      stdin: {
        contents: `import { createRoot } from 'react-dom/client';
import PartFeed from './src/components/PartFeed.jsx';
const id = ${JSON.stringify(legacy)};
createRoot(document.getElementById('root')).render(
  <div style={{ width: '390px', height: '844px', background: '#1e1e1e' }}>
    <PartFeed placement="mobile" isMobile={false} source="git" assemblyName="Assembly" currentBranch="main"
      rows={[{ id, name: 'Part (1)', visible: true, order: 0, action: 'add-to-repo', isSynced: false, dirty: true }]}
      activeId={id} />
  </div>
);`,
        resolveDir: root,
        loader: 'jsx',
      },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      write: false,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'error',
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css.css}</style></head>
<body style="margin:0;background:#1e1e1e"><div id="root"></div><script>${pageBundle.outputFiles[0].text}</script></body></html>`;
    const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
      await page.setContent(html, { waitUntil: 'load' });
      await page.waitForSelector('[data-part-subtitle]');
      const text = await page.locator('[data-parts-rows]').innerText();
      ok('390px parts list shows the repo path', text.includes('parts/Part (1).js'));
      ok('390px unsynced uses Save not Add to Repo pill', !text.includes('Add to Repo'));
      ok('390px parts list text has no local:', !text.includes('local:'));
      const shot = join(shotDir, 'parts-list-unsynced-390.png');
      await page.screenshot({ path: shot });
      ok('parts-list shot stays out of artifacts', !shot.includes('/opt/cursor/artifacts') && existsSync(shot));
    } finally {
      await browser.close();
    }
  }
}

if (failed) {
  console.log(`\npermanent ids: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\npermanent ids: ${passed} passed`);
