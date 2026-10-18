import assert from 'node:assert/strict';
import test from 'node:test';
import { assemblyOpenFailure, resolveAssemblyOpenName } from './openAssemblyName.js';

function noPath(value) {
  const text = JSON.stringify(value);
  assert.equal(/assemblies\//.test(text), false, text);
  assert.equal(/\.surf\.json/.test(text), false, text);
  assert.equal(/parts\//.test(text), false, text);
}

test('a missing assembly name is not_found and lists what exists', () => {
  const decision = resolveAssemblyOpenName('does-not-exist', ['Bracket', 'Housing']);
  assert.equal(decision.name, undefined);
  assert.equal(decision.error.code, 'not_found');
  assert.match(decision.error.message, /does-not-exist/);
  assert.match(decision.error.details.hint, /Bracket/);
  assert.match(decision.error.details.hint, /Housing/);
  assert.deepEqual(decision.error.details.assemblies, ['Bracket', 'Housing']);
  noPath(decision.error);
});

test('an empty vault still says not_found and how to get a name', () => {
  const decision = resolveAssemblyOpenName('does-not-exist', []);
  assert.equal(decision.error.code, 'not_found');
  assert.match(decision.error.message, /does-not-exist/);
  assert.match(decision.error.details.hint, /Save/);
  noPath(decision.error);
});

test('an exact assembly name opens and does not pick a different spelling', () => {
  const exact = resolveAssemblyOpenName('Bracket', ['Housing', 'Bracket']);
  assert.equal(exact.error, undefined);
  assert.equal(exact.name, 'Bracket');

  const close = resolveAssemblyOpenName('bracket', ['Bracket']);
  assert.equal(close.error.code, 'ambiguous');
  assert.match(close.error.message, /bracket/);
  assert.match(close.error.message, /Bracket/);
  assert.deepEqual(close.error.details.matches, ['Bracket']);
  noPath(close.error);
});

test('an exact name still opens when another spelling exists', () => {
  const decision = resolveAssemblyOpenName('Widget', ['Widget', 'widget']);
  assert.equal(decision.error, undefined);
  assert.equal(decision.name, 'Widget');
});

test('several case-insensitive matches are ambiguous and name the request', () => {
  const decision = resolveAssemblyOpenName('WIDGET', ['Widget', 'widget']);
  assert.equal(decision.error.code, 'ambiguous');
  assert.match(decision.error.message, /WIDGET/);
  assert.deepEqual(decision.error.details.matches, ['Widget', 'widget']);
  noPath(decision.error);
});

test('a vault not-found error keeps not_found and drops the repo path', () => {
  const opened = {
    status: 'error',
    error: 'Assembly not found: assemblies/does-not-exist/.surf.json',
  };
  const error = assemblyOpenFailure(opened, 'does-not-exist', ['Bracket']);
  assert.equal(error.code, 'not_found');
  assert.match(error.message, /does-not-exist/);
  assert.match(error.details.hint, /Bracket/);
  noPath(error);
});

test('no repo stays git_blocked', () => {
  const error = assemblyOpenFailure(
    { status: 'error', code: 'git_blocked', error: 'No repo yet. Save creates it.' },
    'Bracket',
    null,
  );
  assert.equal(error.code, 'git_blocked');
  assert.equal(error.message, 'No repo yet. Save creates it.');
});
