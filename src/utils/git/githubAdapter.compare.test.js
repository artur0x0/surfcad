/**
 * Real-adapter compare: GitHub caps the file list at 300 and puts the old
 * name of a rename in previous_filename. planSave fail-closes on truncated.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGithubAdapter } from './githubAdapter.js';
import { GITHUB_COMPARE_FILE_LIMIT } from './githubAdapterInterface.js';
import { createMockGithubAdapter } from './mockGithubAdapter.js';

const BASE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const REPO = { owner: 'artur', name: 'surfcad-vault' };

function json(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async text() {
      return JSON.stringify(data);
    },
  };
}

function comparePayload(files, extra = {}) {
  return {
    status: 'ahead',
    ahead_by: 1,
    behind_by: 0,
    base_commit: { sha: BASE },
    merge_base_commit: { sha: BASE },
    commits: [{ sha: HEAD }],
    files,
    ...extra,
  };
}

function adapterFor(payload) {
  const fetchImpl = async (url) => {
    if (String(url).includes('/compare/')) return json(200, payload);
    return json(500, { message: `unexpected ${url}` });
  };
  return createGithubAdapter({
    token: 'tok',
    fetchImpl,
    apiBase: 'https://api.github.com',
  });
}

test('compare reports truncated at GitHub’s 300-file cap and when GitHub signals it', async () => {
  const cap = Array.from({ length: GITHUB_COMPARE_FILE_LIMIT }, (_, i) => ({
    filename: `n${i}.txt`,
    status: 'modified',
  }));
  const capped = await adapterFor(comparePayload(cap)).compare(REPO, BASE, HEAD);
  assert.equal(capped.truncated, true);
  assert.equal(capped.files.length, GITHUB_COMPARE_FILE_LIMIT);

  const under = Array.from({ length: GITHUB_COMPARE_FILE_LIMIT - 1 }, (_, i) => ({
    filename: `n${i}.txt`,
    status: 'modified',
  }));
  const open = await adapterFor(comparePayload(under)).compare(REPO, BASE, HEAD);
  assert.equal(open.truncated, false);
  assert.equal(open.files.length, GITHUB_COMPARE_FILE_LIMIT - 1);

  const flagged = await adapterFor(comparePayload(
    [{ filename: 'only.txt', status: 'added' }],
    { truncated: true },
  )).compare(REPO, BASE, HEAD);
  assert.equal(flagged.truncated, true);
  assert.deepEqual(flagged.files.map((file) => file.path), ['only.txt']);
});

test('compare lists both previous_filename and filename for a rename', async () => {
  const result = await adapterFor(comparePayload([{
    filename: 'parts/new.js',
    previous_filename: 'parts/old.js',
    status: 'renamed',
  }])).compare(REPO, BASE, HEAD);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.files.map((file) => file.path).sort(), [
    'parts/new.js',
    'parts/old.js',
  ]);
});

test('mock compare reports truncated:false under the 300-file cap', async () => {
  const mock = createMockGithubAdapter({ login: 'artur' });
  mock._seedRepo({
    name: 'surfcad-vault',
    files: { 'surfcad.json': '{"kind":"surfcad-vault","version":2}\n', 'a.txt': 'A' },
  });
  const same = await mock.compare({ owner: 'artur', name: 'surfcad-vault' }, 'main', 'main');
  assert.equal(same.truncated, false);
});
