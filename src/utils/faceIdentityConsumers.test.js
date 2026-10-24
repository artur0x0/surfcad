/**
 * Face identity, part 2: consumers switch to names. A pick that carries a
 * stamped name is written into the script by that name (facesNamed for a
 * hole, edgesOf for a fillet or chamfer), edgesOf returns only the edges
 * around the named face, select_faces / select_edges resolve names, and
 * list_faces filters by name, feature and role.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from './partSolidCache.js';
import { facesForName, resolveEdgeNames, resolveFaceNames, stampedFaceTable } from './faceIdentity.js';
import { classifySelectedFace, emitFaceEdgeLines, emitFaceWorkplaneLines } from './faceFeaturePlacement.js';
import { buildFeatureEdges } from './selectEdge.js';
import { checkFaceFilter, filterFaces } from '../agent/state/listFilters.js';
import { buildEdgeList, buildFaceList } from '../agent/state/listPickables.js';
import { agentFaceCatalog } from '../agent/faceCatalog.js';
import { fingerprintsFromGeometry } from './facePaint.js';

const uniq = (names, base) => {
  let n = base;
  let i = 1;
  while (names.has(n)) n = `${base}${i++}`;
  names.add(n);
  return n;
};

// A plate with a boss on it: the top of the plate and the top of the boss
// both face +Z, which is what fooled the normal filter (bug M3).
const PLATE_BOSS = `// --- cube begin id=plate ---
let part = Manifold.cube([80, 44, 8], true);
// --- cube end id=plate ---
// --- cube begin id=boss ---
part = part.add(Manifold.cube([20, 12, 10], true).translate([20, 0, 9]));
// --- cube end id=boss ---
`;

async function built(source) {
  const ran = await runScript(`${source}return part;\n`);
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  return { ran, geometry, faceIDs, table: stampedFaceTable(geometry, faceIDs) };
}

test('a named pick is composed by name: facesNamed for the workplane, edgesOf for the edges', () => {
  const face = classifySelectedFace({
    center: [20, 0, 14], normal: [0, 0, 1], area: 240, triangleCount: 2, indices: [3, 7], name: 'boss.top', feature: 'boss', role: 'top',
  });
  assert.equal(face.name, 'boss.top');
  const names = new Set(['part']);
  const wp = emitFaceWorkplaneLines('part', face, names, uniq);
  const code = wp.lines.join('\n');
  assert.match(code, /facesNamed\(part, "boss\.top"\)/);
  assert.doesNotMatch(code, /facesByNormal/);
  assert.match(code, new RegExp(`const ${wp.frVar} = workplaneFromFace\\(part, ${wp.faceVar}\\)`));

  const edges = emitFaceEdgeLines('part', face, {}, new Set(['part']), uniq);
  assert.match(edges.lines.join('\n'), /edgesOf\(part, "boss\.top"\)/);
  assert.doesNotMatch(edges.lines.join('\n'), /convexEdges/);

  // An unnamed pick keeps the old path unchanged.
  const plain = classifySelectedFace({ center: [20, 0, 14], normal: [0, 0, 1], area: 240, triangleCount: 2 });
  assert.equal(plain.name, undefined);
  assert.match(emitFaceWorkplaneLines('part', plain, new Set(['part']), uniq).lines.join('\n'), /facesByNormal/);
  assert.match(emitFaceEdgeLines('part', plain, {}, new Set(['part']), uniq).lines.join('\n'), /convexEdges\(part\)\.filter/);
});

test('edgesOf takes the edges around one face; the normal filter took every up-facing edge on the body', async () => {
  const ran = await runScript(`${PLATE_BOSS}
const byName = edgesOf(part, 'boss.top');
const byNormal = convexEdges(part).filter((e) => {
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const ok = (nn) => nn && dot(nn, [0, 0, 1]) > 0.95;
  return ok(e.n0) || ok(e.n1);
});
if (byName.length !== 4) throw new Error('boss top edges ' + byName.length);
if (byName.skipped !== 0) throw new Error('skipped ' + byName.skipped);
if (byNormal.length <= byName.length) throw new Error('normal filter ' + byNormal.length);
// The plate top is concave where the boss stands on it only along the seam,
// which is a seam between two faces, not an edge of plate.top's own loop.
const plateTop = edgesOf(part, 'plate.top');
if (plateTop.length !== 4) throw new Error('plate top edges ' + plateTop.length + ' skipped ' + plateTop.skipped);
let threw = '';
try { edgesOf(part, 'nope.top'); } catch (err) { threw = err.message; }
if (!/no face named 'nope.top'/.test(threw)) throw new Error('missing name did not throw: ' + threw);
part = chamferEdges(part, byName, 2);
return part;
`);
  assert.equal(ran.status, 'NoError');
  // Only the boss top was chamfered: four 2 mm chamfers along 20 + 20 + 12 + 12 mm.
  const removed = 80 * 44 * 8 + 20 * 12 * 10 - ran.volume;
  const expect = 0.5 * 2 * 2 * (20 + 20 + 12 + 12);
  assert.ok(Math.abs(removed - expect) < expect * 0.15, `removed ${removed} expected about ${expect}`);
});

test('edgesOf skips concave edges and says so', async () => {
  const ran = await runScript(`// --- cube begin id=base ---
let part = Manifold.cube([40, 40, 10], true);
// --- cube end id=base ---
// --- cube begin id=notch ---
part = part.subtract(Manifold.cube([10, 50, 6], true).translate([0, 0, 5]));
// --- cube end id=notch ---
// The notch floor: two convex edges where the slot runs out of the base,
// two concave ones against the slot walls.
const all = edgesOf(part, 'notch.bottom', { includeConcave: true });
const convexOnly = edgesOf(part, 'notch.bottom');
if (all.length !== 4) throw new Error('floor edges ' + all.length);
if (convexOnly.length !== 2 || convexOnly.skipped !== 2) throw new Error('convex ' + convexOnly.length + ' skipped ' + convexOnly.skipped);
if (!convexOnly.every((e) => e.convex)) throw new Error('a concave edge got through');
// A face with only concave edges is a loud skip, not a silent empty list.
// --- cube begin id=pocket ---
part = part.subtract(Manifold.cube([8, 8, 6], true).translate([12, 12, 5]));
// --- cube end id=pocket ---
let msg = '';
try { edgesOf(part, 'pocket.bottom'); } catch (err) { msg = err.message; }
if (!/no convex feature edge around 'pocket[.]bottom' \\(4 concave edges skipped/.test(msg)) throw new Error('expected a loud skip: ' + msg);
return part;
`);
  assert.equal(ran.status, 'NoError');
});

test('select_faces by name picks the stamped face itself; unknown names list what exists', async () => {
  const { table } = await built(PLATE_BOSS);
  const one = resolveFaceNames(table, ['boss.top']);
  assert.ok(!one.error, JSON.stringify(one.error));
  assert.equal(one.picks.length, 1);
  assert.deepEqual(one.names, ['boss.top']);
  assert.ok(Math.abs(one.picks[0].center[2] - 14) < 1e-6 && one.picks[0].indices.length >= 2);
  assert.equal(one.picks[0].name, 'boss.top');

  // The boss bottom is buried in the plate, so the boss has five faces left.
  const glob = resolveFaceNames(table, ['boss.*']);
  assert.equal(glob.picks.length, 5);

  const miss = resolveFaceNames(table, ['boss.lid']);
  assert.equal(miss.error.code, 'unknown_face');
  assert.match(miss.error.message, /boss\.top/);

  // A split label without its [k] takes every piece.
  const { table: split } = await built('let part = Manifold.cube([40, 20, 10], true).subtract(Manifold.cube([4, 30, 30], true));\n');
  assert.equal(facesForName(split, 'cube@1.top').length, 2);
  assert.equal(resolveFaceNames(split, ['cube@1.top']).picks.length, 2);
});

test('select_faces by name takes a rounded box top without its band (bug M5)', async () => {
  const { geometry, faceIDs, table } = await built(`// --- roundedBox begin id=boss ---
let part = roundedBox([80, 44, 16], 6, 8);
// --- roundedBox end id=boss ---
`);
  const catalog = agentFaceCatalog(geometry, faceIDs);
  const topPatch = catalog.find((row) => row.name === 'boss.top');
  assert.ok(topPatch, 'the top is named');
  const byName = resolveFaceNames(table, ['boss.top']);
  assert.equal(byName.picks.length, 1);
  const pick = byName.picks[0];
  assert.ok(Math.abs(pick.normal[2] - 1) < 1e-9, 'the named pick is flat');
  // The named pick is the flat only; a graph patch that merged the band would be larger.
  assert.ok(Math.abs(pick.area - (80 - 12) * (44 - 12)) < 1e-6, `area ${pick.area}`);
  assert.ok(pick.indices.length <= topPatch.tris.length);
});

test('select_edges by name resolves to the feature-edge segments between two named faces', async () => {
  const { geometry, table } = await built(PLATE_BOSS);
  const raw = buildFeatureEdges(geometry);
  const hit = resolveEdgeNames(table, raw, ['boss.top~boss.right']);
  assert.ok(!hit.error, JSON.stringify(hit.error));
  assert.ok(hit.edges.length >= 1);
  // Names come back canonical: the two faces in name order.
  assert.deepEqual(hit.names, ['boss.right~boss.top']);
  for (const e of hit.edges) assert.ok(Math.abs(e.mid[2] - 14) < 1e-6 && Math.abs(e.mid[0] - 30) < 1e-6, JSON.stringify(e.mid));
  const flipped = resolveEdgeNames(table, raw, ['boss.right~boss.top']);
  assert.equal(flipped.edges.length, hit.edges.length);
  const seam = resolveEdgeNames(table, raw, ['plate.top~boss.*']);
  assert.ok(!seam.error && seam.edges.length >= 4, JSON.stringify(seam.error || seam.edges.length));
  const miss = resolveEdgeNames(table, raw, ['boss.top~plate.bottom']);
  assert.equal(miss.error.code, 'unknown_edge');
});

test('list_faces filters by name, feature and role; list_edges rows carry the face names', async () => {
  const { geometry, faceIDs, table } = await built(PLATE_BOSS);
  const { faces } = buildFaceList(agentFaceCatalog(geometry, faceIDs));
  assert.equal(checkFaceFilter({ feature: 'boss' }), null);
  assert.equal(checkFaceFilter({ role: '' })?.code, 'bad_args');
  assert.equal(filterFaces(faces, { feature: 'boss' }).length, 5, 'the boss bottom is buried in the plate');
  assert.deepEqual(filterFaces(faces, { role: 'top' }).map((r) => r.name).sort(), ['boss.top', 'plate.top']);
  assert.deepEqual(filterFaces(faces, { name: 'plate.*' }).length, 6);
  assert.equal(filterFaces(faces, { feature: 'boss', kind: 'planar', normalWithin: { n: [0, 0, 1], deg: 5 } }).length, 1);

  const fingerprints = fingerprintsFromGeometry(geometry, faceIDs);
  const { edges } = buildEdgeList(buildFeatureEdges(geometry), fingerprints, table);
  const named = edges.filter((e) => e.name);
  assert.ok(named.length > 0);
  assert.ok(named.some((e) => e.name === 'boss.top~boss.right' || e.name === 'boss.right~boss.top'), named.map((e) => e.name).slice(0, 10).join(','));
  assert.ok(named.every((e) => e.faceNameA && e.faceNameB && e.name === [e.faceNameA, e.faceNameB].sort().join('~')));
});
