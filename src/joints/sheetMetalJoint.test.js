import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { faceColorKey } from '../utils/faceColorMatch.js';
import { fingerprintsFromGeometry } from '../utils/facePaint.js';
import { buildSolidGeometry } from '../utils/partSolidCache.js';
import {
  catalogFromMeshData,
  fitJointAxis,
  matchJointAxis,
  matchJointFace,
} from '../utils/jointResolve.js';
import { partPlacement } from '../utils/jointSchema.js';
import { worldPoint } from '../utils/partPose.js';
import { refreshAssemblyJoints } from './refreshJoints.js';
import { rotateByQuat } from './rigid.js';

const SHEET = '2026-10-11-14-00-00-0001-smet';
const BLOCK = '2026-10-11-14-00-00-0002-blok';
const PIN = '2026-10-11-14-00-00-0003-pin1';

// Hat section plus a tab. Face ids restart on each flange box and bend zone.
// The tab shares edges with those flanges, which is what glued a bend facet
// onto a flange when the catalog ignored the Manifold run.
const HAT = {
  v: 1,
  t: 2,
  r: 2,
  k: 0.4,
  plane: 'XZ',
  width: 80,
  height: 40,
  bends: [
    { id: 'b1', panel: 'base', edge: 'u-', angle: 90, length: 18, flip: true },
    { id: 'b2', panel: 'b1', edge: 'u+', angle: 90, length: 18, flip: false },
    { id: 'b3', panel: 'base', edge: 'u+', angle: 90, length: 18, flip: true },
    { id: 'b4', panel: 'b3', edge: 'u+', angle: 90, length: 18, flip: false },
  ],
  tabs: [{ id: 't1', panel: 'base', edge: 'v+', width: 16, depth: 8, centered: true, offset: 20 }],
  holes: [{ id: 'h1', panel: 'base', u: 0, v: 0, d: 6, type: 'hole' }],
};

function sheetScript() {
  return `const sheetSpec = ${JSON.stringify(HAT)};\nlet part = sheetMetalSolid(sheetSpec);\nreturn part;\n`;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

function gapAlong(a, b) {
  const n = unit(a.n);
  return (b.at[0] - a.at[0]) * n[0] + (b.at[1] - a.at[1]) * n[1] + (b.at[2] - a.at[2]) * n[2];
}

function picksOf(mesh) {
  const solid = buildSolidGeometry(mesh);
  const faces = fingerprintsFromGeometry(solid.geometry, solid.faceIDs);
  const positions = solid.geometry.attributes.position.array;
  const indices = solid.geometry.index.array;
  const axes = [];
  for (const face of faces) {
    if (face.kind === 'planar') continue;
    const axis = fitJointAxis(positions, indices, face.tris);
    if (axis) axes.push(axis);
  }
  solid.geometry.dispose();
  return { faces, axes };
}

function thicknessPair(faces) {
  const keys = faces.filter((face) => face.kind === 'planar').map(faceColorKey).filter(Boolean);
  let best = null;
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      if (dot(unit(keys[i].n), unit(keys[j].n)) > -0.99) continue;
      const span = Math.abs(gapAlong(keys[i], keys[j]));
      if (!(span > 0.4) || span > 40) continue;
      const score = Math.min(keys[i].area, keys[j].area);
      if (!best || score > best.score) best = { score, span, pair: [keys[i], keys[j]] };
    }
  }
  return best;
}

function faceAlong(faces, normal) {
  const want = unit(normal);
  let best = null;
  for (const face of faces) {
    if (face.kind !== 'planar') continue;
    const key = faceColorKey(face);
    if (!key) continue;
    const align = dot(unit(key.n), want);
    if (align < 0.99) continue;
    if (!best || key.area > best.area) best = key;
  }
  return best;
}

function worldAt(part, at) {
  return worldPoint(at, partPlacement(part));
}

function worldN(part, normal) {
  return rotateByQuat(partPlacement(part).q, unit(normal));
}

function partRow(id, name, surfId, t) {
  const row = {
    id,
    name,
    visible: true,
    order: 0,
    surfId,
    position: t.slice(),
  };
  if (t.some((value) => value !== 0)) row.placement = { t: t.slice(), q: [0, 0, 0, 1] };
  return row;
}

function assembly(parts, joints) {
  return {
    version: 1,
    source: 'local',
    name: 'Assembly',
    activeId: parts[0].id,
    parts,
    joints,
  };
}

let loaded;
function load() {
  loaded ??= (async () => {
    const sheet = await runScript(sheetScript());
    const block = await runScript('let part = Manifold.cube([30, 30, 30], true);\nreturn part;\n');
    const pin = await runScript(sheetScript());
    const out = {
      sheetPicks: picksOf(sheet.mesh),
      blockPicks: picksOf(block.mesh),
      pinPicks: picksOf(pin.mesh),
      sheetCatalog: catalogFromMeshData(sheet.mesh),
      blockCatalog: catalogFromMeshData(block.mesh),
      pinCatalog: catalogFromMeshData(pin.mesh),
    };
    sheet.manifold?.delete?.();
    block.manifold?.delete?.();
    pin.manifold?.delete?.();
    return out;
  })();
  return loaded;
}

function faceRef(part, key) {
  return { part, kind: 'face', key };
}

function solved(parts, joint, catalogs) {
  return refreshAssemblyJoints({
    doc: assembly(parts, [joint]),
    catalogs,
  });
}

test('a sheet-metal pick resolves on bend and flange faces', { timeout: 60_000 }, async () => {
  const ctx = await load();
  const planar = ctx.sheetPicks.faces.filter((face) => face.kind === 'planar');
  assert.ok(planar.length >= 8, `planar faces ${planar.length}`);
  for (const face of planar) {
    const key = faceColorKey(face);
    const hit = matchJointFace(ctx.sheetCatalog.faces, key);
    assert.equal(hit.status, 'ok', `face ${key.at.map((n) => n.toFixed(1)).join(',')} ${hit.status}`);
  }
  assert.ok(ctx.sheetPicks.axes.length >= 1, 'the hole should fit an axis');
  for (const axis of ctx.sheetPicks.axes) {
    const hit = matchJointAxis(ctx.sheetCatalog.axes, axis);
    assert.notEqual(hit.status, 'missing', `axis at ${axis.at.map((n) => n.toFixed(1)).join(',')}`);
  }
});

test('every joint type solves against the resolved sheet-metal faces', { timeout: 60_000 }, async () => {
  const ctx = await load();
  const sheetPair = thicknessPair(ctx.sheetPicks.faces);
  const blockPair = thicknessPair(ctx.blockPicks.faces);
  assert.ok(sheetPair, 'sheet flange pair');
  assert.ok(blockPair, 'block pair');
  const sheetFace = faceAlong(ctx.sheetPicks.faces, [0, 0, 1]);
  const blockOpposite = faceAlong(ctx.blockPicks.faces, [0, 0, -1]);
  const blockSide = faceAlong(ctx.blockPicks.faces, [1, 0, 0]);
  assert.ok(sheetFace && blockOpposite && blockSide);
  const sheetAxis = ctx.sheetPicks.axes.find((axis) => matchJointAxis(ctx.sheetCatalog.axes, axis).status === 'ok');
  const pinAxis = ctx.pinPicks.axes.find((axis) => matchJointAxis(ctx.pinCatalog.axes, axis).status === 'ok');
  assert.ok(sheetAxis, 'unique hole axis');
  assert.ok(pinAxis, 'pin hole axis');

  const sheet = partRow('sheet.js', 'Sheet Metallica', SHEET, [0, 0, 0]);
  const block = partRow('block.js', 'Block', BLOCK, [90, 0, 30]);
  const pin = partRow('pin.js', 'Pin', PIN, [40, 20, 0]);
  const faceCatalogs = { [SHEET]: ctx.sheetCatalog, [BLOCK]: ctx.blockCatalog };
  const parts = [sheet, block];

  const symmetric = solved(parts, {
    id: 'sym',
    name: 'Symmetric 1',
    type: 'symmetric',
    a: faceRef(SHEET, sheetPair.pair[0]),
    a2: faceRef(SHEET, sheetPair.pair[1]),
    b: faceRef(BLOCK, blockPair.pair[0]),
    b2: faceRef(BLOCK, blockPair.pair[1]),
  }, faceCatalogs);
  assert.equal(symmetric.statuses.sym, 'ok', symmetric.messages?.sym || symmetric.message || '');
  assert.equal(symmetric.ok, true);
  const sheetPart = symmetric.doc.parts.find((row) => row.surfId === SHEET);
  const blockPart = symmetric.doc.parts.find((row) => row.surfId === BLOCK);
  const mid = (keys, part) => {
    const a = worldAt(part, keys[0].at);
    const b = worldAt(part, keys[1].at);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  };
  const midA = mid(sheetPair.pair, sheetPart);
  const midB = mid(blockPair.pair, blockPart);
  const normal = worldN(sheetPart, sheetPair.pair[0].n);
  const planeGap = (midB[0] - midA[0]) * normal[0]
    + (midB[1] - midA[1]) * normal[1]
    + (midB[2] - midA[2]) * normal[2];
  assert.ok(Math.abs(planeGap) < 1e-2, `symmetric gap ${planeGap}`);
  const align = Math.abs(dot(normal, worldN(blockPart, blockPair.pair[0].n)));
  assert.ok(align > 1 - 1e-3, `symmetric align ${align}`);

  const coincident = solved(parts, {
    id: 'coin',
    name: 'Coincident 1',
    type: 'coincident',
    opposed: true,
    a: faceRef(SHEET, sheetFace),
    b: faceRef(BLOCK, blockOpposite),
  }, faceCatalogs);
  assert.equal(coincident.statuses.coin, 'ok', coincident.messages?.coin || coincident.message || '');
  const coinSheet = coincident.doc.parts.find((row) => row.surfId === SHEET);
  const coinBlock = coincident.doc.parts.find((row) => row.surfId === BLOCK);
  const coinN = worldN(coinSheet, sheetFace.n);
  const coinA = worldAt(coinSheet, sheetFace.at);
  const coinB = worldAt(coinBlock, blockOpposite.at);
  const coinGap = (coinB[0] - coinA[0]) * coinN[0] + (coinB[1] - coinA[1]) * coinN[1] + (coinB[2] - coinA[2]) * coinN[2];
  assert.ok(Math.abs(coinGap) < 1e-2, `coincident gap ${coinGap}`);

  const distance = solved(parts, {
    id: 'dist',
    name: 'Distance 1',
    type: 'distance',
    value: 12,
    sense: 1,
    a: faceRef(SHEET, sheetFace),
    b: faceRef(BLOCK, blockOpposite),
  }, faceCatalogs);
  assert.equal(distance.statuses.dist, 'ok', distance.messages?.dist || distance.message || '');
  const distSheet = distance.doc.parts.find((row) => row.surfId === SHEET);
  const distBlock = distance.doc.parts.find((row) => row.surfId === BLOCK);
  const distN = worldN(distSheet, sheetFace.n);
  const distA = worldAt(distSheet, sheetFace.at);
  const distB = worldAt(distBlock, blockOpposite.at);
  const distGap = (distB[0] - distA[0]) * distN[0] + (distB[1] - distA[1]) * distN[1] + (distB[2] - distA[2]) * distN[2];
  assert.ok(Math.abs(distGap - 12) < 1e-2, `distance gap ${distGap}`);

  const angle = solved(parts, {
    id: 'ang',
    name: 'Angle 1',
    type: 'angle',
    value: 90,
    sense: 1,
    a: faceRef(SHEET, sheetFace),
    b: faceRef(BLOCK, blockSide),
  }, faceCatalogs);
  assert.equal(angle.statuses.ang, 'ok', angle.messages?.ang || angle.message || '');
  const angSheet = angle.doc.parts.find((row) => row.surfId === SHEET);
  const angBlock = angle.doc.parts.find((row) => row.surfId === BLOCK);
  const angDot = Math.abs(dot(worldN(angSheet, sheetFace.n), worldN(angBlock, blockSide.n)));
  assert.ok(angDot < 1e-2, `angle dot ${angDot}`);

  const concentric = solved(
    [sheet, pin],
    {
      id: 'con',
      name: 'Concentric 1',
      type: 'concentric',
      a: { part: SHEET, kind: 'axis', key: sheetAxis },
      b: { part: PIN, kind: 'axis', key: pinAxis },
    },
    { [SHEET]: ctx.sheetCatalog, [PIN]: ctx.pinCatalog },
  );
  assert.equal(concentric.statuses.con, 'ok', concentric.messages?.con || concentric.message || '');

  const fixed = solved(
    [sheet],
    { id: 'fix', name: 'Fixed 1', type: 'fixed', a: { part: SHEET } },
    { [SHEET]: ctx.sheetCatalog },
  );
  assert.equal(fixed.statuses.fix, 'ok', fixed.messages?.fix || fixed.message || '');
  assert.deepEqual(fixed.doc.parts[0].position, [0, 0, 0]);
});
