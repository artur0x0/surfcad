#!/usr/bin/env node
/**
 * G8: Sign in with GitHub (primary) + app User upsert (githubId).
 *
 * - AuthStep order + exact subtitle
 * - startGithubOAuth / establishGithubSession helpers
 * - fetchGithubUserProfile (mocked GitHub /user + emails)
 * - User model githubId + authProvider enum (source)
 * - POST /api/auth/github route wiring (source)
 * - GitCallback calls establishGithubSession after token exchange
 * - LoginModal / OrderModal route github through githubAuth
 * - Soft-nav (#191) preserved
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GITHUB_CALLBACK_PATH, GITHUB_SESSION_PATH, GITHUB_SIGNIN_SUBTITLE,
  peekOAuthState,
  startGithubOAuth, establishGithubSession, resolveGithubClientId,
  rememberGithubClientId, peekGithubClientId,
  resetGithubCallbackDedupe,
} from '../../src/utils/git/githubAuth.js';
import { fetchGithubUserProfile, splitGithubDisplayName } from '../../backend/services/githubUser.js';
import { deleteGithubVaultRepo } from '../../backend/services/githubVaultDelete.js';
import { vaultMarkerContent } from '../../src/utils/git/vault.js';

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

const memStore = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => { memStore.set(k, String(v)); },
  removeItem: (k) => { memStore.delete(k); },
  clear: () => memStore.clear(),
};

console.log('git G8 — constants + helpers');
eq('subtitle exact', GITHUB_SIGNIN_SUBTITLE, 'Enables free part revision control');
eq('session path', GITHUB_SESSION_PATH, '/api/auth/github');
eq('callback path still /git/callback', GITHUB_CALLBACK_PATH, '/git/callback');

memStore.clear();
resetGithubCallbackDedupe();
{
  const assigned = [];
  const started = startGithubOAuth({
    clientId: 'Iv1.test',
    assign: (url) => assigned.push(url),
  });
  ok('startGithubOAuth returns true', started === true);
  ok('startGithubOAuth assigns authorize url',
    assigned.length === 1 && assigned[0].startsWith('https://github.com/login/oauth/authorize?'));
  const u = new URL(assigned[0]);
  eq('start client_id', u.searchParams.get('client_id'), 'Iv1.test');
  ok('start stores oauth state', !!peekOAuthState());
}
ok('start without client id fails', startGithubOAuth({
  clientId: '',
  assign: () => {},
}) === false);
ok('resolve empty without env', resolveGithubClientId({ configClientId: '', viteClientId: '' }) === '');
rememberGithubClientId('Iv1.from-runtime');
ok('resolve uses runtime cache', resolveGithubClientId({ configClientId: '', viteClientId: '' }) === 'Iv1.from-runtime');
eq('peek runtime cache', peekGithubClientId(), 'Iv1.from-runtime');
rememberGithubClientId('');
ok('resolve empty after cache clear', resolveGithubClientId({ configClientId: '', viteClientId: '' }) === '');
ok('App remembers client id from /api/config',
  /rememberGithubClientId/.test(readFileSync(join(root, 'src/App.jsx'), 'utf8')));
ok('LoginModal startGithubOAuth uses resolve (cache)',
  /startGithubOAuth\(\)/.test(readFileSync(join(root, 'src/components/LoginModal.jsx'), 'utf8')));

console.log('\ngit G8 — establishGithubSession');
{
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        isNew: true,
        user: { email: 'octo@example.com', githubId: '42', authProvider: 'github' },
      }),
    };
  };
  const r = await establishGithubSession({ accessToken: 'tok_x', fetchImpl });
  ok('session ok', r.ok === true);
  eq('session user githubId', r.user.githubId, '42');
  ok('session isNew', r.isNew === true);
  eq('session POST path', calls[0].url, '/api/auth/github');
  eq('session method', calls[0].init.method, 'POST');
  ok('session credentials include', calls[0].init.credentials === 'include');
  const body = JSON.parse(calls[0].init.body);
  eq('session sends access_token', body.access_token, 'tok_x');
  ok('session body keys are access_token plus optional consent',
    Object.keys(body).every((key) => key === 'access_token' || key === 'analyticsConsent'));
  ok('session sends analyticsConsent boolean', typeof body.analyticsConsent === 'boolean');
}
{
  const r = await establishGithubSession({ accessToken: '' });
  ok('missing token fails', r.ok === false && /Missing access token/.test(r.error));
}
{
  const fetchImpl = async () => new Promise(() => {}); // never settles
  const t0 = Date.now();
  const r = await establishGithubSession({
    accessToken: 'tok_hang',
    fetchImpl,
    timeoutMs: 50,
  });
  ok('hanging upsert times out', r.ok === false && /timed out/i.test(r.error));
  ok('hanging upsert returns promptly', Date.now() - t0 < 2000);
}
{
  const fetchImpl = async () => ({
    ok: false, status: 401, json: async () => ({ error: 'Bad credentials' }),
  });
  const r = await establishGithubSession({ accessToken: 'bad', fetchImpl });
  ok('401 surfaces error', r.ok === false && /Bad credentials/.test(r.error));
}

console.log('\ngit G8 — fetchGithubUserProfile');
{
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/user')) {
      return {
        ok: true,
        json: async () => ({
          id: 99,
          login: 'octocat',
          email: null,
          name: 'The Octocat',
        }),
      };
    }
    if (String(url).includes('/user/emails')) {
      return {
        ok: true,
        json: async () => ([
          { email: 'octo@example.com', primary: true, verified: true },
        ]),
      };
    }
    throw new Error(`unexpected ${url}`);
  };
  const r = await fetchGithubUserProfile({ accessToken: 'tok', fetchImpl });
  ok('profile ok', r.ok === true);
  eq('profile id string', r.profile.id, '99');
  eq('profile email from emails API', r.profile.email, 'octo@example.com');
  eq('profile login', r.profile.login, 'octocat');
  eq('profile displayName', r.profile.displayName, 'The Octocat');
  eq('profile givenName', r.profile.name.givenName, 'The');
  eq('profile familyName', r.profile.name.familyName, 'Octocat');
}
{
  eq('split full name', splitGithubDisplayName('Ada Lovelace', 'ada'), {
    displayName: 'Ada Lovelace', givenName: 'Ada', familyName: 'Lovelace',
  });
  eq('split login fallback', splitGithubDisplayName('', 'octocat'), {
    displayName: 'octocat', givenName: 'octocat', familyName: null,
  });
  eq('split single word', splitGithubDisplayName('Prince', 'x'), {
    displayName: 'Prince', givenName: 'Prince', familyName: null,
  });
}
{
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/user')) {
      return {
        ok: true,
        json: async () => ({ id: 7, login: 'hidden', email: null, name: null }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const r = await fetchGithubUserProfile({ accessToken: 'tok', fetchImpl });
  ok('noreply fallback', r.ok && r.profile.email === 'hidden@users.noreply.github.com');
  eq('name fallback to login', r.profile.name.givenName, 'hidden');
  eq('no family when no name', r.profile.name.familyName, null);
}
{
  const r = await fetchGithubUserProfile({ accessToken: '' });
  ok('empty token rejected', r.ok === false && r.status === 400);
}


console.log('\ngit G8 — deleteGithubVaultRepo');
{
  const marker = Buffer.from(vaultMarkerContent(), 'utf8').toString('base64');
  const fetchImpl = async (url, opts) => {
    const method = opts?.method || 'GET';
    if (method === 'GET' && /\/repos\/octo\/surfcad-vault$/.test(url)) {
      return { status: 200, json: async () => ({ name: 'surfcad-vault', owner: { login: 'octo' }, default_branch: 'main' }) };
    }
    if (method === 'GET' && /surfcad\.json/.test(url)) {
      return { status: 200, json: async () => ({ type: 'file', encoding: 'base64', content: marker }) };
    }
    ok('DELETE method', method === 'DELETE');
    return { status: 204, json: async () => ({}) };
  };
  const r = await deleteGithubVaultRepo({
    accessToken: 'tok', owner: 'octo', name: 'surfcad-vault', fetchImpl,
  });
  ok('204 deleted', r.ok && r.deleted === true && r.repo === 'octo/surfcad-vault');
}
{
  const r = await deleteGithubVaultRepo({
    accessToken: 'tok', owner: 'octo', name: 'surfcad-vault',
    fetchImpl: async () => ({ status: 404, json: async () => ({ message: 'Not Found' }) }),
  });
  ok('404 treated as ok (already gone)', r.ok && r.deleted === false && r.gone === true);
}
{
  const marker = Buffer.from(vaultMarkerContent(), 'utf8').toString('base64');
  const r = await deleteGithubVaultRepo({
    accessToken: 'tok', owner: 'octo', name: 'surfcad-vault',
    fetchImpl: async (url, opts) => {
      const method = opts?.method || 'GET';
      if (method === 'GET' && /surfcad\.json/.test(url)) {
        return { status: 200, json: async () => ({ type: 'file', encoding: 'base64', content: marker }) };
      }
      if (method === 'GET') {
        return { status: 200, json: async () => ({ name: 'surfcad-vault', owner: { login: 'octo' }, default_branch: 'main' }) };
      }
      return { status: 403, json: async () => ({ message: 'Must have admin rights to Repository.' }) };
    },
  });
  ok('403 missing delete permission', r.ok === false && r.code === 'missing_delete_permission'
    && /delete_repo|Administration/.test(r.error));
}
{
  const r = await deleteGithubVaultRepo({ accessToken: '', owner: 'o', name: 'n' });
  ok('empty token rejected', r.ok === false && r.code === 'missing_token');
}

console.log('\ngit G8 — UI + wiring (source)');
{
  const authStep = readFileSync(join(root, 'src/components/order/AuthStep.jsx'), 'utf8');
  const login = readFileSync(join(root, 'src/components/LoginModal.jsx'), 'utf8');
  const order = readFileSync(join(root, 'src/components/OrderModal.jsx'), 'utf8');
  const cb = readFileSync(join(root, 'src/components/GitCallback.jsx'), 'utf8');
  const main = readFileSync(join(root, 'src/main.jsx'), 'utf8');
  const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');
  const userModel = readFileSync(join(root, 'backend/db/models/User.js'), 'utf8');
  const authRoutes = readFileSync(join(root, 'backend/routes/auth.js'), 'utf8');
  const ghUser = readFileSync(join(root, 'backend/services/githubUser.js'), 'utf8');
  const arch = readFileSync(join(root, 'docs/architecture.md'), 'utf8');
  const pkg = readFileSync(join(root, 'package.json'), 'utf8');

  // Button order: GitHub block before Google / Apple
  const ghIdx = authStep.indexOf('data-auth-github-signin');
  const goIdx = authStep.indexOf('data-auth-google-signin');
  const apIdx = authStep.indexOf('data-auth-apple-signin');
  const emIdx = authStep.indexOf('data-auth-email-signin');
  ok('GitHub sign-in control present', ghIdx > 0);
  ok('GitHub is first among providers', ghIdx < goIdx && goIdx < apIdx && apIdx < emIdx);
  ok('exact subtitle in AuthStep', authStep.includes('GITHUB_SIGNIN_SUBTITLE')
    && /data-auth-github-subtitle/.test(authStep));
  ok('AuthStep imports startGithubOAuth', /startGithubOAuth/.test(authStep));
  ok('AuthStep handles github provider', /provider === 'github'/.test(authStep));

  ok('LoginModal github → startGithubOAuth',
    /startGithubOAuth/.test(login) && /provider === 'github'/.test(login));
  ok('LoginModal github returns before passport redirect',
    /if \(provider === 'github'\)[\s\S]*?startGithubOAuth[\s\S]*?return;[\s\S]*?oauthStartPath\(provider/.test(login));
  ok('OrderModal github → startGithubOAuth',
    /startGithubOAuth/.test(order) && /provider === 'github'/.test(order));
  ok('OrderModal github returns before passport redirect',
    /if \(provider === 'github'\)[\s\S]*?startGithubOAuth[\s\S]*?return;[\s\S]*?oauthStartPath\(provider/.test(order));

  ok('GitCallback calls establishGithubSession', /establishGithubSession/.test(cb));
  ok('GitCallback still soft-navs via onComplete',
    /onComplete/.test(cb) && /history\.replaceState/.test(cb)
    && /typeof onComplete === 'function'/.test(cb));
  ok('GitCallback soft-navs before awaiting session upsert',
    (() => {
      const iNav = cb.search(/history\.replaceState/);
      const iSess = cb.search(/establishGithubSession\(/);
      // Soft-nav must appear before the background session call, or session
      // must not be awaited (void …). Blocking await before soft-nav hung Loading.
      if (iNav < 0 || iSess < 0) return false;
      const beforeSess = cb.slice(0, iSess);
      const awaitsBeforeNav = /await\s+establishGithubSession/.test(beforeSess);
      return iNav < iSess && !awaitsBeforeNav;
    })());
  ok('establishGithubSession has timeout budget',
    /GITHUB_SESSION_TIMEOUT_MS/.test(readFileSync(join(root, 'src/utils/git/githubAuth.js'), 'utf8'))
    && /withTimeout/.test(readFileSync(join(root, 'src/utils/git/githubAuth.js'), 'utf8')));
  ok('App Loading unblocks without awaiting IndexedDB',
    /Unblock Loading THIS tick/.test(app)
    && /pendingOAuthEditor|hasPendingEditorState/.test(app)
    && /setEditorInitialScript\(script\)/.test(app)
    && /LOADING_WATCHDOG_MS/.test(app)
    && /data-app-loading/.test(app));
  ok('OAuth editor hand-off works without ?auth=success (GitHub soft-nav)',
    /pendingOAuthEditor/.test(app) && /soft-nav lands on/.test(app));
  ok('callback outside StrictMode (soft-nav #191)',
    main.indexOf('<GitCallback') < main.indexOf('<StrictMode>'));

  ok('User enum includes github', /enum:\s*\[[^\]]*['"]github['"]/.test(userModel));
  ok('User has githubId field', /githubId:\s*\{/.test(userModel));
  ok('findOrCreateOAuth sets githubId', /githubId:\s*provider === 'github'/.test(userModel)
    || /user\.githubId = String\(id\)/.test(userModel));
  ok('auth route POST /github', /router\.post\('\/github'/.test(authRoutes));
  ok('auth route uses fetchGithubUserProfile', /fetchGithubUserProfile/.test(authRoutes));
  ok('auth route deletes account + vault', /router\.delete\('\/account'/.test(authRoutes)
    && /deleteResolvedGithubVault/.test(authRoutes));
  ok('findOrCreateOAuth backfills names', /Backfill names from GitHub/.test(readFileSync(join(root, 'backend/db/models/User.js'), 'utf8')));
  ok('auth route findOrCreateOAuth github', /findOrCreateOAuth\(profile,\s*'github'\)/.test(authRoutes));
  ok('auth route does not store token', !/access_token.*=.*user/.test(authRoutes)
    && /Does NOT store the token/.test(authRoutes));
  ok('githubUser service exists', /fetchGithubUserProfile/.test(ghUser));
  ok('architecture documents G8', /Sign in with GitHub \(G8\)/.test(arch)
    && /Enables free part revision control/.test(arch)
    && /githubId/.test(arch));
  ok('package.json has golden:git-g8-github-signin', /golden:git-g8-github-signin/.test(pkg));
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
