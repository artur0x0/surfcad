#!/usr/bin/env node
/**
 * G5 branch view (+ rename-on-Commit fold-in): list branches with current
 * marked, switch reloads the assembly; assembly rename moves paths in the
 * same commit (shared parts stay). Mock adapter only — no network, no tokens.
 */
import { readFileSync } from 'node:fs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import {
  ASSEMBLIES_DIR, assemblyFilePath, assemblyPartPath, sharedPartPath,
} from '../../src/utils/git/vaultLayout.js';
import { stringifySurfJson, parseSurfJson } from '../../src/utils/git/surfJson.js';
import { stripSurfId } from '../../src/utils/git/surfId.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { openVaultAssembly, isWorkspaceDirty } from '../../src/utils/git/gitWorkspace.js';
import {
  buildCommitFiles, commitWorkspace, remapAssemblyPaths,
} from '../../src/utils/git/gitCommit.js';
import { listVaultBranches, switchVaultBranch } from '../../src/utils/git/gitBranch.js';
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
/** Open keys rows and scripts by surf id and keeps the repo path on the row. */
const idOf = (doc, path) => (doc?.parts || []).find((p) => p.path === path || p.id === path)?.id;

const BRACKET = assemblyPartPath('Gearbox', 'Bracket');
const BOLT = sharedPartPath('M3 bolt');
const SPARE = assemblyPartPath('Gearbox', 'Spare');
const ASM = assemblyFilePath('Gearbox');
const ASM2 = assemblyFilePath('Transmission');
const BRACKET2 = assemblyPartPath('Transmission', 'Bracket');

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

console.log('git G5 — branch list + switch reload');
{
  const { gh, repo, seedSha } = await seedVault();
  // Side branch with a different bracket script.
  await gh.createBranch(repo, 'feature/cover', seedSha);
  await gh.commitFiles(repo, {
    branch: 'feature/cover', message: 'cover edit',
    files: [fileWrite(BRACKET, '// cover branch bracket')],
    baseSha: seedSha,
  });
  const listed = await listVaultBranches(gh, repo, { current: 'main' });
  eq('lists main + feature', listed.map((b) => b.name), ['main', 'feature/cover']);
  eq('main marked current', listed.find((b) => b.name === 'main')?.current, true);
  eq('feature not current', listed.find((b) => b.name === 'feature/cover')?.current, false);

  const switched = await switchVaultBranch(gh, repo, 'Gearbox', 'feature/cover');
  eq('switched baseline branch', switched.baseline.branch, 'feature/cover');
  // Open keys scripts by surf id and keeps the repo path on the row.
  eq('reloaded bracket from feature', switched.scripts[idOf(switched.doc, BRACKET)], '// cover branch bracket');
  ok('baseline head is feature tip', switched.baseline.headSha === (await gh.getBranch(repo, 'feature/cover')).sha);
  ok('clean after switch', !isWorkspaceDirty(switched.doc, switched.scripts, switched.baseline));

  const back = await switchVaultBranch(gh, repo, 'Gearbox', 'main');
  eq('back on main', back.baseline.branch, 'main');
  eq('main bracket restored', back.scripts[idOf(back.doc, BRACKET)], 'return Manifold.cube([10,10,10], true);');

  let missing = '';
  try { await switchVaultBranch(gh, repo, 'Gearbox', 'nope'); }
  catch (err) { missing = err.message; }
  ok('missing branch refused', /Branch not found/.test(missing), missing);

  // Named assembly missing on tip → fall back to another vault assembly
  // (playtest: default "Assembly" never committed, switch after Create).
  await gh.createBranch(repo, 'feature/empty-asm', seedSha);
  const fallback = await switchVaultBranch(gh, repo, 'Assembly', 'feature/empty-asm');
  eq('missing name falls back to Gearbox', fallback.doc.name, 'Gearbox');
  eq('fallback flag set', fallback.fallbackAssembly, 'Gearbox');
  eq('fallback on side branch', fallback.baseline.branch, 'feature/empty-asm');

  // Tip with no assemblies at all → seed empty working copy (no hard error).
  const emptyInfo = gh._seedRepo({ name: 'surfcad-empty-switch', files: { 'README.md': '# x' } });
  const emptyRepo = { owner: emptyInfo.owner, name: emptyInfo.name };
  const seeded = await switchVaultBranch(gh, emptyRepo, 'Assembly', 'main');
  ok('empty tip seeds', seeded.seeded === true);
  eq('seeded name', seeded.doc.name, 'Assembly');
  eq('seeded branch', seeded.baseline.branch, 'main');
  ok('seeded part lands in parts/', seeded.doc.parts.length === 1
    && seeded.doc.parts[0].id === sharedPartPath('Part (1)'));
}

console.log('\ngit G5 — rename-on-Commit moves paths');
{
  const { gh, repo, opened } = await seedVault();
  const renamedDoc = { ...opened.doc, name: 'Transmission' };
  const bracketId = idOf(opened.doc, BRACKET);
  // Parts still under assemblies/Gearbox/… until commit remaps them. Rows
  // keep their surf id; the path is what moves.
  eq('before commit paths still old', renamedDoc.parts.map((p) => p.path), [BRACKET, BOLT]);

  const remapped = remapAssemblyPaths(renamedDoc, opened.scripts, 'Gearbox', 'Transmission');
  eq('remap moves assembly part', remapped.moved, [{ from: BRACKET, to: BRACKET2, id: bracketId }]);
  eq('shared bolt stays', remapped.doc.parts.map((p) => p.path), [BRACKET2, BOLT]);
  eq('activeId is the id, so it does not move', remapped.doc.activeId, bracketId);

  const built = buildCommitFiles(renamedDoc, opened.scripts, opened.baseline);
  ok('renamed flag', built.renamed === true);
  eq('writes new asm + bracket', built.files.filter((f) => !f.delete).map((f) => f.path).sort(),
    [BRACKET2, ASM2].sort());
  const deletes = built.files.filter((f) => f.delete).map((f) => f.path).sort();
  ok('deletes old asm + bracket', deletes.includes(ASM) && deletes.includes(BRACKET), JSON.stringify(deletes));
  ok('does not delete shared bolt', !deletes.includes(BOLT));

  const res = await commitWorkspace(gh, repo, {
    doc: renamedDoc, scripts: opened.scripts, baseline: opened.baseline,
    message: 'Rename Gearbox → Transmission',
  });
  eq('commit status', res.status, 'committed');
  ok('result doc remapped', res.doc.parts.every((p) => p.path === BOLT || p.path.startsWith(`${ASSEMBLIES_DIR}/Transmission/`)),
    JSON.stringify(res.doc.parts.map((p) => p.path)));
  eq('new asm in git', parseSurfJson((await gh.readFile(repo, ASM2, 'main')).content).name, 'Transmission');
  // The moved script is stamped with its // @surf-id header on the way out.
  eq('new bracket in git', stripSurfId((await gh.readFile(repo, BRACKET2, 'main')).content),
    'return Manifold.cube([10,10,10], true);');
  eq('shared bolt untouched', (await gh.readFile(repo, BOLT, 'main')).content,
    'return Manifold.cylinder(6, 1.5, 1.5, 24);');
  ok('old asm gone', !(await gh.readFile(repo, ASM, 'main')));
  ok('old bracket gone', !(await gh.readFile(repo, BRACKET, 'main')));
  // Orphan Spare under old folder cleared.
  ok('old spare orphan cleared', !(await gh.readFile(repo, SPARE, 'main')));
  ok('clean vs remapped baseline', !isWorkspaceDirty(res.doc, res.scripts, res.baseline));
  eq('baseline assembly path', res.baseline.assemblyPath, ASM2);
}

console.log('\ngit G5 — UI wiring (PartFeed + App)');
const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
ok('title branch chip + pane rows', /data-assembly-branch=""/.test(feed) && /data-git-branches=""/.test(feed)
  && /data-git-branch-pane=""/.test(feed) && /data-git-branch-row=/.test(feed)
  && /data-git-branch-current=/.test(feed) && /data-git-branch-marker/.test(feed)
  && !/data-git-branch-section/.test(feed));
ok('title opens branch pane', /openBranchPane/.test(feed) && /onBranchClick=/.test(feed)
  && !/GitBranch/.test(feed) && !/data-git-branch-dropdown/.test(feed));
ok('dirty switch confirm', /data-git-branch-dirty-warn/.test(feed) && /data-git-branch-confirm/.test(feed));
ok('App wires list + switch', /handleListBranches/.test(app) && /handleSwitchBranch/.test(app)
  && /listVaultBranches\(/.test(app) && /switchVaultBranch\(/.test(app)
  && /onListBranches=\{handleListBranches\}/.test(app)
  && /onSwitchBranch=\{handleSwitchBranch\}/.test(app)
  && /currentBranch=/.test(app));
ok('open/list/add use working branch', /gitWorkingBranch\(/.test(app)
  && /adapter\.listTree\(vault\.repo, gitWorkingBranch\(\)\)/.test(app)
  && /const handleListVaultAssemblies/.test(app));
// A legacy-vault Save still adopts the committed workspace (paths may move
// with an assembly rename). On a v2 vault the rename is a name edit and the
// folder move is refused until v2 Save handles it.
ok('legacy Save adopts the committed workspace; v2 rename is a name edit', /applyCommittedWorkspace\(result\)/.test(app)
  && !/result\.renamed \|\| result\.moved/.test(app)
  && /code: 'unsupported_vault_version'/.test(app.slice(app.indexOf('const handleRenameAssembly'))));
ok('index exports G5', typeof gitIndex.listVaultBranches === 'function'
  && typeof gitIndex.switchVaultBranch === 'function'
  && typeof gitIndex.seedEmptyVaultAssembly === 'function');
ok('Connect still git-only (G7 gates on client id)',
  /data-git-connect=""/.test(feed) && /source === 'git'/.test(feed)
  && /githubConnectReady/.test(feed));
const src = [
  readFileSync(new URL('../../src/utils/git/gitBranch.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../../src/utils/git/gitCommit.js', import.meta.url), 'utf8'),
].join('\n');
ok('no network or token use in G5', !/\bfetch\(|api\.github\.com|XMLHttpRequest|localStorage|Authorization/.test(src));

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
