/**
 * Save gets 403 "Resource not accessible by integration".
 * No installation on the signed-in user → install guidance and link.
 * An installation on that user → approve-permissions guidance.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createGithubAdapter } from './githubAdapter.js';
import { GitAdapterError } from './githubAdapterInterface.js';
import {
  GITHUB_INSTALL_ACTION_LABEL,
  githubAppInstallUrl,
  githubSaveErrorFields,
} from './githubAppInstall.js';
import { gitOpCatchResult } from './workingSidecar.js';
import { importJsx } from '../../../test/jsxTestModule.js';

const INSTALL_URL = 'https://github.com/apps/surfcad/installations/new';
const DENIED = 'Resource not accessible by integration';

function response(status, data, headers = {}) {
  const lower = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[String(name || '').toLowerCase()] || null },
    async text() {
      return data == null ? '' : JSON.stringify(data);
    },
  };
}

function denied(headers) {
  return response(403, { message: DENIED }, headers);
}

/**
 * The Save dialog passes the adapter error through the same fields
 * PartFeed reads (`githubAccess === 'install'` → installUrl).
 */
function saveDialog(Notice, err) {
  const fields = githubSaveErrorFields(err);
  const installUrl = fields.githubAccess === 'install' ? fields.installUrl : '';
  return renderToStaticMarkup(React.createElement(Notice, {
    message: err.message,
    installUrl,
  }));
}

function adapterFor(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push(path);
    const hit = routes.find((route) => route.match(path));
    if (!hit) return response(500, { message: `unexpected ${path}` });
    return hit.reply(path);
  };
  return {
    calls,
    adapter: createGithubAdapter({
      token: 'user-token',
      fetchImpl,
      apiBase: 'https://api.github.com',
    }),
  };
}

async function createDenied(routes) {
  const { adapter, calls } = adapterFor(routes);
  let thrown = null;
  try {
    await adapter.createRepo({ name: 'surfcad-vault', private: true });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof GitAdapterError);
  assert.equal(thrown.code, 'unauthorized');
  assert.equal(thrown.status, 403);
  assert.equal(thrown.githubMessage, DENIED);
  return { err: thrown, calls };
}

const noticeReady = importJsx(new URL('../../components/GithubSaveAccessNotice.jsx', import.meta.url));

async function saveDialogFor(err) {
  const { default: Notice } = await noticeReady;
  return saveDialog(Notice, err);
}

test('403 with no installation tells the user to install and links the app install page', async () => {
  assert.equal(githubAppInstallUrl(), INSTALL_URL);
  const { err, calls } = await createDenied([
    { match: (path) => path === '/user/repos', reply: () => denied({ 'x-accepted-github-permissions': 'administration=write' }) },
    {
      match: (path) => path.startsWith('/user/installations'),
      reply: () => response(200, { total_count: 0, installations: [] }),
    },
  ]);
  assert.deepEqual(calls, ['/user/repos', '/user/installations?per_page=100&page=1']);
  assert.equal(err.githubAccess, 'install');
  assert.equal(err.installUrl, INSTALL_URL);
  assert.match(err.message, /not installed on your GitHub account/);
  assert.match(err.message, /Signing in does not install the app/);
  assert.match(err.message, /come back to this tab and save again/);
  assert.match(err.message, new RegExp(INSTALL_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(err.message.includes('Connect again'), false);
  assert.equal(err.message.includes('disconnect and connect'), false);
  assert.equal(err.message.includes('client_id'), false);

  const html = await saveDialogFor(err);
  assert.match(html, /data-git-commit-error=""/);
  assert.match(html, /not installed on your GitHub account/);
  assert.match(html, new RegExp(`href="${INSTALL_URL}"`));
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /data-ui-action="data-git-install-app"/);
  assert.match(html, /data-git-install-app=""/);
  assert.match(html, new RegExp(`>${GITHUB_INSTALL_ACTION_LABEL}<`));

  const caught = gitOpCatchResult(err, 'Commit failed');
  assert.equal(caught.githubAccess, 'install');
  assert.equal(caught.installUrl, INSTALL_URL);
  assert.match(caught.error, /not installed on your GitHub account/);
});

test('403 with an installation on the signed-in user keeps the permissions guidance', async () => {
  const { err } = await createDenied([
    { match: (path) => path === '/user/repos', reply: () => denied({ 'x-accepted-github-permissions': 'administration=write' }) },
    {
      match: (path) => path.startsWith('/user/installations'),
      reply: () => response(200, {
        total_count: 1,
        installations: [{
          id: 42,
          app_slug: 'surfcad',
          account: { login: 'ada', type: 'User' },
        }],
      }),
    },
  ]);
  assert.equal(err.githubAccess, 'permissions');
  assert.equal(err.installUrl, undefined);
  assert.match(err.message, /Resource not accessible by integration/);
  assert.match(err.message, /administration=write/);
  assert.match(err.message, /Administration R\/W/);
  assert.match(err.message, /Approve the updated permissions/);
  assert.match(err.message, /disconnect and connect again/);
  assert.equal(err.message.includes(INSTALL_URL), false);
  assert.equal(err.acceptedPermissions, 'administration=write');

  const html = await saveDialogFor(err);
  assert.match(html, /Approve the updated permissions/);
  assert.equal(html.includes('data-git-install-app'), false);
  assert.equal(html.includes(INSTALL_URL), false);
  assert.equal(githubSaveErrorFields(err).installUrl, undefined);
});

test('an org installation is not an install on the signed-in user', async () => {
  const { err } = await createDenied([
    { match: (path) => path === '/user/repos', reply: () => denied() },
    {
      match: (path) => path.startsWith('/user/installations'),
      reply: () => response(200, {
        total_count: 1,
        installations: [{
          id: 7,
          app_slug: 'surfcad',
          target_type: 'Organization',
          account: { login: 'acme', type: 'Organization' },
        }],
      }),
    },
  ]);
  assert.equal(err.githubAccess, 'install');
  assert.equal(err.installUrl, INSTALL_URL);
  const html = await saveDialogFor(err);
  assert.match(html, new RegExp(`href="${INSTALL_URL}"`));
  assert.match(html, /Install SurfCAD on GitHub/);
});

test('a failed installations lookup keeps the permissions guidance', async () => {
  const { err, calls } = await createDenied([
    { match: (path) => path === '/user/repos', reply: () => denied({ 'x-accepted-github-permissions': 'administration=write' }) },
    {
      match: (path) => path.startsWith('/user/installations'),
      reply: () => response(403, { message: DENIED }, { 'x-accepted-github-permissions': 'administration=write' }),
    },
  ]);
  assert.deepEqual(calls, ['/user/repos', '/user/installations?per_page=100&page=1']);
  assert.equal(err.githubAccess, 'permissions');
  assert.match(err.message, /Administration R\/W/);
  assert.equal((await saveDialogFor(err)).includes('data-git-install-app'), false);
});

test('other 403s do not look up installations', async () => {
  const { adapter, calls } = adapterFor([
    { match: (path) => path === '/user/repos', reply: () => response(403, { message: 'API rate limit exceeded' }) },
  ]);
  await assert.rejects(() => adapter.createRepo({ name: 'surfcad-vault', private: true }), /rate limit/i);
  assert.deepEqual(calls, ['/user/repos']);
});

test('Save to repo dialog is the surface that offers the install link', () => {
  const feed = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../components/PartFeed.jsx'),
    'utf8',
  );
  assert.match(feed, /GithubSaveAccessNotice/);
  assert.match(feed, /commitFlow\.result\?\.githubAccess === 'install'/);
  assert.match(feed, /installUrl=\{commitFlow\.result\?\.githubAccess === 'install' \? commitFlow\.result\.installUrl : ''\}/);
  assert.match(feed, /Save to repo/);
});
