#!/usr/bin/env node
/**
 * Parts live in parts/. An assembly folder holds .surf.json plus Copy to
 * this assembly. Renaming an assembly does not move parts/ paths or surf
 * ids. One migration commit moves assembly-folder scripts into parts/.
 * Mock adapter only. Shots stay out of /opt/cursor/artifacts.
 */
import { readFileSync } from 'node:fs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath, sharedPartPath } from '../../src/utils/git/vaultLayout.js';
import { parseSurfJson, stringifySurfJson } from '../../src/utils/git/surfJson.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { mintSurfId, readSurfId, stripSurfId, withSurfId } from '../../src/utils/git/surfId.js';
import {
  buildRenameCommitFiles, overlayPendingPartRenames, projectFiles,
} from '../../src/utils/git/gitRename.js';
import { resolveNewPartPath, suggestNewPartPath } from '../../src/utils/git/gitWorkspace.js';
import { createSyncStore } from '../../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../../src/utils/git/syncWorker.js';
import {
  assertLayoutCommitSafe,
  assertLayoutFilesPreserved,
  planLayoutMigration,
  planLayoutMigrationCommit,
} from '../../src/utils/git/layoutMigration.js';

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

const WHEN = new Date('2026-10-07T20:56:31.423Z');
const ID_A = mintSurfId({ now: WHEN, rand: 'a3f9' });
const ID_B = mintSurfId({ now: new Date('2026-10-07T20:56:32.100Z'), rand: 'b10c' });
const ID_G = mintSurfId({ now: new Date('2026-10-07T20:56:33.000Z'), rand: 'c0de' });
const ID_COPY = mintSurfId({ now: new Date('2026-10-07T20:56:34.000Z'), rand: 'd00d' });

function asm(name, activeId, parts, groups) {
  return stringifySurfJson({
    source: 'git', name, activeId, parts, ...(groups ? { groups } : {}),
  });
}

console.log('parts layout — new part lands in the assembly folder');
{
  eq('bare name', resolveNewPartPath('Gearbox', 'Bracket'), assemblyPartPath('Gearbox', 'Bracket'));
  eq('collision suffix', resolveNewPartPath('Gearbox', 'Bracket', [assemblyPartPath('Gearbox', 'Bracket')]),
    assemblyPartPath('Gearbox', 'Bracket-2'));
  eq('suggest', suggestNewPartPath('Gearbox', []), assemblyPartPath('Gearbox', 'Part (1)'));
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  ok('create allocates an assembly-folder path', /allocateVaultPartPath\(/.test(app)
    && /layout: 'assembly-folder'/.test(app));
}

console.log('\nparts layout — rename moves only the assembly');
{
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const bracket = sharedPartPath('Bracket');
  const plate = sharedPartPath('Plate');
  const shim = assemblyPartPath('Gearbox', 'Shim');
  const shimBody = 'return Manifold.cube([1,2,3], true);\n';
  const gearbox = asm('Gearbox', bracket, [
    { id: bracket, name: 'Bracket', visible: true, order: 0, surfId: ID_A },
    { id: plate, name: 'Plate', visible: true, order: 1, surfId: ID_B },
    { id: shim, name: 'Shim', visible: true, order: 2, surfId: ID_COPY },
  ], [{
    id: ID_G, name: 'Cover', source: assemblyFilePath('Cover'), partIds: [ID_A],
  }]);
  const cover = asm('Cover', bracket, [
    { id: bracket, name: 'Bracket', visible: true, order: 0, surfId: ID_A },
  ], [{
    id: ID_G, name: 'Gearbox', source: assemblyFilePath('Gearbox'), partIds: [ID_A],
  }]);
  const seeded = await gh.commitFiles(vault.repo, {
    branch: 'main', message: 'seed', baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath('Gearbox'), gearbox),
      fileWrite(assemblyFilePath('Cover'), cover),
      fileWrite(bracket, withSurfId('return Manifold.cube([10,10,10], true);\n', ID_A)),
      fileWrite(plate, withSurfId('return Manifold.cube([2,2,2], true);\n', ID_B)),
      fileWrite(shim, shimBody),
    ],
  });
  const store = createSyncStore({ persist: false });
  await store.ready();
  await store.setLastSyncedSha(vault.repo, seeded.sha, 'main');
  const nextAsm = assemblyFilePath('Transmission');
  const nextShim = assemblyPartPath('Transmission', 'Shim');
  const renamed = asm('Transmission', bracket, [
    { id: bracket, name: 'Bracket', visible: true, order: 0, surfId: ID_A },
    { id: plate, name: 'Plate', visible: true, order: 1, surfId: ID_B },
    { id: nextShim, name: 'Shim', visible: true, order: 2, surfId: ID_COPY },
  ], [{
    id: ID_G, name: 'Cover', source: assemblyFilePath('Cover'), partIds: [ID_A],
  }]);
  const row = await store.enqueue(vault.repo, {
    op: 'rename',
    branch: 'main',
    message: 'Rename assembly Gearbox to Transmission',
    partIds: [nextShim],
    payload: {
      kind: 'assembly',
      fromName: 'Gearbox',
      toName: 'Transmission',
      assemblyPath: nextAsm,
      assemblyText: renamed,
      localFiles: [{ path: nextShim, content: shimBody }],
    },
  });
  const states = store.partStates();
  const creating = Object.keys(states).filter((key) => key.endsWith(`\0${bracket}`) || key.endsWith(`\0${plate}`));
  eq('parts/ rows are not Creating', creating, []);
  ok('only the moved copy is queued', Object.keys(states).some((key) => key.endsWith(`\0${nextShim}`)));
  const opened = {
    source: 'git',
    name: 'Gearbox',
    activeId: shim,
    parts: [
      { id: bracket, name: 'Bracket', surfId: ID_A },
      { id: shim, name: 'Shim', surfId: ID_COPY },
    ],
    groups: [{ id: ID_G, name: 'Cover', source: assemblyFilePath('Cover'), partIds: [ID_A] }],
  };
  const followed = overlayPendingPartRenames(opened, { [shim]: shimBody, [bracket]: 'bracket' }, [row]);
  eq('reload follows the assembly rename', followed.doc.name, 'Transmission');
  eq('copy path follows, surf id stays', followed.doc.parts.find((part) => part.surfId === ID_COPY),
    { id: nextShim, name: 'Shim', surfId: ID_COPY });
  eq('parts/ path stays on reload', followed.doc.parts.find((part) => part.surfId === ID_A).id, bracket);
  eq('group source is not rewritten', followed.doc.groups[0].source, assemblyFilePath('Cover'));
  eq('group partId still resolves', followed.doc.groups[0].partIds, [ID_A]);
  const flushed = await flushSyncQueue({
    store, adapter: gh, repo: vault.repo, branch: 'main', online: true,
  });
  eq('rename synced', flushed.status, 'synced');
  const cmp = await gh.compare(vault.repo, seeded.sha, 'main');
  const partDiff = (cmp.files || []).filter((file) => file.path.endsWith('.js') && file.path !== nextShim && file.path !== shim);
  eq('parts/ adds and deletes are empty', partDiff, []);
  const surfDiff = (cmp.files || []).filter((file) => file.path.endsWith('.surf.json')).map((file) => [file.path, file.status]).sort();
  eq('only the assembly file changes', surfDiff, [
    [assemblyFilePath('Gearbox'), 'removed'],
    [nextAsm, 'added'],
  ]);
  eq('shim moved, not added as a new id', (cmp.files || []).filter((file) => file.path === shim || file.path === nextShim)
    .map((file) => [file.path, file.status]).sort(), [
    [shim, 'removed'],
    [nextShim, 'added'],
  ]);
  eq('bracket file untouched', (await gh.readFile(vault.repo, bracket, 'main')).content,
    withSurfId('return Manifold.cube([10,10,10], true);\n', ID_A));
  eq('stamped copy keeps the surf id', readSurfId((await gh.readFile(vault.repo, nextShim, 'main')).content), ID_COPY);
  eq('stamp keeps the body', stripSurfId((await gh.readFile(vault.repo, nextShim, 'main')).content), shimBody);
  const coverAfter = parseSurfJson((await gh.readFile(vault.repo, assemblyFilePath('Cover'), 'main')).content);
  eq('second assembly ref still resolves', coverAfter.parts[0].surfId, ID_A);
  eq('second assembly path stays', coverAfter.parts[0].path || coverAfter.parts[0].id, bracket);
  eq('other assembly group source stays', coverAfter.groups[0].source, assemblyFilePath('Gearbox'));
  eq('other assembly group partId stays', coverAfter.groups[0].partIds, [ID_A]);
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  // v2: a part rename is a working-copy name edit, never a path move and
  // never a git write; the next Save writes the same file.
  ok('rename is a name edit, not a move', /status: 'renamed', from: id, to: id, name: nextName, git: false/.test(app)
    && !/partIds: \(remapped\.moved \|\| \[\]\)\.map\(\(pair\) => pair\.to\)/.test(app));
  const built = buildRenameCommitFiles({
    entries: [
      { path: assemblyFilePath('Gearbox'), content: gearbox },
      { path: shim, content: shimBody },
      { path: bracket, content: withSurfId('x\n', ID_A) },
    ],
    plan: {
      kind: 'assembly',
      fromName: 'Gearbox',
      toName: 'Transmission',
      assemblyPath: nextAsm,
      assemblyText: renamed,
      localFiles: [
        { path: nextShim, content: shimBody },
        { path: bracket, content: 'should-not-write' },
      ],
    },
  });
  ok('rename commit does not write parts/', !built.files.some((file) => file.path === bracket));
}

console.log('\nparts layout — migrate two Bracket.js files');
{
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const gear = assemblyPartPath('Gearbox', 'Bracket');
  const cover = assemblyPartPath('Cover', 'Bracket');
  const copy = assemblyPartPath('Gearbox', 'Lid');
  const gearBody = withSurfId('return 1;\n', ID_A);
  const coverBody = withSurfId('return 2;\n', ID_B);
  const copyBody = withSurfId('return 3;\n', ID_COPY);
  const gearbox = asm('Gearbox', gear, [
    { id: gear, name: 'Bracket', visible: true, order: 0, surfId: ID_A },
    { id: copy, name: 'Lid', visible: true, order: 1, surfId: ID_COPY, copiedFrom: ID_B },
  ]);
  const coverAsm = asm('Cover', cover, [
    { id: cover, name: 'Bracket', visible: true, order: 0, surfId: ID_B },
    { id: gear, name: 'Gearbox bracket', visible: true, order: 1, surfId: ID_A },
  ], [{
    id: ID_G, name: 'Gearbox', source: assemblyFilePath('Gearbox'), partIds: [ID_A],
  }]);
  const seeded = await gh.commitFiles(vault.repo, {
    branch: 'main', message: 'seed', baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath('Gearbox'), gearbox),
      fileWrite(assemblyFilePath('Cover'), coverAsm),
      fileWrite(gear, gearBody),
      fileWrite(cover, coverBody),
      fileWrite(copy, copyBody),
    ],
  });
  const tree = async () => {
    const paths = (await gh.listTree(vault.repo, 'main')).map((entry) => entry.path);
    const entries = [];
    for (const path of paths) {
      if (!path.endsWith('.js') && !path.endsWith('.surf.json')) continue;
      const file = await gh.readFile(vault.repo, path, 'main');
      if (file) entries.push({ path, content: file.content });
    }
    return entries;
  };
  const before = await tree();
  const beforeJs = before.filter((entry) => entry.path.endsWith('.js')).map((entry) => entry.path).sort();
  const pending = [{
    op: 'rename',
    payload: {
      kind: 'part',
      surfId: ID_A,
      from: gear,
      to: assemblyPartPath('Gearbox', 'Brace'),
      content: gearBody,
    },
  }];
  const projected = planLayoutMigrationCommit(before, pending);
  ok('pending rename is projected before the move',
    projected.moves.some((move) => move.from === assemblyPartPath('Gearbox', 'Brace') && move.surfId === ID_A)
    && !projected.moves.some((move) => move.from === gear));
  const plan = planLayoutMigration(before);
  eq('one plan, both brackets, copy stays', plan.moves.map((move) => [move.from, move.to, move.surfId]), [
    [cover, sharedPartPath('Bracket'), ID_B],
    [gear, sharedPartPath('Bracket-2'), ID_A],
  ]);
  ok('copy is not in the plan', !plan.moves.some((move) => move.from === copy));
  const store = createSyncStore({ persist: false });
  await store.ready();
  await store.setLastSyncedSha(vault.repo, seeded.sha, 'main');
  const commitsBefore = gh._log.filter((entry) => entry.op === 'commitFiles').length;
  await store.enqueue(vault.repo, {
    op: 'migrate-layout',
    branch: 'main',
    message: 'Move parts into parts/',
    partIds: [],
    files: plan.files,
    payload: { kind: 'parts-layout', moves: plan.moves },
  });
  const flushed = await flushSyncQueue({
    store, adapter: gh, repo: vault.repo, branch: 'main', online: true,
  });
  eq('leftover layout migration is not written', flushed.status, 'idle');
  const commitsAfter = gh._log.filter((entry) => entry.op === 'commitFiles').length;
  eq('migration flush writes no commit', commitsAfter, commitsBefore);
  const after = await tree();
  const afterJs = after.filter((entry) => entry.path.endsWith('.js')).map((entry) => entry.path).sort();
  eq('assembly-folder files stay put', afterJs, beforeJs);
  ok('no parts/ scripts were created', !after.some((entry) => entry.path.startsWith('parts/') && entry.path.endsWith('.js')));
  ok('copy stayed in the assembly folder', after.some((entry) => entry.path === copy && entry.content === copyBody));
  const gearAfter = parseSurfJson(after.find((entry) => entry.path === assemblyFilePath('Gearbox')).content);
  const coverAfter = parseSurfJson(after.find((entry) => entry.path === assemblyFilePath('Cover')).content);
  eq('gearbox paths were not rewritten', gearAfter.parts.map((part) => part.path || part.id).sort(), [
    copy, gear,
  ].sort());
  eq('cover refs stay on the assembly-folder files', coverAfter.parts.map((part) => part.path || part.id).sort(), [
    cover, gear,
  ].sort());
  eq('cover group partId still resolves', coverAfter.groups[0].partIds, [ID_A]);
  eq('cover group source not rewritten', coverAfter.groups[0].source, assemblyFilePath('Gearbox'));
  const again = planLayoutMigration(after);
  ok('planner still describes a move because nothing was written', again.changed === true);
  const againCommit = planLayoutMigrationCommit(after, []);
  eq('leftover planner with an empty outbox still has a plan', againCommit.changed, true);
  let refused = false;
  try {
    assertLayoutFilesPreserved(before, projectFiles(before, [
      { path: sharedPartPath('Bracket'), content: 'different' },
    ]));
  } catch {
    refused = true;
  }
  ok('guard refuses a lost part file', refused);
  let badCommit = false;
  try {
    assertLayoutCommitSafe([{ path: gear, delete: true }]);
  } catch {
    badCommit = true;
  }
  ok('guard refuses a delete without the parts/ write', badCommit);
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
