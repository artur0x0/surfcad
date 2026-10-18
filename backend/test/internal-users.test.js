import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isInternalUser, parseInternalUsers } from '../services/internalUsers.js';

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
});
