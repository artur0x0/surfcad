/**
 * Session repro for the filleted, shelled, flanged box (Shell_Fillet_Test).
 *
 * A 1° draft at the end of the tree used to solve two copies of one wall —
 * normals a fraction of a degree apart, one hinged on the fillet tangency and
 * one on the neutral plane — as two planes. The least-squares step ran away
 * along the wall. pull -z / reference max blew the bbox from the flange
 * (±43.35 × ±46.05) out to about ±47.1 × ±49.8. pull +z took the volume from
 * about 35803 to 36221.
 *
 * The flange here is a 9 mm frame, 3.175 mm tall, sitting on the open top.
 * It only shares the rim edge, so it stays its own body; the draft still sees
 * one mesh and one reference, which is the case that blew out.
 *
 * pull -z, reference max. The neutral plane is the bottom, z = -18.75. The
 * frame has no fillet under it, so it hinges there. Its top is at
 * z = 21.925, and it flares by tan(1°) × 40.675 mm. That is the bbox. It is
 * not the undrafted ±43.35 × ±46.05, and it is not the blown-out ±47.1 × ±49.8.
 *
 * pull +z, reference max. The neutral plane is the frame's top. Both walls of
 * the frame slide outward by the same δ(z) = tan(1°) × (zTop - z), so the δ²
 * terms cancel and the frame's cross-section grows by δ × (outer perimeter −
 * inner perimeter) = δ × 72 mm. Integrated over the 3.175 mm height that is
 * 72 × tan(1°) × 3.175² / 2.
 *
 * The shell is a rounded-rectangle tube: vertical fillets r = 4, wall 1.85.
 * The straight runs are the same length on the outside and the inside, so
 * they cancel, and the perimeter difference is the corner arcs, 2π × 1.85.
 * The vertical wall runs from the bottom-fillet tangency (z = -14.75) to the
 * open top (z = 18.75), hinged at the frame top. The spherical corners and
 * the fillet below that tangency sit outside this prism; they are about 4 mm³.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';

const TAN = Math.tan(Math.PI / 180);
const BOX_X = 68.7;
const BOX_Y = 74.1;
const BOX_Z = 37.5;
const LIP = 9;
const LIP_H = 3.175;
const WALL = 1.85;
const R = 4;

const HX = BOX_X / 2;
const HY = BOX_Y / 2;
const Z_BOT = -BOX_Z / 2;
const Z_TOP = BOX_Z / 2;
const Z_LIP = Z_TOP + LIP_H;
const Z_TANG = Z_BOT + R;
const FX = HX + LIP;
const FY = HY + LIP;

const PERIM_GAP = 2 * ((BOX_X + 2 * LIP) + (BOX_Y + 2 * LIP) - BOX_X - BOX_Y);
const SHELL_GAP = 2 * Math.PI * WALL;

function wedge(zHi, zLo, zHinge) {
  const uHi = Math.abs(zHi - zHinge);
  const uLo = Math.abs(zLo - zHinge);
  return (TAN / 2) * Math.abs(uHi * uHi - uLo * uLo);
}

const SRC = `
// --- cube begin id=cube1 ---
let box1 = Manifold.cube([${BOX_X}, 74.10000000000001, ${BOX_Z}], true);
let part = box1;
// --- cube end id=cube1 ---
// --- fillet-mode begin id=fillet1 ---
const selEdges = edgesNamed(part, "cube1.back~cube1.right", "cube1.back~cube1.bottom", "cube1.bottom~cube1.right", "cube1.bottom~cube1.left", "cube1.bottom~cube1.front", "cube1.front~cube1.left", "cube1.back~cube1.left", "cube1.front~cube1.right");
part = filletEdges(part, selEdges, ${R}, { sphericalCorners: true });
// --- fillet-mode end id=fillet1 ---
const filleted = part;
part = hollow(part, ${WALL}, { center: [0.0003, -0.0003, ${Z_TOP}], normal: [0, 0, 1] });
const outer = [[${-FX}, ${-FY}], [${FX}, ${-FY}], [${FX}, ${FY}], [${-FX}, ${FY}]];
const opening = [[${HX}, ${-HY}], [${HX}, ${HY}], [${-HX}, ${HY}], [${-HX}, ${-HY}]];
const frame = makeExtrude([outer, opening], ${LIP_H}).translate([0, 0, ${Z_TOP}]);
const flanged = part.add(frame);
const bbOf = (solid) => {
  const bb = solid.boundingBox();
  return { vol: solid.volume(), bodies: solid.decompose().length, genus: solid.genus(), min: bb.min, max: bb.max };
};
const down = draftFaces(flanged, 'sides', 1, { pull: '-z', reference: 'max' });
const up = draftFaces(flanged, 'sides', 1, { pull: 'z', reference: 'max' });
const mid = hollow(
  draftFaces(filleted, 'sides', 1, { pull: 'z', reference: 'max' }),
  ${WALL},
  { center: [0.0003, -0.0003, ${Z_TOP}], normal: [0, 0, 1] },
);
globalThis.__note = { pre: bbOf(flanged), down: bbOf(down), up: bbOf(up), mid: bbOf(mid) };
return flanged;
`;

test('a drafted flange stays on the frame and the volume follows the draft', { timeout: 180_000 }, async () => {
  const ran = await runScript(SRC);
  assert.equal(ran.status, 'NoError', ran.status);
  const n = globalThis.__note;

  const flareDown = TAN * (Z_LIP - Z_BOT);
  assert.ok(Math.abs(n.down.max[0] - (FX + flareDown)) < 0.03, `maxX ${n.down.max[0]} want ${FX + flareDown}`);
  assert.ok(Math.abs(n.down.max[1] - (FY + flareDown)) < 0.03, `maxY ${n.down.max[1]} want ${FY + flareDown}`);
  assert.ok(Math.abs(n.down.min[0] + FX + flareDown) < 0.03, `minX ${n.down.min[0]}`);
  assert.ok(Math.abs(n.down.min[1] + FY + flareDown) < 0.03, `minY ${n.down.min[1]}`);
  assert.ok(n.down.max[0] < 45 && n.down.max[1] < 48, `blowout ${n.down.max[0]} x ${n.down.max[1]}`);
  assert.ok(Math.abs(n.down.min[2] - Z_BOT) < 0.02 && Math.abs(n.down.max[2] - Z_LIP) < 0.02);
  assert.equal(n.down.genus, 0);
  assert.equal(n.down.bodies, 2);

  const flareUp = TAN * LIP_H;
  assert.ok(Math.abs(n.up.max[0] - (FX + flareUp)) < 0.03, `+z maxX ${n.up.max[0]} want ${FX + flareUp}`);
  assert.ok(Math.abs(n.up.max[1] - (FY + flareUp)) < 0.03, `+z maxY ${n.up.max[1]} want ${FY + flareUp}`);
  const lipUp = PERIM_GAP * wedge(Z_LIP, Z_TOP, Z_LIP);
  const shellUp = SHELL_GAP * wedge(Z_TOP, Z_TANG, Z_LIP);
  const wantUp = n.pre.vol + lipUp + shellUp;
  assert.ok(Math.abs(n.up.vol - wantUp) < 8, `vol ${n.up.vol} want ${wantUp} (pre ${n.pre.vol}, lip ${lipUp}, shell ${shellUp})`);
  assert.ok(Math.abs(n.up.vol - 36221) > 100, `vol ${n.up.vol} fell back to the blown-out 36221`);
  assert.equal(n.up.genus, 0);

  assert.equal(n.mid.bodies, 1, `draft between fillet and shell split into ${n.mid.bodies}`);
  assert.equal(n.mid.genus, 0);
});
