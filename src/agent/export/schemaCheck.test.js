import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaErrors, shorthandJson, shorthandKeys } from './schemaCheck.js';

const strict = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string', pattern: '^f[0-9]+$' },
    n: { type: 'integer', minimum: 0, maximum: 3 },
    at: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    mode: { type: 'string', enum: ['a', 'b'] },
    params: { type: 'object', additionalProperties: true },
    key: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: false, properties: { x: { type: 'number' } } }] },
  },
};

test('schemaErrors accepts a call that fits', () => {
  assert.deepEqual(schemaErrors(strict, { id: 'f1', n: 2, at: [0, 1, 2], mode: 'a', params: { height: 12 }, key: 'e3' }), []);
});

test('schemaErrors rejects a missing required key, an unknown key, and wrong types', () => {
  assert.match(schemaErrors(strict, {})[0], /\$\.id is required/);
  assert.match(schemaErrors(strict, { id: 'f1', extra: 1 })[0], /\$\.extra is not allowed/);
  assert.match(schemaErrors(strict, { id: 7 })[0], /\$\.id must be string/);
  assert.match(schemaErrors(strict, { id: 'f1', n: 1.5 })[0], /\$\.n must be integer/);
  assert.match(schemaErrors(strict, { id: 'x1' })[0], /must match/);
  assert.match(schemaErrors(strict, { id: 'f1', n: 9 })[0], /<= 3/);
  assert.match(schemaErrors(strict, { id: 'f1', at: [1, 2] })[0], /at least 3/);
  assert.match(schemaErrors(strict, { id: 'f1', at: [1, 2, 'z'] })[0], /at\[2\] must be number/);
  assert.match(schemaErrors(strict, { id: 'f1', mode: 'c' })[0], /one of "a", "b"/);
  assert.match(schemaErrors(strict, { id: 'f1', key: { x: 'no' } })[0], /oneOf/);
});

test('schemaErrors lets a loose params bag carry any key', () => {
  assert.deepEqual(schemaErrors(strict, { id: 'f1', params: { anything: [1, { deep: true }] } }), []);
});

test('schemaErrors throws on a keyword it does not implement', () => {
  assert.throws(() => schemaErrors({ type: 'object', patternProperties: {} }, {}), /unsupported keyword patternProperties/);
});

test('shorthandKeys reads the skill-doc call shapes', () => {
  assert.deepEqual(shorthandKeys(' id | index, confirm? '), ['id', 'index', 'confirm']);
  assert.deepEqual(shorthandKeys(' part_id, scope: "assembly" | "repo", confirm? '), ['part_id', 'scope', 'confirm']);
  assert.deepEqual(shorthandKeys(' dx, dy, dz, … '), ['dx', 'dy', 'dz']);
  assert.deepEqual(shorthandKeys(' params: { at } '), ['params']);
  assert.deepEqual(shorthandKeys(' "accept": true '), ['accept']);
  assert.deepEqual(shorthandKeys(''), []);
});

test('shorthandJson parses concrete calls and skips shapes', () => {
  assert.deepEqual(shorthandJson(' "accept": true '), { accept: true });
  assert.deepEqual(shorthandJson(' plane: "XY" '), { plane: 'XY' });
  assert.deepEqual(shorthandJson(' chip_id: "sheet:base" '), { chip_id: 'sheet:base' });
  assert.equal(shorthandJson(' name? '), null);
  assert.equal(shorthandJson(' id | index '), null);
  assert.equal(shorthandJson(' dx, dy '), null);
});
