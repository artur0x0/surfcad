#!/usr/bin/env node
/**
 * G11 Parts vault chrome: Save=Commit label, title branch chip → pane
 * (list / Create / Delete / Merge squash), Open browse + live search + assembly choice
 * (Open vs Insert), adapter deleteBranch + squashMerge + branch helpers.
 * Mock only — no network, no tokens.
 */
import { readFileSync } from 'node:fs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import {
  assemblyFilePath, assemblyPartPath, sharedPartPath,
} from '../../src/utils/git/vaultLayout.js';
import { stringifySurfJson } from '../../src/utils/git/surfJson.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import {
  listVaultBrowseItems, planInsertVaultAssemblyParts,
  filterVaultOpenIndex, filterVaultPartItems,
  vaultOpenAssemblies, vaultOpenPartRows, groupVaultOpenPartRows, planOpenVaultPart,
  LOOSE_PARTS_LABEL,
} from '../../src/utils/git/gitWorkspace.js';
import {
  createVaultBranch, deleteVaultBranch,
  githubCompareUrl, canDeleteVaultBranch,
  squashMergeVaultBranch,
} from '../../src/utils/git/gitBranch.js';
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
const COVER = assemblyPartPath('Cover', 'Lid');
const ASM = assemblyFilePath('Gearbox');
const ASM_COVER = assemblyFilePath('Cover');

async function seedVault() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const gearbox = {
    source: 'git', name: 'Gearbox', activeId: BRACKET,
    parts: [
      { id: BRACKET, name: 'Bracket', visible: true, order: 0 },
      { id: BOLT, name: 'M3 bolt', visible: true, order: 1 },
    ],
  };
  const cover = {
    source: 'git', name: 'Cover', activeId: COVER,
    parts: [
      { id: COVER, name: 'Lid', visible: true, order: 0 },
      { id: BOLT, name: 'M3 bolt', visible: true, order: 1 },
    ],
  };
  const seed = await gh.commitFiles(vault.repo, {
    branch: 'main', message: 'seed', baseSha: vault.headSha,
    files: [
      fileWrite(ASM, stringifySurfJson(gearbox)),
      fileWrite(BRACKET, 'return Manifold.cube([10,10,10], true);'),
      fileWrite(BOLT, 'return Manifold.cylinder(6, 1.5, 1.5, 24);'),
      fileWrite(ASM_COVER, stringifySurfJson(cover)),
      fileWrite(COVER, 'return Manifold.cube([20,20,2], true);'),
    ],
  });
  return { gh, repo: vault.repo, seedSha: seed.sha, gearbox };
}

console.log('git G11 — branch helpers (create / delete / compare URL)');
{
  const { gh, repo, seedSha } = await seedVault();
  const created = await createVaultBranch(gh, repo, 'feature/g11', { fromSha: seedSha });
  eq('created branch', created.name, 'feature/g11');
  ok('create from tip', created.sha === seedSha);
  let refuseMain = '';
  try { await deleteVaultBranch(gh, repo, 'main', { current: 'feature/g11' }); }
  catch (err) { refuseMain = err.message; }
  ok('delete main refused', /Cannot delete main/.test(refuseMain), refuseMain);
  let refuseCur = '';
  try { await deleteVaultBranch(gh, repo, 'feature/g11', { current: 'feature/g11' }); }
  catch (err) { refuseCur = err.message; }
  ok('delete current refused', /Cannot delete the current branch/.test(refuseCur), refuseCur);
  ok('canDelete false for main', canDeleteVaultBranch('main', { current: 'feature/g11' }) === false);
  ok('canDelete false for current', canDeleteVaultBranch('feature/g11', { current: 'feature/g11' }) === false);
  ok('canDelete true for other', canDeleteVaultBranch('feature/g11', { current: 'main' }) === true);
  await createVaultBranch(gh, repo, 'tmp', { fromSha: seedSha });
  const del = await deleteVaultBranch(gh, repo, 'tmp', { current: 'main' });
  eq('delete status', del, { status: 'deleted', branch: 'tmp' });
  eq('compare URL', githubCompareUrl({ owner: 'artur', name: 'surfcad' }, { base: 'main', head: 'feature/g11' }),
    'https://github.com/artur/surfcad/compare/main...feature%2Fg11?expand=1');
  ok('compare null without head', githubCompareUrl({ owner: 'a', name: 'b' }, { base: 'main' }) === null);
}

console.log('\ngit G11 — squash merge into main');
{
  const { gh, repo, seedSha } = await seedVault();
  await createVaultBranch(gh, repo, 'feature/squash', { fromSha: seedSha });
  // Ahead-only: commit on feature, then squash into main.
  await gh.commitFiles(repo, {
    branch: 'feature/squash', message: 'side work',
    baseSha: seedSha,
    files: [fileWrite(BRACKET, 'return Manifold.cube([11,11,11], true);')],
  });
  const merged = await squashMergeVaultBranch(gh, repo, { head: 'feature/squash', base: 'main' });
  eq('squash status', merged.status, 'merged');
  ok('main advanced', merged.sha && merged.sha !== seedSha);
  eq('main tip is squash', (await gh.getBranch(repo, 'main')).sha, merged.sha);
  eq('main has side content', (await gh.readFile(repo, BRACKET, 'main')).content,
    'return Manifold.cube([11,11,11], true);');
  const up = await squashMergeVaultBranch(gh, repo, { head: 'feature/squash', base: 'main' });
  // feature tip is still the side commit; main is ahead of it → behindBy > 0 → conflict
  // or if compare sees identical trees via ancestry — expect conflict when behind.
  ok('re-squash after main moved is conflict or up-to-date',
    up.status === 'conflict' || up.status === 'up-to-date', up.status);
  // Diverged: commit on main and on another branch from seed.
  await createVaultBranch(gh, repo, 'feature/diverge', { fromSha: seedSha });
  await gh.commitFiles(repo, {
    branch: 'main', message: 'main only', baseSha: (await gh.getBranch(repo, 'main')).sha,
    files: [fileWrite(BOLT, 'return Manifold.cylinder(7, 1.5, 1.5, 24);')],
  });
  await gh.commitFiles(repo, {
    branch: 'feature/diverge', message: 'side only', baseSha: seedSha,
    files: [fileWrite(BRACKET, 'return Manifold.cube([12,12,12], true);')],
  });
  const conflict = await squashMergeVaultBranch(gh, repo, { head: 'feature/diverge', base: 'main' });
  eq('diverged is conflict', conflict.status, 'conflict');
  ok('conflict has compare URL', typeof conflict.url === 'string' && /compare/.test(conflict.url), conflict.url);
}

console.log('\ngit G11 — Open browse + insert parts');
{
  const { gh, repo, gearbox } = await seedVault();
  const browse = await listVaultBrowseItems(gh, repo, 'main');
  eq('browse assemblies', browse.assemblies.map((a) => a.name), ['Cover', 'Gearbox']);
  ok('browse has shared bolt', browse.parts.some((p) => p.path === BOLT));
  ok('browse has cover lid', browse.parts.some((p) => p.path === COVER));
  const planned = await planInsertVaultAssemblyParts(gh, repo, 'Cover', gearbox, { branch: 'main' });
  // Shared bolt already in gearbox → skipped; Lid stays linked at its Cover path
  const lidAdd = planned.additions.find((a) => a.fromPath === COVER);
  ok('lid stays linked at its Cover path', !!lidAdd && lidAdd.fromPath === COVER && lidAdd.linked && lidAdd.id !== COVER, JSON.stringify(planned.additions));
  ok('shared bolt not re-added', !planned.additions.some((a) => a.fromPath === BOLT));
  eq('insert count', planned.additions.length, 1);

  const filteredAsm = filterVaultOpenIndex(browse, 'gear');
  eq('search assemblies by name', filteredAsm.assemblies.map((a) => a.name), ['Gearbox']);
  eq('search gear parts = Bracket only', filteredAsm.parts.map((p) => p.path), [BRACKET]);
  const filteredBolt = filterVaultOpenIndex(browse, 'M3');
  eq('search M3 parts', filteredBolt.parts.map((p) => p.path), [BOLT]);
  eq('search M3 assemblies empty', filteredBolt.assemblies.length, 0);
  const none = filterVaultOpenIndex(browse, 'zzzz-no-such');
  eq('search miss empties both lists', [none.assemblies.length, none.parts.length], [0, 0]);
  const full = filterVaultOpenIndex(browse, '  ');
  eq('blank query returns full index', [full.assemblies.length, full.parts.length],
    [browse.assemblies.length, browse.parts.length]);
  const addFiltered = filterVaultPartItems(browse.parts, 'Lid');
  eq('part filter by label/path', addFiltered.map((p) => p.path), [COVER]);
  eq('open assembly lists assemblies only', vaultOpenAssemblies(browse).map((a) => a.name), ['Cover', 'Gearbox']);
  ok('open assembly has no part rows', vaultOpenAssemblies(browse).every((a) => a.kind === 'assembly' && !a.path));
  const rows = vaultOpenPartRows(browse.parts, { currentAssembly: 'Gearbox', inDoc: [BRACKET, BOLT] });
  ok('open part lists every script', rows.length === browse.parts.length && rows.length === 3);
  const groups = groupVaultOpenPartRows(rows, { currentAssembly: 'Gearbox' });
  eq('open part groups: current, other, loose', groups.map((g) => g.label), ['Gearbox', 'Cover', LOOSE_PARTS_LABEL]);
  ok('own part in the doc is not foreign', groups[0].current && groups[0].parts.some((p) => p.path === BRACKET && p.inDoc && !p.foreign));
  ok('other assembly part is foreign', groups[1].parts.every((p) => p.foreign && p.source === 'Cover'));
  ok('loose part opens by reference', groups[2].loose && groups[2].parts.some((p) => p.path === BOLT && !p.foreign));
  const linked = planOpenVaultPart(gearbox, COVER, 'return Manifold.cube([20,20,2], true);', {});
  ok('foreign part links, it is not copied', linked.mode === 'link' && linked.id === COVER);
  eq('own part focuses', planOpenVaultPart(gearbox, BRACKET, 'x', {}), { id: BRACKET, mode: 'focus' });
  eq('loose part focuses when already in the doc', planOpenVaultPart(gearbox, BOLT, 'bolt', {}), { id: BOLT, mode: 'focus' });
}

console.log('\ngit G11 — UI wiring (PartFeed + App + architecture)');
const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
const branchList = readFileSync(new URL('../../src/components/BranchPaneList.jsx', import.meta.url), 'utf8');
const vaultDlg = readFileSync(new URL('../../src/components/VaultPickerDialog.jsx', import.meta.url), 'utf8');
const choiceDlg = readFileSync(new URL('../../src/components/OpenAssemblyChoiceDialog.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const viewport = readFileSync(new URL('../../src/components/Viewport.jsx', import.meta.url), 'utf8');
const arch = readFileSync(new URL('../../docs/architecture.md', import.meta.url), 'utf8');
ok('Save = Commit chrome', /data-git-save=""/.test(feed) && /data-git-commit=""/.test(feed)
  && /aria-label="Save"/.test(feed) && /Save to repo/.test(feed));
ok('title chip → pane actions', /data-assembly-branch=""/.test(feed)
  && /data-git-branches=""/.test(feed) && /data-git-branch-pane=""/.test(feed)
  && /data-git-branch-action="create"/.test(feed)
  && /data-git-dialog-header/.test(vaultDlg)
  && /data-git-branch-action="delete"/.test(branchList)
  && /data-git-branch-action="merge"/.test(branchList)
  && /GitMerge/.test(branchList)
  && !/data-git-branch-pane-toolbar/.test(feed)
  && !/data-git-branch-dropdown/.test(feed)
  && !/data-git-branch-section/.test(feed));
ok('desktop branch chip in parts list header', /data-parts-ribbon-branch/.test(feed)
  && /placement === 'desktop' && source === 'git'/.test(feed)
  && /RibbonBranchButton/.test(feed)
  && !/data-viewer-git-branch/.test(viewport)
  && !/cadGitBranch/.test(viewport)
  && !/onCadGitBranchClick/.test(app));
ok('desktop parts ribbon hides assembly title chip', /ribbonName && placement !== 'desktop'/.test(feed));
ok('mobile ribbon still shows assembly name with branch chip',
  /RibbonAssemblyName[\s\S]{0,200}onBranchClick/.test(feed)
  && /placement !== 'desktop'/.test(feed)
  && /data-assembly-branch=""/.test(feed));
ok('desktop Save menu has rename and legacy Upgrade vault', (() => {
  const menuStart = feed.indexOf('data-assembly-save-dropdown');
  const menuEnd = feed.indexOf('data-git-move-open', menuStart);
  const menu = menuStart >= 0 && menuEnd > menuStart ? feed.slice(menuStart, menuEnd) : '';
  return /data-assembly-save-menu=""/.test(feed)
    && /Rename assembly/.test(menu)
    && /data-assembly-rename-menu=""/.test(menu)
    && /data-assembly-upgrade-menu=""/.test(menu)
    && /vaultLayout === 'legacy' && upgradeAvailable/.test(menu)
    && /Upgrade vault/.test(menu)
    && /placement === 'desktop' && onRenameAssembly/.test(feed)
    && !/Branches \(/.test(menu)
    && !/data-git-branches=""/.test(menu);
})());
ok('assembly rename stays on the mobile ribbon title',
  /data-assembly-rename="button"/.test(feed)
  && /RibbonAssemblyName/.test(feed)
  && /Click to rename this assembly/.test(feed));
ok('Save still on ribbon end', (() => {
  const end = feed.indexOf('data-parts-ribbon-end');
  const save = feed.indexOf('data-git-save=""', end);
  return end >= 0 && save > end;
})());
ok('merge conflict → Resolve on Git', /data-git-branch-merge-conflict/.test(feed)
  && /data-git-branch-resolve-github/.test(feed)
  && /startMergeFromPane/.test(feed) && /onSquashMerge/.test(feed));
ok('Open assembly choice', (/data-git-dialog="open-choice"/.test(choiceDlg) || /dataAttr="open-choice"/.test(choiceDlg))
  && /data-git-open-replace/.test(choiceDlg) && /data-git-open-insert/.test(choiceDlg)
  && /Insert parts into current/.test(choiceDlg) && /Open assembly/.test(choiceDlg)
  && /<OpenAssemblyChoiceDialog/.test(feed));
ok('Open browses parts + assemblies', /data-git-open-assemblies/.test(feed) && /data-git-open-parts/.test(feed)
  && /data-git-open-part=/.test(feed));
ok('Open Part groups by source; Open Assembly is assemblies only', /data-git-open-group/.test(feed)
  && /vaultOpenPartRows/.test(feed) && /vaultOpenAssemblies/.test(feed)
  && /kind === 'open-assembly' \? vaultOpenAssemblies/.test(feed)
  && /planOpenVaultPart/.test(app));
ok('Open pane live search filters client index', /data-git-open-search/.test(feed)
  && /filterVaultOpenIndex/.test(feed)
  && /data-git-open-search-empty/.test(feed)
  && /No matches/.test(feed)
  && /data-git-open-search-kind/.test(feed)
  && /filterVaultPartItems/.test(feed)
  && /query: ''/.test(feed));
ok('delete confirm + protected', /data-git-branch-delete-confirm/.test(feed)
  && /data-git-branch-delete-warn/.test(feed) && /protected/.test(branchList));
ok('App wires create/delete/merge/squash/insert/browse', /handleCreateBranch/.test(app)
  && /handleDeleteBranch/.test(app) && /handleMergeBranch/.test(app)
  && /handleSquashMerge/.test(app) && /squashMergeVaultBranch\(/.test(app)
  && /handleInsertVaultAssemblyParts/.test(app) && /handleListVaultBrowse/.test(app)
  && /handleOpenVaultPart/.test(app)
  && /onCreateBranch=\{handleCreateBranch\}/.test(app)
  && /onMergeBranch=\{handleMergeBranch\}/.test(app)
  && /onSquashMerge=\{handleSquashMerge\}/.test(app)
  && /handleBranchUiClose/.test(app)
  && /onBranchUiClose=\{handleBranchUiClose\}/.test(app)
  && /githubCompareUrl\(/.test(app) && /window\.open\(url/.test(app));
ok('branch create optimistic pending row', /pending: true/.test(feed)
  && /data-git-branch-pending/.test(branchList)
  && /data-git-branch-pending-spinner/.test(branchList));
ok('Create branch refreshes pane with ensureBranch',
  /ensureBranch:/.test(feed) && /refreshBranchPane\(/.test(feed)
  && /result\.status === 'created'/.test(feed));
ok('create switches when clean; dirty stays put',
  /shouldSwitchToCreatedBranch/.test(app)
  && /handleCreateBranch[\s\S]*handleSwitchBranch\(created\.name\)/.test(app));
ok('GitHub adapter GETs are cache no-store', /cache:\s*'no-store'/.test(
  readFileSync(new URL('../../src/utils/git/githubAdapter.js', import.meta.url), 'utf8'),
));
ok('IDB hydrate skips when vault baseline / gen advanced',
  /Skipping stale IDB hydrate/.test(app) && /vault baseline already set/.test(app));
ok('index exports G11 helpers', typeof gitIndex.createVaultBranch === 'function'
  && typeof gitIndex.shouldSwitchToCreatedBranch === 'function'
  && typeof gitIndex.deleteVaultBranch === 'function'
  && typeof gitIndex.githubCompareUrl === 'function'
  && typeof gitIndex.squashMergeVaultBranch === 'function'
  && typeof gitIndex.listVaultBrowseItems === 'function'
  && typeof gitIndex.planInsertVaultAssemblyParts === 'function'
  && typeof gitIndex.canDeleteVaultBranch === 'function');
ok('adapter has deleteBranch + squashMerge', typeof gitIndex.createMockGithubAdapter({}).deleteBranch === 'function'
  && typeof gitIndex.createMockGithubAdapter({}).squashMerge === 'function');
ok('architecture mentions G11 Parts chrome', /G11/.test(arch) && /Save = Commit|Save \(commit\)|Parts vault chrome/i.test(arch));
ok('model Upload and Download live on Parts, not the Script strip (G12)', (() => {
  const toolbar = readFileSync(new URL('../../src/components/Toolbar.jsx', import.meta.url), 'utf8');
  const parts = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
  return /data-script-upload=""/.test(parts) && /data-script-download=""/.test(parts)
    && !/data-script-upload/.test(toolbar) && !/data-script-download/.test(toolbar)
    && !/title="Open File"/.test(toolbar) && !/onSave/.test(toolbar)
    && !/FolderOpen/.test(toolbar);
})());

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
