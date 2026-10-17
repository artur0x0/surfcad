#!/usr/bin/env node
/**
 * Per-row Save must not orphan sibling paths, listTree failures must abort
 * the save, and adopting the first Save must not mint -2 copies on the next.
 * Mock adapter + real adapter against mocked fetch — no network, no real repo.
 */
import { readFileSync } from 'node:fs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { createGithubAdapter } from '../../src/utils/git/githubAdapter.js';
import { GitAdapterError } from '../../src/utils/git/githubAdapterInterface.js';
import { findOrCreateVault, vaultMarkerContent } from '../../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath } from '../../src/utils/git/vaultLayout.js';
import { parseSurfJson, toSurfJson, validateSurfJson } from '../../src/utils/git/surfJson.js';
import {
  assembleCommitFiles,
  commitPartToRepo,
  commitWorkspace,
  firstCommitBaseline,
  VAULT_TREE_UNAVAILABLE,
} from '../../src/utils/git/gitCommit.js';

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

const ASM = 'Kettle-MCP';
const BODY = assemblyPartPath(ASM, 'B');
const LID = assemblyPartPath(ASM, 'C');
const SURF = assemblyFilePath(ASM);

function strayDoc() {
  return {
    source: 'git',
    name: ASM,
    activeId: 'local:B',
    parts: [
      { id: 'local:B', name: 'B', visible: true, order: 0 },
      { id: 'local:C', name: 'C', visible: true, order: 1 },
    ],
  };
}

const strayScripts = {
  'local:B': '// B\nreturn Manifold.cube([1, 1, 1], true);\n',
  'local:C': '// C\nreturn Manifold.cube([2, 2, 2], true);\n',
};

console.log('git save stray — Save local:B while local:C is also stray');
{
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const out = await commitPartToRepo(gh, vault.repo, {
    doc: strayDoc(),
    scripts: strayScripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    partId: 'local:B',
  });
  eq('status committed', out.status, 'committed');
  eq('clicked keeps its id', out.partId, 'local:B');
  eq('clicked lands in the assembly folder', out.path, BODY);
  eq('sibling promoted', out.siblings, [{ from: 'local:C', to: LID, id: 'local:C' }]);
  const tree = (await gh.listTree(vault.repo, 'main')).map((e) => e.path);
  ok('tree has B.js', tree.includes(BODY));
  ok('tree has C.js (not orphaned)', tree.includes(LID));
  const surf = await gh.readFile(vault.repo, SURF, 'main');
  const raw = JSON.parse(surf.content);
  eq('surf.json validates', validateSurfJson(raw).ok, true);
  eq('surf.json paths', raw.parts.map((p) => p.path), [BODY, LID]);
  for (const row of raw.parts) {
    const file = await gh.readFile(vault.repo, row.path, 'main');
    ok(`.surf.json ${row.path} has a blob`, !!file);
  }
  eq('C.js content', (await gh.readFile(vault.repo, LID, 'main')).content, strayScripts['local:C']);
  ok('working copy kept stable ids', out.doc.parts.every((p) => p.id === 'local:B' || p.id === 'local:C'));
  ok('working copy adopted both paths', out.doc.parts.every((p) => p.path === BODY || p.path === LID));
}

console.log('\ngit save stray — toSurfJson refuses leftover invalid ids');
{
  let threw = '';
  try {
    toSurfJson(strayDoc());
  } catch (err) {
    threw = err?.message || String(err);
  }
  ok('throws Invalid .surf.json', /^Invalid \.surf\.json:/.test(threw), threw);
  ok('does not invent assemblies/…/B.js', !/assemblies\/Kettle-MCP\/B\.js/.test(threw));
}

console.log('\ngit save stray — real listTree throws; save aborts');
{
  const json = (status, data) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => (data == null ? '' : JSON.stringify(data)),
  });
  const sha = 'c'.repeat(40);
  const treeSha = 'd'.repeat(40);
  const marker = vaultMarkerContent();
  const fetchImpl = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const path = new URL(url).pathname;
    if (path === '/user') return json(200, { login: 'octo-user' });
    if (method === 'GET' && /\/repos\/octo-user\/vault$/.test(path)) {
      return json(200, {
        owner: { login: 'octo-user' }, name: 'vault', private: true,
        default_branch: 'main', size: 1,
      });
    }
    if (method === 'GET' && /\/branches\/main$/.test(path)) {
      return json(200, { name: 'main', commit: { sha } });
    }
    if (method === 'GET' && path.includes('/git/commits/')) {
      return json(200, { sha, tree: { sha: treeSha }, parents: [] });
    }
    if (method === 'GET' && path.includes('/git/trees/')) {
      return json(500, { message: 'GitHub is down' });
    }
    if (method === 'GET' && path.includes('/contents/surfcad.json')) {
      return json(200, {
        type: 'file', path: 'surfcad.json', sha: 'b'.repeat(40),
        encoding: 'base64',
        content: Buffer.from(marker, 'utf8').toString('base64'),
      });
    }
    return json(404, { message: `unhandled ${method} ${path}` });
  };
  const real = createGithubAdapter({ token: 'tok', fetchImpl, apiBase: 'https://api.github.com' });
  const repo = { owner: 'octo-user', name: 'vault' };
  let treeErr = null;
  try { await real.listTree(repo, 'main'); } catch (err) { treeErr = err; }
  ok(
    'listTree 500 throws, does not return []',
    treeErr instanceof GitAdapterError && treeErr.code === 'invalid' && treeErr.message.includes('GitHub is down'),
    treeErr ? `${treeErr.code} ${treeErr.message}` : 'no throw',
  );
  let missingErr = null;
  try { await real.listTree(repo, 'no-such-branch'); } catch (err) { missingErr = err; }
  ok(
    'listTree missing SHA throws not_found',
    missingErr instanceof GitAdapterError && missingErr.code === 'not_found',
    missingErr ? `${missingErr.code} ${missingErr.message}` : 'no throw',
  );

  const truncatedFetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const path = new URL(url).pathname;
    if (path === '/user') return json(200, { login: 'octo-user' });
    if (method === 'GET' && /\/repos\/octo-user\/vault$/.test(path)) {
      return json(200, {
        owner: { login: 'octo-user' }, name: 'vault', private: true,
        default_branch: 'main', size: 1,
      });
    }
    if (method === 'GET' && /\/branches\/main$/.test(path)) {
      return json(200, { name: 'main', commit: { sha } });
    }
    if (method === 'GET' && path.includes('/git/commits/')) {
      return json(200, { sha, tree: { sha: treeSha }, parents: [] });
    }
    if (method === 'GET' && path.includes('/git/trees/')) {
      return json(200, {
        sha: treeSha,
        truncated: true,
        tree: [{ path: 'parts/Mount.js', type: 'blob', sha: 'e'.repeat(40) }],
      });
    }
    return json(404, { message: `unhandled ${method} ${path}` });
  };
  const truncated = createGithubAdapter({ token: 'tok', fetchImpl: truncatedFetch, apiBase: 'https://api.github.com' });
  let truncatedErr = null;
  try { await truncated.listTree(repo, 'main'); } catch (err) { truncatedErr = err; }
  ok(
    'listTree truncated throws invalid',
    truncatedErr instanceof GitAdapterError && truncatedErr.code === 'invalid' && /truncated/i.test(truncatedErr.message),
    truncatedErr ? `${truncatedErr.code} ${truncatedErr.message}` : 'no throw',
  );

  const emptyMock = createMockGithubAdapter({ login: 'artur' });
  await emptyMock.createRepo({ name: 'empty-tree' });
  let mockMissing = null;
  try { await emptyMock.listTree({ owner: 'artur', name: 'empty-tree' }, 'main'); } catch (err) { mockMissing = err; }
  ok(
    'mock listTree missing SHA throws not_found',
    mockMissing instanceof GitAdapterError && mockMissing.code === 'not_found',
    mockMissing ? `${mockMissing.code} ${mockMissing.message}` : 'no throw',
  );

  const mock = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(mock);
  mock.listTree = async () => { throw new Error('network down'); };
  const baseline = firstCommitBaseline({ headSha: vault.headSha });
  const commitsBefore = mock._log.filter((e) => e.op === 'commitFiles').length;
  let assembledErr = null;
  try {
    await assembleCommitFiles(mock, vault.repo, {
      doc: strayDoc(), scripts: strayScripts, baseline, message: 'Save',
    });
  } catch (err) { assembledErr = err; }
  ok(
    'assembleCommitFiles aborts',
    assembledErr?.code === VAULT_TREE_UNAVAILABLE && /not overwritten/.test(assembledErr.message),
    assembledErr ? assembledErr.message : 'no throw',
  );
  const part = await commitPartToRepo(mock, vault.repo, {
    doc: strayDoc(), scripts: strayScripts, baseline, partId: 'local:B',
  });
  eq('commitPartToRepo status', part.status, 'error');
  eq('commitPartToRepo code', part.code, VAULT_TREE_UNAVAILABLE);
  const commitsAfter = mock._log.filter((e) => e.op === 'commitFiles').length;
  eq('no extra commit after listTree failure', commitsAfter, commitsBefore);
}

console.log('\ngit save stray — double Save after adopting does not mint -2');
{
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const first = await commitWorkspace(gh, vault.repo, {
    doc: strayDoc(),
    scripts: strayScripts,
    baseline: firstCommitBaseline({ headSha: vault.headSha }),
    message: 'Save Kettle',
  });
  eq('first status', first.status, 'committed');
  eq('first file count', first.files.length, 3);
  ok('first has no -2', !first.files.some((path) => /-2\.js$/.test(path)));
  const second = await commitWorkspace(gh, vault.repo, {
    doc: first.doc,
    scripts: first.scripts,
    baseline: first.baseline,
    message: 'Save Kettle again',
  });
  eq('second is clean', second.status, 'clean');
  const again = await assembleCommitFiles(gh, vault.repo, {
    doc: strayDoc(),
    scripts: strayScripts,
    baseline: first.baseline,
    message: 'Save original again',
  });
  eq('original doc would mint -2', again.status, 'ready');
  ok('-2 files when the first result is not adopted',
    again.files.filter((f) => /-2\.js$/.test(f.path)).length === 2,
    JSON.stringify(again.files.map((f) => f.path)));
}

console.log('\ngit save stray — UI wiring');
{
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  const adapter = readFileSync(new URL('../../src/utils/git/githubAdapter.js', import.meta.url), 'utf8');
  const surf = readFileSync(new URL('../../src/utils/git/surfJson.js', import.meta.url), 'utf8');
  const commit = readFileSync(new URL('../../src/utils/git/gitCommit.js', import.meta.url), 'utf8');
  ok('handleAddToRepo remembers the committed doc',
    /handleAddToRepo[\s\S]*?rememberAssembly\(result\.doc\)/.test(app));
  ok('handleGitCommit lists via listVaultTree',
    /listVaultTree\(gitAdapterRef\.current/.test(app)
    && /err\.code === VAULT_TREE_UNAVAILABLE/.test(app));
  ok('git .surf.json writers use prepareAssemblySurfWrite',
    /prepareAssemblySurfWrite/.test(app)
    && !/stringifySurfJson\(/.test(app));
  ok('rename_part lists via prepareVaultPartRename',
    /prepareVaultPartRename\(gitAdapterRef\.current/.test(app)
    && !/catch \{ \/\* the open document still blocks a collision \*\//.test(app)
    && !/planPartPath\(from, nextName\)/.test(app));
  ok('real listTree does not return [] on failure',
    !/if \(!sha\) return \[\];/.test(adapter)
    && !/if \(!res\.ok\) return \[\];/.test(adapter)
    && /throw new GitAdapterError/.test(adapter)
    && /data\?\.truncated/.test(adapter));
  const mockSrc = readFileSync(new URL('../../src/utils/git/mockGithubAdapter.js', import.meta.url), 'utf8');
  ok('mock listTree throws not_found on missing SHA',
    !/if \(!sha\) return \[\];/.test(mockSrc)
    && /throw new GitAdapterError\('not_found'/.test(mockSrc));
  ok('toSurfJson stays pure (no ensureAssemblyVaultPaths)',
    !/ensureAssemblyVaultPaths\(/.test(surf)
    && /Invalid \.surf\.json:/.test(surf));
  ok('commitPartToRepo promotes every stray via ensureAssemblyVaultPaths',
    /commitPartToRepo[\s\S]*?ensureAssemblyVaultPaths\(workDoc/.test(commit)
    && !/sharedPathForMove/.test(commit));
  const reopened = parseSurfJson(JSON.stringify({
    format: 'surfcad.assembly', version: 1, name: ASM,
    activeId: BODY,
    parts: [
      { path: BODY, name: 'B', visible: true, order: 0 },
      { path: LID, name: 'C', visible: true, order: 1 },
    ],
  }));
  ok('reopen keeps committed paths',
    reopened.parts.map((p) => p.path).join(',') === `${BODY},${LID}`);
  ok('path-keyed parse keeps the path as id',
    reopened.parts.every((p) => p.id === p.path));
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
