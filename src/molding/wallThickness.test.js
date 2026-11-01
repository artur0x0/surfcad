import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePullDirection, analyzeWallOnly } from './pullDirection.js';
import { nominalWallFromSamples } from './wallThickness.js';

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

function appendMesh(dstPos, dstIdx, src) {
  const base = dstPos.length / 3;
  for (let i = 0; i < src.positions.length; i++) dstPos.push(src.positions[i]);
  for (let t = 0; t < src.indices.length; t++) dstIdx.push(src.indices[t] + base);
}

function flipIndices(indices) {
  const out = indices.slice();
  for (let t = 0; t < out.length; t += 3) {
    const b = out[t + 1];
    out[t + 1] = out[t + 2];
    out[t + 2] = b;
  }
  return out;
}

/** Closed shell, outer 0..20, wall 2 mm. Inner faces point into the cavity. */
function uniformShell() {
  const positions = [];
  const indices = [];
  const outer = boxMesh([0, 0, 0], [20, 20, 20]);
  const inner = boxMesh([2, 2, 2], [18, 18, 18]);
  appendMesh(positions, indices, outer);
  appendMesh(positions, indices, { positions: inner.positions, indices: flipIndices(inner.indices) });
  return { positions, indices };
}

function withPart(shell, part) {
  const positions = shell.positions.slice();
  const indices = shell.indices.slice();
  appendMesh(positions, indices, part);
  return { positions, indices };
}

/**
 * 4×8×4 boss in the cavity. The inscribed sphere is the 4 mm cross-section.
 * The 8 mm ray is a corridor, so those faces stay thick and are not 8 mm.
 * The shell's inward rays hit the shell, not the boss.
 */
function thickBoss() {
  return withPart(uniformShell(), boxMesh([8, 8, 8], [12, 16, 12]));
}

/**
 * 0.8×2.5×2.5 rib in the cavity. Every face is the 0.8 mm wall. The end
 * faces sit between the two skins, so the sphere keeps them thin.
 */
function thinRib() {
  return withPart(uniformShell(), boxMesh([10, 9, 9], [10.8, 11.5, 11.5]));
}

function near(actual, expected, eps = 1e-3) {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `expected ${expected}, got ${actual}`,
  );
}

function score(mesh, wall) {
  return analyzePullDirection({ ...mesh, pull: [0, 0, 1], wall });
}

test('nominal is the mode when one thickness dominates, else the band median', () => {
  const mode = nominalWallFromSamples([
    { thickness: 2, area: 100 },
    { thickness: 8, area: 5 },
  ]);
  assert.equal(mode.nominalMethod, 'mode');
  near(mode.nominal, 2);
  near(mode.max, 8);

  const spread = nominalWallFromSamples([
    { thickness: 1, area: 1 },
    { thickness: 2, area: 1 },
    { thickness: 3, area: 1 },
    { thickness: 4, area: 1 },
    { thickness: 5, area: 1 },
  ]);
  assert.equal(spread.nominalMethod, 'median');
  near(spread.nominal, 3);
  near(spread.median, 3);

  const empty = nominalWallFromSamples([]);
  assert.equal(empty.nominal, null);
  assert.equal(empty.nominalMethod, null);
});

test('a uniform-wall shell reports that wall as nominal and max', () => {
  const result = score(uniformShell());
  assert.equal(result.kind, 'mold-analysis');
  assert.equal(result.version, 1);
  assert.equal(result.fit === 'good' || result.fit === 'fixable' || result.fit === 'not_a_fit', true);
  const wall = result.wall;
  assert.equal(wall.nominalMethod, 'mode');
  near(wall.nominal, 2);
  near(wall.max, 2);
  near(wall.min, 2);
  near(wall.mean, 2);
  near(wall.median, 2);
  assert.equal(wall.sampleCount, 24);
  assert.equal(wall.thinCount, 0);
  assert.equal(wall.thickCount, 0);
  assert.equal(wall.thresholds.thinRatio, 0.6);
  assert.equal(wall.thresholds.thickRatio, 1.5);
  assert.equal(wall.field.length, 24);
  for (const sample of wall.field) {
    assert.equal(sample.flag, 'nominal');
    near(sample.thickness, 2);
  }
});

test('a coarse centroid pass and the refined field agree on a uniform shell', () => {
  const mesh = uniformShell();
  const coarse = analyzeWallOnly({ ...mesh, wallPass: 'centroid' });
  const refined = analyzeWallOnly({
    ...mesh,
    wallPass: 'refine',
    nominalHint: coarse.wall.nominal,
  });
  near(coarse.wall.nominal, 2);
  near(refined.wall.nominal, 2);
  near(refined.wall.max, 2);
  assert.equal(coarse.wall.sampleCount, 24);
  assert.equal(refined.wall.sampleCount, 24);
});

test('a thick boss stays off the nominal and is flagged thick', () => {
  const result = score(thickBoss());
  const wall = result.wall;
  assert.equal(wall.nominalMethod, 'mode');
  near(wall.nominal, 2);
  near(wall.max, 4);
  near(wall.min, 2);
  assert.equal(wall.thinCount, 0);
  assert.ok(wall.thickCount >= 1);
  assert.ok(wall.thickArea > 0);
  const shell = wall.field.slice(0, 24);
  const boss = wall.field.slice(24);
  assert.equal(boss.length, 12);
  for (const sample of shell) {
    assert.equal(sample.flag, 'nominal');
    near(sample.thickness, 2);
  }
  for (const sample of boss) {
    assert.equal(sample.flag, 'thick');
    assert.ok(sample.thickness > wall.nominal * wall.thresholds.thickRatio);
    assert.ok(sample.thickness < 5, sample.thickness);
  }
  const yFaces = [24 + 8, 24 + 9, 24 + 10, 24 + 11];
  for (const index of yFaces) {
    assert.equal(wall.field[index].source, 'sphere');
    assert.ok(wall.field[index].thickness > 3.5 && wall.field[index].thickness < 4.2);
  }
});

test('a thin rib is flagged thin and does not move nominal', () => {
  const result = score(thinRib());
  const wall = result.wall;
  assert.equal(wall.nominalMethod, 'mode');
  near(wall.nominal, 2);
  assert.ok(wall.min > 0.7 && wall.min < 0.85, wall.min);
  assert.equal(wall.thickCount, 0);
  assert.equal(wall.thinCount, 1);
  for (const region of wall.thin) assert.ok(region.thickness > 0.7 && region.thickness < 0.85);
  const thinFaces = [24 + 4, 24 + 5, 24 + 6, 24 + 7];
  for (const index of thinFaces) {
    assert.equal(wall.field[index].flag, 'thin');
    assert.equal(wall.field[index].source, 'ray');
    near(wall.field[index].thickness, 0.8);
  }
  const ribEnds = [24, 25, 26, 27, 32, 33, 34, 35];
  for (const index of ribEnds) {
    const sample = wall.field[index];
    assert.equal(sample.flag, 'thin', `${index} ${sample.thickness}`);
    assert.equal(sample.source, 'sphere');
    assert.ok(Math.abs(sample.thickness - 0.8) <= 0.8 * 0.15, `${index} ${sample.thickness}`);
  }
  for (const sample of wall.field.slice(0, 24)) {
    assert.equal(sample.flag, 'nominal');
    near(sample.thickness, 2);
  }
});

test('raising a threshold clears the boss and the rib', () => {
  const boss = score(thickBoss(), { thickRatio: 10 }).wall;
  near(boss.nominal, 2);
  near(boss.max, 4);
  assert.equal(boss.thickCount, 0);
  assert.equal(boss.thresholds.thickRatio, 10);
  assert.equal(boss.field.slice(24).every((sample) => sample.flag === 'nominal'), true);

  const rib = score(thinRib(), { thinRatio: 0.3 }).wall;
  assert.ok(rib.min > 0.7 && rib.min < 0.85, rib.min);
  assert.equal(rib.thinCount, 0);
  assert.equal(rib.thresholds.thinRatio, 0.3);
  assert.equal(rib.field.some((sample) => sample.flag === 'thin'), false);
});

test('a solid cube reports its span as max wall on the mold-analysis result', () => {
  const result = analyzePullDirection(boxMesh([0, 0, 0], [10, 10, 10]));
  assert.equal(result.fit, 'good');
  assert.equal(result.kind, 'mold-analysis');
  near(result.wall.nominal, 10);
  near(result.wall.max, 10);
  assert.equal(result.wall.thinCount, 0);
  assert.equal(result.wall.thickCount, 0);
});

test('a bad wall threshold is bad_args', () => {
  const mesh = uniformShell();
  const equal = analyzePullDirection({ ...mesh, wall: { thinRatio: 1, thickRatio: 1 } });
  assert.equal(equal.error.code, 'bad_args');
  const backwards = analyzePullDirection({ ...mesh, wall: { thinRatio: 2, thickRatio: 0.5 } });
  assert.equal(backwards.error.code, 'bad_args');
});

test('an open triangle is unknown, not thick', () => {
  const wall = score({
    positions: [0, 0, 0, 4, 0, 0, 0, 3, 0],
    indices: [0, 1, 2],
  }).wall;
  assert.equal(wall.nominal, null);
  assert.equal(wall.field[0].flag, 'unknown');
  assert.equal(wall.field[0].thickness, null);
  assert.equal(wall.thickCount, 0);
});

test('a parallel plate reads its thickness, not its span', () => {
  const wall = score(boxMesh([0, 0, 0], [20, 20, 2])).wall;
  near(wall.nominal, 2, 0.15);
  assert.ok(wall.max < 3.2, `max ${wall.max}`);
  assert.ok(wall.min > 1.2, `min ${wall.min}`);
  for (const sample of wall.field) {
    assert.notEqual(sample.flag, 'thick');
    assert.ok(sample.thickness < 4, `${sample.index} ${sample.thickness}`);
  }
});

function pushTri(pos, idx, a, b, c, outward) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const facing = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2];
  const tri = facing >= 0 ? [a, b, c] : [a, c, b];
  const base = pos.length / 3;
  for (const p of tri) pos.push(p[0], p[1], p[2]);
  idx.push(base, base + 1, base + 2);
}

function pushQuad(pos, idx, a, b, c, d, outward) {
  pushTri(pos, idx, a, b, c, outward);
  pushTri(pos, idx, a, c, d, outward);
}

function markRange(indices) {
  return { start: indices.length / 3 };
}

function closeRange(indices, range) {
  range.end = indices.length / 3;
  return range;
}

function sliceRange(field, range) {
  return field.filter((sample) => sample.index >= range.start && sample.index < range.end);
}

/** Open tray, 1.85 mm walls, filleted vertical outside corners, no draft. */
function openTray() {
  const w = 40;
  const d = 28;
  const height = 12;
  const wall = 1.85;
  const radius = 1;
  const segs = 4;
  const corners = [
    { c: [radius, radius], a0: Math.PI, a1: Math.PI * 1.5 },
    { c: [w - radius, radius], a0: Math.PI * 1.5, a1: Math.PI * 2 },
    { c: [w - radius, d - radius], a0: 0, a1: Math.PI * 0.5 },
    { c: [radius, d - radius], a0: Math.PI * 0.5, a1: Math.PI },
  ];
  const loop = [];
  corners.forEach((corner, cornerIndex) => {
    for (let i = 0; i <= segs; i++) {
      const angle = corner.a0 + ((corner.a1 - corner.a0) * i) / segs;
      const point = [
        corner.c[0] + radius * Math.cos(angle),
        corner.c[1] + radius * Math.sin(angle),
      ];
      if (loop.length) {
        const prev = loop[loop.length - 1];
        if (Math.hypot(point[0] - prev[0], point[1] - prev[1]) < 1e-6) continue;
      }
      if (cornerIndex === corners.length - 1 && i === segs) {
        const first = loop[0];
        if (first && Math.hypot(point[0] - first[0], point[1] - first[1]) < 1e-6) continue;
      }
      loop.push(point);
    }
  });
  const innerOf = (p) => {
    const spots = [[0, 0], [w, 0], [w, d], [0, d]];
    const inset = [[wall, wall], [w - wall, wall], [w - wall, d - wall], [wall, d - wall]];
    for (let i = 0; i < spots.length; i++) {
      if (Math.hypot(p[0] - spots[i][0], p[1] - spots[i][1]) <= radius + 0.05) return inset[i];
    }
    if (p[1] <= radius) return [Math.min(w - wall, Math.max(wall, p[0])), wall];
    if (p[1] >= d - radius) return [Math.min(w - wall, Math.max(wall, p[0])), d - wall];
    if (p[0] <= radius) return [wall, Math.min(d - wall, Math.max(wall, p[1]))];
    return [w - wall, Math.min(d - wall, Math.max(wall, p[1]))];
  };
  const arcCenters = [[radius, radius], [w - radius, radius], [w - radius, d - radius], [radius, d - radius]];
  const onArc = (p) => arcCenters.some((c) => Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - radius) < 0.35);
  const pos = [];
  const idx = [];
  const center = [w / 2, d / 2, 0];
  const floor = markRange(idx);
  for (let i = 0; i < loop.length; i++) {
    const p0 = loop[i];
    const p1 = loop[(i + 1) % loop.length];
    pushTri(pos, idx, center, [p1[0], p1[1], 0], [p0[0], p0[1], 0], [0, 0, -1]);
  }
  closeRange(idx, floor);
  const segments = loop.map((p0, i) => {
    const p1 = loop[(i + 1) % loop.length];
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    return { p0, p1, mid, arc: onArc(mid) };
  });
  const addWalls = (rows) => {
    const range = markRange(idx);
    for (const row of rows) {
      pushQuad(
        pos,
        idx,
        [row.p0[0], row.p0[1], 0],
        [row.p1[0], row.p1[1], 0],
        [row.p1[0], row.p1[1], height],
        [row.p0[0], row.p0[1], height],
        [row.mid[0] - w / 2, row.mid[1] - d / 2, 0],
      );
    }
    return closeRange(idx, range);
  };
  const fillet = addWalls(segments.filter((row) => row.arc));
  const straight = addWalls(segments.filter((row) => !row.arc));
  const inner = [[wall, wall], [w - wall, wall], [w - wall, d - wall], [wall, d - wall]];
  const innerWall = markRange(idx);
  for (let i = 0; i < inner.length; i++) {
    const p0 = inner[i];
    const p1 = inner[(i + 1) % inner.length];
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    pushQuad(
      pos,
      idx,
      [p0[0], p0[1], wall],
      [p1[0], p1[1], wall],
      [p1[0], p1[1], height],
      [p0[0], p0[1], height],
      [w / 2 - mid[0], d / 2 - mid[1], 0],
    );
  }
  closeRange(idx, innerWall);
  const cavityFloor = markRange(idx);
  pushQuad(
    pos,
    idx,
    [wall, wall, wall],
    [w - wall, wall, wall],
    [w - wall, d - wall, wall],
    [wall, d - wall, wall],
    [0, 0, 1],
  );
  closeRange(idx, cavityFloor);
  const rim = markRange(idx);
  for (let i = 0; i < loop.length; i++) {
    const p0 = loop[i];
    const p1 = loop[(i + 1) % loop.length];
    const i0 = innerOf(p0);
    const i1 = innerOf(p1);
    pushQuad(
      pos,
      idx,
      [p0[0], p0[1], height],
      [p1[0], p1[1], height],
      [i1[0], i1[1], height],
      [i0[0], i0[1], height],
      [0, 0, 1],
    );
  }
  closeRange(idx, rim);
  return {
    positions: pos,
    indices: idx,
    floor,
    fillet,
    straight,
    innerWall,
    cavityFloor,
    rim,
    wall,
    height,
  };
}

test('an open filleted tray keeps nominal walls and does not thicken the rim', () => {
  const tray = openTray();
  const wall = score(tray).wall;
  const describe = (range) => sliceRange(wall.field, range).map((sample) => (
    `${sample.flag}:${sample.source}:${sample.thickness}`
  )).join(' ');
  assert.ok(Math.abs(wall.nominal - tray.wall) < 1e-6, `nominal ${wall.nominal} ${describe(tray.innerWall)}`);
  for (const sample of wall.field) {
    if (sample.thickness == null) {
      assert.equal(sample.flag, 'unknown');
      continue;
    }
    assert.ok(sample.thickness < tray.height * 0.6, `${sample.index} ${sample.thickness}`);
  }
  const rim = sliceRange(wall.field, tray.rim).filter((sample) => sample.thickness != null);
  assert.ok(rim.length > 0, describe(tray.rim));
  const rimMin = Math.min(...rim.map((sample) => sample.thickness));
  assert.ok(rimMin >= 1.57, rimMin);
  for (const sample of rim) {
    assert.notEqual(sample.flag, 'thick', describe(tray.rim));
    assert.ok(sample.thickness < wall.nominal * 1.5, describe(tray.rim));
    assert.ok(sample.thickness > wall.nominal * 0.55, describe(tray.rim));
  }
  const fillets = sliceRange(wall.field, tray.fillet).filter((sample) => sample.thickness != null);
  assert.ok(fillets.length > 0, describe(tray.fillet));
  for (const sample of fillets) {
    assert.notEqual(sample.flag, 'unknown');
    assert.ok(sample.thickness > 0.4, describe(tray.fillet));
  }
  const skins = [
    ...sliceRange(wall.field, tray.innerWall),
    ...sliceRange(wall.field, tray.cavityFloor),
    ...sliceRange(wall.field, tray.floor),
  ];
  for (const sample of skins) {
    assert.equal(sample.flag, 'nominal', `${sample.index} ${sample.thickness} ${sample.flag}`);
    assert.ok(Math.abs(sample.thickness - tray.wall) < 0.45, sample.thickness);
  }
});

/** Drafted open cup. Horizontal wall gap is 1.6 mm and the walls lean out. */
function draftedCup() {
  const height = 18;
  const wall = 1.6;
  const flare = 1.4;
  const pos = [];
  const idx = [];
  const ring = (inset, grow) => {
    const lo = 2 - grow + inset;
    const hi = 28 + grow - inset;
    return [[lo, lo], [hi, lo], [hi, hi], [lo, hi]];
  };
  const outerBottom = ring(0, 0);
  const outerTop = ring(0, flare);
  const innerBottom = ring(wall, 0);
  const innerTop = ring(wall, flare);
  const z0 = (p, z) => [p[0], p[1], z];
  const walls = markRange(idx);
  for (let i = 0; i < 4; i++) {
    const a = outerBottom[i];
    const b = outerBottom[(i + 1) % 4];
    const c = outerTop[(i + 1) % 4];
    const d = outerTop[i];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    pushQuad(pos, idx, z0(a, 0), z0(b, 0), z0(c, height), z0(d, height), [mid[0] - 15, mid[1] - 15, 0]);
  }
  closeRange(idx, walls);
  const inner = markRange(idx);
  for (let i = 0; i < 4; i++) {
    const a = innerBottom[i];
    const b = innerBottom[(i + 1) % 4];
    const c = innerTop[(i + 1) % 4];
    const d = innerTop[i];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    pushQuad(pos, idx, z0(a, wall), z0(b, wall), z0(c, height), z0(d, height), [15 - mid[0], 15 - mid[1], 0]);
  }
  closeRange(idx, inner);
  const floor = markRange(idx);
  pushQuad(pos, idx, z0(outerBottom[0], 0), z0(outerBottom[3], 0), z0(outerBottom[2], 0), z0(outerBottom[1], 0), [0, 0, -1]);
  pushQuad(pos, idx, z0(innerBottom[0], wall), z0(innerBottom[1], wall), z0(innerBottom[2], wall), z0(innerBottom[3], wall), [0, 0, 1]);
  closeRange(idx, floor);
  const rim = markRange(idx);
  for (let i = 0; i < 4; i++) {
    pushQuad(
      pos,
      idx,
      z0(outerTop[i], height),
      z0(outerTop[(i + 1) % 4], height),
      z0(innerTop[(i + 1) % 4], height),
      z0(innerTop[i], height),
      [0, 0, 1],
    );
  }
  closeRange(idx, rim);
  return { positions: pos, indices: idx, walls, inner, floor, rim, wall, height };
}

test('a drafted cup reads the wall, not the height', () => {
  const cup = draftedCup();
  const wall = score(cup).wall;
  assert.ok(Math.abs(wall.nominal - cup.wall) < 0.35, `nominal ${wall.nominal}`);
  assert.ok(wall.max < cup.height * 0.5, `max ${wall.max}`);
  for (const sample of sliceRange(wall.field, cup.walls)) {
    assert.notEqual(sample.flag, 'unknown');
    assert.ok(sample.thickness < cup.wall * 1.8, sample.thickness);
  }
  for (const sample of sliceRange(wall.field, cup.rim)) {
    assert.notEqual(sample.flag, 'thick', `${sample.thickness} ${sample.source}`);
  }
});

/**
 * Plate plus a 0.7 mm cantilever. The beam end must not read the beam length.
 */
function snapHook() {
  const pos = [];
  const idx = [];
  const plate = boxMesh([0, 0, 0], [24, 16, 2.2]);
  appendMesh(pos, idx, plate);
  const x0 = 24;
  const x1 = 32;
  const y0 = 6;
  const y1 = 9;
  const z0 = 0.75;
  const z1 = 1.45;
  const beam = markRange(idx);
  pushQuad(pos, idx, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
  pushQuad(pos, idx, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]);
  pushQuad(pos, idx, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  pushQuad(pos, idx, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]);
  const end = markRange(idx);
  pushQuad(pos, idx, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
  closeRange(idx, end);
  closeRange(idx, beam);
  return { positions: pos, indices: idx, beam, end, plate: 2.2, beamThickness: z1 - z0, beamLength: x1 - x0 };
}

test('a snap hook measures the beam, not its length', () => {
  const hook = snapHook();
  const wall = score(hook).wall;
  near(wall.nominal, hook.plate, 0.2);
  const sides = wall.field.filter((sample) => sample.index >= hook.beam.start && sample.index < hook.end.start);
  assert.equal(sides.length, 8);
  for (const sample of sides) {
    assert.equal(sample.flag, 'thin', `${sample.index} ${sample.thickness} ${sample.source}`);
    assert.ok(Math.abs(sample.thickness - hook.beamThickness) < 0.25, `${sample.index} ${sample.thickness}`);
  }
  for (const sample of sliceRange(wall.field, hook.end)) {
    assert.equal(sample.flag, 'thin', `${sample.thickness} ${sample.source}`);
    assert.equal(sample.source, 'sphere');
    assert.ok(sample.thickness < hook.beamLength * 0.5, sample.thickness);
    assert.ok(sample.thickness < hook.plate * 0.8, sample.thickness);
  }
});

/** Plate with a square through-hole. Hole walls must not read the plate span. */
function throughHole() {
  const pos = [];
  const idx = [];
  const plate = 2.2;
  const outer = [[0, 0], [24, 0], [24, 24], [0, 24]];
  const hole = [[9, 9], [15, 9], [15, 15], [9, 15]];
  const z = (p, h) => [p[0], p[1], h];
  // Top annulus as four quads between outer and hole.
  for (let i = 0; i < 4; i++) {
    pushQuad(pos, idx, z(outer[i], plate), z(outer[(i + 1) % 4], plate), z(hole[(i + 1) % 4], plate), z(hole[i], plate), [0, 0, 1]);
    pushQuad(pos, idx, z(outer[i], 0), z(hole[i], 0), z(hole[(i + 1) % 4], 0), z(outer[(i + 1) % 4], 0), [0, 0, -1]);
  }
  for (let i = 0; i < 4; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % 4];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    pushQuad(pos, idx, z(a, 0), z(b, 0), z(b, plate), z(a, plate), [mid[0] - 12, mid[1] - 12, 0]);
  }
  const holeWalls = markRange(idx);
  for (let i = 0; i < 4; i++) {
    const a = hole[i];
    const b = hole[(i + 1) % 4];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    pushQuad(pos, idx, z(a, 0), z(a, plate), z(b, plate), z(b, 0), [12 - mid[0], 12 - mid[1], 0]);
  }
  closeRange(idx, holeWalls);
  return { positions: pos, indices: idx, holeWalls, plate, span: 9 };
}

/**
 * Constant-thickness open corner: flat walls, a vertical fillet, and a
 * bottom fillet. The inner skin is the outer skin offset by `wall`, so a
 * fillet is at least that thick.
 */
function offsetFilletCorner(segs) {
  const wall = 1.85;
  const radius = 4;
  const innerR = radius - wall;
  const height = 12;
  const length = 18;
  const pos = [];
  const idx = [];
  const ring = (ang, rad) => [radius - rad * Math.cos(ang), radius - rad * Math.sin(ang)];
  const vertical = markRange(idx);
  for (let s = 0; s < segs; s++) {
    const a0 = (Math.PI / 2) * s / segs;
    const a1 = (Math.PI / 2) * (s + 1) / segs;
    const o0 = ring(a0, radius);
    const o1 = ring(a1, radius);
    const i0 = ring(a0, innerR);
    const i1 = ring(a1, innerR);
    const mid = ring((a0 + a1) / 2, radius);
    const outward = [mid[0] - radius, mid[1] - radius, 0];
    pushQuad(pos, idx, [o0[0], o0[1], radius], [o1[0], o1[1], radius], [o1[0], o1[1], height], [o0[0], o0[1], height], outward);
    pushQuad(pos, idx, [i0[0], i0[1], radius], [i0[0], i0[1], height], [i1[0], i1[1], height], [i1[0], i1[1], radius], [-outward[0], -outward[1], 0]);
  }
  closeRange(idx, vertical);
  const flat = markRange(idx);
  pushQuad(pos, idx, [0, radius, radius], [0, radius + length, radius], [0, radius + length, height], [0, radius, height], [-1, 0, 0]);
  pushQuad(pos, idx, [wall, radius, radius], [wall, radius, height], [wall, radius + length, height], [wall, radius + length, radius], [1, 0, 0]);
  pushQuad(pos, idx, [radius, 0, radius], [radius, 0, height], [radius + length, 0, height], [radius + length, 0, radius], [0, -1, 0]);
  pushQuad(pos, idx, [radius, wall, radius], [radius + length, wall, radius], [radius + length, wall, height], [radius, wall, height], [0, 1, 0]);
  closeRange(idx, flat);
  const bottom = markRange(idx);
  for (let s = 0; s < segs; s++) {
    const a0 = (Math.PI / 2) * s / segs;
    const a1 = (Math.PI / 2) * (s + 1) / segs;
    const y0 = radius;
    const y1 = radius + length;
    const outerAt = (ang, y) => [radius - radius * Math.cos(ang), y, radius - radius * Math.sin(ang)];
    const innerAt = (ang, y) => [radius - innerR * Math.cos(ang), y, radius - innerR * Math.sin(ang)];
    const n = [-Math.cos((a0 + a1) / 2), 0, -Math.sin((a0 + a1) / 2)];
    pushQuad(pos, idx, outerAt(a0, y0), outerAt(a0, y1), outerAt(a1, y1), outerAt(a1, y0), n);
    pushQuad(pos, idx, innerAt(a0, y0), innerAt(a1, y0), innerAt(a1, y1), innerAt(a0, y1), [-n[0], 0, -n[2]]);
  }
  closeRange(idx, bottom);
  const floor = markRange(idx);
  pushQuad(pos, idx, [radius, radius, 0], [radius + length, radius, 0], [radius + length, radius + length, 0], [radius, radius + length, 0], [0, 0, -1]);
  pushQuad(pos, idx, [radius, radius, wall], [radius, radius + length, wall], [radius + length, radius + length, wall], [radius + length, wall, wall], [0, 0, 1]);
  closeRange(idx, floor);
  return { positions: pos, indices: idx, vertical, flat, bottom, floor, wall };
}

test('fillets read at least the wall they join, at several tessellations', () => {
  for (const segs of [2, 4, 8]) {
    const tray = offsetFilletCorner(segs);
    const wall = analyzeWallOnly({
      positions: tray.positions,
      indices: tray.indices,
      wallPass: 'centroid',
    }).wall;
    assert.ok(Math.abs(wall.nominal - tray.wall) < 0.15, `segs ${segs} nominal ${wall.nominal}`);
    const floor = sliceRange(wall.field, tray.floor);
    for (const sample of floor) {
      assert.ok(Math.abs(sample.thickness - tray.wall) < 0.15, `floor ${segs} ${sample.thickness}`);
    }
    for (const sample of sliceRange(wall.field, tray.flat)) {
      assert.equal(sample.flag, 'nominal', `flat ${segs} ${sample.thickness} ${sample.flag}`);
      assert.ok(Math.abs(sample.thickness - tray.wall) < 0.15, `flat ${segs} ${sample.thickness}`);
    }
    for (const range of [tray.vertical, tray.bottom]) {
      for (const sample of sliceRange(wall.field, range)) {
        assert.ok(
          sample.thickness >= wall.nominal - 0.15,
          `fillet segs ${segs} ${sample.thickness} nominal ${wall.nominal} ${sample.source}`,
        );
      }
    }
  }
  const rib = score(thinRib()).wall;
  assert.ok(rib.min > 0.7 && rib.min < 0.85, `rib ${rib.min}`);
  assert.equal(rib.thinCount, 1);
  const hook = snapHook();
  const beam = score(hook).wall;
  const sides = beam.field.filter((sample) => sample.index >= hook.beam.start && sample.index < hook.end.start);
  for (const sample of sides) {
    assert.equal(sample.flag, 'thin', `${sample.index} ${sample.thickness}`);
  }
});

test('a through-hole wall reads the plate, not the span across the hole', () => {
  const part = throughHole();
  const wall = score(part).wall;
  near(wall.nominal, part.plate, 0.25);
  const holes = sliceRange(wall.field, part.holeWalls);
  assert.equal(holes.length, 8);
  for (const sample of holes) {
    assert.notEqual(sample.flag, 'thick', `${sample.thickness} ${sample.source}`);
    assert.ok(Math.abs(sample.thickness - part.plate) < 0.45, sample.thickness);
    assert.ok(sample.thickness < part.span * 0.5, sample.thickness);
    assert.equal(sample.source, 'sphere');
  }
});
