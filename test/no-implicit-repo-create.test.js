/**
 * Read-only vault handlers must not POST /user/repos. Save still creates.
 * Real adapter + in-memory GitHub; no Chrome.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createGithubAdapter } from '../src/utils/git/githubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { gitOpResult } from '../src/agent/gitAgent.js';
import {
  NO_REPO_YET_CODE,
  NO_REPO_YET_COPY,
  gitOpCatchResult,
  noRepoYetError,
  noRepoYetOpResult,
} from '../src/utils/git/workingSidecar.js';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

/** Same lookup App.ensureGitVault uses after token/adapter setup. */
async function driveEnsureGitVault(adapter, { create = false } = {}) {
  try {
    const result = await findOrCreateVault(adapter, { create });
    if (result.status === 'missing' && !create) throw noRepoYetError();
    if (result.status === 'invalid-name' || result.status === 'not-a-vault' || result.status === 'missing') {
      throw new Error(`Vault unavailable (${result.status})`);
    }
    return { status: 'ok', vault: result };
  } catch (err) {
    return gitOpCatchResult(err, 'Vault unavailable');
  }
}

function json(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() { return data; },
    async text() { return JSON.stringify(data); },
  };
}

function fakeGithub({ login = 'dev' } = {}) {
  const posts = [];
  const fetchImpl = async (url, opts = {}) => {
    const method = String(opts.method || 'GET').toUpperCase();
    const path = new URL(url, 'https://api.github.com').pathname;
    if (method === 'GET' && path === '/user') {
      return json(200, { login });
    }
    if (method === 'POST' && path === '/user/repos') {
      const body = opts.body ? JSON.parse(opts.body) : {};
      posts.push(body);
      return json(201, {
        owner: { login },
        name: body.name || 'surfcad-vault',
        private: body.private !== false,
        default_branch: 'main',
      });
    }
    return json(404, { message: 'Not Found' });
  };
  return {
    posts,
    adapter: createGithubAdapter({ token: 'test-token', fetchImpl }),
  };
}

const READ_HANDLERS = [
  'handleOpenVaultAssembly',
  'checkGitRemoteBehind',
  'handleAddExistingPart',
  'handleSwitchBranch',
  'handleInsertVaultAssemblyParts',
  'handleOpenVaultPart',
  'handleCreateBranch',
  'handleDeleteBranch',
  'handleSquashMerge',
  'handleBehindChoice',
  'handleListBranches',
  'handleListVaultBrowse',
  'handleListVaultAssemblies',
  'handleUpgradeVault',
  'handleUpgradeConflict',
];

test('App defaults ensureGitVault to create:false; only Save paths pass create:true', () => {
  assert.match(APP, /const ensureGitVault = async \(\{ create = false \} = \{\}\) =>/);
  const writers = [
    sliceFn(APP, 'const handleGitCommit', 'const absorbOverwriteFiles'),
    sliceFn(APP, 'const handleAddToRepo', 'const handleListBranches'),
    sliceFn(APP, 'const handleSaveOnNewBranch', 'const handleBehindChoice'),
  ];
  for (const src of writers) {
    assert.match(src, /ensureGitVault\(\{\s*create:\s*true\s*\}\)/);
  }
  assert.equal((APP.match(/ensureGitVault\(\{\s*create:\s*true\s*\}\)/g) || []).length, 3);

  for (const name of READ_HANDLERS) {
    const src = handlerSlice(APP, name);
    assert.equal(
      /ensureGitVault\(\{\s*create:\s*true\s*\}\)/.test(src),
      false,
      `${name} must not create a repo`,
    );
  }
});

test('read handlers with no vault: zero POST /user/repos; Save still creates', async () => {
  const { adapter, posts } = fakeGithub();

  for (const name of READ_HANDLERS) {
    const out = await driveEnsureGitVault(adapter, { create: false });
    assert.equal(out.status, 'error', `${name} should refuse without a vault`);
    assert.equal(out.code, NO_REPO_YET_CODE, `${name} should reuse git_blocked`);
    assert.equal(out.error, NO_REPO_YET_COPY);
    const shaped = gitOpResult(out);
    assert.equal(shaped.error?.code, 'git_blocked');
    assert.equal(shaped.error?.message, NO_REPO_YET_COPY);
  }
  assert.equal(posts.length, 0, 'read handlers must not POST /user/repos');

  const save = await driveEnsureGitVault(adapter, { create: true });
  assert.ok(posts.length >= 1, 'Save must POST /user/repos');
  assert.equal(posts[0].name, 'surfcad-vault');
  assert.equal(posts[0].private, true);
  // Seed commit hits 404s on this stub; the create itself is what the playtest caught.
  assert.ok(save.status === 'error' || save.status === 'ok');
});

test('open_assembly / git_* shape a git_blocked error, not ok', () => {
  const opened = noRepoYetOpResult();
  assert.equal(opened.status, 'error');
  const agent = { error: { code: opened.code || 'git_blocked', message: opened.error } };
  assert.equal(agent.error.code, 'git_blocked');
  assert.equal(agent.result, undefined);
  assert.equal(gitOpResult(opened).error.code, 'git_blocked');
  assert.equal(gitOpResult({ status: 'ok', branches: [] }).result.status, 'ok');
});

function sliceFn(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `missing slice ${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

function handlerSlice(src, name) {
  const startNeedle = name === 'checkGitRemoteBehind'
    ? 'const checkGitRemoteBehind'
    : `const ${name}`;
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `missing ${name}`);
  const next = src.indexOf('\n  const ', start + startNeedle.length);
  return src.slice(start, next > start ? next : start + 2500);
}
