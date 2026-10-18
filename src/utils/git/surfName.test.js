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

test('withSurfName replaces a blank @name line instead of duplicating it', () => {
  const blank = `// @surf-id ${ID}\n// @name   \n${BODY}`;
  const next = withSurfName(blank, 'Bracket');
  assert.equal(next, `// @surf-id ${ID}\n// @name Bracket\n${BODY}`);
  assert.equal((next.match(/\/\/ @name/g) || []).length, 1);
  assert.equal(readSurfName(next), 'Bracket');
});

test('withSurfId flag-off stacks an invalid header and keeps extra line text (bytes match main)', () => {
  const invalid = `// @surf-id bogus extra\n${BODY}`;
  const next = withSurfId(invalid, ID);
  assert.equal(next, `// @surf-id ${ID}\n${invalid}`);
  assert.equal(next.includes('bogus extra'), true);

  const crlf = withSurfId('// @surf-id not-an-id keep me\r\nreturn 1;\r\n', ID);
  assert.equal(crlf, `// @surf-id ${ID}\n// @surf-id not-an-id keep me\r\nreturn 1;\r\n`);
});

test('withSurfId flag-off stacks a bare // @surf-id line (bytes match main)', () => {
  const next = withSurfId(`// @surf-id\n${BODY}`, ID);
  assert.equal(next, `// @surf-id ${ID}\n// @surf-id\n${BODY}`);

  const eof = withSurfId('// @surf-id', ID);
  assert.equal(eof, `// @surf-id ${ID}\n// @surf-id`);

  const crlf = withSurfId('// @surf-id\r\nreturn 1;\r\n', ID);
  assert.equal(crlf, `// @surf-id ${ID}\n// @surf-id\r\nreturn 1;\r\n`);
});

test('withSurfId keeps a valid header byte-identical except the id', () => {
  const other = mintSurfId({ now: new Date('2026-10-18T02:50:00.002Z'), rand: 'aa02' });
  const spaced = `// @surf-id ${ID}  \r\n${BODY}`;
  assert.equal(withSurfId(spaced, ID), spaced);
  assert.equal(withSurfId(spaced, other), `// @surf-id ${other}  \r\n${BODY}`);
});

test('withSurfName does not insert above an invalid @surf-id line', () => {
  const bogus = `// @surf-id bogus\n${BODY}`;
  const next = withSurfName(bogus, 'Bracket');
  assert.equal(next, `// @surf-id bogus\n// @name Bracket\n${BODY}`);
  assert.ok(next.startsWith('// @surf-id bogus\n'));
  assert.equal(readSurfName(next), 'Bracket');
});

test('withSurfName splits CR-only and CR-LF bogus @surf-id headers', () => {
  const cr = withSurfName('// @surf-id bogus\rbody\r', 'Bracket');
  assert.equal(cr, '// @surf-id bogus\r// @name Bracket\rbody\r');
  assert.equal(readSurfName(cr), 'Bracket');

  const crlf = withSurfName('// @surf-id bogus\r\nbody\r\n', 'Bracket');
  assert.equal(crlf, '// @surf-id bogus\r\n// @name Bracket\r\nbody\r\n');
  assert.equal(readSurfName(crlf), 'Bracket');
});

test('withSurfName preserves CRLF and strips line separators', () => {
  const crlf = `// @surf-id ${ID}\r\n${BODY.replace('\n', '\r\n')}`;
  const named = withSurfName(crlf, 'Kettle Lid');
  assert.equal(named, `// @surf-id ${ID}\r\n// @name Kettle Lid\r\n${BODY.replace('\n', '\r\n')}`);
  assert.equal(readSurfName(named), 'Kettle Lid');
  const sep = withSurfName(BODY, `A\u2028B\u2029C`);
  assert.equal(readSurfName(sep), 'A B C');
  const tabbed = withSurfName(BODY, 'A\tB');
  assert.equal(readSurfName(tabbed), 'A B');
});

test('withSurfName throws on a blank name', () => {
  assert.throws(() => withSurfName(BODY, '   '), /Bad surf name/);
  assert.throws(() => withSurfName(BODY, ''), /Bad surf name/);
  assert.throws(() => withSurfName(BODY, '\t\t'), /Bad surf name/);
});
