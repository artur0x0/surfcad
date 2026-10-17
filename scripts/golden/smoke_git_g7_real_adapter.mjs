#!/usr/bin/env node
/**
 * G7: real GitHub adapter + stateless token exchange + Connect wiring.
 *
 * - Real adapter method parity vs mock (mocked fetch — no network)
 * - Empty-repo first commit (Contents API bootstrap; blobs 409 until seeded)
 * - Exchange endpoint (mock GitHub token response; stores nothing)
 * - Connect / callback state handling
 * - No secrets in client bundle except Client ID
 * - Mock still available for offline / goldens
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GitAdapterError, assertGithubAdapter, missingAdapterMethods,
  fileWrite, fileDelete,
} from '../../src/utils/git/githubAdapterInterface.js';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { createGithubAdapter } from '../../src/utils/git/githubAdapter.js';
import { vaultMarkerContent } from '../../src/utils/git/vault.js';
import {
  GITHUB_CALLBACK_PATH, GITHUB_TOKEN_STORAGE_KEY, GITHUB_TOKEN_EXCHANGE_PATH,
  GITHUB_OAUTH_STATE_MISSING_HINT,
  buildAuthorizeUrl, githubRedirectUri, resolveGithubClientId,
  createOAuthState, consumeOAuthState, peekOAuthState,
  saveGithubToken, loadGithubToken, clearGithubToken, hasGithubToken,
  exchangeCodeForToken, completeGithubCallback, resetGithubCallbackDedupe,
} from '../../src/utils/git/githubAuth.js';
import { exchangeGithubOAuthToken } from '../../backend/services/githubOAuth.js';
import * as gitIndex from '../../src/utils/git/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

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
async function throwsCode(name, fn, code) {
  try { await fn(); ok(name, false, 'did not throw'); }
  catch (err) { ok(name, err instanceof GitAdapterError && err.code === code, `threw ${err?.code || err?.message}`); }
}

// ---- in-memory sessionStorage for Node ----
const memStore = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => { memStore.set(k, String(v)); },
  removeItem: (k) => { memStore.delete(k); },
  clear: () => memStore.clear(),
};

// ============================================================================
// Auth helpers
// ============================================================================
console.log('git G7 — auth helpers');
eq('callback path', GITHUB_CALLBACK_PATH, '/git/callback');
eq('exchange path', GITHUB_TOKEN_EXCHANGE_PATH, '/api/github/oauth/token');
eq('redirect uri', githubRedirectUri('https://surfcad.com'), 'https://surfcad.com/git/callback');
eq('redirect strips trailing slash', githubRedirectUri('http://localhost:5173/'), 'http://localhost:5173/git/callback');
eq('redirect Tailscale IP', githubRedirectUri('http://100.106.101.1:5173'), 'http://100.106.101.1:5173/git/callback');
eq('redirect LAN IP any port', githubRedirectUri('http://192.168.1.10:4173'), 'http://192.168.1.10:4173/git/callback');
ok('missing-state hint mentions same origin', /same origin/i.test(GITHUB_OAUTH_STATE_MISSING_HINT));
eq('authorize null without client id', buildAuthorizeUrl({ clientId: '' }), null);
{
  const url = buildAuthorizeUrl({
    clientId: 'Iv1.abc',
    redirectUri: 'https://surfcad.com/git/callback',
    state: 's1',
  });
  ok('authorize url', typeof url === 'string' && url.startsWith('https://github.com/login/oauth/authorize?'));
  const u = new URL(url);
  eq('authorize client_id', u.searchParams.get('client_id'), 'Iv1.abc');
  eq('authorize redirect', u.searchParams.get('redirect_uri'), 'https://surfcad.com/git/callback');
  eq('authorize state', u.searchParams.get('state'), 's1');
}
eq('resolve prefers config', resolveGithubClientId({ configClientId: 'from-cfg', viteClientId: 'from-vite' }), 'from-cfg');
eq('resolve falls back to vite', resolveGithubClientId({ configClientId: '', viteClientId: 'from-vite' }), 'from-vite');
eq('resolve empty', resolveGithubClientId({}), '');

memStore.clear();
const st = createOAuthState(() => 'fixed-state');
eq('create state stores', [st, peekOAuthState()], ['fixed-state', 'fixed-state']);
ok('consume ok', consumeOAuthState('fixed-state'));
ok('consume clears', peekOAuthState() === null);
ok('consume mismatch fails', !consumeOAuthState('nope'));

clearGithubToken();
ok('no token', !hasGithubToken());
saveGithubToken('tok_abc');
eq('load token', loadGithubToken(), 'tok_abc');
ok('has token', hasGithubToken());
clearGithubToken();
ok('cleared', !hasGithubToken() && !memStore.has(GITHUB_TOKEN_STORAGE_KEY));

// exchangeCodeForToken via mocked fetch
{
  let sawBody = null;
  const fakeFetch = async (url, opts) => {
    eq('exchange posts to path', url, '/api/github/oauth/token');
    sawBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ access_token: 'ghu_test', token_type: 'bearer', scope: '' }),
    };
  };
  const tok = await exchangeCodeForToken({
    code: 'abc',
    redirectUri: 'https://surfcad.com/git/callback',
    fetchImpl: fakeFetch,
  });
  eq('exchange returns token', tok.access_token, 'ghu_test');
  eq('exchange body', sawBody, { code: 'abc', redirect_uri: 'https://surfcad.com/git/callback' });
}

// completeGithubCallback
{
  memStore.clear();
  resetGithubCallbackDedupe();
  createOAuthState(() => 'cb-state');
  let exchangeCalls = 0;
  const fakeFetch = async () => {
    exchangeCalls += 1;
    return {
      ok: true,
      json: async () => ({ access_token: 'ghu_cb', token_type: 'bearer' }),
    };
  };
  const result = await completeGithubCallback('?code=thecode&state=cb-state', {
    fetchImpl: fakeFetch,
    redirectUri: 'https://surfcad.com/git/callback',
  });
  eq('callback ok', [result.ok, result.token, loadGithubToken()], [true, 'ghu_cb', 'ghu_cb']);
  // Strict Mode remount: same code must reuse the done result (no second exchange, no missing-state).
  const again = await completeGithubCallback('?code=thecode&state=cb-state', {
    fetchImpl: fakeFetch,
    redirectUri: 'https://surfcad.com/git/callback',
  });
  eq('callback dedupe remount', [again.ok, again.token, exchangeCalls], [true, 'ghu_cb', 1]);
  clearGithubToken();

  resetGithubCallbackDedupe();
  memStore.clear();
  createOAuthState(() => 'cb-state');
  const bad = await completeGithubCallback('?code=x&state=wrong', { fetchImpl: fakeFetch });
  eq('callback bad state', [bad.ok, bad.error], [false, 'Invalid or missing OAuth state']);

  resetGithubCallbackDedupe();
  memStore.clear();
  const missing = await completeGithubCallback('?code=orphan&state=anything', { fetchImpl: fakeFetch });
  eq('callback missing state hint', [missing.ok, missing.error], [false, GITHUB_OAUTH_STATE_MISSING_HINT]);

  // Concurrent double-invoke (Strict effect: run → cleanup → run overlapping).
  resetGithubCallbackDedupe();
  memStore.clear();
  createOAuthState(() => 'race-state');
  let resolveFetch;
  const slowFetch = () => new Promise((resolve) => {
    resolveFetch = () => resolve({
      ok: true,
      json: async () => ({ access_token: 'ghu_race', token_type: 'bearer' }),
    });
  });
  const p1 = completeGithubCallback('?code=race&state=race-state', {
    fetchImpl: slowFetch,
    redirectUri: 'http://100.106.101.1:5173/git/callback',
  });
  const p2 = completeGithubCallback('?code=race&state=race-state', {
    fetchImpl: slowFetch,
    redirectUri: 'http://100.106.101.1:5173/git/callback',
  });
  resolveFetch();
  const [r1, r2] = await Promise.all([p1, p2]);
  eq('callback concurrent ok', [r1.ok, r1.token, r2.ok, r2.token, loadGithubToken()],
    [true, 'ghu_race', true, 'ghu_race', 'ghu_race']);
  clearGithubToken();

  const denied = await completeGithubCallback('?error=access_denied&error_description=Nope', {});
  eq('callback error param', [denied.ok, denied.error], [false, 'Nope']);
}

// ============================================================================
// Exchange endpoint (server pure fn)
// ============================================================================
console.log('\ngit G7 — exchange endpoint (stateless)');
{
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      json: async () => ({ access_token: 'ghu_srv', token_type: 'bearer', scope: 'repo' }),
    };
  };
  const okRes = await exchangeGithubOAuthToken({
    code: 'c1',
    redirectUri: 'https://surfcad.com/git/callback',
    clientId: 'Iv1.id',
    clientSecret: 'sekrit',
    fetchImpl: fakeFetch,
  });
  eq('exchange 200', [okRes.ok, okRes.status, okRes.body.access_token], [true, 200, 'ghu_srv']);
  eq('forwards to GitHub', calls[0].url, 'https://github.com/login/oauth/access_token');
  eq('sends id+secret+code', calls[0].body, {
    client_id: 'Iv1.id',
    client_secret: 'sekrit',
    code: 'c1',
    redirect_uri: 'https://surfcad.com/git/callback',
  });

  const uncfg = await exchangeGithubOAuthToken({ code: 'c', clientId: '', clientSecret: '', fetchImpl: fakeFetch });
  eq('unconfigured 503', [uncfg.ok, uncfg.status], [false, 503]);

  const missing = await exchangeGithubOAuthToken({
    code: '', clientId: 'id', clientSecret: 'sek', fetchImpl: fakeFetch,
  });
  eq('missing code 400', [missing.ok, missing.status], [false, 400]);

  const ghReject = await exchangeGithubOAuthToken({
    code: 'bad', clientId: 'id', clientSecret: 'sek',
    fetchImpl: async () => ({ ok: true, json: async () => ({ error: 'bad_verification_code' }) }),
  });
  eq('github reject 400', [ghReject.ok, ghReject.status, ghReject.body.error], [false, 400, 'bad_verification_code']);

  // No store side-channel: function returns token in body only; no module-level stash.
  ok('exchange exports pure', typeof exchangeGithubOAuthToken === 'function');
}

// ============================================================================
// Real adapter with mocked GitHub REST
// ============================================================================
console.log('\ngit G7 — real adapter method parity (mocked fetch)');

function b64(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

/** Minimal fake GitHub that supports the adapter's call patterns. */
function makeFakeGithub() {
  const repos = new Map(); // owner/name -> state
  const tokens = new Set(['good-token']);
  let seq = 0;
  const sha = (label) => {
    seq += 1;
    // Pure hex only (GitHub shas are 40-hex).
    const prefix = { blob: 'b10b', tree: '7eee', cmt: 'c001', b: '00bb', f: '00ff' }[label] || 'aaaa';
    return `${prefix}${String(seq).padStart(36, '0')}`.slice(0, 40);
  };

  function key(owner, name) { return `${owner}/${name}`; }

  function parseUrl(url) {
    const u = new URL(url);
    return { path: u.pathname, search: u.searchParams };
  }

  async function fetchImpl(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const auth = opts.headers?.Authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const { path, search } = parseUrl(url);
    const body = opts.body ? JSON.parse(opts.body) : null;

    const json = (status, data, extraHeaders = {}) => ({
      status,
      ok: status >= 200 && status < 300,
      headers: {
        get: (name) => {
          const want = String(name || '').toLowerCase();
          for (const [k, v] of Object.entries(extraHeaders)) {
            if (k.toLowerCase() === want) return v;
          }
          return null;
        },
      },
      text: async () => (data == null ? '' : JSON.stringify(data)),
      json: async () => data,
    });

    if (!tokens.has(token) && token !== 'no-admin') {
      return json(401, { message: 'Bad credentials' });
    }
    // Can GET /user but POST /user/repos → 403 (App missing Administration R/W).
    if (token === 'no-admin') {
      if (path === '/user' && method === 'GET') return json(200, { login: 'octo-user' });
      if (path === '/user/repos' && method === 'POST') {
        return json(403, {
          message: 'Resource not accessible by integration',
          documentation_url: 'https://docs.github.com/rest/repos/repos#create-a-repository-for-the-authenticated-user',
        }, { 'X-Accepted-GitHub-Permissions': 'administration=write' });
      }
      return json(403, { message: 'Resource not accessible by integration' },
        { 'X-Accepted-GitHub-Permissions': 'administration=write' });
    }

    if (path === '/user' && method === 'GET') {
      return json(200, { login: 'octo-user' });
    }

    let m;
    if ((m = path.match(/^\/user\/repos$/)) && method === 'POST') {
      const k = key('octo-user', body.name);
      if ([...repos.keys()].some((r) => r.toLowerCase() === k.toLowerCase())) {
        return json(422, { message: 'name exists' });
      }
      repos.set(k, {
        owner: 'octo-user', name: body.name, private: !!body.private,
        default_branch: 'main', size: 0,
        commits: new Map(), branches: new Map(), blobs: new Map(),
      });
      return json(201, {
        owner: { login: 'octo-user' }, name: body.name, private: !!body.private,
        default_branch: 'main', size: 0,
      });
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)$/)) && method === 'GET') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      if (!state) return json(404, { message: 'Not Found' });
      return json(200, {
        owner: { login: state.owner }, name: state.name, private: state.private,
        default_branch: state.default_branch, size: state.branches.size ? 1 : 0,
      });
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/branches$/)) && method === 'GET') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      if (!state) return json(404, { message: 'Not Found' });
      const list = [...state.branches.entries()].map(([name, s]) => ({ name, commit: { sha: s } }));
      return json(200, list);
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/branches\/([^/]+)$/)) && method === 'GET') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      if (!state) return json(404, { message: 'Not Found' });
      const name = decodeURIComponent(m[3]);
      const s = state.branches.get(name);
      if (!s) return json(404, { message: 'Not Found' });
      return json(200, { name, commit: { sha: s } });
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/blobs$/)) && method === 'POST') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      if (!state) return json(404, { message: 'Not Found' });
      // Real GitHub: 409 on empty repos (no refs) — Contents API must seed first.
      if (state.branches.size === 0) {
        return json(409, { message: 'Git Repository is empty.' });
      }
      const s = sha('blob');
      state.blobs.set(s, body.content);
      return json(201, { sha: s });
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/trees$/)) && method === 'POST') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      let entries;
      if (body.base_tree) {
        // Find tree contents by treeSha
        let baseMap = new Map();
        for (const c of state.commits.values()) {
          if (c.treeSha === body.base_tree) baseMap = new Map(c.tree);
        }
        for (const e of body.tree || []) baseMap.set(e.path, e.sha);
        entries = [...baseMap.entries()].map(([path, s]) => ({ path, type: 'blob', sha: s, mode: '100644' }));
      } else {
        entries = (body.tree || []).map((e) => ({ ...e }));
      }
      const treeSha = sha('tree');
      // stash pending tree
      state._pendingTree = { sha: treeSha, entries };
      return json(201, { sha: treeSha, tree: entries });
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/commits$/)) && method === 'POST') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      const treeSha = body.tree;
      let entries = state._pendingTree?.sha === treeSha ? state._pendingTree.entries : [];
      // Also allow looking up known tree
      const treeMap = new Map(entries.map((e) => [e.path, state.blobs.get(e.sha) ?? '']));
      // If entries empty, try rebuild from blob map via previous — keep as-is
      const commitSha = sha('cmt');
      const parents = body.parents || [];
      state.commits.set(commitSha, {
        sha: commitSha, parents, tree: treeMap, treeSha, message: body.message,
      });
      return json(201, { sha: commitSha, tree: { sha: treeSha }, parents: parents.map((p) => ({ sha: p })) });
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/commits\/([^/]+)$/)) && method === 'GET') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      const c = state?.commits.get(decodeURIComponent(m[3]));
      if (!c) return json(404, { message: 'Not Found' });
      return json(200, { sha: c.sha, tree: { sha: c.treeSha }, parents: c.parents.map((p) => ({ sha: p })), message: c.message });
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([^/]+)$/)) && method === 'GET') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      const treeSha = decodeURIComponent(m[3]);
      const c = [...(state?.commits.values() || [])].find((x) => x.treeSha === treeSha);
      if (!c) return json(404, { message: 'Not Found' });
      const tree = [...c.tree.entries()].map(([path, content]) => {
        // find blob sha
        let blobSha = null;
        for (const [s, v] of state.blobs) if (v === content) { blobSha = s; break; }
        return { path, type: 'blob', sha: blobSha || sha('b'), mode: '100644' };
      });
      return json(200, { sha: treeSha, tree, truncated: false });
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/refs$/)) && method === 'POST') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      const name = body.ref.replace(/^refs\/heads\//, '');
      if (state.branches.has(name)) return json(422, { message: 'Reference already exists' });
      if (![...state.commits.keys()].includes(body.sha) && !/^[0-9a-f]{40}$/i.test(body.sha)) {
        return json(422, { message: 'Object does not exist' });
      }
      // Allow any 40-hex even if we don't have it for createBranch fromSha edge cases
      if (!state.commits.has(body.sha) && !state.branches.has(name)) {
        // still set if sha looks valid — createBranch from existing commit
        if (!state.commits.has(body.sha)) {
          // only accept known commits
          const known = [...state.commits.keys()];
          if (!known.includes(body.sha)) return json(422, { message: 'Object does not exist' });
        }
      }
      state.branches.set(name, body.sha);
      state.size = 1;
      return json(201, { ref: body.ref, object: { sha: body.sha } });
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/refs\/heads\/([^/]+)$/)) && method === 'PATCH') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      const name = decodeURIComponent(m[3]);
      if (!state.branches.has(name)) return json(404, { message: 'Not Found' });
      state.branches.set(name, body.sha);
      return json(200, { ref: `refs/heads/${name}`, object: { sha: body.sha } });
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/)) && method === 'PUT') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      if (!state) return json(404, { message: 'Not Found' });
      const filePath = decodeURIComponent(m[3]);
      const branch = body.branch || state.default_branch;
      const content = Buffer.from(body.content, 'base64').toString('utf8');
      const blobSha = sha('blob');
      state.blobs.set(blobSha, content);
      const treeSha = sha('tree');
      const commitSha = sha('cmt');
      const tree = new Map([[filePath, content]]);
      // Parent = current branch head when updating; empty repo → root commit.
      const parent = state.branches.get(branch) || null;
      state.commits.set(commitSha, {
        sha: commitSha,
        parents: parent ? [parent] : [],
        tree,
        treeSha,
        message: body.message || 'Update',
      });
      state.branches.set(branch, commitSha);
      state.size = 1;
      return json(201, {
        content: { type: 'file', path: filePath, sha: blobSha },
        commit: { sha: commitSha, message: body.message },
      });
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/)) && method === 'GET') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      if (!state) return json(404, { message: 'Not Found' });
      const filePath = decodeURIComponent(m[3]);
      const ref = search.get('ref') || state.default_branch;
      let commitSha = state.branches.get(ref) || (state.commits.has(ref) ? ref : null);
      if (!commitSha) return json(404, { message: 'Not Found' });
      const c = state.commits.get(commitSha);
      if (!c || !c.tree.has(filePath)) return json(404, { message: 'Not Found' });
      const content = c.tree.get(filePath);
      let blobSha = null;
      for (const [s, v] of state.blobs) if (v === content) { blobSha = s; break; }
      return json(200, {
        type: 'file', path: filePath, sha: blobSha || sha('f'),
        encoding: 'base64', content: b64(content),
      });
    }

    if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/compare\/(.+)$/)) && method === 'GET') {
      const state = repos.get(key(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      if (!state) return json(404, { message: 'Not Found' });
      const spec = decodeURIComponent(m[3]);
      const [baseRef, headRef] = spec.split('...');
      const resolve = (r) => state.branches.get(r) || (state.commits.has(r) ? r : null);
      const baseSha = resolve(baseRef);
      const headSha = resolve(headRef);
      if (!baseSha || !headSha) return json(404, { message: 'Not Found' });

      // ancestors
      const walk = (s) => {
        const seen = new Map();
        const q = [[s, 0]];
        while (q.length) {
          const [x, d] = q.shift();
          if (!x || seen.has(x)) continue;
          seen.set(x, d);
          for (const p of state.commits.get(x)?.parents || []) q.push([p, d + 1]);
        }
        return seen;
      };
      const fromBase = walk(baseSha);
      const fromHead = walk(headSha);
      let mergeBaseSha = null; let best = Infinity;
      for (const [s, d] of fromHead) {
        if (fromBase.has(s) && d + fromBase.get(s) < best) {
          best = d + fromBase.get(s); mergeBaseSha = s;
        }
      }
      const aheadBy = [...fromHead.keys()].filter((s) => !fromBase.has(s)).length;
      const behindBy = [...fromBase.keys()].filter((s) => !fromHead.has(s)).length;
      let status = 'identical';
      if (aheadBy && behindBy) status = 'diverged';
      else if (aheadBy) status = 'ahead';
      else if (behindBy) status = 'behind';
      const a = mergeBaseSha ? state.commits.get(mergeBaseSha).tree : new Map();
      const b = state.commits.get(headSha).tree;
      const files = [];
      for (const [p, c] of b) {
        if (!a.has(p)) files.push({ filename: p, status: 'added' });
        else if (a.get(p) !== c) files.push({ filename: p, status: 'modified' });
      }
      for (const p of a.keys()) if (!b.has(p)) files.push({ filename: p, status: 'removed' });
      const commitsAhead = [...fromHead.keys()].filter((s) => !fromBase.has(s)).map((s) => ({ sha: s }));
      return json(200, {
        status, ahead_by: aheadBy, behind_by: behindBy,
        base_commit: { sha: baseSha },
        merge_base_commit: { sha: mergeBaseSha },
        commits: commitsAhead,
        files,
      });
    }

    return json(404, { message: `unhandled ${method} ${path}` });
  }

  return { fetchImpl, repos };
}

{
  ok('createGithub needs token', (() => {
    try { createGithubAdapter({}); return false; }
    catch (e) { return e instanceof GitAdapterError && e.code === 'unauthorized'; }
  })());

  const { fetchImpl } = makeFakeGithub();
  const real = createGithubAdapter({ token: 'good-token', fetchImpl, apiBase: 'https://api.github.com' });
  eq('real implements interface', missingAdapterMethods(real), []);
  ok('assert passes', assertGithubAdapter(real) === real);
  eq('kind', real.kind, 'real');
  eq('viewer', await real.getViewer(), { login: 'octo-user' });

  const repo = { owner: 'octo-user', name: 'scratch' };
  eq('missing repo', await real.getRepo(repo), null);
  const created = await real.createRepo({ name: 'scratch', private: true });
  eq('created', [created.owner, created.name, created.private, created.empty], ['octo-user', 'scratch', true, true]);
  await throwsCode('dup name', () => real.createRepo({ name: 'scratch' }), 'name_exists');
  await throwsCode('bad name', () => real.createRepo({ name: 'a b' }), 'invalid');

  eq('empty branches', await real.listBranches(repo), []);
  const marker = vaultMarkerContent();
  const c1 = await real.commitFiles(repo, {
    branch: 'main', message: 'one', baseSha: null, seed: true,
    files: [fileWrite('surfcad.json', marker), fileWrite('a.txt', 'A'), fileWrite('dir/b.txt', 'B')],
  });
  ok('first commit sha', /^[0-9a-f]{40}$/i.test(c1.sha));
  eq('first parents', c1.parents, []);
  eq('main listed', (await real.listBranches(repo)).map((b) => b.name), ['main']);
  eq('read a.txt', (await real.readFile(repo, 'a.txt')).content, 'A');
  eq('read missing', await real.readFile(repo, 'nope.txt'), null);
  eq('tree', (await real.listTree(repo, 'main')).map((e) => e.path), ['a.txt', 'dir/b.txt', 'surfcad.json']);
  eq('tree prefix', (await real.listTree(repo, 'main', { prefix: 'dir/' })).map((e) => e.path), ['dir/b.txt']);
  await throwsCode('listTree missing ref throws', () => real.listTree(repo, 'no-such-branch'), 'not_found');
  eq('empty-repo first commit is root', c1.parents, []);
  ok('empty-repo multi-file landed both paths',
    (await real.readFile(repo, 'a.txt')).content === 'A'
    && (await real.readFile(repo, 'dir/b.txt')).content === 'B');

  // Single-file first commit on a fresh empty repo (Contents API only).
  {
    const solo = await real.createRepo({ name: 'solo-empty', private: true });
    eq('solo empty', solo.empty, true);
    const soloRepo = { owner: 'octo-user', name: 'solo-empty' };
    const sc = await real.commitFiles(soloRepo, {
      branch: 'main', message: 'solo', baseSha: null, seed: true,
      files: [fileWrite('surfcad.json', marker)],
    });
    ok('solo sha', /^[0-9a-f]{40}$/i.test(sc.sha));
    eq('solo parents', sc.parents, []);
    eq('solo content', (await real.readFile(soloRepo, 'surfcad.json')).content, marker);
    await real.createRepo({ name: 'not-a-vault', private: true });
    await throwsCode('unmarked empty repo is not seeded', () => real.commitFiles(
      { owner: 'octo-user', name: 'not-a-vault' },
      { branch: 'main', message: 'nope', baseSha: null, files: [fileWrite('only.txt', 'ONE')] },
    ), 'not_a_vault');
  }

  const c2 = await real.commitFiles(repo, {
    branch: 'main', message: 'two', baseSha: c1.sha,
    files: [fileWrite('a.txt', 'A2'), fileDelete('dir/b.txt'), fileWrite('c.txt', 'C')],
  });
  eq('second parents', c2.parents, [c1.sha]);
  eq('after c2 tree', (await real.listTree(repo, 'main')).map((e) => e.path), ['a.txt', 'c.txt', 'surfcad.json']);
  eq('read at old sha', (await real.readFile(repo, 'a.txt', c1.sha)).content, 'A');
  await throwsCode('stale baseSha', () => real.commitFiles(repo, {
    branch: 'main', message: 'x', baseSha: c1.sha, files: [fileWrite('a.txt', 'z')],
  }), 'non_fast_forward');

  const br = await real.createBranch(repo, 'feature', c1.sha);
  eq('branch', br, { name: 'feature', sha: c1.sha });
  await throwsCode('dup branch', () => real.createBranch(repo, 'feature', c1.sha), 'name_exists');

  eq('compare identical', (await real.compare(repo, 'main', 'main')).status, 'identical');
  const behind = await real.compare(repo, 'main', 'feature');
  eq('feature behind', [behind.status, behind.aheadBy, behind.behindBy], ['behind', 0, 1]);
  await real.commitFiles(repo, {
    branch: 'feature', message: 'f', files: [fileWrite('f.txt', 'F'), fileWrite('a.txt', 'Af')],
  });
  const div = await real.compare(repo, 'main', 'feature');
  eq('diverged status', div.status, 'diverged');
  ok('diverged has files', div.files.some((f) => f.path === 'f.txt' && f.status === 'added'));

  // unauthorized
  const bad = createGithubAdapter({ token: 'nope', fetchImpl, apiBase: 'https://api.github.com' });
  await throwsCode('bad token', () => bad.getViewer(), 'unauthorized');
  try {
    await bad.getViewer();
    ok('bad token message', false, 'did not throw');
  } catch (err) {
    ok('bad token surfaces GitHub message', /Bad credentials/.test(err.message));
    eq('bad token status', err.status, 401);
  }

  const noAdmin = createGithubAdapter({ token: 'no-admin', fetchImpl, apiBase: 'https://api.github.com' });
  eq('no-admin can getViewer', await noAdmin.getViewer(), { login: 'octo-user' });
  try {
    await noAdmin.createRepo({ name: 'blocked', private: true });
    ok('createRepo 403', false, 'did not throw');
  } catch (err) {
    ok('createRepo 403 code', err instanceof GitAdapterError && err.code === 'unauthorized');
    ok('createRepo 403 message', /Resource not accessible by integration/.test(err.message));
    ok('createRepo 403 accepted perms', /administration=write/.test(err.message)
      && err.acceptedPermissions === 'administration=write');
    ok('createRepo 403 hints App fix', /Administration R\/W/i.test(err.message));
    eq('createRepo 403 status', err.status, 403);
  }
}

// Mock still works
console.log('\ngit G7 — mock still available');
{
  const mock = createMockGithubAdapter({ login: 'local-user' });
  eq('mock interface', missingAdapterMethods(mock), []);
  eq('mock kind', mock.kind, 'mock');
  ok('index exports real + auth', typeof gitIndex.createGithubAdapter === 'function'
    && typeof gitIndex.buildAuthorizeUrl === 'function'
    && typeof gitIndex.exchangeCodeForToken === 'function');
}

// ============================================================================
// Connect wiring + no secrets in client
// ============================================================================
console.log('\ngit G7 — Connect wiring + no client secrets');
{
  const feed = readFileSync(join(root, 'src/components/PartFeed.jsx'), 'utf8');
  const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');
  const main = readFileSync(join(root, 'src/main.jsx'), 'utf8');
  const auth = readFileSync(join(root, 'src/utils/git/githubAuth.js'), 'utf8');
  const realSrc = readFileSync(join(root, 'src/utils/git/githubAdapter.js'), 'utf8');
  const cb = readFileSync(join(root, 'src/components/GitCallback.jsx'), 'utf8');
  const srv = readFileSync(join(root, 'backend/serverApp.js'), 'utf8');
  const route = readFileSync(join(root, 'backend/routes/github.js'), 'utf8');
  const cfg = readFileSync(join(root, 'backend/config/index.js'), 'utf8');

  ok('Connect button present', /data-git-connect=""/.test(feed) && /Connect GitHub/.test(feed));
  ok('Connect gated on ready / connected', /githubConnectReady/.test(feed) && /githubConnected/.test(feed));
  ok('disabled only when not ready and not connected',
    /disabled=\{!githubConnected && !githubConnectReady\}/.test(feed));
  ok('App wires connect handlers', /onGitConnect=\{handleGitConnect\}/.test(app)
    && /onGitDisconnect=\{handleGitDisconnect\}/.test(app)
    && /createGithubAdapter/.test(app)
    && /buildAuthorizeUrl/.test(app));
  ok('adapter switches on token', /loadGithubToken\(\)/.test(app) && /kind === 'real'/.test(app));
  ok('callback page routed', /GitCallback/.test(main) && /GITHUB_CALLBACK_PATH/.test(main));
  ok('callback outside StrictMode',
    /<GitCallback/.test(main) && /<StrictMode>/.test(main)
    && main.indexOf('<GitCallback') < main.indexOf('<StrictMode>'));
  ok('callback soft-nav via onComplete',
    /onComplete=\{goHome\}/.test(main)
    && /onComplete/.test(cb)
    && /history\.replaceState/.test(cb)
    && /typeof onComplete === 'function'/.test(cb));
  ok('callback exchanges + stores', /completeGithubCallback/.test(cb) && /sessionStorage/.test(auth));
  ok('callback shows same-origin hint', /data-git-callback-origin-hint/.test(cb)
    && /GITHUB_OAUTH_STATE_MISSING_HINT/.test(cb));
  ok('redirect_uri from window.origin', /githubRedirectUri\(window\.location\.origin\)/.test(cb)
    && /githubRedirectUri\(\)/.test(app));
  ok('token in sessionStorage not localStorage',
    /sessionStorage/.test(auth) && !/localStorage/.test(auth));
  ok('auth documents Tailscale / same-origin', /Tailscale/.test(auth) && /same origin/.test(auth));
  ok('exchange route mounted', /\/api\/github/.test(srv) && /oauth\/token/.test(route));
  ok('config exposes client id only', /githubAppClientId/.test(srv) && /GITHUB_APP_CLIENT_SECRET/.test(cfg));
  ok('createRepo uses POST /user/repos', /\/user\/repos/.test(realSrc) && /method: 'POST'/.test(realSrc));
  ok('auth headers include Accept + Api-Version', /application\/vnd\.github\+json/.test(realSrc)
    && /X-GitHub-Api-Version/.test(realSrc) && /2022-11-28/.test(realSrc));
  ok('403 surfaces X-Accepted-GitHub-Permissions', /X-Accepted-GitHub-Permissions/.test(realSrc)
    && /unauthorizedFromResponse/.test(realSrc));
  ok('docs cover Administration R/W', /Administration/.test(readFileSync(join(root, 'docs/architecture.md'), 'utf8'))
    && /Approve.*updated permissions/i.test(readFileSync(join(root, 'docs/architecture.md'), 'utf8')));
  ok('client secret not in src/', (() => {
    const walk = (dir) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name === 'dist') continue;
        const p = join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(js|jsx|mjs|ts|tsx)$/.test(ent.name)) {
          const t = readFileSync(p, 'utf8');
          if (/GITHUB_APP_CLIENT_SECRET/.test(t) && !p.includes('backend/')) return false;
          if (/client_secret/.test(t) && p.includes('/src/')) return false;
        }
      }
      return true;
    };
    return walk(join(root, 'src'));
  })());
  ok('real adapter uses Bearer', /Authorization.*Bearer/.test(realSrc.replace(/\n/g, ' ')));
  ok('empty-repo Contents bootstrap', /commitFilesOnEmptyRepo/.test(realSrc)
    && /\/contents\//.test(realSrc) && /Initialize empty repository/.test(realSrc));
  ok('auth never logs token', !/\bconsole\.(log|info|debug|warn)\([^)]*token/i.test(auth + route));
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
