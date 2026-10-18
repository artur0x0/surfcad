#!/usr/bin/env node
/**
 * Part groups. Inserting an assembly files its new parts under the source
 * name. The Parts list draws that as a thread. Rename, ungroup, copy all,
 * and remove group. groups round-trip through .surf.json; a legacy file
 * with no groups still loads.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath, sharedPartPath } from '../../src/utils/git/vaultLayout.js';
import { parseSurfJson, stringifySurfJson, toSurfJson, validateSurfJson } from '../../src/utils/git/surfJson.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { mintSurfId, withSurfId, readSurfId } from '../../src/utils/git/surfId.js';
import { planSurfIdMigrationCommit } from '../../src/utils/git/surfIdMigration.js';
import { openVaultAssembly, planInsertVaultAssemblyParts } from '../../src/utils/git/gitWorkspace.js';
import { createSyncStore } from '../../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../../src/utils/git/syncWorker.js';
import { parseAssemblyDocument, removePart, serializeAssembly } from '../../src/utils/assembly.js';
import {
  copyGroupToAssembly,
  layoutPartFeed,
  removeGroupParts,
  renameGroup,
  ungroupParts,
  withInsertedGroup,
} from '../../src/utils/partGroups.js';

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

const WHEN = new Date('2026-10-08T02:00:00.001Z');
const BRACKET_ID = mintSurfId({ now: WHEN, rand: 'a3f9' });
const LID_ID = mintSurfId({ now: new Date('2026-10-08T02:00:00.002Z'), rand: 'b10c' });
const BOLT_ID = mintSurfId({ now: new Date('2026-10-08T02:00:00.003Z'), rand: 'c0de' });
const PLATE_ID = mintSurfId({ now: new Date('2026-10-08T02:00:00.004Z'), rand: 'd00d' });
const GROUP_ID = mintSurfId({ now: WHEN, rand: 'ab12' });
const GB = assemblyPartPath('Gearbox', 'Bracket');
const CV_LID = assemblyPartPath('Cover', 'Lid');
const CV_PLATE = assemblyPartPath('Cover', 'Plate');
const BOLT = sharedPartPath('M3 bolt');
const COVER_SRC = assemblyFilePath('Cover');

const BRACKET_SRC = withSurfId('return Manifold.cube([10,10,10], true);\n', BRACKET_ID);
const LID_SRC = withSurfId('return Manifold.cube([20,20,2], true);\n', LID_ID);
const BOLT_SRC = withSurfId('return Manifold.cylinder(6, 1.5, 1.5, 24);\n', BOLT_ID);

function part(id, name, order, surfId, path) {
  return { id, name, visible: true, order, surfId, ...(path ? { path } : {}) };
}

async function seed() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const gearbox = {
    source: 'git', name: 'Gearbox', activeId: GB,
    parts: [part(GB, 'Bracket', 0, BRACKET_ID), part(BOLT, 'M3 bolt', 1, BOLT_ID)],
  };
  const cover = {
    source: 'git', name: 'Cover', activeId: CV_LID,
    parts: [part(CV_LID, 'Lid', 0, LID_ID), part(BOLT, 'M3 bolt', 1, BOLT_ID)],
  };
  const commit = await gh.commitFiles(vault.repo, {
    branch: 'main', message: 'seed', baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath('Gearbox'), stringifySurfJson(gearbox)),
      fileWrite(GB, BRACKET_SRC),
      fileWrite(BOLT, BOLT_SRC),
      fileWrite(COVER_SRC, stringifySurfJson(cover)),
      fileWrite(CV_LID, LID_SRC),
    ],
  });
  return { gh, repo: vault.repo, head: commit.sha, gearbox };
}

console.log('insert assembly creates a group');
let grouped;
{
  const { gh, repo, gearbox } = await seed();
  const planned = await planInsertVaultAssemblyParts(gh, repo, 'Cover', gearbox, { branch: 'main' });
  eq('source path', planned.sourcePath, COVER_SRC);
  const lid = planned.additions.find((row) => row.fromPath === CV_LID);
  ok('lid is a linked addition', !!lid && lid.linked && lid.surfId === LID_ID);
  ok('bolt already in the doc is skipped', !planned.additions.some((row) => row.id === BOLT));
  const parts = [
    ...gearbox.parts,
    part(lid.id, lid.name, gearbox.parts.length, lid.surfId, lid.fromPath),
  ];
  grouped = withInsertedGroup(
    { ...gearbox, parts, activeId: lid.id },
    {
      name: planned.sourceName,
      source: planned.sourcePath,
      partIds: planned.additions.map((row) => row.surfId).filter(Boolean),
      id: GROUP_ID,
      now: WHEN,
      rand: 'ab12',
    },
  );
  eq('one group named for the source assembly', grouped.groups.map((g) => g.name), ['Cover']);
  eq('group source and members', [grouped.groups[0].source, grouped.groups[0].partIds], [COVER_SRC, [LID_ID]]);
  ok('bracket and bolt stay ungrouped', grouped.parts.length === 3
    && grouped.groups[0].partIds.length === 1);
  const again = withInsertedGroup(grouped, {
    name: 'Cover', source: COVER_SRC, partIds: [LID_ID], id: mintSurfId({ now: WHEN, rand: 'ffff' }),
  });
  eq('a part stays in one group', again.groups.length, 1);
  eq('second insert does not duplicate the id', again.groups[0].partIds, [LID_ID]);
  const withPlate = {
    ...again,
    parts: [...again.parts, part(CV_PLATE, 'Plate', 3, PLATE_ID)],
  };
  const appended = withInsertedGroup(withPlate, {
    name: 'Renamed', source: COVER_SRC, partIds: [PLATE_ID],
  });
  eq('same source appends and keeps the group name', [appended.groups.length, appended.groups[0].name, appended.groups[0].partIds],
    [1, 'Cover', [LID_ID, PLATE_ID]]);
}

console.log('\nlayout keeps ungrouped rows and clusters the group');
{
  const rows = grouped.parts.map((row) => ({ ...row }));
  const items = layoutPartFeed(rows, grouped.groups);
  eq('block order', items.map((item) => item.kind), ['part', 'part', 'group']);
  eq('ungrouped rows are the same objects', [items[0].row, items[1].row], [rows[0], rows[1]]);
  eq('group members in document order', items[2].parts.map((entry) => entry.row.name), ['Lid']);
  eq('drag index is the flat row index', items[2].parts[0].index, 2);
  const bare = layoutPartFeed(rows, []);
  eq('no groups means one part item per row', bare.map((item) => item.kind), ['part', 'part', 'part']);
}

console.log('\nrename, ungroup, copy all, remove');
{
  const renamed = renameGroup(grouped, GROUP_ID, 'Lid set');
  eq('renamed', renamed.groups[0].name, 'Lid set');
  eq('blank rename keeps the name', renameGroup(renamed, GROUP_ID, '   ').groups[0].name, 'Lid set');
  const loose = ungroupParts(renamed, GROUP_ID);
  ok('ungroup drops the group and keeps the parts', !loose.groups && loose.parts.length === grouped.parts.length
    && loose.parts.some((row) => row.surfId === LID_ID));
  const scripts = { [GB]: BRACKET_SRC, [BOLT]: BOLT_SRC, [CV_LID]: LID_SRC };
  const copied = copyGroupToAssembly(grouped, scripts, GROUP_ID, {
    now: WHEN,
    randFor: () => 'e1e1',
  });
  eq('one copy', copied.copies.length, 1);
  const copy = copied.copies[0];
  eq('copy stays path-less until Save', copy.path, null);
  eq('copy id is the new surf id', copy.id, copy.surfId);
  ok('copy has a new bare id', !String(copy.surfId).startsWith('local-') && copy.surfId !== LID_ID && copy.isSynced === false);
  eq('copy records copiedFrom', copy.copiedFrom, LID_ID);
  eq('copy header is the new id', readSurfId(copy.content), copy.surfId);
  eq('group kept, part id follows the copy', [copied.doc.groups[0].id, copied.doc.groups[0].name, copied.doc.groups[0].partIds],
    [GROUP_ID, 'Cover', [copy.surfId]]);
  ok('old path left the document', !copied.doc.parts.some((row) => row.id === CV_LID || row.path === CV_LID)
    && copied.scripts[copy.id] === copy.content
    && copied.scripts[CV_LID] == null);
  const owned = copyGroupToAssembly(copied.doc, copied.scripts, GROUP_ID, { now: WHEN, randFor: () => 'ffff' });
  eq('already-local member is not copied again', owned.copies.length, 0);
  eq('group still holds the copy', owned.doc.groups[0].partIds, [copy.surfId]);
  const lidRow = grouped.parts.find((row) => row.surfId === LID_ID);
  const removed = removeGroupParts(grouped, GROUP_ID);
  eq('remove drops the grouped part and the group', [
    removed.removed.map((row) => row.id),
    removed.doc.parts.map((row) => row.id),
    removed.doc.groups || null,
  ], [[lidRow.id], [GB, BOLT], null]);
  const afterDelete = removePart(grouped, lidRow.id);
  ok('deleting the last member drops the group', !afterDelete.groups
    && afterDelete.parts.every((row) => row.surfId !== LID_ID));
}

console.log('\nsave, reload, legacy, prune, promote');
{
  const { gh, repo, head } = await seed();
  const text = stringifySurfJson(grouped);
  ok('groups are in the file', /"groups"/.test(text) && text.includes(GROUP_ID) && text.includes(LID_ID));
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, head);
  await store.enqueue(repo, {
    op: 'save',
    message: 'Link parts from Cover',
    partIds: [CV_LID],
    files: [
      fileWrite(CV_LID, LID_SRC),
      fileWrite(assemblyFilePath('Gearbox'), text),
    ],
  });
  const synced = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  eq('outbox save synced', synced.status, 'synced');
  const opened = await openVaultAssembly(gh, repo, 'Gearbox', { branch: 'main' });
  eq('reload round-trips groups', opened.doc.groups, grouped.groups);
  eq('toSurfJson matches the reload', toSurfJson(opened.doc).groups, toSurfJson(grouped).groups);
  ok('linked lid file was not deleted', !!(await gh.readFile(repo, CV_LID, 'main')));

  const legacy = {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Gearbox',
    activeId: GB,
    parts: [{ id: BRACKET_ID, path: GB, name: 'Bracket', visible: true, order: 0 }],
  };
  const legacyDoc = parseSurfJson(legacy);
  ok('legacy file has no groups', legacyDoc.groups == null && legacyDoc.parts[0].surfId === BRACKET_ID);
  ok('legacy round-trip omits groups', !Object.prototype.hasOwnProperty.call(toSurfJson(legacyDoc), 'groups'));
  ok('legacy still validates', validateSurfJson(legacy).ok);
  const local = serializeAssembly({
    source: 'local',
    parts: [{ id: 'local:1', name: 'A', visible: true, order: 0 }],
  });
  ok('local doc without groups omits the key', !Object.prototype.hasOwnProperty.call(local, 'groups'));

  const dangling = parseSurfJson({
    ...legacy,
    groups: [{
      id: GROUP_ID,
      name: 'Cover',
      source: COVER_SRC,
      partIds: [PLATE_ID, BRACKET_ID, PLATE_ID],
    }],
  });
  eq('dangling and duplicate part ids are pruned', dangling.groups[0].partIds, [BRACKET_ID]);
  const empty = parseSurfJson({
    ...legacy,
    groups: [{ id: GROUP_ID, name: 'Cover', source: COVER_SRC, partIds: [PLATE_ID] }],
  });
  ok('a group whose ids are all dangling is dropped', empty.groups == null);
  const second = mintSurfId({ now: WHEN, rand: '9999' });
  const firstWins = parseSurfJson({
    ...legacy,
    parts: [
      { id: BRACKET_ID, path: GB, name: 'Bracket', visible: true, order: 0 },
      { id: LID_ID, path: CV_LID, name: 'Lid', visible: true, order: 1 },
    ],
    groups: [
      { id: GROUP_ID, name: 'Cover', source: COVER_SRC, partIds: [LID_ID] },
      { id: second, name: 'Other', source: assemblyFilePath('Frame'), partIds: [LID_ID] },
    ],
  });
  eq('first group keeps the part', firstWins.groups.map((g) => g.name), ['Cover']);
  const idb = parseAssemblyDocument(JSON.stringify(grouped));
  eq('indexed document keeps groups', idb.groups, grouped.groups);

  const localId = `local-${mintSurfId({ now: WHEN, rand: 'e1e1' })}`;
  const shim = assemblyPartPath('Gearbox', 'Lid');
  const body = 'return Manifold.cube([20,20,2], true);\n';
  const promotedDoc = {
    ...grouped,
    parts: grouped.parts.map((row) => (row.surfId === LID_ID ? { ...row, id: shim, surfId: localId, copiedFrom: LID_ID } : row)),
    groups: [{ ...grouped.groups[0], partIds: [localId] }],
  };
  const script = withSurfId(body, localId);
  const asmText = stringifySurfJson(promotedDoc);
  const promoted = planSurfIdMigrationCommit([
    { path: shim, content: script },
    { path: assemblyFilePath('Gearbox'), content: asmText },
  ]);
  const surfFile = promoted.files.find((file) => file.path.endsWith('.surf.json'));
  const parsed = parseSurfJson(surfFile.content);
  const wantId = mintSurfId({ now: WHEN, rand: 'e1e1' });
  eq('migration rewrites group part ids and leaves the group id', [parsed.groups[0].id, parsed.groups[0].partIds], [GROUP_ID, [wantId]]);
  eq('migration keeps the script body', readSurfId(promoted.files.find((file) => file.path === shim).content) === wantId
    && promoted.files.find((file) => file.path === shim).content.endsWith(body), true);
}

console.log('\nrender thread, collapse, and the action menu');
{
  const blockSrc = readFileSync(new URL('../../src/components/PartGroupBlock.jsx', import.meta.url), 'utf8');
  ok('long-press matches the feature sheet', /export const GROUP_LONG_PRESS_MS = 450/.test(blockSrc));
  const { build } = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'part-groups-'));
  const out = join(dir, 'ui.mjs');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const res = await build({
    stdin: {
      contents: `export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
export { default as PartGroupBlock } from './src/components/PartGroupBlock.jsx';`,
      resolveDir: root,
      loader: 'jsx',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'text', '.png': 'dataurl' },
    logLevel: 'error',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  writeFileSync(out, res.outputFiles[0].text);
  const ui = await import(out);
  rmSync(dir, { recursive: true, force: true });
  const h = (props) => {
    const err = console.error;
    console.error = (...args) => {
      if (/useLayoutEffect does nothing on the server|useEffect does nothing/.test(String(args[0]))) return;
      err(...args);
    };
    try {
      return ui.renderToStaticMarkup(ui.createElement(ui.PartGroupBlock, props));
    } finally {
      console.error = err;
    }
  };
  const child = ui.createElement('div', { 'data-part-row': CV_LID, 'data-part-external': '' }, 'Caution: external part!');
  const group = grouped.groups[0];
  const openHtml = h({ group, open: true, count: 1, children: child });
  ok('expanded group has the thread and the part', /data-part-group-open="true"/.test(openHtml)
    && /data-part-group-thread/.test(openHtml)
    && /data-part-group-chevron/.test(openHtml)
    && /data-part-group-count/.test(openHtml)
    && openHtml.includes('Cover')
    && openHtml.includes('>1<')
    && openHtml.includes(`data-part-row="${CV_LID}"`)
    && openHtml.includes('Caution: external part!'));
  const closedHtml = h({ group, open: false, count: 1, children: child });
  ok('collapsed group hides the thread and the parts', /data-part-group-open="false"/.test(closedHtml)
    && !/data-part-group-thread/.test(closedHtml)
    && !closedHtml.includes(`data-part-row="${CV_LID}"`)
    && closedHtml.includes('Cover')
    && closedHtml.includes('>1<'));
  const menuHtml = h({ group, open: true, menuOpen: true, count: 1, editing: true, children: child });
  ok('overflow menu has rename, ungroup, copy all, remove', /data-part-group-actions/.test(menuHtml)
    && /data-part-group-menu/.test(menuHtml)
    && /data-part-group-action="rename"/.test(menuHtml)
    && /data-part-group-action="ungroup"/.test(menuHtml)
    && /data-part-group-action="copy-all"/.test(menuHtml)
    && />Copy all to this assembly</.test(menuHtml)
    && /data-part-group-action="remove"/.test(menuHtml)
    && />Remove group</.test(menuHtml)
    && /data-part-group-name-input/.test(menuHtml)
    && /data-part-group-long-press="450"/.test(menuHtml));
}

console.log('\nwiring');
{
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
  const arch = readFileSync(new URL('../../docs/architecture.md', import.meta.url), 'utf8');
  const map = readFileSync(new URL('../../docs/UI_MAP.md', import.meta.url), 'utf8');
  ok('insert files the group', /withInsertedGroup\(/.test(app) && /planned\.sourcePath/.test(app));
  ok('group actions are wired', /onRenameGroup=\{handleRenameGroup\}/.test(app)
    && /onUngroup=\{handleUngroup\}/.test(app)
    && /onCopyGroup=\{handleCopyGroup\}/.test(app)
    && /onRemoveGroup=\{handleRemoveGroup\}/.test(app)
    && /copyGroupToAssembly\(/.test(app));
  const removeFn = app.slice(app.indexOf('const handleRemoveGroup'), app.indexOf('const handleRenameRetry'));
  ok('remove group does not delete vault files', /rememberAssembly\(nextDoc\)/.test(removeFn)
    && !/fileDelete|flushGitOps|flushSyncQueue|enqueueGit|enqueueAssemblySave/.test(removeFn));
  ok('feed lays groups out and confirms remove', /layoutPartFeed\(rows, groups\)/.test(feed)
    && /data-part-group-remove-dialog/.test(feed)
    && /data-part-group-remove-confirm/.test(feed)
    && /Caution: external part!/.test(feed)
    && /renderPartRow\(row, index\)/.test(feed));
  ok('docs name groups against multi-body and the row', /Part groups/.test(arch)
    && /not a multi-body/.test(arch)
    && /layoutPartFeed/.test(arch)
    && /data-part-group-thread/.test(map)
    && /Copy all to this assembly/.test(map));
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
