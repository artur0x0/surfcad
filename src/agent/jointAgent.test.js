import assert from 'node:assert/strict';
import test from 'node:test';
import { jointParamsFromArgs, normalizeJointType } from './jointAgent.js';

test('planar aliases to coincident', () => {
  assert.equal(normalizeJointType('planar'), 'coincident');
  const built = jointParamsFromArgs({ type: 'planar' });
  assert.equal(built.patch.type, 'coincident');
});

test('unknown joint type lists valid types', () => {
  const built = jointParamsFromArgs({ type: 'bogus' });
  assert.equal(built.error?.code, 'bad_args');
  assert.match(built.error.message, /coincident/);
  assert.match(built.error.message, /planar is an alias/);
});
