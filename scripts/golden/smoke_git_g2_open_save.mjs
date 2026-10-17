#!/usr/bin/env node
/**
 * G2 open/save in Git mode: list/open .surf.json + parts by path, new part
 * path, + Part|Assembly create; folder Part|Assembly open, dirty badges, profile chip (playtest unify).
 * Mock adapter only — no network, no tokens, no commit (G3).
 */
import { readFileSync } from 'node:fs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import {
  assemblyFilePath, assemblyPartPath, sharedPartPath, listAssemblies,
} from '../../src/utils/git/vaultLayout.js';
import { stringifySurfJson, parseSurfJson } from '../../src/utils/git/surfJson.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import {
  dirtyPartIds, isAssemblyDirty, isPartDirty, isWorkspaceDirty,
  listVaultAssemblies, listAddableVaultParts, openVaultAssembly, readVaultPart,
  resolveNewPartPath, suggestNewPartPath,
} from '../../src/utils/git/gitWorkspace.js';
import { commitPartToRepo } from '../../src/utils/git/gitCommit.js';
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

console.log('git G2 — seed vault with two assemblies');
const gh = createMockGithubAdapter({ login: 'artur' });
const vault = await findOrCreateVault(gh);
eq('vault ready', [vault.status, vault.repo.name], ['created', 'surfcad-vault']);
const gearbox = {
  source: 'git',
  name: 'Gearbox',
  activeId: assemblyPartPath('Gearbox', 'Bracket'),
  parts: [
    { id: assemblyPartPath('Gearbox', 'Bracket'), name: 'Bracket', visible: true, order: 0 },
    { id: sharedPartPath('M3 bolt'), name: 'M3 bolt', visible: true, order: 1 },
  ],
};
const cover = {
  source: 'git',
  name: 'Cover',
  activeId: assemblyPartPath('Cover', 'Lid'),
  parts: [
    { id: assemblyPartPath('Cover', 'Lid'), name: 'Lid', visible: true, order: 0 },
  ],
};
const seed = await gh.commitFiles(vault.repo, {
  branch: 'main',
  message: 'assemblies',
  baseSha: vault.headSha,
  files: [
    fileWrite(assemblyFilePath('Gearbox'), stringifySurfJson(gearbox)),
    fileWrite(assemblyPartPath('Gearbox', 'Bracket'), 'return Manifold.cube([10,10,10], true);'),
    fileWrite(sharedPartPath('M3 bolt'), 'return Manifold.cylinder(6, 1.5, 1.5, 24);'),
    fileWrite(assemblyFilePath('Cover'), stringifySurfJson(cover)),
    fileWrite(assemblyPartPath('Cover', 'Lid'), 'return Manifold.cube([20,20,2], true);'),
    fileWrite(assemblyPartPath('Gearbox', 'Spare'), 'return Manifold.cube([1,1,1], true);'),
  ],
});
eq('list assemblies', await listVaultAssemblies(gh, vault.repo, 'main'), ['Cover', 'Gearbox']);
eq('listAssemblies on tree', listAssemblies(await gh.listTree(vault.repo, 'main')), ['Cover', 'Gearbox']);

console.log('\ngit G2 — open loads parts by path');
const opened = await openVaultAssembly(gh, vault.repo, 'Gearbox', {
  branch: 'main', headSha: seed.sha,
});
eq('opened name', opened.doc.name, 'Gearbox');
eq('opened source', opened.doc.source, 'git');
eq('opened part paths', opened.doc.parts.map((p) => p.path), [
  assemblyPartPath('Gearbox', 'Bracket'),
  sharedPartPath('M3 bolt'),
]);
ok('opened part ids are stable', opened.doc.parts.every((p) => p.id && p.id !== p.path));
eq('bracket script', opened.scripts[opened.doc.parts[0].id],
  'return Manifold.cube([10,10,10], true);');
eq('shared bolt script', opened.scripts[opened.doc.parts[1].id],
  'return Manifold.cylinder(6, 1.5, 1.5, 24);');
eq('baseline assembly path', opened.baseline.assemblyPath, assemblyFilePath('Gearbox'));
ok('baseline has both scripts',
  opened.baseline.scripts[opened.doc.parts[0].id]?.includes('cube')
  && opened.baseline.scripts[opened.doc.parts[1].id]?.includes('cylinder'));
ok('round-trip surf', parseSurfJson(opened.baseline.assemblyText).name === 'Gearbox');

console.log('\ngit G2 — dirty tracking');
const base = opened.baseline;
ok('clean after open', !isWorkspaceDirty(opened.doc, opened.scripts, base));
ok('assembly clean', !isAssemblyDirty(opened.doc, base));
const bracketId = opened.doc.parts[0].id;
const boltId = opened.doc.parts[1].id;
ok('part clean', !isPartDirty(bracketId, opened.scripts[bracketId], base));
const edited = { ...opened.scripts, [bracketId]: 'return Manifold.cube([11,11,11], true);' };
ok('script edit is dirty', isPartDirty(bracketId, edited[bracketId], base));
ok('workspace dirty after edit', isWorkspaceDirty(opened.doc, edited, base));
eq('dirtyPartIds after edit', [...dirtyPartIds(opened.doc, edited, base)], [bracketId]);
const renamed = {
  ...opened.doc,
  parts: opened.doc.parts.map((p, i) => (i === 0 ? { ...p, name: 'Arm' } : p)),
};
ok('rename dirties assembly', isAssemblyDirty(renamed, base) && isWorkspaceDirty(renamed, opened.scripts, base));
const withNew = {
  ...opened.doc,
  parts: [...opened.doc.parts, {
    id: assemblyPartPath('Gearbox', 'Part 2'), name: 'Part 2', visible: true, order: 2,
  }],
};
const scriptsNew = { ...opened.scripts, [assemblyPartPath('Gearbox', 'Part 2')]: '// new' };
eq('new part id is dirty', [...dirtyPartIds(withNew, scriptsNew, base)].sort(),
  [assemblyPartPath('Gearbox', 'Part 2')].sort());
const withoutBolt = {
  ...opened.doc,
  parts: opened.doc.parts.filter((p) => p.id !== boltId),
  activeId: bracketId,
};
ok('removed part counted dirty', dirtyPartIds(withoutBolt, opened.scripts, base).has(boltId));
ok('no baseline → not dirty', !isWorkspaceDirty(opened.doc, edited, null));
ok('liveScript overrides stored', dirtyPartIds(opened.doc, opened.scripts, base, {
  liveId: bracketId,
  liveScript: 'CHANGED',
}).has(bracketId));

console.log('\ngit G2 — new part name');
eq('bare name → assembly folder', resolveNewPartPath('Gearbox', 'Bracket'),
  assemblyPartPath('Gearbox', 'Bracket'));
eq('bare name collision → Bracket-2', resolveNewPartPath('Gearbox', 'Bracket', [assemblyPartPath('Gearbox', 'Bracket')]),
  assemblyPartPath('Gearbox', 'Bracket-2'));
eq('full assembly path', resolveNewPartPath('Gearbox', assemblyPartPath('Gearbox', 'X')),
  assemblyPartPath('Gearbox', 'X'));
eq('shared path allowed', resolveNewPartPath('Gearbox', 'parts/Pin.js'), sharedPartPath('Pin'));
eq('other assembly refused (legacy)', resolveNewPartPath('Gearbox', 'assemblies/Cover/parts/Lid.js'), null);
eq('other assembly refused (flat)', resolveNewPartPath('Gearbox', 'assemblies/Cover/Lid.js'), null);
eq('suggest skips existing', suggestNewPartPath('Gearbox', opened.doc.parts),
  assemblyPartPath('Gearbox', 'Part (1)'));
ok('index exports G2', typeof gitIndex.openVaultAssembly === 'function'
  && typeof gitIndex.isWorkspaceDirty === 'function'
  && typeof gitIndex.suggestNewPartPath === 'function');

console.log('\ngit G2 — add existing from vault');
const addable = await listAddableVaultParts(gh, vault.repo, 'Gearbox', {
  branch: 'main',
  existingIds: opened.doc.parts.map((p) => p.path || p.id),
});
eq('addable includes Spare only (not Bracket/bolt)', addable.map((a) => a.path), [
  assemblyPartPath('Gearbox', 'Spare'),
]);
eq('Spare kind', addable[0].kind, 'assembly-part');
const spare = await readVaultPart(gh, vault.repo, assemblyPartPath('Gearbox', 'Spare'), 'main');
eq('read spare', spare?.content, 'return Manifold.cube([1,1,1], true);');
const addableCover = await listAddableVaultParts(gh, vault.repo, 'Cover', {
  existingIds: [],
});
ok('Cover can add shared bolt', addableCover.some((a) => a.path === sharedPartPath('M3 bolt')));
ok('Cover cannot add Gearbox Spare', !addableCover.some((a) => a.path === assemblyPartPath('Gearbox', 'Spare')));


console.log('\ngit G2 — Add to Repo (instant single-part commit)');
{
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const ASM = assemblyFilePath('Gearbox');
  const BRACKET = assemblyPartPath('Gearbox', 'Bracket');
  const NEWP = assemblyPartPath('Gearbox', 'NewLocal');
  const seed = await gh.commitFiles(vault.repo, {
    branch: 'main', message: 'seed', baseSha: vault.headSha,
    files: [
      fileWrite(ASM, stringifySurfJson({
        source: 'git', name: 'Gearbox', activeId: BRACKET,
        parts: [{ id: BRACKET, name: 'Bracket', visible: true, order: 0 }],
      })),
      fileWrite(BRACKET, 'return Manifold.cube([10,10,10], true);'),
    ],
  });
  const opened = await openVaultAssembly(gh, vault.repo, 'Gearbox', {
    branch: 'main', headSha: seed.sha,
  });
  const doc = {
    ...opened.doc,
    parts: [
      ...opened.doc.parts,
      { id: NEWP, name: 'NewLocal', visible: true, order: 1 },
    ],
  };
  const scripts = { ...opened.scripts, [NEWP]: 'return Manifold.cube([2,2,2], true);' };
  const added = await commitPartToRepo(gh, vault.repo, {
    doc, scripts, baseline: opened.baseline, partId: NEWP,
  });
  eq('add status', added.status, 'committed');
  eq('new part in repo', (await gh.readFile(vault.repo, NEWP, 'main')).content,
    'return Manifold.cube([2,2,2], true);');
  ok('baseline has new part', Object.prototype.hasOwnProperty.call(added.baseline.scripts, NEWP));
  ok('index exports commitPartToRepo', typeof gitIndex.commitPartToRepo === 'function');
}

console.log('\ngit G2 — UI wiring (PartFeed + App)');
const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
ok('profile chip on Parts (playtest unify), not Local|Git toggle',
  /data-parts-profile-chip/.test(feed)
  && /ProfileChip/.test(feed)
  && !/data-parts-source-toggle/.test(feed)
  && !/data-parts-session-identity/.test(feed));
ok('dirty badge on Commit', /data-git-dirty-badge/.test(feed) && /data-git-dirty=/.test(feed)
  && /data-git-commit=""/.test(feed));
ok('row dirty badge', /data-part-dirty/.test(feed) && /row\.dirty/.test(feed));
ok('row Save icon always in git (dot when dirty)', /data-part-save=/.test(feed)
  && /data-part-dirty=\{row\.dirty/.test(feed)
  && /onAddToRepo\(row\.id\)/.test(feed));
ok('in-sync open → no dirty ids', dirtyPartIds(opened.doc, opened.scripts, opened.baseline).size === 0);
ok('App first-commit chrome only for local: ; reseed tip baseline on reload',
  /firstCommitBaseline/.test(app)
  && /dirtyBaseline/.test(app)
  && /needsFirstCommitChrome/.test(app)
  && /startsWith\('local:'\)/.test(app)
  && /baseline reseed/.test(app)
  && /rememberGitBaseline\(opened\.baseline\)/.test(app));
ok('assembly floppy dirty badge closer to icon',
  /data-git-dirty-badge=""/.test(feed)
  && /absolute right-0\.5 top-0\.5 h-1\.5 w-1\.5 rounded-full bg-amber-400/.test(feed));
ok('git Open lists vault', /data-git-open-list/.test(feed) && /onListVaultAssemblies/.test(feed)
  && /onOpenVaultAssembly/.test(feed)
  && /data-git-open-search/.test(feed) && /filterVaultOpenIndex/.test(feed));
ok('new part asks for name only', /data-git-new-part-name/.test(feed) && /title="New part"/.test(feed)
  && !/New part path/.test(feed) && !/data-git-new-part-path/.test(feed)
  && /data-git-new-part-name[\s\S]*?PARTS_TEXT_INPUT_CLASS/.test(feed));
ok('+ create menu is Part|Assembly only', /data-part-add-menu/.test(feed)
  && /data-part-add-dropdown/.test(feed)
  && /data-part-add-action="part"/.test(feed)
  && /data-part-add-action="assembly"/.test(feed)
  && /data-part-add-kind="part"/.test(feed)
  && /data-part-add-kind="assembly"/.test(feed)
  && !/data-part-add-action="existing"/.test(feed)
  && !/data-part-add-section=/.test(feed));
ok('folder open menu is Part|Assembly; Open Part (whole repo) via folder', /data-part-open-menu/.test(feed)
  && /data-part-open-dropdown/.test(feed)
  && /data-part-open-action="part"/.test(feed)
  && /data-part-open-action="assembly"/.test(feed)
  && /data-git-open-part-action/.test(feed) && /startOpenPart/.test(feed)
  && /data-git-open-group/.test(feed) && /opens by reference/.test(feed) && /links from/.test(feed)
  && !/data-git-add-existing/.test(feed)
  && /data-assembly-add-existing/.test(feed)
  && /onOpenVaultPart/.test(feed));
ok('assembly leave Save|Discard guard', /data-assembly-leave-ask/.test(feed)
  && /data-assembly-leave-save/.test(feed)
  && /data-assembly-leave-discard/.test(feed)
  && /bg-red-700/.test(feed)
  && /needsAssemblyLeaveGuard/.test(app)
  && /onNewAssembly/.test(app));
ok('Connect gated on client id / connected (G7+G10)',
  /data-git-connect=""/.test(feed)
  && /githubConnectReady/.test(feed)
  && /githubConnected/.test(feed));
ok('App wires vault open + dirty; source follows GitHub token (G10)',
  /handleOpenVaultAssembly/.test(app)
  && /isWorkspaceDirty/.test(app)
  && /dirtyPartIds/.test(app)
  && /sourceDirty=\{!!sourceDirty\}/.test(app)
  && /githubConnected/.test(app)
  && /source: 'git'/.test(app)
  && /createMockGithubAdapter/.test(app)
  && /findOrCreateVault/.test(app));
ok('App new part allocateVaultPartPath in git',
  /allocateVaultPartPath\(/.test(app) && /layout: 'assembly-folder'/.test(app));
ok('Add to Repo adopts the committed doc',
  /handleAddToRepo[\s\S]*?rememberAssembly\(result\.doc\)/.test(app));
ok('optimistic create + pending spinner', /setPendingPartIds/.test(app)
  && /data-part-pending/.test(feed)
  && /data-part-pending-spinner/.test(feed)
  && /Loader2/.test(feed)
  && /rememberAssembly\([\s\S]*?activeId: id[\s\S]*?setPendingPartIds/.test(app)
  && /handleAddToRepo[\s\S]*?setPendingPartIds/.test(app));
ok('part Save wires add-to-repo commit', /handleAddToRepo/.test(app) && /onAddToRepo/.test(feed)
  && /commitPartToRepo/.test(app) && /data-part-add-to-repo/.test(feed));
const srcFiles = ['gitWorkspace', 'githubAdapterInterface', 'mockGithubAdapter', 'vaultLayout', 'surfJson', 'vault']
  .map((f) => readFileSync(new URL(`../../src/utils/git/${f}.js`, import.meta.url), 'utf8')).join('\n');
ok('no network or token use in G2', !/\bfetch\(|api\.github\.com|XMLHttpRequest|Authorization:\s*['"]Bearer/.test(srcFiles));
ok('G2 does not commit from workspace helpers',
  !/commitFiles/.test(readFileSync(new URL('../../src/utils/git/gitWorkspace.js', import.meta.url), 'utf8')));

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
