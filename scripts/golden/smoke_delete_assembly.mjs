#!/usr/bin/env node
/**
 * Delete an assembly.
 * Without parts: the folder and .surf.json go, parts/ bytes stay, and an
 * assembly-local copy moves to parts/. With parts: an unreferenced script
 * is removed, a script cited from another assembly's parts[] or
 * groups[].partIds stays (including a ref that exists only in a queued op
 * or the open document), and a referenced assembly-local copy moves to
 * parts/. The commit refuses to drop a referenced part file. A failed
 * commit toasts Retry/Revert and the cache snapshot is never half-applied.
 */
/* The evaluate callback runs in the browser, where document exists. */
/* global document, window, KeyboardEvent, MouseEvent */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath, sharedPartPath } from '../../src/utils/git/vaultLayout.js';
import { parseSurfJson, stringifySurfJson } from '../../src/utils/git/surfJson.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { mintSurfId, withSurfId } from '../../src/utils/git/surfId.js';
import { createSyncStore } from '../../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../../src/utils/git/syncWorker.js';
import { projectFiles } from '../../src/utils/git/gitRename.js';
import {
  planDeleteAssembly,
  previewDeleteAssembly,
  baselineAfterDelete,
  swapDeleteCache,
  chooseAssemblyAfterDelete,
  workingCopyAfterDelete,
  assemblyFromEntries,
  emptyGitAssembly,
  refMatchesPart,
  assertDeleteKeepsReferenced,
  projectPendingOps,
} from '../../src/utils/git/gitDeleteAssembly.js';
import { mintGroupId } from '../../src/utils/partGroups.js';

process.env.BROWSERSLIST_IGNORE_OLD_DATA = '1';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

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

const WHEN = new Date('2026-10-07T20:56:31.423Z');
const BRACKET_ID = mintSurfId({ now: WHEN, rand: 'a3f9' });
const SHIM_ID = mintSurfId({ now: new Date('2026-10-07T20:56:32.100Z'), rand: 'b10c' });
const LID_ID = mintSurfId({ now: new Date('2026-10-07T20:56:33.200Z'), rand: 'c0de' });
const GROUP_ID = mintGroupId({ now: new Date('2026-10-08T02:00:00.001Z'), rand: 'ab12' });

const GB = assemblyPartPath('Gearbox', 'Bracket');
const SHIM = assemblyPartPath('Gearbox', 'Shim');
const LID = assemblyPartPath('Cover', 'Lid');
const SHARED_BRACKET = sharedPartPath('Bracket');
const SHARED_SHIM = sharedPartPath('Shim');
const SHARED_BRACKET_2 = sharedPartPath('Bracket (2)');
const BRACKET_SRC = withSurfId('return Manifold.cube([10,10,10], true);\n', BRACKET_ID);
const SHIM_SRC = withSurfId('return Manifold.cube([1,1,1], true);\n', SHIM_ID);
const LID_SRC = withSurfId('return Manifold.cube([20,20,2], true);\n', LID_ID);

function asm(name, activeId, parts, groups) {
  return stringifySurfJson({
    source: 'git',
    name,
    activeId,
    parts,
    groups,
  });
}

async function seed({ clash = false } = {}) {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const cover = asm('Cover', LID, [
    { id: LID, name: 'Lid', visible: true, order: 0, surfId: LID_ID },
    { id: GB, name: 'Bracket', visible: true, order: 1, surfId: BRACKET_ID },
  ], [{
    id: GROUP_ID, name: 'Gearbox', source: assemblyFilePath('Gearbox'), partIds: [BRACKET_ID],
  }]);
  const files = [
    fileWrite(assemblyFilePath('Gearbox'), asm('Gearbox', GB, [
      { id: GB, name: 'Bracket', visible: true, order: 0, surfId: BRACKET_ID },
      { id: SHIM, name: 'Shim', visible: true, order: 1, surfId: SHIM_ID },
    ])),
    fileWrite(GB, BRACKET_SRC),
    fileWrite(SHIM, SHIM_SRC),
    fileWrite(assemblyFilePath('Cover'), cover),
    fileWrite(LID, LID_SRC),
  ];
  if (clash) files.push(fileWrite(SHARED_BRACKET, 'return Manifold.cube([4,4,4], true); // already shared\n'));
  const commit = await gh.commitFiles(vault.repo, {
    branch: 'main', message: 'seed', baseSha: vault.headSha, files,
  });
  return { gh, repo: vault.repo, head: commit.sha };
}

async function entriesOf(gh, repo) {
  const tree = await gh.listTree(repo, 'main');
  const entries = [];
  for (const row of tree) {
    const file = await gh.readFile(repo, row.path, 'main');
    if (file) entries.push({ path: file.path, content: file.content });
  }
  return entries;
}

function byPath(entries) {
  return new Map(entries.map((entry) => [entry.path, entry.content]));
}

function partialDelete(entries) {
  const paths = new Set(entries.map((entry) => entry.path));
  const surf = paths.has(assemblyFilePath('Gearbox'));
  const oldBracket = paths.has(GB);
  const moved = paths.has(SHARED_BRACKET) || paths.has(SHARED_BRACKET_2);
  const oldShim = paths.has(SHIM);
  if (surf && moved) return true;
  if (!surf && oldBracket) return true;
  if (moved && oldBracket) return true;
  if (!surf && oldShim && !paths.has(SHARED_SHIM)) return true;
  return false;
}

console.log('refs match id first, then path');
{
  ok('id match wins', refMatchesPart(
    { id: BRACKET_ID, path: 'parts/Other.js' },
    { surfId: BRACKET_ID, path: GB },
  ));
  ok('missing id falls back to path', refMatchesPart(
    { path: GB },
    { surfId: BRACKET_ID, path: GB },
  ));
  ok('different id and path does not match', !refMatchesPart(
    { id: SHIM_ID, path: SHIM },
    { surfId: BRACKET_ID, path: GB },
  ));
  ok('same path with a different id does not match', !refMatchesPart(
    { id: SHIM_ID, path: GB },
    { surfId: BRACKET_ID, path: GB },
  ));
}

console.log('\nkeep parts: move, rewrite refs, one commit');
{
  const { gh, repo, head } = await seed();
  const before = await entriesOf(gh, repo);
  const plan = planDeleteAssembly(before, 'Gearbox', 'keep');
  eq('message', plan.message, 'Delete assembly Gearbox');
  eq('part count', plan.partCount, 2);
  eq('referenced part', plan.referenced.map((part) => [part.name, part.assemblies]), [['Bracket', ['Cover']]]);
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head);
  await store.putTree(repo, 'main', before);
  const next = projectFiles(before, plan.files);
  await store.putTree(repo, 'main', next);
  let commits = 0;
  let seen = null;
  const orig = gh.commitFiles.bind(gh);
  gh.commitFiles = async (target, opts) => {
    commits += 1;
    seen = opts;
    return orig(target, opts);
  };
  await store.enqueue(repo, {
    op: 'delete-assembly',
    message: plan.message,
    partIds: plan.moves.map((move) => move.to),
    files: plan.files,
    payload: { name: 'Gearbox', moves: plan.moves },
  });
  const synced = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  eq('keep synced', synced.status, 'synced');
  eq('one commit', commits, 1);
  eq('commit message', seen?.message, 'Delete assembly Gearbox');
  ok('gearbox folder is gone', !(await gh.readFile(repo, assemblyFilePath('Gearbox'), 'main'))
    && !(await gh.readFile(repo, GB, 'main'))
    && !(await gh.readFile(repo, SHIM, 'main')));
  ok('both scripts moved', !!(await gh.readFile(repo, SHARED_BRACKET, 'main'))
    && !!(await gh.readFile(repo, SHARED_SHIM, 'main')));
  eq('moved script keeps its id', (await gh.readFile(repo, SHARED_BRACKET, 'main')).content, BRACKET_SRC);
  const cover = parseSurfJson((await gh.readFile(repo, assemblyFilePath('Cover'), 'main')).content);
  const bracket = cover.parts.find((part) => part.surfId === BRACKET_ID);
  eq('cover path rewritten, id kept', [bracket?.id, bracket?.surfId, bracket?.name], [SHARED_BRACKET, BRACKET_ID, 'Bracket']);
  eq('group name kept, source cleared', [cover.groups?.[0]?.name, cover.groups?.[0]?.source, cover.groups?.[0]?.partIds],
    ['Gearbox', null, [BRACKET_ID]]);
  ok('cache is the full next tree', !partialDelete(store.getTree(repo, 'main')));
  const open = {
    source: 'git', name: 'Cover', activeId: GB,
    parts: [
      { id: LID, name: 'Lid', visible: true, order: 0, surfId: LID_ID },
      { id: GB, name: 'Bracket', visible: true, order: 1, surfId: BRACKET_ID },
    ],
    groups: [{ id: GROUP_ID, name: 'Gearbox', source: assemblyFilePath('Gearbox'), partIds: [BRACKET_ID] }],
  };
  const updated = workingCopyAfterDelete(open, { [GB]: BRACKET_SRC, [LID]: LID_SRC }, next, plan, { recent: ['Cover'] });
  eq('open cover updates in place', updated.kind, 'update');
  eq('open cover path follows the id', updated.doc.parts.find((part) => part.surfId === BRACKET_ID)?.id, SHARED_BRACKET);
  eq('open cover group source is null', updated.doc.groups[0].source, null);
  eq('open cover group keeps its name', updated.doc.groups[0].name, 'Gearbox');
  ok('script key moved with the part', updated.scripts[SHARED_BRACKET] === BRACKET_SRC && updated.scripts[GB] == null);
  const previous = {
    assemblyPath: assemblyFilePath('Cover'),
    assemblyText: 'unsaved cover',
    scripts: { [LID]: 'saved lid', [GB]: 'saved bracket' },
  };
  const captured = {
    assemblyPath: assemblyFilePath('Cover'),
    assemblyText: 'rewritten cover',
    scripts: { [LID]: 'dirty lid', [SHARED_BRACKET]: BRACKET_SRC },
  };
  const keptDirty = baselineAfterDelete(captured, {
    kind: 'update',
    files: plan.files.filter((file) => file.path !== assemblyFilePath('Cover')),
    pairs: updated.pairs,
    previous,
  });
  eq('unwritten assembly text stays dirty', keptDirty.assemblyText, 'unsaved cover');
  eq('unwritten lid stays at its old baseline', keptDirty.scripts[LID], 'saved lid');
  eq('moved bracket baseline is the committed script', keptDirty.scripts[SHARED_BRACKET], BRACKET_SRC);
  const rewritten = baselineAfterDelete(captured, {
    kind: 'update',
    files: plan.files,
    pairs: updated.pairs,
    previous,
  });
  eq('a rewritten assembly baseline follows the commit', rewritten.assemblyText, 'rewritten cover');
}

console.log('\ndelete with parts: unreferenced gone, referenced kept');
{
  const { gh, repo, head } = await seed();
  const before = await entriesOf(gh, repo);
  const preview = previewDeleteAssembly(before, 'Gearbox');
  eq('dialog list is the referenced part', preview.referenced.map((part) => ({
    name: part.name, assemblies: part.assemblies,
  })), [{ name: 'Bracket', assemblies: ['Cover'] }]);
  const plan = planDeleteAssembly(before, 'Gearbox', 'drop');
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head);
  await store.enqueue(repo, {
    op: 'delete-assembly', message: plan.message, files: plan.files, payload: { name: 'Gearbox' },
  });
  const synced = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  eq('drop synced', synced.status, 'synced');
  ok('unreferenced shim is deleted', !(await gh.readFile(repo, SHIM, 'main')) && !(await gh.readFile(repo, SHARED_SHIM, 'main')));
  ok('referenced bracket moved', (await gh.readFile(repo, SHARED_BRACKET, 'main'))?.content === BRACKET_SRC);
  const cover = parseSurfJson((await gh.readFile(repo, assemblyFilePath('Cover'), 'main')).content);
  eq('cover still points at the kept id', cover.parts.find((part) => part.surfId === BRACKET_ID)?.id, SHARED_BRACKET);
}

console.log('\nname clash in parts/');
{
  const { gh, repo, head } = await seed({ clash: true });
  const before = await entriesOf(gh, repo);
  const plan = planDeleteAssembly(before, 'Gearbox', 'keep');
  const bracketMove = plan.moves.find((move) => move.surfId === BRACKET_ID);
  eq('suffix avoids the existing file', bracketMove?.to, SHARED_BRACKET_2);
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head);
  await store.enqueue(repo, {
    op: 'delete-assembly', message: plan.message, files: plan.files, payload: { name: 'Gearbox' },
  });
  await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  ok('existing shared file stays', /already shared/.test((await gh.readFile(repo, SHARED_BRACKET, 'main')).content));
  eq('moved bracket landed beside it', (await gh.readFile(repo, SHARED_BRACKET_2, 'main')).content, BRACKET_SRC);
  const cover = parseSurfJson((await gh.readFile(repo, assemblyFilePath('Cover'), 'main')).content);
  eq('ref uses the suffixed path', cover.parts.find((part) => part.surfId === BRACKET_ID)?.id, SHARED_BRACKET_2);
}

console.log('\ndeleting the open assembly');
{
  eq('most recent other assembly', chooseAssemblyAfterDelete(
    ['Cover', 'Frame', 'Gearbox'],
    { deleted: 'Gearbox', recent: ['Cover', 'Frame', 'Gearbox'] },
  ), 'Frame');
  eq('no history uses the first remaining', chooseAssemblyAfterDelete(['Cover', 'Frame'], { deleted: 'Gearbox', recent: [] }), 'Cover');
  eq('none left', chooseAssemblyAfterDelete(['Gearbox'], { deleted: 'Gearbox', recent: ['Gearbox'] }), null);
  const { gh, repo } = await seed();
  const before = await entriesOf(gh, repo);
  const plan = planDeleteAssembly(before, 'Gearbox', 'keep');
  const next = projectFiles(before, plan.files);
  const open = {
    source: 'git', name: 'Gearbox', activeId: GB,
    parts: [
      { id: GB, name: 'Bracket', visible: true, order: 0, surfId: BRACKET_ID },
      { id: SHIM, name: 'Shim', visible: true, order: 1, surfId: SHIM_ID },
    ],
  };
  const switched = workingCopyAfterDelete(open, { [GB]: BRACKET_SRC, [SHIM]: SHIM_SRC }, next, plan, {
    recent: ['Cover', 'Gearbox'],
  });
  eq('switches to the most recent', [switched.kind, switched.name], ['switch', 'Cover']);
  const fromTree = assemblyFromEntries(next, 'Cover');
  eq('switched doc is the rewritten cover', fromTree.doc.parts.find((part) => part.surfId === BRACKET_ID)?.id, SHARED_BRACKET);
  eq('empty when it was the last assembly', workingCopyAfterDelete(open, {}, [], { assemblyName: 'Gearbox' }, { recent: [] }).kind, 'empty');
  eq('empty document has no parts', emptyGitAssembly().parts.length, 0);
}

console.log('\nfailure: retry, revert, no partial cache');
{
  const { gh, repo, head } = await seed();
  const before = await entriesOf(gh, repo);
  const plan = planDeleteAssembly(before, 'Gearbox', 'keep');
  const next = projectFiles(before, plan.files);
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head);
  await store.putTree(repo, 'main', before);
  const cache = { entries: before.map((entry) => ({ ...entry })) };
  let threw = false;
  try {
    swapDeleteCache(cache, [{ path: '', content: 'half' }]);
  } catch {
    threw = true;
  }
  ok('bad snapshot does not swap', threw);
  eq('cache still the original snapshot', cache.entries.map((entry) => entry.path).sort(), before.map((entry) => entry.path).sort());
  let rejected = false;
  try {
    await store.putTree(repo, 'main', [{ path: '', content: 'half' }]);
  } catch {
    rejected = true;
  }
  ok('store rejects an empty path before writing', rejected);
  eq('store still holds the original tree', store.getTree(repo, 'main').map((entry) => entry.path).sort(),
    before.map((entry) => entry.path).sort());
  await store.putTree(repo, 'main', next);
  ok('swapped cache is complete', !partialDelete(store.getTree(repo, 'main'))
    && byPath(store.getTree(repo, 'main')).has(SHARED_BRACKET)
    && !byPath(store.getTree(repo, 'main')).has(assemblyFilePath('Gearbox')));
  gh.commitFiles = async () => { throw new Error('push rejected'); };
  await store.enqueue(repo, {
    op: 'delete-assembly',
    message: plan.message,
    partIds: [SHARED_BRACKET],
    files: plan.files,
    payload: { name: 'Gearbox', label: 'Gearbox', before: { cache: before } },
  });
  const failedFlush = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  eq('delete failed', failedFlush.status, 'failed');
  eq('toast offers retry and revert', failedFlush.toast?.actions, ['retry', 'revert']);
  ok('toast names the assembly', /Delete assembly Gearbox|Could not delete assembly Gearbox/.test(failedFlush.toast?.message || ''));
  ok('failed cache is not partial', !partialDelete(store.getTree(repo, 'main')));
  const op = store.failed(repo, 'main')[0];
  await store.putTree(repo, 'main', op.payload.before.cache);
  await store.drop(op.id);
  eq('revert restores the snapshot', store.getTree(repo, 'main').map((entry) => entry.path).sort(),
    before.map((entry) => entry.path).sort());
  ok('reverted cache matches the remote bytes', store.getTree(repo, 'main').every((entry) => {
    const origRow = before.find((row) => row.path === entry.path);
    return origRow && origRow.content === entry.content;
  }));
  ok('remote was not half-written', !!(await gh.readFile(repo, assemblyFilePath('Gearbox'), 'main'))
    && !!(await gh.readFile(repo, GB, 'main'))
    && !(await gh.readFile(repo, SHARED_BRACKET, 'main')));
}

console.log('\nretry pushes the same commit after a failure');
{
  const { gh, repo, head } = await seed();
  const before = await entriesOf(gh, repo);
  const plan = planDeleteAssembly(before, 'Gearbox', 'keep');
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head);
  await store.putTree(repo, 'main', projectFiles(before, plan.files));
  let calls = 0;
  const orig = gh.commitFiles.bind(gh);
  gh.commitFiles = async (target, opts) => {
    calls += 1;
    if (calls === 1) throw new Error('push rejected');
    return orig(target, opts);
  };
  await store.enqueue(repo, {
    op: 'delete-assembly', message: plan.message, files: plan.files, payload: { name: 'Gearbox' },
  });
  const first = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  eq('first push fails', first.status, 'failed');
  ok('cache stayed complete while failed', !partialDelete(store.getTree(repo, 'main')));
  await store.requeue(store.failed(repo, 'main')[0].id);
  const second = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  eq('retry syncs', second.status, 'synced');
  eq('retry is one more commit', calls, 2);
  ok('retry removed the folder', !(await gh.readFile(repo, assemblyFilePath('Gearbox'), 'main')));
  ok('retry moved the part', !!(await gh.readFile(repo, SHARED_BRACKET, 'main')));
}

console.log('\nwithout parts leaves /parts; with parts keeps only real refs');
{
  const ORPHAN_ID = mintSurfId({ now: new Date('2026-10-07T21:00:00.000Z'), rand: 'd00d' });
  const CITED_ID = mintSurfId({ now: new Date('2026-10-07T21:00:01.000Z'), rand: 'e11e' });
  const GROUPED_ID = mintSurfId({ now: new Date('2026-10-07T21:00:02.000Z'), rand: 'f22f' });
  const QUEUED_ID = mintSurfId({ now: new Date('2026-10-07T21:00:03.000Z'), rand: 'a33a' });
  const OPEN_ID = mintSurfId({ now: new Date('2026-10-07T21:00:04.000Z'), rand: 'b44b' });
  const LIVE_ID = mintSurfId({ now: new Date('2026-10-07T21:00:05.000Z'), rand: 'c55c' });
  const COPY_ID = mintSurfId({ now: new Date('2026-10-07T21:00:06.000Z'), rand: 'd66d' });
  const ORPHAN = sharedPartPath('Orphan');
  const CITED = sharedPartPath('Cited');
  const GROUPED = sharedPartPath('Grouped');
  const QUEUED = sharedPartPath('Queued');
  const OPEN_ONLY = sharedPartPath('OpenOnly');
  const LIVE = sharedPartPath('Live');
  const SPARE = sharedPartPath('Spare');
  const COPY = assemblyPartPath('Gearbox', 'Copy');
  const COPY_DEST = sharedPartPath('Copy');
  const orphanSrc = withSurfId('return Manifold.cube([2,2,2], true);\n', ORPHAN_ID);
  const citedSrc = withSurfId('return Manifold.cube([3,3,3], true);\n', CITED_ID);
  const groupedSrc = withSurfId('return Manifold.cube([4,4,4], true);\n', GROUPED_ID);
  const queuedSrc = withSurfId('return Manifold.cube([5,5,5], true);\n', QUEUED_ID);
  const openSrc = withSurfId('return Manifold.cube([6,6,6], true);\n', OPEN_ID);
  const liveSrc = withSurfId('return Manifold.cube([7,7,7], true);\n', LIVE_ID);
  const spareSrc = withSurfId('return Manifold.cube([8,8,8], true);\n', mintSurfId({ now: WHEN, rand: 'eeee' }));
  const copySrc = withSurfId('return Manifold.cube([9,9,9], true);\n', COPY_ID);
  const row = (id, path, name, order, extra = {}) => ({ id, path, name, visible: true, order, ...extra });
  const surf = (name, activeId, parts, groups) => `${JSON.stringify({
    format: 'surfcad.assembly',
    version: 1,
    name,
    activeId,
    parts,
    ...(groups ? { groups } : {}),
  }, null, 2)}\n`;
  const gearbox = surf('Gearbox', CITED, [
    row(ORPHAN_ID, ORPHAN, 'Orphan', 0),
    row(CITED_ID, CITED, 'Cited', 1),
    row(GROUPED_ID, GROUPED, 'Grouped', 2),
    row(QUEUED_ID, QUEUED, 'Queued', 3),
    row(OPEN_ID, OPEN_ONLY, 'OpenOnly', 4),
    row(LIVE_ID, LIVE, 'Live', 5),
    row(COPY_ID, COPY, 'Copy', 6),
  ]);
  const coverTip = surf('Cover', LID, [
    row(LID_ID, LID, 'Lid', 0, { copiedFrom: ORPHAN_ID }),
    row(CITED_ID, CITED, 'Cited', 1),
    row(COPY_ID, COPY, 'Copy', 2),
    row(OPEN_ID, OPEN_ONLY, 'OpenOnly', 3),
  ], [{
    id: GROUP_ID, name: 'Gearbox', source: assemblyFilePath('Gearbox'), partIds: [GROUPED_ID],
  }]);
  const coverQueued = surf('Cover', LID, [
    row(LID_ID, LID, 'Lid', 0, { copiedFrom: ORPHAN_ID }),
    row(CITED_ID, CITED, 'Cited', 1),
    row(COPY_ID, COPY, 'Copy', 2),
    row(QUEUED_ID, QUEUED, 'Queued', 3),
  ], [{
    id: GROUP_ID, name: 'Gearbox', source: assemblyFilePath('Gearbox'), partIds: [GROUPED_ID],
  }]);
  const scripts = [
    [ORPHAN, orphanSrc], [CITED, citedSrc], [GROUPED, groupedSrc], [QUEUED, queuedSrc],
    [OPEN_ONLY, openSrc], [LIVE, liveSrc], [SPARE, spareSrc], [COPY, copySrc], [LID, LID_SRC],
  ];
  const tip = [
    fileWrite(assemblyFilePath('Gearbox'), gearbox),
    fileWrite(assemblyFilePath('Cover'), coverTip),
    ...scripts.map(([path, content]) => fileWrite(path, content)),
  ].map((file) => ({ path: file.path, content: file.content }));
  const projected = projectPendingOps(tip, [{
    op: 'save',
    status: 'queued',
    files: [fileWrite(assemblyFilePath('Cover'), coverQueued)],
  }]);
  const openDoc = {
    source: 'git',
    name: 'Cover',
    activeId: LID,
    parts: [
      { id: LID, name: 'Lid', visible: true, order: 0, surfId: LID_ID },
      { id: CITED, name: 'Cited', visible: true, order: 1, surfId: CITED_ID },
      { id: COPY, name: 'Copy', visible: true, order: 2, surfId: COPY_ID },
      { id: LIVE, name: 'Live', visible: true, order: 3, surfId: LIVE_ID },
    ],
    groups: [{ id: GROUP_ID, name: 'Gearbox', source: assemblyFilePath('Gearbox'), partIds: [GROUPED_ID] }],
  };
  const opts = { openDoc, tipEntries: tip };
  const keep = planDeleteAssembly(projected, 'Gearbox', 'keep', opts);
  const keepTree = projectFiles(projected, keep.files);
  const keepBy = byPath(keepTree);
  ok('without parts leaves every /parts file', [ORPHAN, CITED, GROUPED, QUEUED, OPEN_ONLY, LIVE, SPARE].every((path) => keepBy.get(path) === byPath(projected).get(path)));
  ok('without parts removes the assembly folder', !keepBy.has(assemblyFilePath('Gearbox')) && !keepBy.has(COPY));
  eq('without parts moves the copy', keepBy.get(COPY_DEST), copySrc);
  const keepCover = JSON.parse(keepBy.get(assemblyFilePath('Cover')));
  eq('without parts rewrites the copy ref', keepCover.parts.find((part) => part.id === COPY_ID)?.path, COPY_DEST);
  eq('without parts clears group source', keepCover.groups[0].source, null);
  const drop = planDeleteAssembly(projected, 'Gearbox', 'drop', opts);
  const dropTree = projectFiles(projected, drop.files);
  const dropBy = byPath(dropTree);
  ok('with parts removes the unreferenced part', !dropBy.has(ORPHAN));
  ok('copiedFrom did not keep the orphan', drop.referenced.every((part) => part.surfId !== ORPHAN_ID));
  eq('with parts keeps the parts[] ref', dropBy.get(CITED), citedSrc);
  eq('with parts keeps the group partId', dropBy.get(GROUPED), groupedSrc);
  eq('with parts keeps the queued ref', dropBy.get(QUEUED), queuedSrc);
  eq('with parts keeps the tip ref a queued op removed', dropBy.get(OPEN_ONLY), openSrc);
  eq('with parts keeps the open-document ref', dropBy.get(LIVE), liveSrc);
  eq('with parts leaves an unrelated part', dropBy.get(SPARE), spareSrc);
  eq('referenced copy moves to /parts', dropBy.get(COPY_DEST), copySrc);
  ok('referenced copy is not deleted in place', !dropBy.has(COPY));
  const dropCover = JSON.parse(dropBy.get(assemblyFilePath('Cover')));
  eq('moved copy keeps its id in the other assembly', [
    dropCover.parts.find((part) => part.id === COPY_ID)?.path,
    dropCover.groups[0].partIds,
    dropCover.groups[0].source,
  ], [COPY_DEST, [GROUPED_ID], null]);
  let lost = false;
  try {
    assertDeleteKeepsReferenced(
      [{ path: CITED, content: citedSrc }],
      [],
      [{ id: CITED_ID, path: null, assembly: 'Cover', via: 'part' }],
    );
  } catch (err) {
    lost = /lost referenced part/.test(err?.message || '');
  }
  ok('guard refuses to drop a referenced part', lost);
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const seeded = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed',
    baseSha: vault.headSha,
    files: projected.map((entry) => fileWrite(entry.path, entry.content)),
  });
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(vault.repo, seeded.sha);
  let commits = 0;
  const orig = gh.commitFiles.bind(gh);
  gh.commitFiles = async (target, commitOpts) => {
    commits += 1;
    return orig(target, commitOpts);
  };
  await store.enqueue(vault.repo, {
    op: 'delete-assembly', message: drop.message, files: drop.files, payload: { name: 'Gearbox' },
  });
  const synced = await flushSyncQueue({ store, adapter: gh, repo: vault.repo, branch: 'main', online: true });
  eq('with parts is one commit', [synced.status, commits], ['synced', 1]);
  ok('committed orphan is gone', !(await gh.readFile(vault.repo, ORPHAN, 'main')));
  eq('committed cited stays', (await gh.readFile(vault.repo, CITED, 'main'))?.content, citedSrc);
  eq('committed copy moved', (await gh.readFile(vault.repo, COPY_DEST, 'main'))?.content, copySrc);
}

console.log('\nui wires the trash, the gate, and the existing toast');
{
  const feed = read('src/components/PartFeed.jsx');
  const dialog = read('src/components/DeleteAssemblyDialog.jsx');
  const app = read('src/App.jsx');
  const worker = read('src/utils/git/syncWorker.js');
  const pkg = read('package.json');
  ok('folder Assembly list and the open search share the trash row',
    /data-part-open-action="assembly"/.test(feed)
    && /<AssemblyOpenList\b/.test(feed)
    && /onDelete=\{\(name\) => \{ void askDeleteAssembly\(name\); \}\}/.test(feed)
    && /data-assembly-delete=\{name\}/.test(dialog));
  ok('desktop and mobile share that PartFeed',
    (app.match(/<PartFeed\b/g) || []).length === 1
    && /placement=\{isMobile \? 'mobile' : 'desktop'\}/.test(app));
  ok('keep is the primary and drop is the danger gate',
    /data-assembly-delete-keep/.test(dialog)
    && /Delete assembly, keep parts/.test(dialog)
    && /data-assembly-delete-parts/.test(dialog)
    && /Delete assembly and its parts/.test(dialog)
    && /data-assembly-delete-confirm-input/.test(dialog)
    && /disabled=\{locked \|\| !confirmed\}/.test(dialog)
    && /These parts are used elsewhere and will be kept in \/parts/.test(dialog)
    && /Keeping parts leaves files in \/parts where they are/.test(dialog));
  ok('row trash matches the branch row action',
    /shrink-0 rounded p-1 text-gray-500 hover:bg-red-500\/15 hover:text-red-300/.test(dialog)
    && /data-git-branch-delete-row/.test(feed));
  const deleter = read('src/utils/git/gitDeleteAssembly.js');
  ok('one outbox commit and the existing toast',
    /op: 'delete-assembly'/.test(app)
    && /message: plan\.message/.test(app)
    && /Delete assembly \$\{name\}/.test(deleter)
    && /putTree\(/.test(app)
    && /data-rename-toast/.test(feed)
    && /data-rename-retry/.test(feed)
    && /data-rename-revert/.test(feed)
    && /delete-assembly/.test(worker));
  ok('package.json registers golden:delete-assembly',
    /"golden:delete-assembly": "node scripts\/golden\/smoke_delete_assembly\.mjs"/.test(pkg));
  ok('delete is guarded by an in-flight ref',
    /deleteInFlightRef/.test(feed)
    && /if \(deleteInFlightRef\.current\) return;/.test(feed)
    && /deleteInFlightRef\.current = true/.test(feed));
  ok('spinner stays inside the clicked delete button',
    /data-assembly-delete-spinner=\{which\}/.test(dialog)
    && /invisible/.test(dialog)
    && /busyAction/.test(dialog)
    && /disabled=\{locked \|\| !confirmed\}/.test(dialog));
  ok('failure stays in the popup',
    /result\?\.status === 'error' \|\| result\?\.status === 'failed'/.test(feed)
    && /data-assembly-delete-error/.test(dialog));
  ok('delete awaits IndexedDB and the queued sync',
    /await assemblyDocPersistRef\.current/.test(app)
    && /await deletePartScript\(id\)/.test(app)
    && /await enqueueGit\(vault\.repo/.test(app)
    && /const result = await flushGitOps\(\)/.test(app)
    && /assemblyOpenLockRef\.current/.test(app)
    && /An assembly is opening — try the delete again once it finishes/.test(app));
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
ok('system Chrome available for the 390px dialog', !!exe, 'set CHROME_PATH');

if (exe) {
  const cssSrc = read('src/index.css');
  const processed = await postcss([
    tailwindcss({ config: join(ROOT, 'tailwind.config.js') }),
    autoprefixer(),
  ]).process(cssSrc, { from: join(ROOT, 'src/index.css') });
  const bundled = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import VaultPickerDialog from './src/components/VaultPickerDialog.jsx';
import DeleteAssemblyDialog, { AssemblyOpenList } from './src/components/DeleteAssemblyDialog.jsx';
import PartFeed from './src/components/PartFeed.jsx';

function Harness() {
  const [typed, setTyped] = useState('');
  const showList = window.__DELETE_ASSEMBLY_VIEW__ === 'list';
  if (window.__DELETE_ASSEMBLY_VIEW__ === 'flow') {
    return (
      <div style={{ width: '390px', height: '844px', background: '#1e1e1e' }}>
        <PartFeed
          placement="mobile"
          source="git"
          assemblyName="Cover"
          currentBranch="main"
          assemblyLeaveSafe
          rows={[{ id: 'parts/Lid.js', name: 'Lid', visible: true, order: 0 }]}
          activeId="parts/Lid.js"
          onListVaultAssemblies={() => Promise.resolve(['Cover', 'Gearbox'])}
          onPreviewDeleteAssembly={async () => ({
            partCount: 2,
            referenced: [{ name: 'Bracket', path: 'assemblies/Gearbox/Bracket.js', assemblies: ['Cover'] }],
          })}
          onDeleteAssembly={() => {
            window.__deleteCalls = (window.__deleteCalls || 0) + 1;
            return new Promise((resolve) => {
              window.__resolveDelete = () => resolve(window.__DELETE_RESULT || { status: 'deleted' });
            });
          }}
        />
      </div>
    );
  }
  if (showList) {
    return (
      <VaultPickerDialog title="Open assembly" labelledBy="git-open-title" dataAttr="open-assembly" onClose={() => {}}>
        <div data-git-open-assemblies="">
          <AssemblyOpenList
            items={[{ name: 'Cover', label: 'Cover' }, { name: 'Gearbox', label: 'Gearbox' }]}
            current="Cover"
            onOpen={() => {}}
            onDelete={() => {}}
          />
        </div>
      </VaultPickerDialog>
    );
  }
  return (
    <DeleteAssemblyDialog
      assemblyName="Gearbox"
      partCount={2}
      referenced={[{ name: 'Bracket', path: 'assemblies/Gearbox/Bracket.js', assemblies: ['Cover', 'Frame'] }]}
      typed={typed}
      onTyped={setTyped}
      onKeep={() => {}}
      onDrop={() => {}}
      onClose={() => {}}
    />
  );
}
createRoot(document.getElementById('root')).render(<Harness />);
`,
      resolveDir: ROOT,
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
  const pageHtml = (view) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${processed.css}</style></head>
<body style="margin:0;background:#1e1e1e">
<div id="root"></div>
<script>window.__DELETE_ASSEMBLY_VIEW__ = ${JSON.stringify(view)};</script>
<script>${bundled.outputFiles[0].text}</script>
</body></html>`;
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
attachConsentPresetToBrowser(browser);
  const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
  mkdirSync(shotDir, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    page.on('pageerror', (err) => console.log('  pageerror', err.message));
    await page.setContent(pageHtml('list'), { waitUntil: 'load' });
    await page.waitForSelector('[data-assembly-delete="Gearbox"]', { timeout: 5000 });
    const trash = await page.evaluate(() => {
      const row = document.querySelector('[data-git-open-assembly-row="Gearbox"]');
      const button = document.querySelector('[data-assembly-delete="Gearbox"]');
      const label = button ? button.getAttribute('aria-label') : '';
      const box = button ? button.getBoundingClientRect() : null;
      const rowBox = row ? row.getBoundingClientRect() : null;
      return {
        label,
        inside: !!(box && rowBox && box.left >= rowBox.left - 1 && box.right <= rowBox.right + 1),
        count: document.querySelectorAll('[data-assembly-delete]').length,
      };
    });
    ok('390px list shows a trash control on each assembly', trash.count === 2 && trash.label === 'Delete assembly Gearbox' && trash.inside,
      JSON.stringify(trash));
    await page.screenshot({ path: join(shotDir, 'delete-assembly-trash-390.png') });

    await page.setContent(pageHtml('dialog'), { waitUntil: 'load' });
    await page.waitForSelector('[data-assembly-delete-parts]', { timeout: 5000 });
    const beforeType = await page.evaluate(() => {
      const danger = document.querySelector('[data-assembly-delete-parts]');
      const heading = document.querySelector('[data-assembly-delete-kept-heading]')?.textContent || '';
      const part = document.querySelector('[data-assembly-delete-kept-part="Bracket"]')?.textContent || '';
      const name = document.querySelector('[data-assembly-delete-name]')?.textContent || '';
      const count = document.querySelector('[data-assembly-delete-count]')?.textContent || '';
      return {
        disabled: danger?.disabled === true,
        enabledAttr: danger?.getAttribute('data-assembly-delete-parts-enabled'),
        heading: heading.trim(),
        part: part.trim(),
        name,
        count,
      };
    });
    ok('confirm shows the name, count, and kept parts',
      beforeType.name === 'Gearbox'
      && beforeType.count === '2 parts'
      && beforeType.heading === 'These parts are used elsewhere and will be kept in /parts'
      && /Bracket/.test(beforeType.part)
      && /Cover, Frame/.test(beforeType.part),
      JSON.stringify(beforeType));
    ok('delete-parts stays disabled until the name is typed',
      beforeType.disabled && beforeType.enabledAttr === 'false');
    await page.screenshot({ path: join(shotDir, 'delete-assembly-confirm-390.png') });
    await page.fill('[data-assembly-delete-confirm-input]', 'Gear');
    const mistype = await page.locator('[data-assembly-delete-parts]').isDisabled();
    ok('a partial name does not unlock delete-parts', mistype);
    await page.fill('[data-assembly-delete-confirm-input]', 'Gearbox');
    const unlocked = await page.locator('[data-assembly-delete-parts]').isDisabled();
    ok('typing the assembly name enables delete-parts', unlocked === false);
    const card = await page.locator('[data-git-dialog="delete-assembly"] > div').boundingBox();
    ok('confirm dialog fits a 390px phone', !!card && card.width <= 390 && card.x >= 0, JSON.stringify(card));

    await page.setContent(pageHtml('flow'), { waitUntil: 'load' });
    await page.click('[data-assembly-load]');
    await page.click('[data-part-open-action="assembly"]');
    await page.waitForSelector('[data-assembly-delete="Gearbox"]', { timeout: 5000 });
    await page.click('[data-assembly-delete="Gearbox"]');
    await page.waitForSelector('[data-assembly-delete-keep]:not([disabled])', { timeout: 5000 });
    const beforeBox = await page.locator('[data-assembly-delete-keep]').boundingBox();
    const doubleTap = await page.evaluate(() => {
      window.__deleteCalls = 0;
      window.__DELETE_RESULT = { status: 'deleted' };
      const button = document.querySelector('[data-assembly-delete-keep]');
      button.click();
      button.click();
      return window.__deleteCalls;
    });
    ok('a second tap does not start another delete', doubleTap === 1, String(doubleTap));
    await page.waitForSelector('[data-assembly-delete-spinner="keep"]', { timeout: 5000 });
    const spinning = await page.evaluate(() => {
      const root = document.querySelector('[data-git-dialog="delete-assembly"]');
      const keep = root.querySelector('[data-assembly-delete-keep]');
      const drop = root.querySelector('[data-assembly-delete-parts]');
      const cancel = root.querySelector('[data-git-dialog-cancel]');
      const box = keep.getBoundingClientRect();
      return {
        keepDisabled: keep.disabled === true,
        dropDisabled: drop.disabled === true,
        cancelDisabled: cancel.disabled === true,
        spinner: !!root.querySelector('[data-assembly-delete-spinner="keep"]'),
        ariaBusy: keep.getAttribute('aria-busy'),
        calls: window.__deleteCalls,
        width: box.width,
        height: box.height,
      };
    });
    ok('spinner shows and both actions plus Cancel are disabled',
      spinning.keepDisabled && spinning.dropDisabled && spinning.cancelDisabled
      && spinning.spinner && spinning.ariaBusy === 'true' && spinning.calls === 1,
      JSON.stringify(spinning));
    ok('delete button keeps its size while the spinner shows',
      !!beforeBox
      && Math.abs(beforeBox.width - spinning.width) < 1
      && Math.abs(beforeBox.height - spinning.height) < 1,
      JSON.stringify({ before: beforeBox, during: { width: spinning.width, height: spinning.height } }));
    const stillOpen = await page.evaluate(() => {
      const root = document.querySelector('[data-git-dialog="delete-assembly"]');
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const scrim = root;
      scrim.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.querySelector('[data-assembly-delete-keep]')?.click();
      return {
        open: !!document.querySelector('[data-git-dialog="delete-assembly"]'),
        calls: window.__deleteCalls,
      };
    });
    ok('Escape, scrim, and another tap leave the in-flight delete alone',
      stillOpen.open === true && stillOpen.calls === 1, JSON.stringify(stillOpen));
    await page.locator('[data-git-dialog="delete-assembly"]').click({ position: { x: 2, y: 2 } });
    ok('scrim click does not dismiss an in-flight delete',
      await page.locator('[data-git-dialog="delete-assembly"]').count() === 1);
    await page.screenshot({ path: join(shotDir, 'delete-assembly-spinner-390.png') });
    await page.evaluate(() => { window.__resolveDelete?.(); });
    await page.waitForSelector('[data-git-dialog="delete-assembly"]', { state: 'detached', timeout: 5000 });
    ok('success closes the delete popup', true);

    await page.click('[data-assembly-delete="Cover"]');
    await page.waitForSelector('[data-assembly-delete-keep]:not([disabled])', { timeout: 5000 });
    await page.evaluate(() => {
      window.__deleteCalls = 0;
      window.__DELETE_RESULT = { status: 'failed', error: 'Remote rejected the delete' };
      document.querySelector('[data-assembly-delete-keep]').click();
    });
    await page.waitForSelector('[data-assembly-delete-spinner="keep"]', { timeout: 5000 });
    await page.evaluate(() => { window.__resolveDelete?.(); });
    await page.waitForSelector('[data-assembly-delete-error]', { timeout: 5000 });
    const failedUi = await page.evaluate(() => {
      const root = document.querySelector('[data-git-dialog="delete-assembly"]');
      const keep = root.querySelector('[data-assembly-delete-keep]');
      const cancel = root.querySelector('[data-git-dialog-cancel]');
      return {
        open: !!root,
        error: root.querySelector('[data-assembly-delete-error]')?.textContent || '',
        keepDisabled: keep.disabled === true,
        cancelDisabled: cancel.disabled === true,
        spinner: !!root.querySelector('[data-assembly-delete-spinner]'),
        calls: window.__deleteCalls,
      };
    });
    ok('failure keeps the popup, shows the error, and re-enables the buttons',
      failedUi.open
      && failedUi.error === 'Remote rejected the delete'
      && failedUi.keepDisabled === false
      && failedUi.cancelDisabled === false
      && failedUi.spinner === false
      && failedUi.calls === 1,
      JSON.stringify(failedUi));
    const failedCard = await page.locator('[data-git-dialog="delete-assembly"] > div').boundingBox();
    ok('error dialog fits a 390px phone', !!failedCard && failedCard.width <= 390 && failedCard.x >= 0, JSON.stringify(failedCard));
    await page.screenshot({ path: join(shotDir, 'delete-assembly-error-390.png') });
    const spinnerShot = join(shotDir, 'delete-assembly-spinner-390.png');
    const errorShot = join(shotDir, 'delete-assembly-error-390.png');
    ok('busy shots stay out of artifacts',
      !spinnerShot.includes('/opt/cursor/artifacts') && !errorShot.includes('/opt/cursor/artifacts'));
  } finally {
    await browser.close();
  }
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
