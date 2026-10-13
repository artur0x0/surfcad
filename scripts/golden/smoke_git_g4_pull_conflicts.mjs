#!/usr/bin/env node
/**
 * G4 pull/conflicts: check remote on open/focus; behind toast + markers;
 * Reload / Keep mine / Check in mine to a branch (base auto-detected).
 * Mock adapter only — no network, no tokens.
 */
import { readFileSync } from 'node:fs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath, sharedPartPath } from '../../src/utils/git/vaultLayout.js';
import { stringifySurfJson, parseSurfJson } from '../../src/utils/git/surfJson.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { openVaultAssembly, isWorkspaceDirty, isPartDirty } from '../../src/utils/git/gitWorkspace.js';
import {
  checkRemoteBehind, behindPathsFromFiles, behindToastMessage, behindToastTarget,
  openBehindToastTarget, keepBehindToastTarget,
  remainingBehindMarkers, reloadFromRemote, advanceBaselineHead,
  checkInMineToBranch,
} from '../../src/utils/git/gitPull.js';
import { detectCommitBase } from '../../src/utils/git/gitCommit.js';
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
const DAY = new Date(2026, 9, 6, 11, 0);

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
  return { gh, repo: vault.repo, opened, seedSha: seed.sha, doc };
}

console.log('git G4 — behind detection');
{
  const { gh, repo, opened, seedSha } = await seedVault();
  const clean = await checkRemoteBehind(gh, repo, {
    baselineSha: opened.baseline.headSha,
    assemblyPath: ASM,
    partIds: [BRACKET, BOLT],
  });
  eq('fresh open is identical', [clean.status, clean.behindBy, clean.assemblyBehind, clean.partIds],
    ['identical', 0, false, []]);

  const remote = await gh.commitFiles(repo, {
    branch: 'main', message: 'remote edit', baseSha: seedSha,
    files: [
      fileWrite(BRACKET, '// remote bracket'),
      fileWrite(ASM, stringifySurfJson({
        ...opened.doc,
        parts: [
          ...opened.doc.parts,
          { id: SPARE, name: 'Spare', visible: true, order: 2 },
        ],
      })),
      fileWrite(SPARE, '// remote spare'),
    ],
  });

  const behind = await checkRemoteBehind(gh, repo, {
    baselineSha: opened.baseline.headSha,
    assemblyPath: ASM,
    partIds: opened.doc.parts.map((p) => p.id),
  });
  eq('status behind', behind.status, 'behind');
  eq('behindBy = 1', behind.behindBy, 1);
  eq('remoteSha', behind.remoteSha, remote.sha);
  eq('base = open head', behind.baseSha, seedSha);
  eq('assembly behind', behind.assemblyBehind, true);
  eq('bracket behind (bolt not)', behind.partIds, [BRACKET]);
  ok('toast names commit count', /1 new commit/.test(behindToastMessage({ behindBy: 1 })));
  ok('toast plural', /2 new commits/.test(behindToastMessage({ behindBy: 2 })));
  ok('toast names Get latest and Keep mine',
    /Get latest/.test(behindToastMessage({ behindBy: 1 }))
    && /Keep mine/.test(behindToastMessage({ behindBy: 1 }))
    && !/Open Parts/.test(behindToastMessage({ behindBy: 1 })));
  eq('toast target prefers the assembly', behindToastTarget(behind, [], {
    assemblyName: 'Gearbox',
    parts: opened.doc.parts,
  }), { path: ASM, kind: 'assembly', name: 'Gearbox' });
  eq('toast target uses the part when the assembly is current', behindToastTarget({
    ...behind, assemblyBehind: false,
  }, [], { parts: opened.doc.parts }), { path: BRACKET, kind: 'part', name: 'Bracket' });
  eq('resolved assembly falls through to the part', behindToastTarget(behind, [ASM], {
    parts: opened.doc.parts,
  }), { path: BRACKET, kind: 'part', name: 'Bracket' });
  {
    const calls = [];
    const feed = {
      openBehindConflict(path, kind, name) { calls.push(['open', path, kind, name]); },
      keepBehind(path, kind) { calls.push(['keep', path, kind]); return { status: 'kept', path }; },
    };
    const target = { path: BRACKET, kind: 'part', name: 'Bracket' };
    ok('Get latest opens that feed dialog', openBehindToastTarget(feed, target) === true);
    eq('Keep mine calls the keep handler', await keepBehindToastTarget(feed, target), { status: 'kept', path: BRACKET });
    eq('toast helpers hit the feed once each', calls, [
      ['open', BRACKET, 'part', 'Bracket'],
      ['keep', BRACKET, 'part'],
    ]);
    ok('missing target does not open a dialog', openBehindToastTarget(feed, null) === false);
  }

  const scoped = behindPathsFromFiles(behind.files, { assemblyPath: ASM, partIds: [BRACKET, BOLT] });
  eq('scoped ignores spare not in doc', scoped.partIds, [BRACKET]);
  eq('scoped assembly', scoped.assemblyBehind, true);

  // Same base detection G3 uses.
  const base = await detectCommitBase(gh, repo, { baselineSha: opened.baseline.headSha });
  eq('detectCommitBase agrees', [base.baseSha, base.mainSha, base.behindBy], [seedSha, remote.sha, 1]);
}

console.log('\ngit G4 — Reload / Keep mine / Check in mine');
{
  const { gh, repo, opened, seedSha } = await seedVault();
  await gh.commitFiles(repo, {
    branch: 'main', message: 'remote', baseSha: seedSha,
    files: [
      fileWrite(BRACKET, '// remote bracket'),
      fileWrite(BOLT, '// remote bolt'),
    ],
  });
  const check = await checkRemoteBehind(gh, repo, {
    baselineSha: opened.baseline.headSha,
    assemblyPath: ASM,
    partIds: [BRACKET, BOLT],
  });
  eq('both parts behind', check.partIds, [BOLT, BRACKET].sort());

  // Reload bracket.
  const reloaded = await reloadFromRemote(gh, repo, {
    path: BRACKET, kind: 'part', branch: 'main',
    doc: opened.doc, scripts: opened.scripts, baseline: opened.baseline,
  });
  eq('reload status content', reloaded.content, '// remote bracket');
  eq('baseline script updated', reloaded.baseline.scripts[BRACKET], '// remote bracket');
  ok('working script updated', reloaded.scripts[BRACKET] === '// remote bracket');
  ok('headSha not advanced on single reload', reloaded.baseline.headSha === opened.baseline.headSha);
  ok('not dirty after reload vs new baseline',
    !isPartDirty(BRACKET, reloaded.scripts[BRACKET], reloaded.baseline));

  let resolved = [BRACKET];
  let markers = remainingBehindMarkers(check, resolved);
  eq('after reload bracket, bolt still marked', markers, { assemblyBehind: false, partIds: [BOLT], any: true });

  // Keep mine on bolt — marker clears, working copy unchanged, headSha stays.
  resolved = [BRACKET, BOLT];
  markers = remainingBehindMarkers(check, resolved);
  eq('keep mine clears markers', markers, { assemblyBehind: false, partIds: [], any: false });
  ok('local bolt still mine', opened.scripts[BOLT] === 'return Manifold.cylinder(6, 1.5, 1.5, 24);');

  // Advance head only when every marker was Reloaded (caller decides).
  const advanced = advanceBaselineHead(reloaded.baseline, check.remoteSha);
  eq('advance head', advanced.headSha, check.remoteSha);
  const after = await checkRemoteBehind(gh, repo, {
    baselineSha: advanced.headSha,
    assemblyPath: ASM,
    partIds: [BRACKET, BOLT],
  });
  eq('current after advance', [after.status, after.behindBy], ['identical', 0]);
}

console.log('\ngit G4 — Check in mine to a branch');
{
  const { gh, repo, opened, seedSha } = await seedVault();
  const remote = await gh.commitFiles(repo, {
    branch: 'main', message: 'remote', baseSha: seedSha,
    files: [fileWrite(BRACKET, '// remote bracket')],
  });
  const scripts = { ...opened.scripts, [BRACKET]: '// mine bracket' };
  const mainBefore = (await gh.listBranches(repo)).find((b) => b.name === 'main').sha;
  const res = await checkInMineToBranch(gh, repo, {
    doc: opened.doc, scripts, baseline: opened.baseline,
    path: BRACKET, kind: 'part', now: DAY,
  });
  eq('branched status', res.status, 'branched');
  eq('branch name', res.branch, 'surfcad/Gearbox-2026-10-06');
  eq('main untouched', (await gh.getBranch(repo, 'main')).sha, remote.sha);
  eq('branch has mine', (await gh.readFile(repo, BRACKET, res.branch)).content, '// mine bracket');
  eq('main still remote', (await gh.readFile(repo, BRACKET, 'main')).content, '// remote bracket');
  eq('base auto-detected', res.baseSha, seedSha);
  ok('working copy unchanged', scripts[BRACKET] === '// mine bracket');
  ok('baseline head unchanged', opened.baseline.headSha === seedSha);
  eq('mainBefore preserved', mainBefore, remote.sha);

  // Second check-in same day gets -2.
  const again = await checkInMineToBranch(gh, repo, {
    doc: opened.doc, scripts, baseline: opened.baseline,
    path: BRACKET, kind: 'part', now: DAY,
  });
  eq('same-day suffix', again.branch, 'surfcad/Gearbox-2026-10-06-2');

  // Assembly check-in.
  const renamed = { ...opened.doc, name: 'Gearbox' };
  renamed.parts = renamed.parts.map((p, i) => (i === 0 ? { ...p, name: 'BracketX' } : p));
  const asmRes = await checkInMineToBranch(gh, repo, {
    doc: renamed, scripts: opened.scripts, baseline: opened.baseline,
    path: ASM, kind: 'assembly', now: DAY,
  });
  eq('assembly branch', asmRes.branch, 'surfcad/Gearbox-2026-10-06-3');
  const asmOnBranch = parseSurfJson((await gh.readFile(repo, ASM, asmRes.branch)).content);
  eq('assembly on branch has rename', asmOnBranch.parts[0].name, 'BracketX');
}

console.log('\ngit G4 — assembly reload');
{
  const { gh, repo, opened, seedSha } = await seedVault();
  const remoteDoc = {
    ...opened.doc,
    parts: [
      ...opened.doc.parts,
      { id: SPARE, name: 'Spare', visible: true, order: 2 },
    ],
  };
  await gh.commitFiles(repo, {
    branch: 'main', message: 'add spare to asm', baseSha: seedSha,
    files: [fileWrite(ASM, stringifySurfJson(remoteDoc))],
  });
  const check = await checkRemoteBehind(gh, repo, {
    baselineSha: opened.baseline.headSha,
    assemblyPath: ASM,
    partIds: opened.doc.parts.map((p) => p.id),
  });
  eq('only assembly behind', [check.assemblyBehind, check.partIds], [true, []]);
  const reloaded = await reloadFromRemote(gh, repo, {
    path: ASM, kind: 'assembly', branch: 'main',
    doc: opened.doc, scripts: opened.scripts, baseline: opened.baseline,
  });
  eq('reloaded doc has spare', reloaded.doc.parts.map((p) => p.id), [BRACKET, BOLT, SPARE]);
  ok('baseline assembly text = remote', reloaded.baseline.assemblyText === (await gh.readFile(repo, ASM, 'main')).content);
  ok('clean vs reloaded baseline (same scripts)',
    !isWorkspaceDirty(reloaded.doc, reloaded.scripts, reloaded.baseline));
}

console.log('\ngit G4 — UI wiring (PartFeed + App)');
const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const toast = readFileSync(new URL('../../src/components/GitBehindToast.jsx', import.meta.url), 'utf8');
ok('behind toast Get latest and Keep mine', /data-git-behind-toast/.test(toast)
  && /data-git-behind-toast-get/.test(toast) && /data-git-behind-toast-keep/.test(toast)
  && /Get latest/.test(toast) && /Keep mine/.test(toast)
  && !/data-git-behind-toast-parts/.test(app) && !/data-git-behind-toast-parts/.test(toast)
  && /tone="warn"/.test(toast));
ok('Get latest reuses the Parts dialog opener', /openBehindToastTarget\(/.test(app)
  && /openBehindConflict/.test(feed) && /dispatchBehind\(/.test(feed));
const keepHandler = app.split('onGitBehindKeepMine')[1] || '';
ok('Keep mine calls the dialog keep handler and dismisses the toast',
  /keepBehindToastTarget\(/.test(keepHandler.slice(0, 500))
  && /setGitBehindToast\(null\)/.test(keepHandler.slice(0, 500))
  && /keepBehind = \(path, kind\) => dispatchBehind\('keep'/.test(feed));
ok('check on open + focus', /checkGitRemoteBehind\(\{ showToast: true, reason: 'open' \}\)/.test(app)
  && /reason: 'focus'/.test(app)
  && /window\.addEventListener\('focus'/.test(app)
  && /visibilitychange/.test(app));
ok('behind markers on rows + assembly', /data-part-behind/.test(feed) && /data-assembly-behind/.test(feed));
ok('conflict dialog three choices', /data-git-behind-reload/.test(feed) && /data-git-behind-keep/.test(feed)
  && /data-git-behind-branch/.test(feed) && /data-git-behind-ask/.test(feed));
ok('App wires behind choice', /handleBehindChoice/.test(app) && /onBehindChoice=\{handleBehindChoice\}/.test(app)
  && /reloadFromRemote\(/.test(app) && /checkInMineToBranch\(/.test(app)
  && /markBehindResolved/.test(app));
ok('index exports G4', typeof gitIndex.checkRemoteBehind === 'function'
  && typeof gitIndex.reloadFromRemote === 'function'
  && typeof gitIndex.checkInMineToBranch === 'function'
  && typeof gitIndex.remainingBehindMarkers === 'function');
ok('Connect still git-only (G7 gates on client id)',
  /data-git-connect=""/.test(feed) && /source === 'git'/.test(feed)
  && /githubConnectReady/.test(feed));
const src = readFileSync(new URL('../../src/utils/git/gitPull.js', import.meta.url), 'utf8');
ok('no network or token use in G4', !/\bfetch\(|api\.github\.com|XMLHttpRequest|localStorage|Authorization/.test(src));

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
