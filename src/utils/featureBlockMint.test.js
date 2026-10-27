/**
 * Every block a snippet or a mode writes carries `id=` on its markers, so the
 * names stamped on its faces (`cube1.top`) do not move when a block is
 * inserted ahead of it. Blocks with no id (hand-written, older scripts)
 * still parse and keep their positional id.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mintBlockIds, existingBlockIds } from './featureBlockMint.js';
import { hasFeatureBlock, lastFeatureBlock, markerWithId } from './featureBlockId.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { composeHelperInsert, insertBlockAtCaret, CUBE_BEGIN, CUBE_END, FILLET_MODE_BEGIN, FILLET_MODE_END } from './helperPaletteSnippets.js';
import { composeMoveCommit, stripMoveBlock, parseLastMove } from './moveMode.js';
import { hasFilletModeBlock, filletModeOwnedRegion, stripFilletModeBlock } from './filletMode.js';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from './partSolidCache.js';
import { stampedFaceTable } from './faceIdentity.js';

const CUBE = { width: 20, depth: 20, height: 20, center: true };

test('mintBlockIds names every bare pair, skips ids already written, and leaves Code blocks alone', () => {
  const buffer = '// --- cube begin id=cube1 ---\nlet box1 = Manifold.cube([1, 1, 1]);\n// --- cube end id=cube1 ---\n';
  const snippet = [
    '// --- cube begin ---', 'let box2 = Manifold.cube([2, 2, 2]);', '// --- cube end ---',
    '// --- fillet-mode begin id=rim ---', 'part = filletEdges(part, convexEdges(part), 1);', '// --- fillet-mode end id=rim ---',
    '// --- code begin ---', 'part = part.scale(2);', '// --- code end ---',
  ].join('\n');
  const out = mintBlockIds(snippet, buffer);
  assert.match(out, /^\/\/ --- cube begin id=cube2 ---\n/);
  assert.match(out, /\n\/\/ --- cube end id=cube2 ---\n/);
  assert.match(out, /fillet-mode begin id=rim ---\n[^\n]+\n\/\/ --- fillet-mode end id=rim ---/);
  assert.match(out, /\n\/\/ --- code begin ---\n[^\n]+\n\/\/ --- code end ---$/);
  assert.deepEqual([...existingBlockIds(buffer + out)].sort(), ['cube1', 'cube2', 'rim']);
  assert.equal(mintBlockIds('return part;\n', buffer), 'return part;\n', 'no markers: unchanged');
});

test('composeHelperInsert mints cube1, cube2, … and parseFeatureMarkers reads them back', () => {
  const one = composeHelperInsert('', 'cube', null, CUBE);
  assert.match(one, /\/\/ --- cube begin id=cube1 ---/);
  assert.match(one, /\/\/ --- cube end id=cube1 ---/);
  const two = composeHelperInsert(one, 'cube', null, { ...CUBE, width: 5 });
  assert.deepEqual(parseFeatureMarkers(two).map((f) => f.id), ['cube1', 'cube2']);
  assert.equal(hasFeatureBlock(two, CUBE_BEGIN, CUBE_END), true);
  const last = lastFeatureBlock(two, CUBE_BEGIN, CUBE_END);
  assert.equal(last.id, 'cube2');
  assert.equal(two.slice(last.start, last.end), last.text);
  assert.equal(two.slice(last.endMarkerStart, last.end), '// --- cube end id=cube2 ---');
  // A hand-written block with no id keeps its positional id.
  const mixed = `${two}// --- cube begin ---\nlet box9 = Manifold.cube([1, 1, 1]);\n// --- cube end ---\n`;
  assert.deepEqual(parseFeatureMarkers(mixed).map((f) => f.id), ['cube1', 'cube2', 'cube-2']);
});

test('a block inserted ahead of a minted block does not rename it or its stamped faces (the h5 failure)', async () => {
  const seed = composeHelperInsert('', 'cube', null, { width: 40, depth: 30, height: 20, center: true });
  const idsBefore = parseFeatureMarkers(seed).map((f) => f.id);
  assert.deepEqual(idsBefore, ['cube1']);
  // Insert a second cube at the top of the script, before cube1.
  const early = mintBlockIds([CUBE_BEGIN, 'let box0 = Manifold.cube([10, 10, 10], true).translate([100, 0, 0]);', 'part = part.add(box0);', CUBE_END].join('\n'), seed);
  assert.match(early, /id=cube2/);
  const script = insertBlockAtCaret(seed, early, seed.indexOf('return part;'));
  assert.deepEqual(parseFeatureMarkers(script).map((f) => f.id), ['cube1', 'cube2']);

  const ran = await runScript(script);
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  const names = (stampedFaceTable(geometry, faceIDs)?.faces || []).map((f) => f.name).sort();
  assert.ok(names.includes('cube1.top') && names.includes('cube2.top'), names.join(' '));
  // The name written against cube1 still resolves after the insert.
  const named = await runScript(`${script.replace('return part;', '')}const top = facesNamed(part, "cube1.top");\nreturn part;\n`);
  assert.equal(named.status, 'NoError', JSON.stringify(named.errors || named.status));
});

test('mode composers mint an id and their strip / owned-region helpers find the id-carrying block', () => {
  const base = composeHelperInsert('', 'cube', null, CUBE);
  const moved = composeMoveCommit(base, { body: 'part', target: { at: [0, 0, 10] }, dx: 1, dy: 2, dz: 3 });
  assert.equal(moved.ok, true, moved.message);
  assert.match(moved.buffer, /\/\/ --- move begin id=move1 ---\npart = move\(/);
  assert.match(moved.buffer, /\/\/ --- move end id=move1 ---/);
  assert.ok(parseLastMove(moved.buffer), 'parseLastMove reads the id-carrying block');
  assert.equal(stripMoveBlock(moved.buffer).includes('move('), false);
  // A replace keeps the same id: the stripped block frees move1.
  const again = composeMoveCommit(moved.buffer, { body: 'part', target: { at: [0, 0, 10] }, dx: 4, dy: 5, dz: 6 });
  assert.equal(again.ok, true, again.message);
  assert.equal((again.buffer.match(/move begin id=move1/g) || []).length, 1);
  assert.equal((again.buffer.match(/\bmove\(/g) || []).length, 1);

  const fil = `${base.replace('return part;', '')}${markerWithId(FILLET_MODE_BEGIN, 'fillet1')}\npart = filletEdges(part, convexEdges(part), 1);\n${markerWithId(FILLET_MODE_END, 'fillet1')}\nreturn part;\n`;
  assert.equal(hasFilletModeBlock(fil), true);
  assert.match(filletModeOwnedRegion(fil), /^\/\/ --- fillet-mode begin id=fillet1 ---\n.*\n\/\/ --- fillet-mode end id=fillet1 ---$/s);
  assert.equal(stripFilletModeBlock(fil).includes('filletEdges'), false);
});
