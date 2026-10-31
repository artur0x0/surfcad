import assert from 'node:assert/strict';
import test from 'node:test';
import { MOLD_REGION_NORMAL_DEG } from './pullDirection.js';
import { analyzePullDirection } from './pullDirection.js';
import { PARTING_CLUSTER_DEG, PARTING_NEUTRAL_DEG, partingLegendModel } from './parting.js';
import { classifyParting } from './parting.js';

function boxMesh(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = [
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    1, 2, 6, 1, 6, 5,
    0, 4, 7, 0, 7, 3,
    3, 7, 6, 3, 6, 2,
    0, 1, 5, 0, 5, 4,
  ];
  return { positions, indices };
}

function addLoop(positions, loop, z) {
  const base = positions.length / 3;
  for (const [x, y] of loop) positions.push(x, y, z);
  return base;
}

function capLoop(indices, base, n, up) {
  for (let i = 1; i < n - 1; i++) {
    if (up) indices.push(base, base + i, base + i + 1);
    else indices.push(base, base + i + 1, base + i);
  }
}

function wallLoop(indices, bottom, top, n, out) {
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (out) indices.push(bottom + i, bottom + j, top + j, bottom + i, top + j, top + i);
    else indices.push(bottom + i, top + j, bottom + j, bottom + i, top + i, top + j);
  }
}

function annulus(indices, outer, inner, n, up) {
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (up) indices.push(outer + i, outer + j, inner + j, outer + i, inner + j, inner + i);
    else indices.push(outer + i, inner + j, outer + j, outer + i, inner + i, inner + j);
  }
}

/** Solid open tray: 1.85 mm walls, filleted plan, floor, no lid. */
function openTray() {
  const wall = 1.85;
  const height = 8;
  const outer = [
    [3, 0], [17, 0], [20, 3], [20, 13], [17, 16], [3, 16], [0, 13], [0, 3],
  ];
  const inner = [
    [3, wall], [17, wall], [20 - wall, 3], [20 - wall, 13],
    [17, 16 - wall], [3, 16 - wall], [wall, 13], [wall, 3],
  ];
  const positions = [];
  const indices = [];
  const n = outer.length;
  const bottom = addLoop(positions, outer, 0);
  const floor = addLoop(positions, inner, wall);
  const rimOut = addLoop(positions, outer, height);
  const rimIn = addLoop(positions, inner, height);
  capLoop(indices, bottom, n, false);
  capLoop(indices, floor, n, true);
  wallLoop(indices, bottom, rimOut, n, true);
  wallLoop(indices, floor, rimIn, n, false);
  annulus(indices, rimOut, rimIn, n, true);
  return { positions, indices };
}

/** Block with a rectangular through hole along Z. */
function throughHole() {
  const positions = [];
  const indices = [];
  const outer = [[0, 0], [20, 0], [20, 16], [0, 16]];
  const inner = [[6, 4], [14, 4], [14, 12], [6, 12]];
  const n = 4;
  const ob = addLoop(positions, outer, 0);
  const ib = addLoop(positions, inner, 0);
  const ot = addLoop(positions, outer, 12);
  const it = addLoop(positions, inner, 12);
  annulus(indices, ob, ib, n, false);
  annulus(indices, ot, it, n, true);
  wallLoop(indices, ob, ot, n, true);
  wallLoop(indices, ib, it, n, false);
  return { positions, indices };
}

function triInfo(mesh, index) {
  const ia = mesh.indices[index * 3];
  const ib = mesh.indices[index * 3 + 1];
  const ic = mesh.indices[index * 3 + 2];
  const p = (v) => [
    mesh.positions[v * 3],
    mesh.positions[v * 3 + 1],
    mesh.positions[v * 3 + 2],
  ];
  const a = p(ia);
  const b = p(ib);
  const c = p(ic);
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return {
    centroid: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
    normal: [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx],
  };
}

test('the parting cluster band matches the pull scorer', () => {
  assert.equal(PARTING_NEUTRAL_DEG, 10);
  assert.equal(PARTING_CLUSTER_DEG, MOLD_REGION_NORMAL_DEG);
});

test('a box along +Z keeps an axis pull, colours every face, and draws the top loop', () => {
  const result = analyzePullDirection({ ...boxMesh([0, 0, 0], [10, 10, 10]), pull: [0, 0, 1] });
  const parting = result.parting;
  assert.deepEqual(result.pull, [0, 0, 1]);
  assert.equal(parting.counts.parting, 0);
  assert.equal(parting.counts.core, 1);
  assert.equal(parting.counts.cavity, 5);
  assert.ok(parting.triangles.every((row) => row.role === 'core' || row.role === 'cavity'));
  assert.equal(parting.lines.length, 1);
  const line = parting.lines[0];
  assert.equal(line.closed, true);
  assert.equal(line.name, null);
  assert.ok(Math.abs(line.length - 40) < 1e-4);
  assert.ok(Math.abs(line.projectedPerimeter - 40) < 1e-4);
  assert.ok(line.points.every((point) => Math.abs(point[2] - 10) < 1e-4));
  const legend = partingLegendModel(parting);
  assert.deepEqual(legend.rows.map((row) => row.label), ['Core', 'Cavity', 'Parting line']);
  assert.ok(legend.rows.every((row) => row.count == null));
});

test('reversing the pull swaps the seeded faces and leaves contested walls on cavity', () => {
  const mesh = boxMesh([0, 0, 0], [10, 10, 10]);
  const up = analyzePullDirection({ ...mesh, pull: [0, 0, 1] });
  const down = analyzePullDirection({ ...mesh, pull: [0, 0, -1] });
  const roleAt = (result, z) => {
    const row = result.parting.triangles.find((entry) => {
      const info = triInfo(mesh, entry.index);
      return Math.abs(info.centroid[2] - z) < 0.2 && Math.abs(info.normal[2]) > 0.5;
    });
    return row.role;
  };
  assert.equal(roleAt(up, 10), 'core');
  assert.equal(roleAt(up, 0), 'cavity');
  assert.equal(roleAt(down, 10), 'cavity');
  assert.equal(roleAt(down, 0), 'core');
  const side = (result) => result.parting.triangles.filter((entry) => {
    const info = triInfo(mesh, entry.index);
    return Math.abs(info.normal[2]) < 0.2;
  });
  assert.ok(side(up).every((entry) => entry.role === 'cavity'));
  assert.ok(side(down).every((entry) => entry.role === 'cavity'));
  assert.ok(down.parting.lines[0].points.every((point) => Math.abs(point[2]) < 1e-4));
});

test('an open tray is core inside, cavity outside, with one outer rim loop', () => {
  const mesh = openTray();
  const result = analyzePullDirection({ ...mesh, pull: [0, 0, 1] });
  const parting = result.parting;
  assert.equal(parting.counts.parting, 0);
  assert.ok(parting.triangles.every((row) => row.role === 'core' || row.role === 'cavity'));
  const rows = parting.triangles.map((row) => ({ ...row, ...triInfo(mesh, row.index) }));
  const floor = rows.filter((row) => row.normal[2] > 0.5 && row.centroid[2] < 3);
  const bottom = rows.filter((row) => row.normal[2] < -0.5);
  const outerWall = rows.filter((row) => Math.abs(row.normal[2]) < 0.2 && (row.centroid[0] < 1 || row.centroid[0] > 19 || row.centroid[1] < 1 || row.centroid[1] > 15));
  const innerWall = rows.filter((row) => {
    if (Math.abs(row.normal[2]) >= 0.2) return false;
    const [x, y] = row.centroid;
    const inset = x > 1.2 && x < 18.8 && y > 1.2 && y < 14.8;
    const nearInner = x < 3.5 || x > 16.5 || y < 3.5 || y > 12.5;
    return inset && nearInner;
  });
  assert.ok(floor.length > 0 && floor.every((row) => row.role === 'core'));
  assert.ok(bottom.length > 0 && bottom.every((row) => row.role === 'cavity'));
  assert.ok(innerWall.length > 0 && innerWall.every((row) => row.role === 'core'));
  assert.ok(outerWall.length > 0 && outerWall.every((row) => row.role === 'cavity'));
  assert.equal(parting.lines.length, 1);
  const line = parting.lines[0];
  assert.equal(line.closed, true);
  assert.ok(line.points.every((point) => Math.abs(point[2] - 8) < 1e-4));
  assert.ok(Math.abs(line.projectedPerimeter - 64.970563) < 1e-3);
});

test('a through hole keeps the outer loop and drops the hole loop', () => {
  const mesh = throughHole();
  const result = analyzePullDirection({ ...mesh, pull: [0, 0, 1] });
  const line = result.parting.lines[0];
  assert.equal(result.parting.lines.length, 1);
  assert.equal(line.closed, true);
  assert.ok(Math.abs(line.projectedPerimeter - 72) < 1e-3);
  assert.ok(line.points.some((point) => point[0] < 0.1 || point[0] > 19.9));
  assert.ok(line.points.every((point) => Math.abs(point[2] - 12) < 1e-4));
});

test('a stamped face that straddles zero draft stays split', () => {
  const tris = [
    tri([0, 0, 4], [2, 0, 4], [1, 0.4, 4], 0, 0, 1, 2, [0, 0, 1]),
    tri([0, 0, 4], [2, 0, 2], [2, 0, 4], 1, 0, 3, 1, [0, 1, 0]),
    tri([0, 0, 4], [0, 0, 2], [2, 0, 2], 2, 0, 4, 3, [0, 1, 0]),
    tri([0, 0, 2], [2, 0, 2], [1, -0.8, 2], 3, 4, 3, 5, [0, 0, -1]),
  ];
  const faceInfo = {
    triFace: [0, 0, 0, 0],
    names: ['wrap'],
  };
  const parting = classifyParting(tris, [0, 0, 1], faceInfo);
  assert.equal(parting.triangles[0].role, 'core');
  assert.equal(parting.triangles[3].role, 'cavity');
  const named = parting.faces.filter((face) => face.name === 'wrap');
  assert.equal(named.length, 2);
  assert.ok(named.some((face) => face.role === 'core'));
  assert.ok(named.some((face) => face.role === 'cavity'));
  assert.equal(parting.lines.length, 1);
  assert.ok(parting.lines[0].points.every((point) => Math.abs(point[2] - 4) < 1e-4));
});

function tri(a, b, c, t, ia, ib, ic, normal) {
  const n = normal.slice();
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  return {
    t,
    ia,
    ib,
    ic,
    a,
    b,
    c,
    area: 1,
    n: [n[0] / length, n[1] / length, n[2] / length],
    centroid: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
  };
}
