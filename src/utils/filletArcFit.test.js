/**
 * The circle a sweep path is resampled on (densifySweepArcTurns).
 *
 * A closed loop was fitted through its first, middle and last sample. The
 * last sample of a loop is the first one's neighbour, so the plane of the
 * circle hung on one short chord. On a machined rim that chord is in the
 * plane and nothing showed. On a crease cut by a boolean (a post under a
 * sphere: 31 µm of wobble in z) the circle tilted by 4.4° and the knots sat
 * up to 0.5 mm off the crease. The concave fillet was then built in the air
 * on one side and inside the wall on the other.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { densifySweepArcTurns } from './filletAlongPath.js';

const turnsDeg = (pts) => {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
    out.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
  }
  return out;
};

/** Deterministic noise in [-1, 1]. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

/**
 * A loop like the crease where a 64-facet post (r 6) meets a sphere: 41
 * samples, chords from 0.2 to 1.6 mm, each sample off the circle by up to
 * `noise` in z and in r.
 */
function creaseLoop(noise, seed = 7) {
  const rnd = lcg(seed);
  const weights = [];
  for (let i = 0; i < 41; i++) weights.push(0.2 + 1.4 * Math.abs(rnd()));
  const total = weights.reduce((a, b) => a + b, 0);
  const pts = [];
  let ang = 0;
  for (let i = 0; i < 41; i++) {
    const r = 6 - noise * Math.abs(rnd());
    pts.push([r * Math.cos(ang), r * Math.sin(ang), 37.31 + noise * rnd()]);
    ang += (weights[i] / total) * 2 * Math.PI;
  }
  return pts;
}

test('an exact rim is resampled on its own circle, in its own plane', () => {
  const rim = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    rim.push([8 * Math.cos(a), 8 * Math.sin(a), 4]);
  }
  const out = densifySweepArcTurns(rim, true, 5);
  assert.ok(out.length > rim.length, `resampled ${rim.length} -> ${out.length}`);
  for (const p of out) {
    assert.ok(Math.abs(Math.hypot(p[0], p[1]) - 8) < 1e-9, `r ${Math.hypot(p[0], p[1])}`);
    assert.ok(Math.abs(p[2] - 4) < 1e-9, `z ${p[2]}`);
  }
  assert.ok(Math.max(...turnsDeg(out)) <= 5 + 1e-6);
});

test('a loop that wobbles about a circle stays on its crease: no tilt, one smooth run', () => {
  const noise = 0.015;
  const loop = creaseLoop(noise);
  const out = densifySweepArcTurns(loop, true, 5);
  assert.ok(out.length > loop.length, `resampled ${loop.length} -> ${out.length}`);
  let offZ = 0;
  let offR = 0;
  for (const p of out) {
    offZ = Math.max(offZ, Math.abs(p[2] - 37.31));
    offR = Math.max(offR, Math.abs(Math.hypot(p[0], p[1]) - 6));
  }
  // Three samples that are each off by the noise can tilt the plane by a
  // few times that across the loop. The old fit was off by 0.5 mm here.
  assert.ok(offZ < 4 * noise, `z off the crease by ${offZ}`);
  assert.ok(offR < 4 * noise, `r off the crease by ${offR}`);
  // No knot turns past the 5° run gate, so the sweep is one tube. Pinning
  // the ends of a run to noisy samples kinked it (8.7° measured, 24 tubes).
  assert.ok(Math.max(...turnsDeg(out)) <= 5 + 1e-6, `max turn ${Math.max(...turnsDeg(out))}`);
});

test('the wobble does not have to be small in one direction only', () => {
  for (const seed of [1, 2, 3, 11, 29]) {
    const out = densifySweepArcTurns(creaseLoop(0.02, seed), true, 5);
    let off = 0;
    for (const p of out) off = Math.max(off, Math.abs(p[2] - 37.31), Math.abs(Math.hypot(p[0], p[1]) - 6));
    assert.ok(off < 0.1, `seed ${seed}: off the crease by ${off}`);
    assert.ok(Math.max(...turnsDeg(out)) <= 5 + 1e-6, `seed ${seed}: max turn ${Math.max(...turnsDeg(out))}`);
  }
});

test('a rounded rectangle keeps its straights and its four corner arcs', () => {
  // Straights are not on the circle the corners share: the loop rule must
  // leave this path to the run logic.
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (Math.PI / 2);
      pts.push([cx + 3 * Math.cos(a), cy + 3 * Math.sin(a), 0]);
    }
  };
  corner(20, 10, -Math.PI / 2);
  corner(20, 30, 0);
  corner(-20, 30, Math.PI / 2);
  corner(-20, 10, Math.PI);
  const out = densifySweepArcTurns(pts, true, 5);
  const xs = out.map((p) => p[0]);
  const ys = out.map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...xs) - 23) < 1e-6 && Math.abs(Math.min(...xs) + 23) < 1e-6, 'width kept');
  assert.ok(Math.abs(Math.max(...ys) - 33) < 1e-6 && Math.abs(Math.min(...ys) - 7) < 1e-6, 'height kept');
  // The long straights are still there as single chords.
  const chords = out.map((p, i) => Math.hypot(out[(i + 1) % out.length][0] - p[0], out[(i + 1) % out.length][1] - p[1]));
  assert.equal(chords.filter((c) => c > 19).length, 4, 'four straights');
});
