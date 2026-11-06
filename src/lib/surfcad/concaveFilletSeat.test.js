/**
 * A concave fillet on a tessellated curve, and the blend that follows it.
 *
 * 1. The filler of a concave run stood proud of a faceted wall. The sweep
 *    path is resampled onto the fitted arc, and a true circle through the
 *    vertices of a 64-facet post is up to 9.6 µm outside its facets. The
 *    filler's leg rode out with the knot and ended at the tangency in a flat
 *    ledge a few microns wide: a ring of 159 real 88° convex edges. The next
 *    no-selection blend took them from convexEdges() and failed: filletEdges
 *    threw "edge is concave" (its ball probe reads a micron step as flat).
 *    `_s23SeatConcaveKnots` now offsets a concave run into its walls by the
 *    amount it was proud, as one smooth offset, so the run stays one tube.
 *
 * 2. chamferEdges counted a zero-volume speck of seam dust as a body, so the
 *    last cutter of a closed rim "split the solid into 2 bodies". Dust is
 *    dropped and not counted; a piece with volume is still a split.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';

/** A disc base with a post standing on it, one body. */
const POST = (seg) => `// --- cylinder begin id=cylinder1 ---
let cyl1 = Manifold.cylinder(8, 30, 30, ${seg});
let part = cyl1;
// --- cylinder end id=cylinder1 ---
// --- cylinder begin id=cylinder2 ---
let cyl2 = Manifold.cylinder(40, 8, 8, ${seg}).translate([0, 0, 4]);
part = part.add(cyl2);
// --- cylinder end id=cylinder2 ---`;

/** The concave fillet at the foot of the post, as fillet mode writes it. */
const FOOT = (r) => `// --- fillet-mode begin id=fillet1 ---
const selEdges = edgesNamed(part, "cylinder1.top~cylinder2.side");
const path = makeSweepPath(selEdges);
part = filletAlongPath(part, path, ${r});
globalThis.__seat = globalThis.__filletVariableProfileMeta;
// --- fillet-mode end id=fillet1 ---`;

/** What the no-selection fillet and chamfer write. */
const DEFAULT_FILLET = (r) => `// --- fillet-mode begin id=fillet2 ---
part = filletEdges(part, convexEdges(part), ${r}, { sphericalCorners: true });
// --- fillet-mode end id=fillet2 ---`;
const DEFAULT_CHAMFER = (c) => `// --- chamfer-mode begin id=chamfer1 ---
part = chamferEdges(part, convexEdges(part), ${c});
// --- chamfer-mode end id=chamfer1 ---`;

/**
 * Edge counts, and the area of upward faces at height z within radius rMax:
 * the ledge, when there is one.
 */
const MEASURE = (z, rMax) => `
{
  const mesh = part.getMesh(); const np = mesh.numProp || 3; const V = mesh.vertProperties; const T = mesh.triVerts;
  const P = (i) => [V[i * np], V[i * np + 1], V[i * np + 2]];
  let ledgeArea = 0; let ledgeTris = 0;
  for (let t = 0; t < T.length / 3; t++) {
    const A = P(T[t * 3]); const B = P(T[t * 3 + 1]); const C = P(T[t * 3 + 2]);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]; const w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    if (!(l > 0)) continue;
    const zc = (A[2] + B[2] + C[2]) / 3; const rc = Math.hypot((A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3);
    if (n[2] / l > 0.99 && Math.abs(zc - ${z}) < 0.01 && rc < ${rMax}) { ledgeArea += l / 2; ledgeTris += 1; }
  }
  globalThis.__note = {
    convex: convexEdges(part).length,
    concave: concaveEdges(part).length,
    ledgeArea, ledgeTris,
    bodies: part.decompose().length,
    genus: part.genus(),
    volume: part.volume(),
  };
}`;

async function run(source) {
  globalThis.__note = null;
  globalThis.__seat = null;
  const ran = await runScript(`${source}\nreturn part;\n`);
  assert.equal(ran.status, 'NoError', `${ran.status}: ${String(ran.error || ran.message || '').slice(0, 200)}`);
  return { ran, note: globalThis.__note, seat: globalThis.__seat };
}

/** The error of the block that failed, or '' when every block ran. */
function skipped(ran) {
  const skip = ran.featureSkip;
  if (!skip) return '';
  return String(skip.error || skip.message || skip.reason || JSON.stringify(skip));
}

for (const seg of [32, 64, 96]) {
  test(`a concave fillet at the foot of a ${seg}-facet post leaves no ledge and no stray edges`, { timeout: 300_000 }, async () => {
    const before = await run(`${POST(seg)}${MEASURE(10, 8.5)}`);
    // Three convex rims and the one concave crease.
    assert.equal(before.note.convex, 3 * seg);
    assert.equal(before.note.concave, seg);

    const after = await run(`${POST(seg)}\n${FOOT(2)}${MEASURE(10, 8.5)}`);
    assert.equal(skipped(after.ran), '', 'the concave fillet runs');
    // The same three rims, nothing else: no ring of micro-edges at the tangency.
    assert.equal(after.note.convex, 3 * seg, `convex edges ${after.note.convex}`);
    assert.equal(after.note.concave, 0, `concave edges ${after.note.concave}`);
    assert.equal(after.note.ledgeTris, 0, `${after.note.ledgeTris} upward triangles at the tangency, ${after.note.ledgeArea} mm²`);
    assert.equal(after.note.bodies, 1);
    assert.equal(after.note.genus, 0);

    // The run was proud by the facet sag, moved by that much, and is still one tube.
    const sag = 8 * (1 - Math.cos(Math.PI / seg));
    assert.ok(after.seat, 'variable-profile meta');
    assert.ok(after.seat.seatedKnots > 0, `seated ${after.seat.seatedKnots}`);
    assert.ok(Math.abs(after.seat.seatMaxMm - sag) < 0.05 * sag + 1e-4, `seat ${after.seat.seatMaxMm} vs sag ${sag}`);
    assert.equal(after.seat.concaveRuns, 1);
    assert.equal(after.seat.runCount, 1, 'one tube: the offset keeps the path smooth');

    // The fill itself: a quarter spandrel revolved about the post (Pappus).
    // It sits on the circle inside the facets, so it is under the ideal by
    // roughly a third of the sag over the fillet height (0.8% at 96 facets,
    // 1.7% at 64, 3.8% at 32), and never over it by more than the arc error.
    const r = 2;
    const spandrel = (1 - Math.PI / 4) * r * r;
    const centroid = (r * (10 - 3 * Math.PI)) / (3 * (4 - Math.PI));
    const expected = spandrel * 2 * Math.PI * (8 + centroid);
    const added = after.note.volume - before.note.volume;
    assert.ok(added < 1.005 * expected && added > 0.95 * expected, `added ${added.toFixed(3)} expected ${expected.toFixed(3)}`);
  });
}

test('after that concave fillet the no-selection fillet and chamfer run, and remove what they remove on the plain post', { timeout: 300_000 }, async () => {
  const seg = 64;
  const plain = await run(`${POST(seg)}${MEASURE(10, 8.5)}`);
  const footed = await run(`${POST(seg)}\n${FOOT(2)}${MEASURE(10, 8.5)}`);

  const filletPlain = await run(`${POST(seg)}\n${DEFAULT_FILLET(1)}${MEASURE(10, 8.5)}`);
  const filletFooted = await run(`${POST(seg)}\n${FOOT(2)}\n${DEFAULT_FILLET(1)}${MEASURE(10, 8.5)}`);
  assert.equal(skipped(filletFooted.ran), '', 'filletEdges(part, convexEdges(part)) runs after a concave fillet');
  assert.equal(filletFooted.note.bodies, 1);
  assert.equal(filletFooted.note.genus, 0);
  const removedPlain = plain.note.volume - filletPlain.note.volume;
  const removedFooted = footed.note.volume - filletFooted.note.volume;
  assert.ok(removedPlain > 50, `plain post: removed ${removedPlain}`);
  assert.ok(Math.abs(removedFooted - removedPlain) < 0.05, `fillet removed ${removedFooted.toFixed(3)} after the foot, ${removedPlain.toFixed(3)} on the plain post`);

  const chamferPlain = await run(`${POST(seg)}\n${DEFAULT_CHAMFER(1)}${MEASURE(10, 8.5)}`);
  const chamferFooted = await run(`${POST(seg)}\n${FOOT(2)}\n${DEFAULT_CHAMFER(1)}${MEASURE(10, 8.5)}`);
  assert.equal(skipped(chamferFooted.ran), '', 'chamferEdges(part, convexEdges(part)) runs after a concave fillet');
  assert.equal(chamferFooted.note.bodies, 1, 'seam dust is not a body of the result');
  const cutPlain = plain.note.volume - chamferPlain.note.volume;
  const cutFooted = footed.note.volume - chamferFooted.note.volume;
  assert.ok(cutPlain > 100, `plain post: chamfer removed ${cutPlain}`);
  assert.ok(Math.abs(cutFooted - cutPlain) < 0.05, `chamfer removed ${cutFooted.toFixed(3)} after the foot, ${cutPlain.toFixed(3)} on the plain post`);
});

test('shell, then the concave fillet, then the no-selection fillet: one body at every step', { timeout: 300_000 }, async () => {
  const SHELL = `// --- shell begin id=shell1 ---
part = hollow(part, 1.5, '-z');
// --- shell end id=shell1 ---`;
  const shelled = await run(`${POST(64)}\n${SHELL}${MEASURE(10, 8.5)}`);
  assert.equal(shelled.note.bodies, 1);
  const footed = await run(`${POST(64)}\n${SHELL}\n${FOOT(2)}${MEASURE(10, 8.5)}`);
  assert.equal(skipped(footed.ran), '');
  assert.equal(footed.note.bodies, 1);
  assert.equal(footed.note.ledgeTris, 0);
  const rounded = await run(`${POST(64)}\n${SHELL}\n${FOOT(2)}\n${DEFAULT_FILLET(0.5)}${MEASURE(10, 8.5)}`);
  assert.equal(skipped(rounded.ran), '', 'the no-selection fillet runs on the shelled, footed part');
  assert.equal(rounded.note.bodies, 1);
  assert.ok(rounded.note.volume < footed.note.volume, 'it removed material');
});

test('a run that already lies on its crease is not moved: a straight root edge between two planes', { timeout: 300_000 }, async () => {
  // The boss root of concaveFilletEnds.test.js (B6). Both walls are planes
  // and the path is the mesh edge itself, so no knot is proud of anything.
  const BOSS = `
let part = Manifold.cube([14, 20, 5], true);
part = part.add(Manifold.cube([10, 6, 10], true).translate([0, 0, 7.5]));
`;
  const ROOT = `
{
  const cc = concaveEdges(part).filter((e) => Math.abs(e.va[1] + 3) < 1e-6 && Math.abs(e.vb[1] + 3) < 1e-6
    && Math.abs(e.va[2] - 2.5) < 1e-6 && Math.abs(e.vb[2] - 2.5) < 1e-6 && Math.abs(e.va[0] - e.vb[0]) > 5);
  if (cc.length !== 1) throw new Error('front root edge: ' + cc.length);
  part = filletAlongPath(part, makeSweepPath(cc), 2.5, { variableProfile: true });
  globalThis.__seat = globalThis.__filletVariableProfileMeta;
}
`;
  const base = await run(`${BOSS}${MEASURE(0, 0)}`);
  const filled = await run(`${BOSS}${ROOT}${MEASURE(0, 0)}`);
  assert.ok(filled.seat, 'variable-profile meta');
  assert.equal(filled.seat.concaveRuns, 1);
  assert.equal(filled.seat.seatedKnots, 0, 'nothing proud, nothing moved');
  assert.equal(filled.seat.seatMaxMm, 0);
  const added = filled.note.volume - base.note.volume;
  const expected = (1 - Math.PI / 4) * 2.5 * 2.5 * 10;
  assert.ok(Math.abs(added - expected) < 0.02 * expected, `added ${added.toFixed(3)} expected ${expected.toFixed(3)}`);
});

test('a bore floor: the wall curves the other way, the run seats by less than the sag, and no ledge appears', { timeout: 300_000 }, async () => {
  // A blind bore. The crease between its wall and its floor is concave, and
  // the wall curves toward the air. The fitted circle (r 9.9907) is in the
  // hole by 9.2 µm at every facet corner, so this run needs its seat too.
  // Measured against the neighbouring facet's plane it would read 22 µm.
  const BORE = `
let part = Manifold.cylinder(20, 20, 20, 64);
part = part.subtract(Manifold.cylinder(15, 10, 10, 64).translate([0, 0, 5]));
`;
  const FLOOR = `
{
  const cc = concaveEdges(part).filter((e) => Math.abs(e.va[2] - 5) < 1e-6 && Math.abs(e.vb[2] - 5) < 1e-6);
  if (cc.length !== 64) throw new Error('bore floor crease: ' + cc.length);
  part = filletAlongPath(part, makeSweepPath(cc), 2);
  globalThis.__seat = globalThis.__filletVariableProfileMeta;
}
`;
  const before = await run(`${BORE}${MEASURE(7, 10.5)}`);
  const after = await run(`${BORE}${FLOOR}${MEASURE(7, 10.5)}`);
  assert.equal(after.note.convex, before.note.convex, `convex edges ${before.note.convex} -> ${after.note.convex}`);
  assert.equal(after.note.concave, 0);
  assert.equal(after.note.ledgeTris, 0);
  assert.equal(after.note.bodies, 1);
  const sag = 10 * (1 - Math.cos(Math.PI / 64));
  assert.ok(after.seat.seatMaxMm > 1e-3 && after.seat.seatMaxMm <= sag + 1e-6, `seat ${after.seat.seatMaxMm} sag ${sag}`);
  const follow = await run(`${BORE}${FLOOR}\n${DEFAULT_FILLET(1)}${MEASURE(7, 10.5)}`);
  assert.equal(skipped(follow.ran), '', 'the no-selection fillet runs after the bore floor fillet');
  assert.equal(follow.note.bodies, 1);
});

test('a rim-face chamfer on a shelled cup runs: the specks its cutters leave are seam dust, not bodies', { timeout: 300_000 }, async () => {
  // Playtest case D. A 2 mm wall, the rim face picked (inner and outer rim,
  // 128 edges). Six of the cuts leave a speck of 1e-11 mm³ or less, and
  // every leg size used to be refused as "split the solid into 2 bodies".
  const CUP = `// --- cylinder begin id=cylinder1 ---
let cyl1 = Manifold.cylinder(30, 20, 20, 64);
let part = cyl1;
// --- cylinder end id=cylinder1 ---
// --- shell begin id=shell1 ---
part = hollow(part, 2, 'z');
// --- shell end id=shell1 ---`;
  const RIM = (c) => `// --- chamfer-mode begin id=chamfer1 ---
const faceEdges = edgesOf(part, "cylinder1.top");
part = chamferEdges(part, faceEdges, ${c});
// --- chamfer-mode end id=chamfer1 ---`;
  const cup = await run(`${CUP}${MEASURE(0, 0)}`);
  const cut = await run(`${CUP}\n${RIM(0.8)}${MEASURE(0, 0)}`);
  assert.equal(skipped(cut.ran), '', 'the rim chamfer runs');
  assert.equal(cut.note.bodies, 1, 'the dust is dropped, not returned as a body');
  // Two rims, an equal-leg triangle each: 0.5 c² around r 20 and r 18.
  const expected = 0.5 * 0.8 * 0.8 * 2 * Math.PI * (20 + 18);
  const removed = cup.note.volume - cut.note.volume;
  assert.ok(Math.abs(removed - expected) < 0.03 * expected, `removed ${removed.toFixed(3)} expected ${expected.toFixed(3)}`);
});

test('a chamfer that really cuts the solid in two still throws', { timeout: 300_000 }, async () => {
  // Two blocks joined by a 1 x 1 neck. A 2 mm chamfer on one edge of the
  // neck takes the whole neck: two bodies with volume, a real split.
  const DUMBBELL = `
let part = Manifold.cube([10, 10, 10], true).translate([-10, 0, 0]);
part = part.add(Manifold.cube([10, 10, 10], true).translate([10, 0, 0]));
part = part.add(Manifold.cube([12, 1, 1], true));
`;
  const NECK = (c) => `// --- chamfer-mode begin id=chamfer1 ---
{
  const neck = convexEdges(part).filter((e) => Math.abs(e.va[1] - 0.5) < 1e-6 && Math.abs(e.vb[1] - 0.5) < 1e-6
    && Math.abs(e.va[2] - 0.5) < 1e-6 && Math.abs(e.vb[2] - 0.5) < 1e-6 && Math.abs(e.va[0] - e.vb[0]) > 5);
  if (neck.length !== 1) throw new Error('neck edge: ' + neck.length);
  part = chamferEdges(part, neck, ${c});
}
// --- chamfer-mode end id=chamfer1 ---`;
  const whole = await run(`${DUMBBELL}${MEASURE(0, 0)}`);
  assert.equal(whole.note.bodies, 1);
  const cut = await run(`${DUMBBELL}\n${NECK(2)}${MEASURE(0, 0)}`);
  assert.match(skipped(cut.ran), /chamferEdges: edge 0 split the solid into 2 bodies \(was 1\)/);
  assert.ok(Math.abs(cut.note.volume - whole.note.volume) < 1e-6, 'the part stays as it was');
  // A leg the neck can carry is an ordinary chamfer.
  const ok = await run(`${DUMBBELL}\n${NECK(0.3)}${MEASURE(0, 0)}`);
  assert.equal(skipped(ok.ran), '');
  assert.equal(ok.note.bodies, 1);
});

test('a post under a sphere: the fillet follows the crease as one run, and the seat costs it little', { timeout: 300_000 }, async () => {
  // The crease is cut by a boolean, so it wobbles (31 µm in z) and its
  // chords are uneven. Three things went wrong on it:
  //   - the loop was fitted through first / middle / last, the circle
  //     tilted 4.4°, and the filler was built up to 0.5 mm off the crease;
  //   - a seat along per-knot normals kinked the path past the 5° run gate
  //     (the facets under the crease point every way): 20 tubes;
  //   - a seat of 18 µm in a fill 95 µm thick halved the fillet.
  const TIP = `// --- cylinder begin id=cylinder1 ---
let cyl1 = Manifold.cylinder(40, 6, 6, 64);
let part = cyl1;
// --- cylinder end id=cylinder1 ---
// --- sphere begin id=sphere1 ---
let sphere1 = Manifold.sphere(9, 64).translate([0, 0, 44]);
part = part.add(sphere1);
// --- sphere end id=sphere1 ---`;
  const NECK_FILLET = `// --- fillet-mode begin id=fillet1 ---
const selEdges = edgesNamed(part, "cylinder1.side~sphere1.surface");
part = filletAlongPath(part, makeSweepPath(selEdges), 1);
globalThis.__seat = globalThis.__filletVariableProfileMeta;
// --- fillet-mode end id=fillet1 ---`;
  const before = await run(`${TIP}${MEASURE(0, 0)}`);
  const after = await run(`${TIP}\n${NECK_FILLET}${MEASURE(0, 0)}`);
  assert.equal(skipped(after.ran), '', 'the concave fillet runs');
  assert.equal(after.note.bodies, 1);
  assert.equal(after.seat.runCount, 1, 'one tube around the crease');
  // The fill: walls at an empty-side angle θ, area r²(cot(θ/2) − (π − θ)/2),
  // swept around the post. The sphere's normal at the crease leans 48.2°
  // off the post's, so θ is 131.8° and the fill is a thin crescent.
  const theta = Math.PI - Math.acos(6 / 9);
  const area = 1 / Math.tan(theta / 2) - (Math.PI - theta) / 2;
  const ideal = area * 2 * Math.PI * 6.1;
  const added = after.note.volume - before.note.volume;
  assert.ok(added > 0.75 * ideal && added < 1.15 * ideal, `added ${added.toFixed(3)} ideal ${ideal.toFixed(3)}`);
  // The seat is bounded by a tenth of the crescent's thickness at the crease.
  const thickness = 1 / Math.sin(theta / 2) - 1;
  assert.ok(after.seat.seatMaxMm <= 0.1 * thickness + 1e-9, `seat ${after.seat.seatMaxMm} thickness ${thickness}`);
});
