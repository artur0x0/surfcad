#!/usr/bin/env node
/**
 * Artur's bracket script (fixtures/artur_bend_fillet_0913.js).
 *
 * c1 is a base through-cut. c2 is a wall notch on the flange, from z=12.96
 * up, six millimetres past the bend tangent at z=6.985. selEdges is a 3.27
 * fillet on one base corner. selEdges2–4 are the other base corners and
 * selEdges5–8 are the notch corners, each
 * filletAlongPath(..., 2.54, { variableProfile: true }).
 *
 * None of those edges is the bend's outer corner. Each path is the sheet
 * thickness (3.175 mm) and stays that long: the next edges are perpendicular
 * to it, so the sheet span does not walk them onto the bend. Seven are
 * concave hole corners (material added) and selEdges8 is the convex step
 * (material removed). The flange/bend crease is the same face afterwards.
 * A ray through the bend is one empty-to-solid transition. The drawn mesh
 * has no tangency needle.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filletWedgeArea } from '../../src/utils/filletAlongPath.js';
import { countDegenerateTriangles } from '../../src/utils/filletEdgeClass.js';
import { runScript } from '../../src/lib/surfcad/index.js';
import { buildSolidGeometry } from '../../src/utils/partSolidCache.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'artur_bend_fillet_0913.js');
const fixture = readFileSync(fixturePath, 'utf8');
const THICK = 3.175;

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const filletLines = [...fixture.matchAll(/^part = filletAlongPath\([^;]+;/gm)];
check('eight fillets in the fixture', filletLines.length === 8, String(filletLines.length));

const head = fixture.slice(0, filletLines[0].index);
const radii = [3.27, 2.54, 2.54, 2.54, 2.54, 2.54, 2.54, 2.54];
const adds = [true, true, true, true, true, true, true, false];
const names = ['selEdges 3.27', 'selEdges2', 'selEdges3', 'selEdges4', 'selEdges5', 'selEdges6', 'selEdges7', 'selEdges8'];

let prefix = head;
const bare = await runScript(`${prefix}\nglobalThis.__vol = part.volume();\nreturn part;\n`);
check('cuts run', bare.status === 'NoError' && !bare.featureSkip, bare.status || bare.error || '');
let prevVol = globalThis.__vol;
for (let i = 0; i < filletLines.length; i++) {
  prefix = fixture.slice(0, filletLines[i].index + filletLines[i][0].length);
  const run = await runScript(`${prefix}\nglobalThis.__vol = part.volume();\nreturn part;\n`);
  check(`${names[i]} runs`, run.status === 'NoError' && !run.featureSkip, run.status || run.error || '');
  const vol = globalThis.__vol;
  const delta = vol - prevVol;
  const expect = filletWedgeArea(radii[i]) * THICK * (adds[i] ? 1 : -1);
  const ratio = delta / expect;
  check(
    `${names[i]} ${adds[i] ? 'adds' : 'removes'} ${delta.toFixed(2)} vs section×thickness ${expect.toFixed(2)}`,
    ratio > 0.8 && ratio < 1.2,
    `ratio ${ratio.toFixed(3)}`,
  );
  prevVol = vol;
}

const probe = `
const probe = (c, s) => Manifold.intersection(part, Manifold.cube(s, true).translate(c)).volume();
function ray(x, deg) {
  const a = deg * Math.PI / 180;
  const N = [0, Math.cos(a), -Math.sin(a)];
  const P = [x, 30 + 6.985 * Math.cos(a), 6.985 - 6.985 * Math.sin(a)];
  const B = [0, -N[1], -N[2]];
  let prev = -1, flips = 0, bits = '';
  for (let i = -4; i <= 40; i++) {
    const d = i * 0.05;
    const c = [P[0], P[1] + B[1] * d, P[2] + B[2] * d];
    const bit = probe(c, [0.08, 0.08, 0.08]) > 1e-7 ? 1 : 0;
    if (prev >= 0 && bit !== prev) flips++;
    prev = bit;
    bits += bit;
  }
  return { x, deg, flips, bits };
}
const rays = [];
for (const x of [-48, -11, 0, 18, 31, 48]) {
  for (const deg of [0, 20, 45, 70, 88]) rays.push(ray(x, deg));
}
globalThis.__rays = rays;
globalThis.__bodies = part.decompose().length;
return part;
`;
const full = fixture.replace(/return part;\s*$/, probe);
const run = await runScript(full);
check('full script manifold', run.status === 'NoError' && !run.featureSkip, run.status || run.error || '');
check('one body', globalThis.__bodies === 1, `bodies ${globalThis.__bodies}`);
for (const ray of globalThis.__rays || []) {
  check(
    `bend x=${ray.x} ${ray.deg}° one shell`,
    ray.flips === 1 && ray.bits.includes('0') && ray.bits.includes('1'),
    ray.bits,
  );
}

const geom = buildSolidGeometry(run.mesh);
check('no tangency needle', countDegenerateTriangles(geom.geometry) === 0, `degen ${countDegenerateTriangles(geom.geometry)}`);

const pos = geom.geometry.attributes.position.array;
const index = geom.geometry.index.array;
const nTri = index.length / 3;
const at = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
const r = 2.54;
const cx = -11.0235 + r;
const cz = 12.960001 + r;
const dists = [];
let crease = 0;
let creaseOther = 0;
for (let t = 0; t < nTri; t++) {
  const a = at(index[t * 3]);
  const b = at(index[t * 3 + 1]);
  const c = at(index[t * 3 + 2]);
  const my = (a[1] + b[1] + c[1]) / 3;
  const mz = (a[2] + b[2] + c[2]) / 3;
  if (my > 36.2 && mz > 6.4 && mz < 9) {
    crease++;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const L = Math.hypot(cr[0], cr[1], cr[2]) || 1;
    if (Math.abs(cr[1] / L) < 0.9) creaseOther++;
  }
}
for (let i = 0; i < pos.length; i += 3) {
  const x = pos[i];
  const y = pos[i + 1];
  const z = pos[i + 2];
  if (y < 33.7 || y > 37.1 || x < -11.3 || x > -8.2 || z < 12.8 || z > 15.7) continue;
  const d = Math.hypot(x - cx, z - cz);
  if (Math.abs(d - r) < 0.15) dists.push(d);
}
dists.sort((p, q) => p - q);
let clusters = 0;
let last = -Infinity;
for (const d of dists) {
  if (d - last > 0.05) clusters++;
  last = d;
}
check('notch fillet nearest the bend is one radius', dists.length >= 20 && clusters === 1, `n=${dists.length} clusters=${clusters}`);
check('flange/bend crease stays the flange face', crease === 2 && creaseOther === 0, `tris ${crease} other ${creaseOther}`);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall checks passed');
