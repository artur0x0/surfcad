#!/usr/bin/env node
/**
 * Cache-first sync + stable part ids.
 * Rename with a cross-assembly reference survives reload; offline rename
 * then reconnect; rename failure toast; a push keeps the surf id;
 * external caution + copy; Add to Repo follows isSynced.
 */
import { readFileSync } from 'node:fs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath, isExternalPartPath, sharedPartPath } from '../../src/utils/git/vaultLayout.js';
import { parseSurfJson, stringifySurfJson } from '../../src/utils/git/surfJson.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import {
  mintSurfId, withSurfId, readSurfId, showAddToRepo, backfillSurfIds,
} from '../../src/utils/git/surfId.js';
import {
  buildRenameCommitFiles, projectFiles, overlayPendingPartRenames,
} from '../../src/utils/git/gitRename.js';
import { createSyncStore } from '../../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../../src/utils/git/syncWorker.js';
import { openVaultAssembly, planCopyToAssembly, planOpenVaultPart } from '../../src/utils/git/gitWorkspace.js';
import { assembleCommitFiles } from '../../src/utils/git/gitCommit.js';

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
const LID_ID = mintSurfId({ now: new Date('2026-10-07T20:56:32.100Z'), rand: 'b10c' });
const GB = assemblyPartPath('Gearbox', 'Bracket');
const GB_NEXT = assemblyPartPath('Gearbox', 'Brace');
const CV_LID = assemblyPartPath('Cover', 'Lid');
const BOLT = sharedPartPath('M3 bolt');

const BRACKET_SRC = withSurfId('return Manifold.cube([10,10,10], true);\n', BRACKET_ID);
const LID_SRC = withSurfId('return Manifold.cube([20,20,2], true);\n', LID_ID);

function asm(name, activeId, parts) {
  return stringifySurfJson({
    source: 'git',
    name,
    activeId,
    parts: parts.map((part) => ({ ...part, surfId: part.surfId })),
  });
}

async function seed() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const gearbox = asm('Gearbox', GB, [
    { id: GB, name: 'Bracket', visible: true, order: 0, surfId: BRACKET_ID },
  ]);
  const cover = asm('Cover', CV_LID, [
    { id: CV_LID, name: 'Lid', visible: true, order: 0, surfId: LID_ID },
    { id: GB, name: 'Bracket', visible: true, order: 1, surfId: BRACKET_ID },
  ]);
  const commit = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed',
    baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath('Gearbox'), gearbox),
      fileWrite(GB, BRACKET_SRC),
      fileWrite(assemblyFilePath('Cover'), cover),
      fileWrite(CV_LID, LID_SRC),
      fileWrite(BOLT, 'return Manifold.cylinder(6, 1.5, 1.5, 24);\n'),
    ],
  });
  return { gh, repo: vault.repo, head: commit.sha, gearbox, cover };
}

console.log('stable ids');
{
  eq('mint format', mintSurfId({ local: true, now: WHEN, rand: 'a3f9' }),
    '2026-10-07-20-56-31-0423-a3f9');
  ok('header round trip', readSurfId(BRACKET_SRC) === BRACKET_ID);
  const doc = { name: 'Gearbox', source: 'git', parts: [{ id: GB, name: 'Bracket' }] };
  const once = backfillSurfIds(doc, {}, { now: WHEN, randFor: () => 'abcd' });
  const twice = backfillSurfIds(once.doc, once.index, { now: WHEN, randFor: () => 'ffff' });
  ok('backfill mints once', once.minted === 1 && twice.minted === 0);
  eq('backfill id is stable', twice.doc.parts[0].surfId, once.doc.parts[0].surfId);
  const fromIndex = backfillSurfIds(
    { name: 'Gearbox', source: 'git', parts: [{ id: GB, name: 'Bracket' }] },
    once.index,
    { randFor: () => 'zzzz' },
  );
  eq('backfill reuses the path index', fromIndex.doc.parts[0].surfId, once.doc.parts[0].surfId);
  ok('second index pass mints nothing', fromIndex.minted === 0);
}

console.log('\nrename with a cross-assembly reference survives reload');
{
  const { gh, repo, head } = await seed();
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head);
  await store.enqueue(repo, {
    op: 'rename',
    message: 'Rename Bracket to Brace',
    partIds: [GB_NEXT],
    payload: {
      kind: 'part',
      surfId: BRACKET_ID,
      from: GB,
      to: GB_NEXT,
      content: BRACKET_SRC,
      label: 'Brace',
      partId: GB_NEXT,
    },
  });
  const synced = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  eq('rename synced', synced.status, 'synced');
  ok('old path is gone', !(await gh.readFile(repo, GB, 'main')));
  const gb = parseSurfJson((await gh.readFile(repo, assemblyFilePath('Gearbox'), 'main')).content);
  const cv = parseSurfJson((await gh.readFile(repo, assemblyFilePath('Cover'), 'main')).content);
  eq('gearbox path moved, id kept', [gb.parts[0].path, gb.parts[0].id, gb.parts[0].surfId], [GB_NEXT, BRACKET_ID, BRACKET_ID]);
  const coverBracket = cv.parts.find((part) => part.surfId === BRACKET_ID);
  eq('cover still references the same id at the new path', [coverBracket?.path, coverBracket?.id, coverBracket?.surfId], [GB_NEXT, BRACKET_ID, BRACKET_ID]);
  const reloaded = await openVaultAssembly(gh, repo, 'Cover', { branch: 'main', headSha: synced.sha });
  const again = reloaded.doc.parts.filter((part) => part.surfId === BRACKET_ID);
  ok('reload does not fork the part', again.length === 1 && again[0].id === BRACKET_ID && again[0].path === GB_NEXT);
  ok('reloaded script keeps the id', readSurfId(reloaded.scripts[BRACKET_ID] || reloaded.scripts[GB_NEXT]) === BRACKET_ID);
}

console.log('\noffline rename then reconnect');
{
  const { gh, repo, head, cover } = await seed();
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head);
  const queued = await store.enqueue(repo, {
    op: 'rename',
    message: 'Rename Bracket to Brace',
    partIds: [GB_NEXT],
    payload: {
      kind: 'part', surfId: BRACKET_ID, from: GB, to: GB_NEXT, content: BRACKET_SRC, label: 'Brace', partId: GB_NEXT,
    },
  });
  const offline = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: false });
  eq('offline waits', offline.status, 'offline');
  ok('rename still queued', store.pending(repo).length === 1 && store.pending(repo)[0].id === queued.id);
  ok('remote path unchanged while offline', !!(await gh.readFile(repo, GB, 'main')));
  const stale = parseSurfJson(cover);
  const scripts = { [GB]: BRACKET_SRC };
  const overlaid = overlayPendingPartRenames(stale, scripts, store.pending(repo));
  const hits = overlaid.doc.parts.filter((part) => part.surfId === BRACKET_ID || part.id === GB || part.id === GB_NEXT);
  ok('reload follows the old path to the same part', hits.length === 1 && hits[0].id === BRACKET_ID && hits[0].path === GB_NEXT);
  ok('script moved with the part', (overlaid.scripts[BRACKET_ID] === BRACKET_SRC || overlaid.scripts[GB_NEXT] === BRACKET_SRC) && overlaid.scripts[GB] == null);
  const online = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  eq('reconnect pushes', online.status, 'synced');
  ok('queue empty', store.pending(repo).length === 0);
  ok('remote moved after reconnect', !(await gh.readFile(repo, GB, 'main')) && !!(await gh.readFile(repo, GB_NEXT, 'main')));
}

console.log('\nrename failure toast');
{
  const { gh, repo, head } = await seed();
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head);
  await store.enqueue(repo, {
    op: 'rename',
    message: 'Rename Bracket to Brace',
    partIds: [GB_NEXT],
    payload: {
      kind: 'part', surfId: BRACKET_ID, from: GB, to: GB_NEXT, content: BRACKET_SRC, label: 'Brace', partId: GB_NEXT,
    },
  });
  gh.commitFiles = async () => { throw new Error('push rejected'); };
  const failedFlush = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  eq('rename failed', failedFlush.status, 'failed');
  eq('toast offers retry and revert', failedFlush.toast?.actions, ['retry', 'revert']);
  ok('toast names the part', /Brace/.test(failedFlush.toast?.message || ''));
  ok('row marked failed', store.partStates()[`${repo.owner}/${repo.name}\0main\0${GB_NEXT}`] === 'failed');
  const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
  ok('toast has Retry and Revert', /data-rename-toast/.test(feed)
    && /data-rename-retry/.test(feed) && /data-rename-revert/.test(feed)
    && />Retry</.test(feed) && />Revert</.test(feed));
  ok('failed row has a red mark', /data-part-sync-failed/.test(feed));
}

console.log('\npush keeps the surf id');
{
  const { gh, repo, head } = await seed();
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head);
  const localId = mintSurfId({ local: true, now: WHEN, rand: 'c0de' });
  ok('create mints a bare id', !String(localId).startsWith('local-'));
  const path = assemblyPartPath('Gearbox', 'Shim');
  const script = withSurfId('return Manifold.cube([1,1,1], true);\n', localId);
  const before = parseSurfJson((await gh.readFile(repo, assemblyFilePath('Gearbox'), 'main')).content);
  const doc = {
    ...before,
    parts: [...before.parts, { id: path, name: 'Shim', visible: true, order: 1, surfId: localId, isSynced: false }],
  };
  const commitsBefore = gh._log.filter((entry) => entry.op === 'commitFiles').length;
  await store.enqueue(repo, {
    op: 'create',
    message: 'Add Shim',
    partIds: [path],
    files: [
      fileWrite(path, script),
      fileWrite(assemblyFilePath('Gearbox'), stringifySurfJson(doc)),
    ],
  });
  const pushed = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  eq('create synced', pushed.status, 'synced');
  const commitsAfter = gh._log.filter((entry) => entry.op === 'commitFiles').length;
  ok('create is one commit', commitsAfter === commitsBefore + 1);
  eq('header unchanged', readSurfId((await gh.readFile(repo, path, 'main')).content), localId);
  const surf = parseSurfJson((await gh.readFile(repo, assemblyFilePath('Gearbox'), 'main')).content);
  eq('surf json id unchanged', surf.parts.find((part) => part.path === path || part.id === path)?.id, localId);
  ok('push does not rewrite ids', !pushed.promoted || Object.keys(pushed.promoted).length === 0);
  ok('surf json omits isSynced', !String((await gh.readFile(repo, assemblyFilePath('Gearbox'), 'main')).content).includes('isSynced'));
}

console.log('\nexternal part caution and copy');
{
  ok('other assembly is external', isExternalPartPath('Gearbox', CV_LID));
  ok('loose part is not external', !isExternalPartPath('Gearbox', BOLT));
  ok('own part is not external', !isExternalPartPath('Gearbox', GB));
  const doc = {
    source: 'git', name: 'Gearbox', activeId: GB,
    parts: [{ id: GB, name: 'Bracket', surfId: BRACKET_ID }],
  };
  eq('open links instead of copying', planOpenVaultPart(doc, CV_LID, LID_SRC, {}), { id: CV_LID, mode: 'link' });
  const copy = planCopyToAssembly(doc, { id: CV_LID, name: 'Lid', surfId: LID_ID }, LID_SRC, { now: WHEN, rand: 'd00d' });
  eq('copy stays path-less until Save', copy.path, null);
  eq('copy id is the new surf id', copy.id, copy.surfId);
  ok('copy has a new bare id', !String(copy.surfId).startsWith('local-') && copy.surfId !== LID_ID && copy.isSynced === false);
  eq('copy records copiedFrom', copy.copiedFrom, LID_ID);
  eq('copy header is the new id', readSurfId(copy.content), copy.surfId);
  const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
  ok('row shows the caution and copy button', /Caution: external part!/.test(feed)
    && /Copy to this assembly/.test(feed)
    && /data-part-external/.test(feed)
    && /data-part-copy-to-assembly/.test(feed));
}

console.log('\nAdd to Repo follows isSynced');
{
  ok('unsynced part offers Add to Repo', showAddToRepo({ id: GB, surfId: BRACKET_ID, isSynced: false }));
  ok('legacy local: id offers Add to Repo', showAddToRepo({ id: 'local:abc' }));
  ok('legacy local- row id offers Add to Repo', showAddToRepo({ id: 'local-abc' }));
  ok('synced part does not', !showAddToRepo({ id: CV_LID, surfId: LID_ID, isSynced: true }));
  ok('in-repo part without a flag does not', !showAddToRepo({ id: CV_LID, surfId: LID_ID }));
  ok('a legacy prefixed surf id is not the signal', !showAddToRepo({ id: GB, surfId: 'local-2026-10-07-20-56-31-0423-a3f9' }));
  ok('linked part without an id does not', !showAddToRepo({ id: CV_LID }));
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  ok('rows use showAddToRepo', /showAddToRepo\(row\)/.test(app));
  const projected = projectFiles(
    [{ path: GB, content: BRACKET_SRC }, { path: assemblyFilePath('Cover'), content: asm('Cover', GB, [{ id: GB, name: 'Bracket', visible: true, order: 0, surfId: BRACKET_ID }]) }],
    buildRenameCommitFiles({
      entries: [
        { path: GB, content: BRACKET_SRC },
        { path: assemblyFilePath('Cover'), content: asm('Cover', GB, [{ id: GB, name: 'Bracket', visible: true, order: 0, surfId: BRACKET_ID }]) },
      ],
      plan: { kind: 'part', surfId: BRACKET_ID, from: GB, to: GB_NEXT, content: BRACKET_SRC },
    }).files,
  );
  const cover = projected.find((entry) => entry.path === assemblyFilePath('Cover'));
  const parsed = parseSurfJson(cover.content);
  eq('projected cache keeps one reference', [parsed.parts.length, parsed.parts[0].path, parsed.parts[0].id], [1, GB_NEXT, BRACKET_ID]);
}

console.log('\nremote moved → conflict, nothing overwritten');
{
  const { gh, repo, head } = await seed();
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head);
  const moved = await gh.commitFiles(repo, {
    branch: 'main', message: 'someone else', baseSha: head,
    files: [fileWrite(BOLT, 'return Manifold.cylinder(8, 1.5, 1.5, 24);\n')],
  });
  await store.enqueue(repo, {
    op: 'save',
    message: 'local edit',
    partIds: [GB],
    files: [fileWrite(GB, BRACKET_SRC + '// local\n')],
  });
  const conflict = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  eq('conflict', conflict.status, 'conflict');
  ok('sync hold does not overwrite', conflict.syncHold === true && conflict.remoteSha === moved.sha);
  ok('local edit was not pushed', !/\/\/ local/.test((await gh.readFile(repo, GB, 'main')).content));
  ok('op stays queued', store.pending(repo).length === 1);
  const overwritten = await flushSyncQueue({
    store, adapter: gh, repo, branch: 'main', online: true, force: true,
  });
  eq('Overwrite main synced', overwritten.status, 'synced');
  ok('main contains the local content', /\/\/ local/.test((await gh.readFile(repo, GB, 'main')).content));
  ok('queue cleared', store.pending(repo).length === 0);
  ok('dirty dot cleared', !store.partStates()[`${repo.owner}/${repo.name}\0main\0${GB}`]);
}

console.log('\nSave is queued and does not force-merge on its own');
{
  const { gh, repo, head } = await seed();
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head);
  const opened = await openVaultAssembly(gh, repo, 'Gearbox', { branch: 'main', headSha: head });
  const edited = `${BRACKET_SRC}// queued save\n`;
  const bracket = opened.doc.parts.find((part) => part.surfId === BRACKET_ID) || opened.doc.parts[0];
  const assembled = await assembleCommitFiles(gh, repo, {
    doc: opened.doc,
    scripts: { ...opened.scripts, [bracket.id]: edited },
    baseline: opened.baseline,
    message: 'Save bracket',
  });
  eq('save is ready to queue', assembled.status, 'ready');
  await store.enqueue(repo, {
    op: 'save', branch: 'main', message: assembled.message, partIds: [GB], files: assembled.files,
  });
  const offline = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: false });
  eq('save waits offline', offline.status, 'offline');
  ok('save not pushed while offline', !/queued save/.test((await gh.readFile(repo, GB, 'main')).content));
  ok('save row queued', store.partStates()[`${repo.owner}/${repo.name}\0main\0${GB}`] === 'queued');
  const online = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  eq('save syncs', online.status, 'synced');
  ok('save landed', /queued save/.test((await gh.readFile(repo, GB, 'main')).content));
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
  ok('App Save goes through the outbox', /assembleCommitFiles\(gitAdapterRef/.test(app)
    && /op: 'save'/.test(app)
    && !/commitWorkspace\(/.test(app)
    && !/forceMergeCommit\(/.test(app));
  ok('Overwrite main force-flushes past the moved-tip guard', /onOverwriteMain/.test(feed)
    && /handleOverwriteMain/.test(app)
    && /force:\s*true/.test(app)
    && !/Sync will not overwrite the remote repo/.test(feed));
}

console.log('\nbranch switch with a pending rename does not fork');
{
  const { gh, repo, head } = await seed();
  await gh.createBranch(repo, 'feature', head);
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head, 'main');
  await store.setLastSyncedSha(repo, head, 'feature');
  await store.enqueue(repo, {
    op: 'rename',
    branch: 'main',
    message: 'Rename Bracket to Brace',
    partIds: [GB_NEXT],
    payload: {
      kind: 'part', surfId: BRACKET_ID, from: GB, to: GB_NEXT, content: BRACKET_SRC, label: 'Brace', partId: GB_NEXT,
    },
  });
  const featureFlush = await flushSyncQueue({ store, adapter: gh, repo, branch: 'feature', online: true });
  eq('other branch does not push the rename', featureFlush.status, 'idle');
  ok('main rename still queued', store.pending(repo, 'main').length === 1);
  ok('feature queue is empty', store.pending(repo, 'feature').length === 0);
  ok('remote still has the old path', !!(await gh.readFile(repo, GB, 'feature')));
  const featureOpened = await openVaultAssembly(gh, repo, 'Gearbox', { branch: 'feature', headSha: head });
  const featureOverlay = overlayPendingPartRenames(
    featureOpened.doc,
    featureOpened.scripts,
    store.pending(repo, 'feature').concat(store.failed(repo, 'feature')),
  );
  eq('feature is not forked by the main rename', featureOverlay.doc.parts.map((part) => part.path || part.id), [GB]);
  const mainOpened = await openVaultAssembly(gh, repo, 'Gearbox', { branch: 'main', headSha: head });
  const filled = backfillSurfIds(mainOpened.doc, {});
  const mainOverlay = overlayPendingPartRenames(
    filled.doc,
    mainOpened.scripts,
    store.pending(repo, 'main').concat(store.failed(repo, 'main')),
  );
  const hits = mainOverlay.doc.parts.filter((part) => part.surfId === BRACKET_ID || part.id === GB || part.id === GB_NEXT);
  ok('switch back keeps one part at the new path', hits.length === 1 && hits[0].id === BRACKET_ID && hits[0].path === GB_NEXT && hits[0].surfId === BRACKET_ID);
  ok('backfill did not mint a second id', filled.minted === 0);
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  ok('switch uses the open-path adopt', /const handleSwitchBranch[\s\S]*?adoptVaultOpening\(/.test(app)
    && /const adoptVaultOpening[\s\S]*?backfillSurfIds\(/.test(app)
    && /const adoptVaultOpening[\s\S]*?overlayPendingPartRenames\(/.test(app));
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
