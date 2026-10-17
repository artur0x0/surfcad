import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  copyProfileMongoUserId,
  profileMongoUserId,
  profileUserIdRowVisible,
} from '../src/components/profileUserId.js';

describe('profile user id', () => {
  test('uses Mongo _id (or id virtual), not githubId', () => {
    const mongo = '507f1f77bcf86cd799439011';
    assert.equal(profileMongoUserId({ _id: mongo, githubId: '999' }), mongo);
    assert.equal(profileMongoUserId({ id: mongo, githubId: '999' }), mongo);
    assert.equal(profileMongoUserId({ githubId: '999' }), '');
  });

  test('signed in shows row; signed out does not', () => {
    const user = { _id: '507f1f77bcf86cd799439011' };
    assert.equal(profileUserIdRowVisible(true, false, user), true);
    assert.equal(profileUserIdRowVisible(false, false, user), false);
    assert.equal(profileUserIdRowVisible(false, true, user), true);
    assert.equal(profileUserIdRowVisible(true, false, null), false);
  });

  test('copy writes id and ignores clipboard failure', async () => {
    let written = '';
    const ok = await copyProfileMongoUserId('507f1f77bcf86cd799439011', async (text) => {
      written = text;
    });
    assert.equal(ok, true);
    assert.equal(written, '507f1f77bcf86cd799439011');

    const fail = await copyProfileMongoUserId('507f1f77bcf86cd799439011', async () => {
      throw new Error('denied');
    });
    assert.equal(fail, false);
    assert.equal(await copyProfileMongoUserId('', async () => {}), false);
  });

  test('ProfilePanel wires copy row markers', () => {
    const panel = readFileSync(new URL('../src/components/ProfilePanel.jsx', import.meta.url), 'utf8');
    const row = readFileSync(new URL('../src/components/ProfileUserIdRow.jsx', import.meta.url), 'utf8');
    assert.match(panel, /ProfileUserIdRow/);
    assert.match(row, /data-profile-user-id-copy/);
    assert.match(row, /aria-label="Copy user id"/);
    assert.match(row, /Copied/);
  });
});
