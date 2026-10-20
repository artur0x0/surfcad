import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { internalUsersFromEnv, isInternalUser, parseInternalUsers } from '../services/internalUsers.js';

describe('POSTHOG_INTERNAL_USERS', () => {
  test('default empty list matches nobody', () => {
    const list = parseInternalUsers(undefined);
    assert.equal(list.size, 0);
    assert.equal(isInternalUser({ email: 'dev@example.com', githubLogin: 'octocat' }, list), false);
  });

  test('matches GitHub login or email case-insensitively', () => {
    const list = parseInternalUsers(' OctoCat , Dev@Example.com ');
    assert.equal(isInternalUser({ githubLogin: 'octocat' }, list), true);
    assert.equal(isInternalUser({ email: 'dev@example.com' }, list), true);
    assert.equal(isInternalUser({ email: 'other@example.com', githubLogin: 'someone' }, list), false);
  });

  test('internalUsersFromEnv unions the list with ADMIN_GITHUB_LOGINS', () => {
    const list = internalUsersFromEnv({
      POSTHOG_INTERNAL_USERS: 'dev@example.com',
      ADMIN_GITHUB_LOGINS: 'OctoCat, admin2',
    });
    assert.deepEqual([...list].sort(), ['admin2', 'dev@example.com', 'octocat']);
    assert.equal(isInternalUser({ githubLogin: 'octocat' }, list), true);
    assert.equal(isInternalUser({ email: 'dev@example.com' }, list), true);
    assert.equal(isInternalUser({ githubLogin: 'visitor' }, list), false);
  });

  test('internalUsersFromEnv with nothing set matches nobody', () => {
    const list = internalUsersFromEnv({});
    assert.equal(list.size, 0);
    assert.equal(isInternalUser({ githubLogin: 'octocat' }, list), false);
  });
});
