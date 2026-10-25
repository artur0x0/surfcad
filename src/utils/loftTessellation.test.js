import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOFT_CHORD_MIN_MM,
  adaptiveLoftAngles,
  capPolarGaps,
  loftChordToleranceMm,
  loftSpanSegments,
  maxPolarGap,
  quadTwistSagitta,
  simplifyClosedPolyline,
} from './loftTessellation.js';

const plane = {
  center: [0, 0, 0],
  normal: [0, 0, 1],
  x: [1, 0, 0],
  y: [0, 1, 0],
};

function circle(r, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return pts;
}

function station(contour, offset) {
  return {
    plane: {
      ...plane,
      center: [0, 0, offset],
    },
    contour,
    offset,
  };
}

test('creases stay and a point on a straight edge drops', () => {
  const pts = [[-2, -1], [0, -1], [2, -1], [2, 1], [0, 1], [-2, 1]];
  const kept = simplifyClosedPolyline(pts, 0.05);
  assert.equal(kept.length, 4);
  const key = (p) => `${p[0]},${p[1]}`;
  const set = new Set(kept.map(key));
  assert.equal(set.has('0,-1'), false);
  assert.equal(set.has('0,1'), false);
  assert.equal(set.has('-2,-1'), true);
  assert.equal(set.has('2,1'), true);
});

test('a 64-gon inside the small-part tolerance is not decimated', () => {
  const pts = circle(10, 64);
  const kept = simplifyClosedPolyline(pts, 0.014);
  assert.equal(kept.length, 64);
  const coarse = simplifyClosedPolyline(pts, 0.2);
  assert.ok(coarse.length < 40, `coarse ${coarse.length}`);
  assert.ok(coarse.length >= 8, `coarse ${coarse.length}`);
});

test('omitted resolution leaves a square at its four corners', () => {
  const square = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  const stations = [station(square, 0), station(square, 20)];
  const angles = adaptiveLoftAngles(stations, {}, 0.1);
  assert.equal(angles.length, 4);
});

test('resolution is a max polar gap and 16 is coarser than 64 on a square', () => {
  const square = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  const stations = [station(square, 0), station(square, 20)];
  const a16 = adaptiveLoftAngles(stations, { resolution: 16 }, 0.1);
  const a64 = adaptiveLoftAngles(stations, { resolution: 64 }, 0.1);
  assert.ok(maxPolarGap(a16) <= (Math.PI * 2) / 16 + 1e-6, `gap16 ${maxPolarGap(a16)}`);
  assert.ok(maxPolarGap(a64) <= (Math.PI * 2) / 64 + 1e-6, `gap64 ${maxPolarGap(a64)}`);
  assert.ok(a64.length > a16.length, `${a64.length} vs ${a16.length}`);
});

test('capPolarGaps fills the largest hole first', () => {
  const filled = capPolarGaps([0, Math.PI / 2], Math.PI / 4);
  assert.ok(maxPolarGap(filled) <= Math.PI / 4 + 1e-6);
  assert.ok(filled.length >= 8);
});

test('span segments follow twist sagitta over the tolerance', () => {
  assert.equal(loftSpanSegments(0, 0.16), 1);
  assert.equal(loftSpanSegments(0.1, 0.16), 1);
  assert.equal(loftSpanSegments(0.343, 0.16), 3);
  assert.equal(loftSpanSegments(0.69, 0.16), 5);
  assert.equal(loftSpanSegments(100, 0.16), 32);
});

test('quad twist sagitta is |a0 - a1 + b1 - b0| / 4', () => {
  const s = quadTwistSagitta([0, 0], [1, 0], [0, 2], [1, 0]);
  assert.ok(Math.abs(s - 0.5) < 1e-12, s);
});

test('chordal tolerance scales with part size and stays clamped', () => {
  const tiny = [station(circle(2, 16), 0), station(circle(2, 16), 4)];
  const saddle = [
    station(circle(70, 32), 0),
    station(circle(14, 32), 285),
  ];
  const tinyEps = loftChordToleranceMm(tiny);
  const saddleEps = loftChordToleranceMm(saddle);
  assert.equal(tinyEps, LOFT_CHORD_MIN_MM);
  assert.ok(saddleEps > tinyEps);
  assert.ok(saddleEps <= 0.25);
  assert.ok(Math.abs(saddleEps - 0.0005 * Math.hypot(140, 140, 285)) < 1e-6 || saddleEps === 0.25);
});
