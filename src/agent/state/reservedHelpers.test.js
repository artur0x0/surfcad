import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RESERVED_HELPER_NAMES, explainReservedHelperError } from './reservedHelpers.js';

test('reserved helper names match HELPER_FUNCTIONS', () => {
  const src = readFileSync(new URL('../../lib/surfcad/runtime.js', import.meta.url), 'utf8');
  const start = src.indexOf('const HELPER_FUNCTIONS = {');
  assert.ok(start > 0);
  const end = src.indexOf('\n};', start);
  const block = src.slice(start, end);
  const names = [...block.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*(?:,|:)/gm)].map((match) => match[1]);
  assert.deepEqual([...names].sort(), [...RESERVED_HELPER_NAMES].sort());
});

test('explainReservedHelperError names the helper and leaves other errors', () => {
  assert.equal(
    explainReservedHelperError("Identifier 'cut' has already been declared"),
    '`cut` is a reserved SurfCAD helper name; rename your variable',
  );
  assert.equal(
    explainReservedHelperError("SyntaxError: Identifier 'move' has already been declared"),
    '`move` is a reserved SurfCAD helper name; rename your variable',
  );
  const own = "Identifier 'width' has already been declared";
  assert.equal(explainReservedHelperError(own), own);
  assert.equal(explainReservedHelperError('subtract failed'), 'subtract failed');
});
