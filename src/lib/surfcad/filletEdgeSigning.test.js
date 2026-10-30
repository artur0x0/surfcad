/**
 * Two robustness fixes found while raising the fillet arc density, both
 * latent at any density:
 *
 * 1. The sweep-path endpoint weld (0.05 mm) swallowed a real edge shorter
 *    than itself and turned a closed rim into junctions. It now stays under
 *    half the shortest edge of the set.
 * 2. signedFeatureEdges signed a concave crease from a sliver triangle that
 *    Manifold had wound against its own face (a fold pair on a planar face
 *    bounded by a dense arc), and the next fillet cut instead of filled. A
 *    fold pair's shared edge is no feature edge, and a sliver takes the
 *    normal of the largest coplanar neighbour.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';
import { assembleSweepPathSet } from '../../utils/edgeSweepPath.js';

test('the endpoint weld never swallows an edge shorter than the weld tolerance', () => {
  // A square rim whose corners carry a 0.02 mm first chord (as a dense
  // fillet arc leaves): 8 edges, one closed loop, no junction.
  const P = [[0, 0, 0], [10, 0, 0], [10.02, 0.01, 0], [10.03, 10, 0], [10.01, 10.02, 0], [0, 10.03, 0], [-0.02, 10.01, 0], [-0.03, 0.02, 0]];
  const edges = P.map((va, i) => ({ a: i, b: (i + 1) % P.length, va, vb: P[(i + 1) % P.length] }));
  const set = assembleSweepPathSet(edges, { smoothCorners: false, thinPath: false });
  assert.equal(set.ok, true, set.message);
  assert.equal(set.components.length, 1, 'one loop');
  assert.equal(set.value.closed, true, 'closed');
  assert.equal(set.value.edgeCount, 8);
});

test('a concave crease next to a folded sliver still reads concave, and the concave fillet fills', { timeout: 300_000 }, async () => {
  // The concave playtest's shape with the first fillet at 96 steps per
  // quarter: a hollow after the dense fillet leaves fold pairs on the inner
  // walls. Both inner creases on the +x wall must be concave.
  const ran = await runScript(`let part = Manifold.cube([40, 30, 20], true);
const e = convexEdges(part).filter((e) => Math.hypot(e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]) > 30)[0];
part = filletAlongPath(part, makeSweepPath([e]), 4, { segments: 96 });
part = hollow(part, 2.5, [{ center: [0, -15, 0], normal: [0, -1, 0] }, { center: [-20, 0, 0], normal: [-1, 0, 0] }, { center: [0, 0, -10], normal: [0, 0, -1] }]);
// The two inner creases of the +x wall: with the ceiling (z = 7.5) and with
// the back wall (y = 12.5). The wall's open rims are convex and stay so.
const onLine = (e, axis, v) => Math.abs(e.va[0] - 17.5) < 1e-3 && Math.abs(e.vb[0] - 17.5) < 1e-3
  && Math.abs(e.va[axis] - v) < 1e-3 && Math.abs(e.vb[axis] - v) < 1e-3;
const onCrease = (e) => onLine(e, 2, 7.5) || onLine(e, 1, 12.5);
const long = (list) => list.filter((e) => Math.hypot(e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]) > 10).length;
globalThis.__note = { concaveLong: long(concaveEdges(part).filter(onCrease)), convexOnCrease: convexEdges(part).filter(onCrease).length };
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  assert.ok(globalThis.__note.concaveLong >= 2, `concave long creases ${globalThis.__note.concaveLong}`);
  assert.equal(globalThis.__note.convexOnCrease, 0, 'no convex edge on either inner crease');
});
