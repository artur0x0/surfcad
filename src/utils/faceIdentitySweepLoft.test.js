/**
 * Face identity, part 3: sweep and loft record their faces. A swept
 * profile has cap0 / cap1 on the path's end planes and one wall per logical
 * profile edge; a parallel loft has cap0 / cap1 and span[i][j] per bottom
 * edge i and station span j. Pieces stay whole on the warped meshes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from './partSolidCache.js';
import { stampedFaceTable } from './faceIdentity.js';

const PLANE = "const pl = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };";

async function tableOf(source) {
  const ran = await runScript(source);
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  return { ran, table: stampedFaceTable(geometry, faceIDs) };
}
const names = (table) => table.faces.map((f) => f.name).sort();

test('sweepPoints: caps on the path ends, one wall per profile edge, the path on the record', async () => {
  const { table } = await tableOf(`${PLANE}
// --- contour-mode sweep begin id=rail ---
const c1 = makeCrossSection(pl, profileRectangle(6, 4));
let part = sweepPoints(new CrossSection(c1.contours), [[0, 0, 0], [20, 0, 5], [40, 10, 10]], { closed: false, initialNormal: [1, 0, 0] });
// --- contour-mode sweep end id=rail ---
return part;`);
  assert.deepEqual(names(table), ['rail.cap0', 'rail.cap1', 'rail.wall[0]', 'rail.wall[1]', 'rail.wall[2]', 'rail.wall[3]'], 'each cap and wall is one piece');
  const cap0 = table.byName.get('rail.cap0');
  assert.ok(Math.abs(cap0.center[0]) < 1e-6 && Math.abs(cap0.center[2]) < 1e-6, `cap0 at the path start, got ${cap0.center}`);
  const cap1 = table.byName.get('rail.cap1');
  assert.ok(Math.abs(cap1.center[0] - 40) < 1e-6 && Math.abs(cap1.center[1] - 10) < 1e-6, `cap1 at the path end, got ${cap1.center}`);
  assert.equal(cap0.record.kind, 'plane');
  const wall = table.byName.get('rail.wall[0]');
  assert.equal(wall.record.kind, 'swept');
  assert.deepEqual(wall.record.path, [[0, 0, 0], [20, 0, 5], [40, 10, 10]]);
  assert.ok(Array.isArray(wall.record.profileEdge) && wall.record.profileEdge.length === 4);
});

test('a circle profile sweeps to one wall; a plain sweep() without points has no path on the record', async () => {
  const { table } = await tableOf(`${PLANE}
const c1 = makeCrossSection(pl, profileCircle(3, 24));
let part = sweepPoints(new CrossSection(c1.contours), [[0, 0, 0], [20, 0, 5], [40, 10, 10]], { closed: false });
return part;`);
  assert.deepEqual(names(table), ['sweep@1.cap0', 'sweep@1.cap1', 'sweep@1.wall[0]']);
  const wall = table.byName.get('sweep@1.wall[0]');
  assert.equal(wall.record.kind, 'swept');
  assert.ok(wall.record.profileCircle && Math.abs(wall.record.profileCircle.radius - 3) < 1e-6);
});

test('makeLoft: cap0, cap1 and span[i][j] per bottom edge and station span, whole on the warped mesh', async () => {
  const { table } = await tableOf(`${PLANE}
// --- contour-mode loft begin id=neck ---
const a = makeCrossSection(pl, profileRectangle(40, 20));
const b = makeCrossSection(pl, profileRectangle(30, 30));
const c = makeCrossSection(pl, profileCircle(6, 32));
let part = makeLoft([a, { ...b, plane: offsetPlaneFrame(b.plane, 15) }, { ...c, plane: offsetPlaneFrame(c.plane, 30) }]);
// --- contour-mode loft end id=neck ---
return part;`);
  const got = names(table);
  const spans = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) spans.push(`neck.span[${i}][${j}]`);
  assert.deepEqual(got, ['neck.cap0', 'neck.cap1', ...spans].sort(), got.join(','));
  const cap1 = table.byName.get('neck.cap1');
  assert.ok(Math.abs(cap1.center[2] - 30) < 1e-6 && Math.abs(cap1.normal[2] - 1) < 1e-6, JSON.stringify(cap1.center));
  assert.ok(Math.abs(cap1.area - Math.PI * 36) < Math.PI * 36 * 0.03, `top cap area ${cap1.area}`);
  const span = table.byName.get('neck.span[0][0]');
  assert.equal(span.record.kind, 'lofted');
  assert.deepEqual(span.record.stations, [0, 15, 30]);
  assert.ok(span.center[2] > 0 && span.center[2] < 15, 'the first span sits between the first two stations');
});

test('facesNamed finds a loft cap and a sweep wall in the kernel', async () => {
  const ran = await runScript(`${PLANE}
// --- contour-mode loft begin id=neck ---
const a = makeCrossSection(pl, profileRectangle(40, 20));
const c = makeCrossSection(pl, profileCircle(6, 32));
let part = makeLoft([a, { ...c, plane: offsetPlaneFrame(c.plane, 30) }]);
// --- contour-mode loft end id=neck ---
const top = facesNamed(part, 'neck.cap1');
if (top.length !== 1 || Math.abs(top[0].normal[2] - 1) > 1e-6) throw new Error('cap1 ' + JSON.stringify(top.map((f) => f.normal)));
const wp = workplaneFromFace(part, top[0]);
part = hole(part, wp, 0, 0, 3, 10);
const walls = facesNamed(part, 'neck.span[*]');
if (walls.length !== 4) throw new Error('spans ' + walls.length);
return part;`);
  assert.equal(ran.status, 'NoError');
});
