/**
 * Fillet mode, box-corner picks: a pick where three edges meet at a vertex
 * used to be refused as a Y/T junction. On straight right-angle edges between
 * flat faces Accept now writes the planar kernel with spherical corners, the
 * card previews one wedge per edge, and the kernel rounds every such vertex.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from './partSolidCache.js';
import { edgeNamesForPicks, stampedFaceTable } from './faceIdentity.js';
import { buildFeatureEdges } from './selectEdge.js';
import {
  buildFilletBlendPreview,
  composeFilletCommit,
  validateFilletAccept,
} from './filletMode.js';
import {
  boxCornerRadiusMax,
  detectBoxCornerPick,
  FILLET_BOX_CORNER_FLAT,
  FILLET_BOX_CORNER_STRAIGHT,
} from './filletBoxCorners.js';
import { FILLET_SWEEP_BRANCH } from './filletAlongPath.js';

const BOX = `// --- cube begin id=seed ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
`;
const R = 5;
// Rounded box: inner box + faces + quarter cylinders + one sphere.
const ROUNDED = 30 * 20 * 10 + 2 * R * (600 + 200 + 300) + Math.PI * R * R * (30 + 20 + 10) + (4 / 3) * Math.PI * R ** 3;

async function pickOf(source) {
  const ran = await runScript(`${source}return part;\n`);
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  const table = stampedFaceTable(geometry, faceIDs);
  const edges = edgeNamesForPicks(table, buildFeatureEdges(geometry));
  return { ran, geometry, table, edges };
}

function cornerFaces(mesh) {
  const { geometry, faceIDs } = buildSolidGeometry(mesh);
  return stampedFaceTable(geometry, faceIDs).faces.filter((f) => f.role === 'corner');
}

test('the twelve edges of a box are a box-corner pick: planar kernel, spherical corners, names', async () => {
  const { geometry, edges } = await pickOf(BOX);
  assert.equal(edges.length, 12);
  assert.deepEqual(detectBoxCornerPick(edges, { geometry }), { ok: true, junctions: 8 });

  const gate = validateFilletAccept(edges, { strategy: 'sweep', radius: R, geometry });
  assert.equal(gate.ok, true, gate.message);
  assert.equal(gate.boxCorners, 8);
  assert.equal(gate.normalized.strategy, 'planar');
  assert.equal(gate.normalized.sphericalCorners, true);
  assert.equal(gate.normalized.radius, R);

  const commit = composeFilletCommit(`${BOX}return part;\n`, {
    edges,
    params: { strategy: 'sweep', radius: R },
    geometry,
  });
  assert.equal(commit.ok, true, commit.message);
  assert.equal(commit.kernel, 'planar-box-corners');
  // Every pair, by name, in pick order.
  assert.match(commit.buffer, /const selEdges = edgesNamed\(part, (?:"seed\.[a-z]+~seed\.[a-z]+"(?:, )?){12}\);/);
  assert.match(commit.buffer, /part = filletEdges\(part, selEdges, 5, \{ sphericalCorners: true \}\); \/\/ box corners/);
  assert.doesNotMatch(commit.buffer, /makeSweepPath|filletAlongPath|_mids/);

  const ran = await runScript(commit.buffer);
  assert.equal(ran.status, 'NoError', ran.status);
  assert.ok(Math.abs(ran.volume - ROUNDED) < 2, `volume ${ran.volume} vs ${ROUNDED}`);
  const corners = cornerFaces(ran.mesh);
  assert.equal(corners.length, 8, corners.map((f) => f.name).join(' '));
  assert.ok(corners.every((f) => /^fillet\d*\.corner\[[0-7]\]$/.test(f.name)), corners.map((f) => f.name).join(' '));
});

test('three edges at one vertex round that corner; four verticals stay a sweep', async () => {
  const { geometry, edges } = await pickOf(BOX);
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-6;
  const V = [20, 15, 10];
  const three = edges.filter((e) => near(e.va, V) || near(e.vb, V));
  assert.equal(three.length, 3);
  assert.deepEqual(detectBoxCornerPick(three, { geometry }), { ok: true, junctions: 1 });
  const commit = composeFilletCommit(`${BOX}return part;\n`, { edges: three, params: { strategy: 'sweep', radius: 4 }, geometry });
  assert.equal(commit.ok, true, commit.message);
  const ran = await runScript(commit.buffer);
  assert.equal(ran.status, 'NoError', ran.status);
  assert.equal(cornerFaces(ran.mesh).length, 1);

  const vertical = edges.filter((e) => Math.abs(e.tangent[2]) > 0.99);
  assert.equal(vertical.length, 4);
  assert.equal(detectBoxCornerPick(vertical, { geometry }), null, 'no junction: not a box-corner pick');
  const sweep = composeFilletCommit(`${BOX}return part;\n`, { edges: vertical, params: { strategy: 'sweep', radius: 2 }, geometry });
  assert.equal(sweep.ok, true, sweep.message);
  assert.equal(sweep.kernel, 'sweep-dihedral');
  assert.match(sweep.buffer, /filletAlongPath/);
});

test('the preview paints one wedge per edge and the radius is clamped under the planar size guard', async () => {
  const { geometry, edges } = await pickOf(BOX);
  const preview = buildFilletBlendPreview(edges, { strategy: 'sweep', radius: R, geometry });
  assert.equal(preview.ok, true, preview.message);
  assert.equal(preview.boxCorners, 8);
  assert.equal(preview.strategy, 'planar');
  assert.equal(preview.componentCount, 1, 'one fillet, not twelve independent ones');
  assert.equal(preview.components.length, 12);
  assert.ok(preview.components.every((c) => c.ok && (c.rings?.length || 0) >= 2));
  assert.equal(preview.polylines.length, 12);

  // 0.45 of the shortest edge (20 mm): a 20 mm request becomes 9 mm.
  assert.ok(Math.abs(boxCornerRadiusMax(edges) - 9) < 1e-3);
  const big = validateFilletAccept(edges, { strategy: 'sweep', radius: 20, geometry });
  assert.equal(big.ok, true);
  assert.ok(Math.abs(big.normalized.radius - 9) < 1e-3, `radius ${big.normalized.radius}`);
  const bigPreview = buildFilletBlendPreview(edges, { strategy: 'sweep', radius: 20, geometry });
  assert.ok(Math.abs(bigPreview.radius - 9) < 1e-3, 'preview == commit');
});

test('a junction that is not a box corner is still refused, with a reason', async () => {
  const { geometry, edges } = await pickOf(BOX);
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-6;
  const three = edges.filter((e) => near(e.va, [20, 15, 10]) || near(e.vb, [20, 15, 10]));
  // One edge of the junction is not a right angle.
  const tilted = three.map((e, i) => (i === 0 ? { ...e, n0: [0, 0, 1], n1: [0, Math.sin(1), Math.cos(1)] } : e));
  assert.deepEqual(detectBoxCornerPick(tilted), { ok: false, message: FILLET_BOX_CORNER_STRAIGHT });
  const gate = validateFilletAccept(tilted, { strategy: 'sweep', radius: 2 });
  assert.equal(gate.ok, false);
  assert.equal(gate.message, FILLET_BOX_CORNER_STRAIGHT);
  // A real junction on a curved wall: a half-buried cylinder on the box top.
  // At (10, 15, 10) the top~back line, the top~cylinder line and the first
  // segment of the cylinder's cap rim meet. The rim row is not a right-angle
  // flat edge, so the pick is refused with a reason, not routed.
  const boss = `${BOX}// --- cylinder begin id=boss ---
part = part.add(Manifold.cylinder(30, 10, 10, 64, true).rotate([90, 0, 0]).translate([0, 0, 10]));
// --- cylinder end ---
`;
  const bossPick = await pickOf(boss);
  const at = bossPick.edges.filter((e) => near(e.va, [10, 15, 10]) || near(e.vb, [10, 15, 10]));
  assert.equal(at.length, 3, at.map((e) => e.edgeName).join(' '));
  assert.ok(at.some((e) => e.edgeName && e.edgeName.startsWith('boss.')), 'the cylinder is part of the junction');
  const verdict = detectBoxCornerPick(at, { geometry: bossPick.geometry });
  assert.ok(verdict && verdict.ok === false, JSON.stringify(verdict));
  assert.ok([FILLET_BOX_CORNER_FLAT, FILLET_BOX_CORNER_STRAIGHT].includes(verdict.message));
  const refused = composeFilletCommit(`${boss}return part;\n`, { edges: at, params: { strategy: 'sweep', radius: 2 }, geometry: bossPick.geometry });
  assert.equal(refused.ok, false);
  assert.equal(refused.message, verdict.message);
  // Chamfer picks never take this route.
  const chamfer = validateFilletAccept(three, { strategy: 'sweep', radius: 2, profile: 'chamfer', geometry });
  assert.equal(chamfer.ok, false);
  assert.equal(chamfer.message, FILLET_SWEEP_BRANCH);
});
