#!/usr/bin/env node
/**
 * G3 commit/push: changed parts + assembly as one commit to main.
 * A moved tip returns conflict and writes nothing until Overwrite main.
 * Assembly rename moves paths in the same commit (see G5 golden for full
 * rename-on-Commit coverage).
 * Mock adapter only — no network, no tokens.
 */
import { readFileSync } from 'node:fs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath, sharedPartPath } from '../../src/utils/git/vaultLayout.js';
import { stringifySurfJson, parseSurfJson } from '../../src/utils/git/surfJson.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { openVaultAssembly, isWorkspaceDirty } from '../../src/utils/git/gitWorkspace.js';
import {
  buildCommitFiles, commitBranchName, commitWorkspace, detectCommitBase,
  forceMergeCommit, firstCommitBaseline,
} from '../../src/utils/git/gitCommit.js';
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

const BRACKET = assemblyPartPath('Gearbox', 'Bracket');
const BOLT = sharedPartPath('M3 bolt');
const SPARE = assemblyPartPath('Gearbox', 'Spare');
const ASM = assemblyFilePath('Gearbox');
const DAY = new Date(2026, 9, 6, 9, 30);

async function seedVault() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const doc = {
    source: 'git', name: 'Gearbox', activeId: BRACKET,
    parts: [
      { id: BRACKET, name: 'Bracket', visible: true, order: 0 },
      { id: BOLT, name: 'M3 bolt', visible: true, order: 1 },
    ],
  };
  const seed = await gh.commitFiles(vault.repo, {
    branch: 'main', message: 'seed', baseSha: vault.headSha,
    files: [
      fileWrite(ASM, stringifySurfJson(doc)),
      fileWrite(BRACKET, 'return Manifold.cube([10,10,10], true);'),
      fileWrite(BOLT, 'return Manifold.cylinder(6, 1.5, 1.5, 24);'),
      fileWrite(SPARE, 'return Manifold.cube([1,1,1], true);'),
    ],
  });
  const opened = await openVaultAssembly(gh, vault.repo, 'Gearbox', { branch: 'main', headSha: seed.sha });
  return { gh, repo: vault.repo, opened, seedSha: seed.sha };
}
const commitsOn = (gh, branch) => gh._log.filter((e) => e.op === 'commitFiles' && e.branch === branch);

console.log('git G3 — commit files');
{
  const { opened } = await seedVault();
  eq('clean → no files', buildCommitFiles(opened.doc, opened.scripts, opened.baseline).files, []);
  const edited = { ...opened.scripts, [BRACKET]: 'return Manifold.cube([12,12,12], true);' };
  const b = buildCommitFiles(opened.doc, edited, opened.baseline);
  eq('edit → part + assembly', b.files.map((f) => f.path), [BRACKET, ASM]);
  const live = buildCommitFiles(opened.doc, opened.scripts, opened.baseline, { liveId: BOLT, liveScript: '// live' });
  eq('live editor text is committed', live.files.map((f) => [f.path, f.path === BOLT ? f.content : '']), [[BOLT, '// live'], [ASM, '']]);
  const renamed = { ...opened.doc, parts: opened.doc.parts.map((p, i) => (i === 1 ? { ...p, name: 'Bolt' } : p)) };
  eq('rename → assembly only', buildCommitFiles(renamed, opened.scripts, opened.baseline).files.map((f) => f.path), [ASM]);
  const dropped = { ...opened.doc, parts: opened.doc.parts.filter((p) => p.id !== BOLT) };
  const d = buildCommitFiles(dropped, opened.scripts, opened.baseline);
  eq('removed part → assembly only, no delete', d.files.map((f) => [f.path, !!f.delete]), [[ASM, false]]);
  eq('branch name', commitBranchName('Gearbox', DAY), 'surfcad/Gearbox-2026-10-06');
  eq('branch name slug', commitBranchName('My Gear box', DAY), 'surfcad/My-Gear-box-2026-10-06');
}

console.log('\ngit G3 — happy path: one commit to main');
{
  const { gh, repo, opened, seedSha } = await seedVault();
  const scripts = { ...opened.scripts, [BRACKET]: 'return Manifold.cube([12,12,12], true);' };
  const doc = { ...opened.doc, parts: [...opened.doc.parts, { id: assemblyPartPath('Gearbox', 'Gear'), name: 'Gear', visible: true, order: 2 }] };
  scripts[assemblyPartPath('Gearbox', 'Gear')] = 'return Manifold.sphere(5, 32);';
  const before = commitsOn(gh, 'main').length;
  eq('clean commit is a no-op', (await commitWorkspace(gh, repo, { doc: opened.doc, scripts: opened.scripts, baseline: opened.baseline })).status, 'clean');
  const res = await commitWorkspace(gh, repo, { doc, scripts, baseline: opened.baseline, message: 'Bigger bracket + gear', now: DAY });
  eq('status committed', res.status, 'committed');
  eq('exactly one commit to main', commitsOn(gh, 'main').length - before, 1);
  eq('commit paths', res.files, [BRACKET, assemblyPartPath('Gearbox', 'Gear'), ASM]);
  const head = await gh.getBranch(repo, 'main');
  eq('main head is the commit', head.sha, res.sha);
  const cmp = await gh.compare(repo, seedSha, res.sha);
  eq('fast-forward one commit', [cmp.status, cmp.aheadBy], ['ahead', 1]);
  eq('bracket in git', (await gh.readFile(repo, BRACKET, 'main')).content, 'return Manifold.cube([12,12,12], true);');
  eq('assembly in git has gear', parseSurfJson((await gh.readFile(repo, ASM, 'main')).content).parts.map((p) => p.id),
    [BRACKET, BOLT, assemblyPartPath('Gearbox', 'Gear')]);
  eq('bolt untouched', (await gh.readFile(repo, BOLT, 'main')).content, 'return Manifold.cylinder(6, 1.5, 1.5, 24);');
  ok('new baseline clean', !isWorkspaceDirty(doc, scripts, res.baseline));
  eq('new baseline head', res.baseline.headSha, res.sha);
  ok('no surfcad/ branch on happy path', !(await gh.listBranches(repo)).some((b) => b.name.startsWith('surfcad/')));
  const second = await commitWorkspace(gh, repo, {
    doc, scripts: { ...scripts, [BOLT]: '// second' }, baseline: res.baseline,
  });
  eq('second commit chains on new baseline', [second.status, (await gh.getBranch(repo, 'main')).sha === second.sha], ['committed', true]);
}

console.log('\ngit G3 — moved main → conflict, nothing overwritten');
{
  const { gh, repo, opened, seedSha } = await seedVault();
  const remote = await gh.commitFiles(repo, {
    branch: 'main', message: 'remote edit', baseSha: seedSha,
    files: [fileWrite(BRACKET, '// remote bracket'), fileWrite(SPARE, '// remote spare')],
  });
  const base = await detectCommitBase(gh, repo, { branch: 'main', baselineSha: opened.baseline.headSha });
  eq('base detected = our open', [base.baseSha, base.mainSha, base.behindBy], [seedSha, remote.sha, 1]);
  eq('remote changed files', base.remoteFiles.map((f) => f.path), [BRACKET, SPARE]);
  const scripts = { ...opened.scripts, [BRACKET]: '// mine bracket' };
  const mainBefore = commitsOn(gh, 'main').length;
  const res = await commitWorkspace(gh, repo, { doc: opened.doc, scripts, baseline: opened.baseline, message: 'mine', now: DAY });
  eq('status conflict', res.status, 'conflict');
  ok('sync hold', res.syncHold === true);
  eq('main not written', [commitsOn(gh, 'main').length - mainBefore, (await gh.getBranch(repo, 'main')).sha], [0, remote.sha]);
  eq('remote bracket kept', (await gh.readFile(repo, BRACKET, 'main')).content, '// remote bracket');
  eq('remote spare kept', (await gh.readFile(repo, SPARE, 'main')).content, '// remote spare');
  ok('no side branch', !(await gh.listBranches(repo)).some((b) => b.name.startsWith('surfcad/')));
  const again = await commitWorkspace(gh, repo, { doc: opened.doc, scripts, baseline: opened.baseline, now: DAY });
  eq('second stale save is also a conflict', again.status, 'conflict');
  eq('keep on branch leaves main', (await gh.getBranch(repo, 'main')).sha, remote.sha);
  const overwritten = await forceMergeCommit(gh, repo, {
    doc: opened.doc,
    scripts,
    baseline: opened.baseline,
    message: 'mine',
  });
  eq('overwrite committed', overwritten.status, 'committed');
  eq('main contains the local content', (await gh.readFile(repo, BRACKET, 'main')).content, '// mine bracket');
  eq('remote spare stays', (await gh.readFile(repo, SPARE, 'main')).content, '// remote spare');
  eq('overwrite is the new main', (await gh.getBranch(repo, 'main')).sha, overwritten.sha);
}

console.log('\ngit G3 — first commit of a new assembly (no Open)');
{
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const P = assemblyPartPath('Widget', 'Body');
  const doc = { source: 'git', name: 'Widget', activeId: P, parts: [{ id: P, name: 'Body', visible: true, order: 0 }] };
  const res = await commitWorkspace(gh, vault.repo, {
    doc, scripts: { [P]: 'return Manifold.cube([5,5,5], true);' },
    baseline: firstCommitBaseline({ branch: 'main', headSha: vault.headSha }),
  });
  eq('first commit writes part + assembly', [res.status, res.files], ['committed', [P, assemblyFilePath('Widget')]]);
  const mixed = { ...doc, parts: [...doc.parts, { id: 'local-abc', name: 'part1', visible: true, order: 1 }] };
  let strayErr = '';
  let strayCode = '';
  let strayIds = null;
  try {
    await commitWorkspace(gh, vault.repo, { doc: mixed, scripts: {}, baseline: firstCommitBaseline({ headSha: res.sha }) });
  } catch (err) {
    strayErr = err.message;
    strayCode = err.code || '';
    strayIds = err.stray;
  }
  ok('local (non-repo) row refused with a clear message', /No repo path for part1/.test(strayErr), strayErr);
  ok('no_repo_path carries stray ids for Add to Repo', strayCode === 'no_repo_path'
    && Array.isArray(strayIds) && strayIds[0]?.id === 'local-abc' && strayIds[0]?.name === 'part1',
  strayCode);
  const reopened = await openVaultAssembly(gh, vault.repo, 'Widget');
  eq('reopens from vault', reopened.scripts[P], 'return Manifold.cube([5,5,5], true);');
  ok('clean vs new baseline', !isWorkspaceDirty(doc, { [P]: 'return Manifold.cube([5,5,5], true);' }, res.baseline));
  // Null baseline head (post-OAuth, no Open yet) must resolve tip — not throw
  // "main moved: head …, base null" or falsely return branched.
  const P2 = assemblyPartPath('Gadget', 'Cap');
  const doc2 = { source: 'git', name: 'Gadget', activeId: P2, parts: [{ id: P2, name: 'Cap', visible: true, order: 0 }] };
  const nullBase = await commitWorkspace(gh, vault.repo, {
    doc: doc2, scripts: { [P2]: 'return Manifold.cube([1,1,1], true);' },
    baseline: firstCommitBaseline({ branch: 'main', headSha: null }),
  });
  eq('null baseline head commits on tip (not branched)', nullBase.status, 'committed');
  ok('null-base did not invent a side branch', !nullBase.branch || nullBase.branch === 'main');
}

console.log('\ngit G3 — assembly rename moves in one commit');
{
  const { gh, repo, opened } = await seedVault();
  const renamed = { ...opened.doc, name: 'Transmission' };
  const res = await commitWorkspace(gh, repo, {
    doc: renamed, scripts: opened.scripts, baseline: opened.baseline,
    message: 'rename',
  });
  eq('rename commit status', res.status, 'committed');
  const NEW_ASM = assemblyFilePath('Transmission');
  const NEW_BRACKET = assemblyPartPath('Transmission', 'Bracket');
  ok('new assembly path written', !!(await gh.readFile(repo, NEW_ASM, 'main')));
  ok('old assembly path deleted', !(await gh.readFile(repo, ASM, 'main')));
  ok('bracket moved', !!(await gh.readFile(repo, NEW_BRACKET, 'main')) && !(await gh.readFile(repo, BRACKET, 'main')));
  ok('shared bolt stays', !!(await gh.readFile(repo, BOLT, 'main')));
}

console.log('\ngit G3 — UI wiring (PartFeed + App)');
const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
ok('Commit button git-only, gated', /data-git-commit=""/.test(feed) && /disabled=\{!canCommit\}/.test(feed)
  && /canCommit=\{assemblyDoc\.source === 'git' && !!sourceDirty/.test(app));
ok('commit message dialog', /data-git-commit-message/.test(feed) && /data-git-commit-confirm/.test(feed));
ok('commit message prompts + no iOS zoom', /Enter a commit message/.test(feed)
  && /data-git-commit-message[\s\S]*?PARTS_TEXT_INPUT_STYLE/.test(feed)
  && /PARTS_TEXT_INPUT_CLASS/.test(feed)
  && /partsChrome\.js/.test(feed)
  && /fontSize: '16px'/.test(readFileSync(new URL('../../src/utils/partsChrome.js', import.meta.url), 'utf8')));
ok('no-repo-path commit error offers Add to Repo', /data-git-commit-add-to-repo/.test(feed)
  && /no_repo_path/.test(feed) && /runAddStrayToRepo/.test(feed));
ok('force merge ask', /data-git-force-merge-ask/.test(feed) && /data-git-force-merge=""/.test(feed)
  && /data-git-keep-branch/.test(feed) && /data-git-force-merge-warning/.test(feed));
ok('G13 conflict popup options', /data-git-conflict-popup/.test(feed)
  && /data-git-conflict-stay/.test(feed) && /Stay on branch/.test(feed)
  && /data-git-conflict-open-github/.test(feed) && /Open on GitHub/.test(feed)
  && /data-git-conflict-overwrite/.test(feed) && /Overwrite main/.test(feed)
  && !/Keep on branch/.test(feed) && !/>Force merge</.test(feed));
ok('App queues Save; Overwrite main force-flushes', /handleGitCommit/.test(app)
  && /assembleCommitFiles\(gitAdapterRef\.current/.test(app)
  && /op: 'save'/.test(app)
  && !/commitWorkspace\(gitAdapterRef\.current/.test(app)
  && !/forceMergeCommit\(/.test(app)
  && /handleOverwriteMain/.test(app)
  && /force:\s*true/.test(app)
  && /onOverwriteMain=\{handleOverwriteMain\}/.test(app)
  && /onGitCommit=\{handleGitCommit\}/.test(app) && /canCommit=/.test(app));
ok('baseline advances after commit', /rememberGitBaseline\(result\.baseline\)/.test(app)
  || /rememberGitBaseline\(captureBaseline\(/.test(app));
ok('index exports G3', typeof gitIndex.commitWorkspace === 'function'
  && typeof gitIndex.assembleCommitFiles === 'function'
  && typeof gitIndex.forceMergeCommit === 'function');
const commitSrc = readFileSync(new URL('../../src/utils/git/gitCommit.js', import.meta.url), 'utf8');
const vaultSrc = readFileSync(new URL('../../src/utils/git/vault.js', import.meta.url), 'utf8');
ok('null baseline head resolves tip before commit', /expectedBase = opts\.baseline\?\.headSha/.test(commitSrc)
  && /adapter\.getBranch\(repo, branch\)/.test(commitSrc));
ok('vault findOrCreate prefers getBranch over size===0', /inspectRepo/.test(vaultSrc)
  && /getBranch/.test(vaultSrc) && /size === 0/.test(vaultSrc) && /non_fast_forward/.test(vaultSrc));
ok('G10 suppresses Upload Error for main-moved vault race', /moved:\\s\*head/i.test(app));
ok('Connect still git-only (G7 gates on client id)',
  /data-git-connect=""/.test(feed) && /source === 'git'/.test(feed)
  && /githubConnectReady/.test(feed));
const src = readFileSync(new URL('../../src/utils/git/gitCommit.js', import.meta.url), 'utf8');
ok('no network or token use in G3', !/\bfetch\(|api\.github\.com|XMLHttpRequest|localStorage|Authorization/.test(src));

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
