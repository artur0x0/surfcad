import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HELPERS_NEED_BODY,
  composeHelperInsert,
  newPartStarterScript,
  starterCubeScript,
} from './helperPaletteSnippets.js';
import { describeHelperRefusal } from '../agent/helperPaletteAgent.js';
import { HELPER_PALETTE_ITEMS } from './helperPaletteSnippets.js';

/** Bike acceptance PR 3: no seed cube. */

test('a new part starts empty; the old cube is a test fixture', () => {
  assert.equal(newPartStarterScript(), '');
  assert.match(starterCubeScript(), /Manifold\.cube\(\[20, 20, 20\], true\)/);
  assert.match(starterCubeScript(), /cube begin/);
});

test('a Block on an empty part is the first solid, with no hidden seed', () => {
  const script = composeHelperInsert('', 'cylinder', null, { radius: 10, height: 30 });
  assert.match(script, /let part = /);
  assert.doesNotMatch(script, /Manifold\.cube/);
  assert.doesNotMatch(script, /width = 40/);
  const cube = composeHelperInsert('', 'cube', null, { width: 5, depth: 5, height: 5 });
  assert.equal((cube.match(/Manifold\.cube/g) || []).length, 1, 'one cube, the one asked for');
});

test('a helper that needs a body is refused on an empty part instead of seeding one', () => {
  for (const id of ['hole', 'filletEdges', 'array3D', 'move', 'shell', 'mirror', 'cut', 'boolean']) {
    assert.ok(HELPERS_NEED_BODY.has(id), id);
    assert.equal(composeHelperInsert('', id, null, {}), null, id);
    assert.equal(composeHelperInsert('// only a comment\n', id, null, {}), null, `${id} on a comment-only part`);
  }
  for (const id of ['cube', 'cylinder', 'sphere', 'roundedBox', 'tube', 'hexPrism']) {
    assert.ok(!HELPERS_NEED_BODY.has(id), id);
  }
});

test('the refusal says to add a Block or Shape first', () => {
  const item = HELPER_PALETTE_ITEMS.find((row) => row.id === 'hole');
  const message = describeHelperRefusal(item, { params: {}, buffer: '' });
  assert.match(message, /needs a body/i);
  assert.match(message, /Block/);
  assert.match(message, /Shape/);
  const withBody = describeHelperRefusal(item, { params: {}, buffer: starterCubeScript() });
  assert.doesNotMatch(withBody, /needs a body/i);
});

test('helpers still work on a part that has a body', () => {
  const script = composeHelperInsert(starterCubeScript(), 'array3D', null, { body: 'part', nx: 2, ny: 1, nz: 1, sx: 30, sy: 0, sz: 0 });
  assert.match(script, /array3D\(part/);
});
