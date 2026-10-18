#!/usr/bin/env node
/**
 * G6 Local → Git: "Move to Git" find-or-creates the vault (rename field),
 * writes the IndexedDB parts + assembly into the layout as ONE commit and
 * returns a clean Git-mode working copy. Mock adapter only — no network,
 * no tokens.
 */
import { readFileSync } from 'node:fs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault, isVaultMarker } from '../../src/utils/git/vault.js';
import {
  VAULT_MARKER_PATH, assemblyFilePath, assemblyPartPath, sharedPartPath, listAssemblies,
} from '../../src/utils/git/vaultLayout.js';
import { parseSurfJson, validateSurfJson } from '../../src/utils/git/surfJson.js';
import { openVaultAssembly, isWorkspaceDirty, dirtyPartIds } from '../../src/utils/git/gitWorkspace.js';
import { commitWorkspace } from '../../src/utils/git/gitCommit.js';
import { planMoveToGit, moveToGit } from '../../src/utils/git/gitMoveToGit.js';
import * as gitIndex from '../../src/utils/git/index.js';

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

const CUBE = 'return Manifold.cube([10,10,10], true);';
const BOLT = 'return Manifold.cylinder(6, 1.5, 1.5, 24);';
const LIVE = 'return Manifold.cube([20,10,10], true); // live editor';

/** Local-mode working copy as IndexedDB holds it. */
function localWorkspace() {
  const doc = {
    source: 'local', name: 'Gearbox', activeId: 'local:b',
    parts: [
      { id: 'local:a', name: 'Bracket', visible: true, order: 0, position: [0, 0, 5] },
      { id: 'local:b', name: 'Bracket', visible: true, order: 1 }, // duplicate name
      { id: 'local:c', name: 'M3 bolt', visible: false, order: 2 },
      { id: 'local:d', name: 'Cover', visible: true, order: 3 }, // no script yet
    ],
  };
  const scripts = { 'local:a': CUBE, 'local:b': '// stale idb text', 'local:c': BOLT };
  return { doc, scripts };
}

const BRACKET = sharedPartPath('Bracket');
const BRACKET2 = sharedPartPath('Bracket (2)');
const SH_BOLT = sharedPartPath('M3 bolt');
const COVER = sharedPartPath('Cover');
const KEPT_BRACKET = assemblyPartPath('Gearbox', 'Bracket');
const ASM = assemblyFilePath('Gearbox');

console.log('git G6 — plan (no writes)');
{
  const { doc, scripts } = localWorkspace();
  const plan = planMoveToGit(doc, scripts, { sharedIds: ['local:c'], liveId: 'local:b', liveScript: LIVE });
  eq('assembly path', plan.assemblyPath, ASM);
  eq('id map', plan.idMap.map((m) => [m.from, m.to, m.shared]), [
    ['local:a', BRACKET, true], ['local:b', BRACKET2, true],
    ['local:c', SH_BOLT, true], ['local:d', COVER, true],
  ]);
  eq('files: parts sorted (codepoint, like G3) then assembly', plan.files.map((f) => f.path), [BRACKET2, BRACKET, SH_BOLT, ASM]);
  eq('missing script reported', plan.missing, [COVER]);
  eq('live editor text wins', plan.scripts[BRACKET2], LIVE);
  eq('doc source git', plan.doc.source, 'git');
  eq('activeId remapped', plan.doc.activeId, BRACKET2);
  eq('position + visibility kept', [plan.doc.parts[0].position, plan.doc.parts[2].visible], [[0, 0, 5], false]);
  ok('.surf.json validates', validateSurfJson(plan.files.at(-1).content).ok);

  // Case-insensitive collision: "bracket" vs "Bracket".
  const ci = planMoveToGit({
    source: 'local', name: 'Gearbox',
    parts: [{ id: 'local:1', name: 'Bracket' }, { id: 'local:2', name: 'bracket' }],
  }, { 'local:1': CUBE, 'local:2': CUBE });
  eq('case-insensitive dedupe', ci.idMap.map((m) => m.to), [BRACKET, sharedPartPath('bracket (2)')]);

  // Rows that already carry repo paths (Git → Local → Git): own path and
  // shared path are kept, another assembly's path is re-homed.
  const carried = planMoveToGit({
    source: 'local', name: 'Gearbox',
    parts: [
      { id: KEPT_BRACKET, name: 'Renamed label', order: 0 },
      { id: SH_BOLT, name: 'M3 bolt', order: 1 },
      { id: assemblyPartPath('Other', 'Plate'), name: 'Plate', order: 2 },
    ],
  }, { [KEPT_BRACKET]: CUBE, [SH_BOLT]: BOLT, [assemblyPartPath('Other', 'Plate')]: CUBE });
  eq('carried paths', carried.idMap.map((m) => m.to), [KEPT_BRACKET, SH_BOLT, sharedPartPath('Plate')]);
  eq('carried shared flag', carried.idMap.map((m) => m.shared), [false, true, true]);
}

console.log('\ngit G6 — Move to Git into a fresh vault (rename field)');
const gh = createMockGithubAdapter({ login: 'artur' });
let moved;
{
  const { doc, scripts } = localWorkspace();
  moved = await moveToGit(gh, {
    vaultName: '  My Vault! ', doc, scripts, sharedIds: ['local:c'], liveId: 'local:b', liveScript: LIVE,
  });
  eq('status moved', moved.status, 'moved');
  eq('vault created', moved.vault.status, 'created');
  eq('rename field sanitized', moved.vault.repo, { owner: 'artur', name: 'My-Vault' });
  ok('vault private', moved.vault.private === true && (await gh.getRepo(moved.vault.repo)).private === true);
  ok('marker present', isVaultMarker((await gh.readFile(moved.vault.repo, VAULT_MARKER_PATH, 'main')).content));
  const commits = gh._log.filter((e) => e.op === 'commitFiles' && e.repo === 'artur/My-Vault');
  eq('seed + one move commit', commits.length, 2);
  eq('move commit paths', commits[1].paths, [BRACKET2, BRACKET, SH_BOLT, ASM]);
  eq('head = move commit', (await gh.getBranch(moved.vault.repo, 'main')).sha, moved.sha);
  const tree = (await gh.listTree(moved.vault.repo, 'main')).map((e) => e.path);
  eq('assembly listed', listAssemblies(tree), ['Gearbox']);
  ok('no file for missing script', !tree.includes(COVER));
  eq('bracket text', (await gh.readFile(moved.vault.repo, BRACKET, 'main')).content, CUBE);
  eq('bracket 2 = live editor', (await gh.readFile(moved.vault.repo, BRACKET2, 'main')).content, LIVE);
  eq('shared bolt at top-level parts/', (await gh.readFile(moved.vault.repo, SH_BOLT, 'main')).content, BOLT);
  const surf = parseSurfJson((await gh.readFile(moved.vault.repo, ASM, 'main')).content);
  eq('surf rows by path', surf.parts.map((p) => p.id), [BRACKET, BRACKET2, SH_BOLT, COVER]);
  eq('surf activeId', surf.activeId, BRACKET2);

  eq('working copy is git', moved.doc.source, 'git');
  ok('baseline clean (no dirty badges)', !isWorkspaceDirty(moved.doc, moved.scripts, moved.baseline));
  eq('baseline head', moved.baseline.headSha, moved.sha);
  eq('baseline path', moved.baseline.assemblyPath, ASM);

  const reopened = await openVaultAssembly(gh, moved.vault.repo, 'Gearbox', { branch: 'main' });
  eq('Open round-trips doc', reopened.doc, moved.doc);
  eq('Open round-trips scripts', reopened.scripts, { ...moved.scripts, [COVER]: '' });

  // G3 continuity: edit → dirty → Commit lands on main.
  const edited = { ...moved.scripts, [BRACKET]: '// edited after move' };
  eq('edit marks one row dirty', [...dirtyPartIds(moved.doc, edited, moved.baseline)], [BRACKET]);
  const res = await commitWorkspace(gh, moved.vault.repo, {
    doc: moved.doc, scripts: edited, baseline: moved.baseline, message: 'edit',
  });
  eq('commit after move', res.status, 'committed');
  eq('commit wrote bracket + assembly', res.files, [BRACKET, ASM]);
}

console.log('\ngit G6 — existing vault, conflicts, bad names');
{
  const head = (await gh.getBranch(moved.vault.repo, 'main')).sha;
  const { doc, scripts } = localWorkspace();
  const again = await moveToGit(gh, { vaultName: 'My-Vault', doc, scripts });
  eq('same assembly again → conflict', [again.status, again.assemblyExists], ['conflict', true]);
  eq('conflict wrote nothing', (await gh.getBranch(moved.vault.repo, 'main')).sha, head);

  // Second assembly into the found vault, reusing the identical shared bolt.
  const second = await moveToGit(gh, {
    vaultName: 'My-Vault',
    doc: { source: 'local', name: 'Cover box', parts: [
      { id: 'local:x', name: 'Lid' }, { id: 'local:y', name: 'M3 bolt' },
    ] },
    scripts: { 'local:x': CUBE, 'local:y': BOLT },
    sharedIds: ['local:y'],
  });
  eq('found vault', [second.status, second.vault.status], ['moved', 'found']);
  eq('identical shared part not rewritten', second.files,
    [sharedPartPath('Lid'), assemblyFilePath('Cover box')]);
  eq('both assemblies listed', listAssemblies(await gh.listTree(moved.vault.repo, 'main')), ['Cover box', 'Gearbox']);

  const clash = await moveToGit(gh, {
    vaultName: 'My-Vault',
    doc: { source: 'local', name: 'Third', parts: [{ id: 'local:z', name: 'M3 bolt' }] },
    scripts: { 'local:z': '// different bolt' },
    sharedIds: ['local:z'],
  });
  eq('different shared text → conflict', [clash.status, clash.assemblyExists, clash.paths], ['conflict', false, [SH_BOLT]]);

  gh._seedRepo({ name: 'notes', files: { 'README.md': '# notes' } });
  const nav = await moveToGit(gh, { vaultName: 'notes', doc, scripts });
  eq('non-vault repo refused', nav.status, 'not-a-vault');
  eq('non-vault repo untouched', (await gh.listTree({ owner: 'artur', name: 'notes' }, 'main')).map((e) => e.path), ['README.md']);

  const bad = await moveToGit(gh, { vaultName: '!!!', doc, scripts });
  eq('invalid name', bad.status, 'invalid-name');
  ok('no repo for invalid name', !gh._log.some((e) => e.op === 'createRepo' && /!!!/.test(e.repo)));
  eq('empty assembly', (await moveToGit(gh, { doc: { source: 'local', name: 'E', parts: [] }, scripts: {} })).status, 'empty');

  const def = createMockGithubAdapter({ login: 'artur' });
  const dflt = await moveToGit(def, { doc, scripts });
  eq('default vault name surfcad-vault', dflt.vault.repo.name, 'surfcad-vault');
  eq('default matches findOrCreateVault', (await findOrCreateVault(def)).status, 'found');
}

console.log('\ngit G6 — UI wiring (PartFeed + App)');
const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
ok('Vault create dialog machinery remains (G10: not opened from Local|Git toggle)',
  /startMoveToGit/.test(feed) && /dataAttr="move-to-git"/.test(feed)
  && !/data-parts-source-toggle/.test(feed));
ok('G13 slim vault create: name + Save/Cancel only', /data-git-vault-create/.test(feed)
  && /data-git-move-vault-name/.test(feed) && /data-git-vault-save/.test(feed)
  && /data-git-move-confirm/.test(feed) && /Create repo/.test(feed)
  && !/data-git-move-plan/.test(feed) && !/data-git-move-shared=/.test(feed)
  && !/data-git-move-switch-only/.test(feed) && !/Switch only/.test(feed));
ok('App wires plan + move', /onPlanMoveToGit=\{handlePlanMoveToGit\}/.test(app)
  && /onMoveToGit=\{handleMoveToGit\}/.test(app));
ok('Move to Git is v2 first Save (ids stay opaque)',
  /const handleMoveToGit[\s\S]*handleV2PlanSave\(/.test(app)
  && /vaultLayout: 'v2'/.test(app.slice(app.indexOf('const handleMoveToGit'), app.indexOf('const handleListVaultAssemblies')))
  && !/moveToGit\(ensureGitAdapter\(\)/.test(app)
  && !/applyCommittedWorkspace\(\{ doc: result\.doc/.test(app));
ok('default vault name from vault / surfcad', /defaultVaultName=\{gitDefaultVaultName\(\)\}/.test(app)
  && /DEFAULT_VAULT_NAME/.test(app));
ok('Connect gated on client id / connected (G10)',
  /data-git-connect=""/.test(feed)
  && /githubConnectReady/.test(feed));
ok('index exports G6', typeof gitIndex.moveToGit === 'function' && typeof gitIndex.planMoveToGit === 'function');
const src = readFileSync(new URL('../../src/utils/git/gitMoveToGit.js', import.meta.url), 'utf8');
ok('no network or token use in G6', !/\bfetch\(|api\.github\.com|XMLHttpRequest|localStorage|Authorization/.test(src));

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
