import assert from 'node:assert/strict';
import test from 'node:test';
import { mintSurfId, readSurfName, withSurfId, withSurfName } from './surfId.js';

const ID = mintSurfId({ now: new Date('2026-10-18T02:50:00.001Z'), rand: 'aa01' });
const BODY = 'return Manifold.cube([10, 10, 10], true);\n';

test('readSurfName returns null when the header is missing', () => {
  assert.equal(readSurfName(BODY), null);
  assert.equal(readSurfName(withSurfId(BODY, ID)), null);
  assert.equal(readSurfName('// @name   \n' + BODY), null);
});

test('withSurfName / readSurfName keep spaces and unicode', () => {
  const spaced = withSurfName(withSurfId(BODY, ID), 'Kettle Lid');
  assert.equal(spaced, `// @surf-id ${ID}\n// @name Kettle Lid\n${BODY}`);
  assert.equal(readSurfName(spaced), 'Kettle Lid');

  const unicode = withSurfName(spaced, 'ブラケット Café');
  assert.equal(readSurfName(unicode), 'ブラケット Café');
  assert.ok(unicode.startsWith(`// @surf-id ${ID}\n// @name ブラケット Café\n`));
  assert.ok(unicode.endsWith(BODY));
});

test('withSurfName inserts under @surf-id and replaces an existing name', () => {
  const named = withSurfName(BODY, 'Bracket');
  assert.equal(named, `// @name Bracket\n${BODY}`);
  assert.equal(readSurfName(named), 'Bracket');
  assert.equal(readSurfName(withSurfName(named, 'Housing')), 'Housing');
});

test('withSurfName throws on a blank name', () => {
  assert.throws(() => withSurfName(BODY, '   '), /Bad surf name/);
  assert.throws(() => withSurfName(BODY, ''), /Bad surf name/);
});
