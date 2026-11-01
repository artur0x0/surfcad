/**
 * `extrude1.wall[0]~extrude1.wall[1]` used to lose the right-hand index:
 * the trailing `[1]` was read as a chain ordinal, so the lookup asked for
 * `extrude1.wall` and reported "no edge between extrude1.wall[0] and extrude1.wall".
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchEdgeName } from './namedEdges.js';
import { runScript } from './index.js';

function edge(name, base, ordinal, chains, faces) {
  return { name, base, ordinal, chains, faces };
}

test('a wall[i]~wall[j] name keeps both indexes', () => {
  const edges = [
    edge('extrude1.wall[0]~extrude1.wall[1]', 'extrude1.wall[0]~extrude1.wall[1]', 0, 1, ['extrude1.wall[0]', 'extrude1.wall[1]']),
    edge('extrude1.wall[0]~extrude1.wall[3]', 'extrude1.wall[0]~extrude1.wall[3]', 0, 1, ['extrude1.wall[0]', 'extrude1.wall[3]']),
  ];
  const hit = matchEdgeName(edges, 'extrude1.wall[0]~extrude1.wall[1]');
  assert.equal(hit.error, undefined);
  assert.equal(hit.hits.length, 1);
  assert.equal(hit.hits[0].name, 'extrude1.wall[0]~extrude1.wall[1]');
  const flipped = matchEdgeName(edges, 'extrude1.wall[1]~extrude1.wall[0]');
  assert.equal(flipped.hits[0].base, 'extrude1.wall[0]~extrude1.wall[1]');
});

test('a chain ordinal on faces that have no index still selects that chain', () => {
  const edges = [
    edge('plate.front~plate.top[0]', 'plate.front~plate.top', 0, 2, ['plate.front', 'plate.top']),
    edge('plate.front~plate.top[1]', 'plate.front~plate.top', 1, 2, ['plate.front', 'plate.top']),
  ];
  const one = matchEdgeName(edges, 'plate.top~plate.front[1]');
  assert.equal(one.hits.length, 1);
  assert.equal(one.hits[0].ordinal, 1);
  const missing = matchEdgeName(edges, 'plate.top~plate.front[2]');
  assert.equal(missing.error, 'ordinal');
  assert.match(missing.message, /has 2 chains/);
});

test('edgesNamed resolves an extrude wall corner', async () => {
  const ran = await runScript(`// --- contour-mode extrude begin id=extrude1 ---
const pl = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const c1 = makeCrossSection(pl, profileRectangle(50, 40));
let part = makeExtrude(c1.contours, 5);
// --- contour-mode extrude end id=extrude1 ---
const names = faceNames(part);
const sel = edgesNamed(part, 'extrude1.wall[0]~extrude1.wall[1]');
globalThis.__note = { names, segs: sel.length, edgeName: sel.names && sel.names[0] };
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  const n = globalThis.__note;
  assert.ok(n.names.includes('extrude1.wall[0]'), n.names.join(', '));
  assert.ok(n.names.includes('extrude1.wall[1]'), n.names.join(', '));
  assert.ok(n.segs >= 1, `segments ${n.segs}`);
});
