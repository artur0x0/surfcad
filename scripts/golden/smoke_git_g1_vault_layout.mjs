#!/usr/bin/env node
/**
 * G1 git vault + layout: adapter interface contract, mock round-trip,
 * path helpers, .surf.json schema, find-or-create vault, Connect GitHub control.
 * Core G1 modules: mock adapter only — no network, no tokens.
 */
import { readFileSync } from 'node:fs';
import {
  GITHUB_ADAPTER_METHODS, GitAdapterError, assertGithubAdapter, missingAdapterMethods,
  fileWrite, fileDelete,
} from '../../src/utils/git/githubAdapterInterface.js';
import { createMockGithubAdapter, mockSha } from '../../src/utils/git/mockGithubAdapter.js';
import {
  assemblyFilePath, assemblyPartPath, sharedPartPath, assemblyDir, parseVaultPath,
  isAssemblyFile, isPartScript, partPathAllowedFor, listAssemblies, listPartScripts,
  vaultSegment, VAULT_MARKER_PATH,
} from '../../src/utils/git/vaultLayout.js';
import {
  validateSurfJson, toSurfJson, parseSurfJson, stringifySurfJson, SURF_JSON_FORMAT,
} from '../../src/utils/git/surfJson.js';
import {
  findOrCreateVault, sanitizeVaultName, DEFAULT_VAULT_NAME, isVaultMarker,
} from '../../src/utils/git/vault.js';
import * as gitIndex from '../../src/utils/git/index.js';

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}
async function throwsCode(name, fn, code) {
  try { await fn(); ok(name, false, 'did not throw'); } catch (err) {
    ok(name, err instanceof GitAdapterError && err.code === code, `threw ${err?.code || err?.message}`);
  }
}

console.log('git G1 — interface contract');
eq('interface methods', [...GITHUB_ADAPTER_METHODS], ['getViewer', 'getRepo', 'createRepo', 'listBranches', 'getBranch', 'createBranch', 'deleteBranch', 'listTree', 'readFile', 'readBlob', 'commitFiles', 'compare', 'squashMerge']);
eq('missing on {}', missingAdapterMethods({}).length, GITHUB_ADAPTER_METHODS.length);
eq('missing on partial', missingAdapterMethods({ getViewer() {}, readFile() {} }).length, GITHUB_ADAPTER_METHODS.length - 2);
await throwsCode('assert rejects partial adapter', () => assertGithubAdapter({ getViewer() {} }), 'invalid');
const mock = createMockGithubAdapter({ login: 'artur' });
eq('mock implements interface', missingAdapterMethods(mock), []);
ok('index re-exports', typeof gitIndex.findOrCreateVault === 'function' && typeof gitIndex.createMockGithubAdapter === 'function');
ok('mockSha 40 hex + deterministic', /^[0-9a-f]{40}$/.test(mockSha('x')) && mockSha('x') === mockSha('x') && mockSha('x') !== mockSha('y'));

console.log('\ngit G1 — mock round-trip');
const repo = { owner: 'artur', name: 'scratch' };
eq('viewer', await mock.getViewer(), { login: 'artur' });
eq('missing repo', await mock.getRepo(repo), null);
const created = await mock.createRepo({ name: 'scratch', private: true });
eq('created repo info', created, { owner: 'artur', name: 'scratch', private: true, defaultBranch: 'main', empty: true });
await throwsCode('duplicate name (case-insensitive)', () => mock.createRepo({ name: 'Scratch' }), 'name_exists');
await throwsCode('bad repo name', () => mock.createRepo({ name: 'a b' }), 'invalid');
eq('empty repo has no branches', await mock.listBranches(repo), []);
await throwsCode('empty repo tree throws not_found', () => mock.listTree(repo, 'main'), 'not_found');
const c1 = await mock.commitFiles(repo, {
  branch: 'main', message: 'one', baseSha: null,
  files: [fileWrite('a.txt', 'A'), fileWrite('dir/b.txt', 'B')],
});
eq('first commit has no parent', c1.parents, []);
eq('main created', (await mock.listBranches(repo)).map((b) => [b.name, b.sha]), [['main', c1.sha]]);
eq('read a.txt', (await mock.readFile(repo, 'a.txt')).content, 'A');
eq('read missing', await mock.readFile(repo, 'nope.txt'), null);
eq('tree', (await mock.listTree(repo, 'main')).map((e) => e.path), ['a.txt', 'dir/b.txt']);
eq('tree prefix', (await mock.listTree(repo, 'main', { prefix: 'dir/' })).map((e) => e.path), ['dir/b.txt']);
const c2 = await mock.commitFiles(repo, {
  branch: 'main', message: 'two', baseSha: c1.sha,
  files: [fileWrite('a.txt', 'A2'), fileDelete('dir/b.txt'), fileWrite('c.txt', 'C')],
});
eq('multi-file write is ONE commit', c2.parents, [c1.sha]);
eq('after commit 2 tree', (await mock.listTree(repo, 'main')).map((e) => e.path), ['a.txt', 'c.txt']);
eq('read at old sha', (await mock.readFile(repo, 'a.txt', c1.sha)).content, 'A');
eq('read at main', (await mock.readFile(repo, 'a.txt', 'main')).content, 'A2');
await throwsCode('stale baseSha is non_fast_forward', () => mock.commitFiles(repo, { branch: 'main', message: 'x', baseSha: c1.sha, files: [fileWrite('a.txt', 'z')] }), 'non_fast_forward');
eq('stale write left main alone', (await mock.getBranch(repo, 'main')).sha, c2.sha);
await throwsCode('empty file list', () => mock.commitFiles(repo, { branch: 'main', message: 'x', files: [] }), 'invalid');
await throwsCode('parent path rejected', () => mock.commitFiles(repo, { branch: 'main', message: 'x', files: [fileWrite('../x', 'z')] }), 'invalid');
await throwsCode('unknown branch', () => mock.commitFiles(repo, { branch: 'nope', message: 'x', files: [fileWrite('a', 'z')] }), 'not_found');
const br = await mock.createBranch(repo, 'feature', c1.sha);
eq('branch from c1', br, { name: 'feature', sha: c1.sha });
await throwsCode('duplicate branch', () => mock.createBranch(repo, 'feature', c1.sha), 'name_exists');
await throwsCode('cannot delete main', () => mock.deleteBranch(repo, 'main'), 'invalid');
await mock.createBranch(repo, 'tmp-del', c1.sha);
await mock.deleteBranch(repo, 'tmp-del');
eq('deleted branch gone', await mock.getBranch(repo, 'tmp-del'), null);
await throwsCode('delete missing', () => mock.deleteBranch(repo, 'tmp-del'), 'not_found');
eq('compare identical', (await mock.compare(repo, 'main', 'main')).status, 'identical');
const behind = await mock.compare(repo, 'main', 'feature');
eq('feature behind main', [behind.status, behind.aheadBy, behind.behindBy, behind.mergeBaseSha], ['behind', 0, 1, c1.sha]);
const c3 = await mock.commitFiles(repo, { branch: 'feature', message: 'f', files: [fileWrite('f.txt', 'F'), fileWrite('a.txt', 'Af')] });
const div = await mock.compare(repo, 'main', 'feature');
eq('diverged', [div.status, div.aheadBy, div.behindBy, div.mergeBaseSha, div.headSha], ['diverged', 1, 1, c1.sha, c3.sha]);
eq('diverged files = mergeBase→head', div.files, [{ path: 'a.txt', status: 'modified' }, { path: 'f.txt', status: 'added' }]);
const ahead = await mock.compare(repo, c1.sha, 'main');
eq('main ahead of c1 by sha', [ahead.status, ahead.aheadBy, ahead.files], ['ahead', 1, [{ path: 'a.txt', status: 'modified' }, { path: 'c.txt', status: 'added' }, { path: 'dir/b.txt', status: 'removed' }]]);
await throwsCode('compare unknown ref', () => mock.compare(repo, 'main', 'ghost'), 'not_found');
await throwsCode('unknown repo', () => mock.listBranches({ owner: 'artur', name: 'ghost' }), 'not_found');
eq('branches sorted', (await mock.listBranches(repo)).map((b) => b.name), ['feature', 'main']);

console.log('\ngit G1 — path helpers');
eq('assembly file', assemblyFilePath('Gearbox'), 'assemblies/Gearbox/.surf.json');
eq('assembly dir', assemblyDir('Gearbox'), 'assemblies/Gearbox');
eq('assembly part', assemblyPartPath('Gearbox', 'Bracket'), 'assemblies/Gearbox/Bracket.js');
eq('assembly part .js idempotent', assemblyPartPath('Gearbox', 'Bracket.js'), 'assemblies/Gearbox/Bracket.js');
eq('shared part', sharedPartPath('M3 bolt'), 'parts/M3 bolt.js');
eq('segment strips path chars', vaultSegment(' a/b\\c:d*  e.. '), 'abcd e');
eq('segment strips dots', vaultSegment('..x..'), 'x');
let threw = false; try { assemblyFilePath('../'); } catch { threw = true; }
ok('empty segment throws', threw);
eq('parse marker', parseVaultPath(VAULT_MARKER_PATH), { kind: 'marker' });
eq('parse assembly', parseVaultPath('assemblies/Gearbox/.surf.json'), { kind: 'assembly', assembly: 'Gearbox' });
eq('parse legacy named assembly', parseVaultPath('assemblies/Gearbox/Gearbox.surf.json'), { kind: 'assembly', assembly: 'Gearbox', legacy: true });
eq('parse mismatched assembly file', parseVaultPath('assemblies/Gearbox/Other.surf.json'), { kind: 'other' });
eq('parse assembly part', parseVaultPath('./assemblies/Gearbox/Bracket.js'), { kind: 'assembly-part', assembly: 'Gearbox', part: 'Bracket' });
eq('parse legacy nested part', parseVaultPath('./assemblies/Gearbox/parts/Bracket.js'), { kind: 'assembly-part', assembly: 'Gearbox', part: 'Bracket', legacy: true });
eq('parse shared part', parseVaultPath('parts/M3 bolt.js'), { kind: 'shared-part', part: 'M3 bolt' });
eq('parse nested shared = other', parseVaultPath('parts/sub/x.js'), { kind: 'other' });
eq('parse bad', parseVaultPath('../x.js'), null);
ok('isAssemblyFile / isPartScript', isAssemblyFile('assemblies/A/.surf.json') && isPartScript('parts/x.js') && !isPartScript('parts/.gitkeep'));
ok('own + shared allowed, other assembly not', partPathAllowedFor('A', 'assemblies/A/p.js') && partPathAllowedFor('A', 'parts/p.js') && !partPathAllowedFor('A', 'assemblies/B/p.js'));
ok('legacy nested still allowed for read-compat', partPathAllowedFor('A', 'assemblies/A/parts/p.js'));
const tree = ['assemblies/B/.surf.json', 'assemblies/A/.surf.json', 'assemblies/A/p.js', 'parts/s.js', 'README.md', 'assemblies/A/notes.md'].map((path) => ({ path }));
eq('listAssemblies', listAssemblies(tree), ['A', 'B']);
eq('listPartScripts', listPartScripts(tree), { shared: ['parts/s.js'], byAssembly: { A: ['assemblies/A/p.js'] } });
const legacyTree = ['assemblies/A/A.surf.json', 'assemblies/A/parts/old.js'].map((path) => ({ path }));
eq('listAssemblies legacy', listAssemblies(legacyTree), ['A']);
eq('listPartScripts legacy', listPartScripts(legacyTree), { shared: [], byAssembly: { A: ['assemblies/A/parts/old.js'] } });

console.log('\ngit G1 — .surf.json schema');
const doc = {
  source: 'git', name: 'Gearbox', activeId: 'assemblies/Gearbox/Bracket.js',
  parts: [
    { id: 'parts/M3 bolt.js', name: 'M3 bolt', visible: false, order: 1, position: [10, 0, 0], script: 'IGNORED' },
    { id: 'assemblies/Gearbox/Bracket.js', name: 'Bracket', visible: true, order: 0 },
  ],
};
const surf = toSurfJson(doc);
eq('toSurfJson shape', surf, {
  format: SURF_JSON_FORMAT, version: 1, name: 'Gearbox', activeId: 'assemblies/Gearbox/Bracket.js',
  parts: [
    { path: 'assemblies/Gearbox/Bracket.js', name: 'Bracket', visible: true, order: 0 },
    { path: 'parts/M3 bolt.js', name: 'M3 bolt', visible: false, order: 1, position: [10, 0, 0] },
  ],
});
ok('no script source in file', !stringifySurfJson(doc).includes('IGNORED'));
ok('stringify stable + newline', stringifySurfJson(doc) === stringifySurfJson(doc) && stringifySurfJson(doc).endsWith('}\n'));
eq('validate ok', validateSurfJson(surf), { ok: true, errors: [] });
const back = parseSurfJson(stringifySurfJson(doc));
eq('parse → git doc', [back.source, back.name, back.activeId, back.parts.map((p) => p.id)], ['git', 'Gearbox', 'assemblies/Gearbox/Bracket.js', ['assemblies/Gearbox/Bracket.js', 'parts/M3 bolt.js']]);
eq('round-trip', toSurfJson(back), surf);
const bad = (patch) => validateSurfJson({ ...surf, ...patch });
ok('reject wrong format', !bad({ format: 'x' }).ok);
ok('reject wrong version', !bad({ version: 2 }).ok);
ok('reject unknown key', !bad({ script: 'x' }).ok);
ok('reject unsafe name', !bad({ name: 'a/b' }).ok);
ok('external assembly part is a link', bad({ parts: [{ path: 'assemblies/Other/x.js', name: 'x', visible: true, order: 0 }], activeId: null }).ok);
ok('reject a nested non-part path', !bad({ parts: [{ path: 'parts/sub/x.js', name: 'x', visible: true, order: 0 }], activeId: null }).ok);
ok('reject non-js', !bad({ parts: [{ path: 'parts/x.txt', name: 'x', visible: true, order: 0 }], activeId: null }).ok);
ok('reject duplicate path', !bad({ parts: [surf.parts[0], { ...surf.parts[0], order: 1 }] }).ok);
ok('reject bad position', !bad({ parts: [{ ...surf.parts[0], position: [1, 'x'] }] }).ok);
ok('reject dangling activeId', !bad({ activeId: 'parts/ghost.js' }).ok);
ok('reject bad JSON text', !validateSurfJson('{').ok);
ok('collects every error', bad({ format: 'x', version: 9 }).errors.length >= 2);
threw = false; try { toSurfJson({ name: 'A', parts: [{ id: 'local:123', name: 'p' }] }); } catch { threw = true; }
ok('toSurfJson refuses local ids', threw);

console.log('\ngit G1 — find-or-create vault');
eq('default name', DEFAULT_VAULT_NAME, 'surfcad-vault');
eq('sanitize rename', sanitizeVaultName('  My CAD vault! '), 'My-CAD-vault');
eq('sanitize empty', sanitizeVaultName('..'), '');
const gh = createMockGithubAdapter({ login: 'artur' });
const v1 = await findOrCreateVault(gh);
eq('creates surfcad-vault', [v1.status, v1.repo, v1.private, v1.defaultBranch], ['created', { owner: 'artur', name: 'surfcad-vault' }, true, 'main']);
eq('seed tree', (await gh.listTree(v1.repo, 'main')).map((e) => e.path), ['assemblies/.gitkeep', 'parts/.gitkeep', 'README.md', 'surfcad.json'].sort((a, b) => a.localeCompare(b)));
ok('marker valid', isVaultMarker((await gh.readFile(v1.repo, 'surfcad.json')).content));
eq('seed is one commit', (await gh.compare(v1.repo, 'main', 'main')).headSha, v1.headSha);
const v2 = await findOrCreateVault(gh);
eq('second call finds it', [v2.status, v2.headSha], ['found', v1.headSha]);
eq('one createRepo only', gh._log.filter((e) => e.op === 'createRepo').length, 1);
// GitHub `size === 0` often lies for small vaults; findOrCreate must use getBranch,
// not info.empty — otherwise seed with baseSha:null throws "main moved… base null".
{
  const realGetRepo = gh.getRepo.bind(gh);
  gh.getRepo = async (repo) => {
    const info = await realGetRepo(repo);
    return info ? { ...info, empty: true } : info;
  };
  const lied = await findOrCreateVault(gh);
  eq('size===0 lie still finds vault', [lied.status, lied.headSha], ['found', v1.headSha]);
  gh.getRepo = realGetRepo;
}
const v3 = await findOrCreateVault(gh, { name: 'my parts' });
eq('rename field', [v3.status, v3.repo.name], ['created', 'my-parts']);
gh._seedRepo({ name: 'busy', files: { 'index.html': '<p>' } });
const v4 = await findOrCreateVault(gh, { name: 'busy' });
eq('non-vault repo untouched', [v4.status, (await gh.listTree(v4.repo, 'main')).length], ['not-a-vault', 1]);
gh._seedRepo({ name: 'blank' });
{
  const blank = await findOrCreateVault(gh, { name: 'blank' });
  eq('empty repo not seeded', blank.status, 'not-a-vault');
  await throwsCode('empty unseeded repo tree throws not_found', () => gh.listTree({ owner: 'artur', name: 'blank' }, 'main'), 'not_found');
}
eq('look-only missing', (await findOrCreateVault(gh, { name: 'nothing', create: false })).status, 'missing');
eq('invalid name', (await findOrCreateVault(gh, { name: '!!' })).status, 'invalid-name');
// layout write → read through the vault
const asm = { source: 'git', name: 'Gearbox', activeId: null, parts: [{ id: assemblyPartPath('Gearbox', 'Bracket'), name: 'Bracket' }] };
await gh.commitFiles(v1.repo, {
  branch: 'main', message: 'Gearbox', baseSha: v2.headSha,
  files: [fileWrite(assemblyFilePath('Gearbox'), stringifySurfJson(asm)), fileWrite(assemblyPartPath('Gearbox', 'Bracket'), 'return Manifold.cube([1,1,1]);')],
});
const vaultTree = await gh.listTree(v1.repo, 'main');
eq('vault lists assembly', listAssemblies(vaultTree), ['Gearbox']);
const loaded = parseSurfJson((await gh.readFile(v1.repo, assemblyFilePath('Gearbox'))).content);
eq('loaded part script by path', (await gh.readFile(v1.repo, loaded.parts[0].id)).content, 'return Manifold.cube([1,1,1]);');

console.log('\ngit G1 — Connect GitHub wiring (G7 enables when Client ID set)');
const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
const at = feed.indexOf('data-git-connect');
ok('PartFeed has Connect GitHub', at > 0 && feed.includes('Connect GitHub'));
ok('Connect is git-mode only', /source === 'git' && \([\s\S]*?data-git-connect/.test(feed));
ok('Connect gated on client id / token (G7)', /githubConnectReady/.test(feed) && /githubConnected/.test(feed));
const srcFiles = ['githubAdapterInterface', 'mockGithubAdapter', 'vaultLayout', 'surfJson', 'vault']
  .map((f) => readFileSync(new URL(`../../src/utils/git/${f}.js`, import.meta.url), 'utf8')).join('\n');
ok('no network or token use in G1 core modules', !/\bfetch\(|api\.github\.com|XMLHttpRequest|localStorage|Authorization/.test(srcFiles));

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
