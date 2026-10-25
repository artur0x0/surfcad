import assert from 'node:assert/strict';
import test from 'node:test';
import { memoKey } from '../lib/surfcad/featureMemo.js';
import { meshToStl, runScript } from '../lib/surfcad/index.js';
import { assetKeyFromAssets, decideMeshShip, runFromShip } from './meshShip.js';
import { collectTransferBuffers, copyMeshForTransfer, meshTransferList } from './meshTransfer.js';
import {
  bakeRigidMesh,
  composePlacementWithMatrix,
  matrixToPlacement,
  poseAgentCatalog,
  poseFaceRecord,
  rigidMatrixForOps,
  rotateAboutMatrix,
  splitTrailingRigid,
  transformPoint,
  translationMatrix,
} from './rigidSuffix.js';

const MOVE_BEGIN = '// --- move begin ---';
const MOVE_END = '// --- move end ---';

function cubeScript() {
  return 'let part = Manifold.cube([10, 10, 10], true);\nreturn part;\n';
}

function moveScript(dx) {
  return [
    'let part = Manifold.cube([10, 10, 10], true);',
    MOVE_BEGIN,
    `part = move(part, [${dx}, 0, 0], { bodies: [{ at: [0, 0, 0] }] });`,
    MOVE_END,
    'return part;',
  ].join('\n');
}

function booleanAfterMove() {
  return [
    'let part = Manifold.cube([10, 10, 10], true);',
    MOVE_BEGIN,
    'part = move(part, [20, 0, 0], { bodies: [{ at: [0, 0, 0] }] });',
    MOVE_END,
    'const tool = Manifold.cube([10, 10, 10], true);',
    'part = part.subtract(tool);',
    'return part;',
  ].join('\n');
}

function fakeMesh(seed = 0) {
  return {
    numProp: 3,
    vertProperties: new Float32Array([seed, 0, 0, seed + 1, 0, 0, seed, 1, 0]),
    triVerts: new Uint32Array([0, 1, 2]),
  };
}

function runOf(script, mesh, extra = {}) {
  const split = splitTrailingRigid(script);
  const prefix = split?.ops.length ? split.prefix : script;
  return {
    ok: true,
    mesh,
    unmoved: true,
    scriptKey: memoKey(script, ''),
    meshKey: memoKey(prefix, ''),
    salt: '',
    assetKey: '',
    baseCentroid: [0, 0, 0],
    baseBBox: { min: [-5, -5, -5], max: [5, 5, 5] },
    bbox: { min: [-5, -5, -5], max: [5, 5, 5] },
    bodyCount: 1,
    volume: 1000,
    ...extra,
  };
}

test('trailing move parses and a later boolean does not', () => {
  const split = splitTrailingRigid(moveScript(4));
  assert.equal(split.ops.length, 1);
  assert.equal(split.ops[0].kind, 'move');
  assert.deepEqual(split.ops[0].delta, [4, 0, 0]);
  assert.equal(splitTrailingRigid(booleanAfterMove()).ops.length, 0);
  const mid = [
    MOVE_BEGIN,
    'part = move(part, [1, 0, 0], { bodies: [{ at: [0, 0, 0] }] });',
    MOVE_END,
    'part = part.subtract(tool);',
  ].join('\n');
  assert.equal(splitTrailingRigid(mid).ops.length, 0);
});

test('rigid matrix follows the centroid and rejects a wrong at', () => {
  const ok = rigidMatrixForOps(
    [{ kind: 'move', delta: [5, 0, 0], at: [0, 0, 0] }],
    [0, 0, 0],
  );
  assert.ok(ok);
  assert.equal(ok.matrix[12], 5);
  assert.deepEqual(ok.centroid, [5, 0, 0]);
  assert.equal(rigidMatrixForOps(
    [{ kind: 'move', delta: [5, 0, 0], at: [1, 0, 0] }],
    [0, 0, 0],
  ), null);
});

test('unchanged script reuses, a dx edit is rigid, deleting the move is identity', () => {
  const mesh = fakeMesh();
  const base = cubeScript();
  const moved = moveScript(5);
  const again = moveScript(8);
  const first = runOf(base, mesh);
  assert.equal(decideMeshShip({ script: base, previous: first }).action, 'reuse');
  const withMove = runOf(moved, mesh, {
    featureRigid: translationMatrix(5, 0, 0),
    bbox: { min: [0, -5, -5], max: [10, 5, 5] },
    bodyCentroids: [[5, 0, 0]],
  });
  const dx = decideMeshShip({ script: again, previous: withMove });
  assert.equal(dx.action, 'rigid');
  assert.equal(dx.featureRigid[12], 8);
  assert.equal(dx.mesh, mesh);
  const kept = runFromShip(withMove, dx);
  assert.equal(kept.mesh, mesh);
  assert.deepEqual(Array.from(kept.mesh.vertProperties), Array.from(mesh.vertProperties));
  assert.equal(kept.featureRigid[12], 8);
  const dropped = decideMeshShip({ script: base, previous: kept });
  assert.equal(dropped.action, 'rigid');
  assert.equal(dropped.featureRigid, null);
  const cleared = runFromShip(kept, dropped);
  assert.equal(cleared.featureRigid, undefined);
  assert.equal(cleared.mesh.featureRigid, undefined);
});

test('a different asset map, a second body, or a boolean after the move rebuilds', () => {
  const mesh = fakeMesh();
  const moved = moveScript(5);
  const previous = runOf(moved, mesh);
  assert.equal(decideMeshShip({
    script: moved,
    assetKey: assetKeyFromAssets({ 'A.mesh': 'a'.repeat(40) }),
    previous,
  }).reason, 'assets');
  assert.equal(decideMeshShip({
    script: moveScript(6),
    previous: { ...previous, bodyCount: 2 },
  }).reason, 'bodies');
  assert.equal(decideMeshShip({
    script: booleanAfterMove(),
    previous,
  }).action, 'rebuild');
});

test('world pose is the assembly placement times the feature rigid', () => {
  const pose = composePlacementWithMatrix(
    { t: [100, 0, 0], q: [0, 0, 0, 1] },
    translationMatrix(5, 0, 0),
  );
  assert.deepEqual(pose.t, [105, 0, 0]);
  const turn = rotateAboutMatrix([0, 0, 1], 90, [0, 0, 0]);
  const turnedPose = matrixToPlacement(turn);
  assert.ok(Math.abs(turnedPose.q[2] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(turnedPose.q[3] - Math.SQRT1_2) < 1e-6);
  const placed = composePlacementWithMatrix({ t: [0, 0, 0], q: turnedPose.q }, null);
  const qx = placed.q[0]; const qy = placed.q[1]; const qz = placed.q[2]; const qw = placed.q[3];
  const vx = 1; const vy = 0; const vz = 0;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  const spun = [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
  const viaMatrix = transformPoint(turn, [1, 0, 0]);
  for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(spun[k] - viaMatrix[k]) < 1e-5);
  const face = poseFaceRecord({ center: [1, 2, 3], normal: [0, 0, 1] }, translationMatrix(5, 0, 0));
  assert.deepEqual(face.center, [6, 2, 3]);
  assert.deepEqual(face.normal, [0, 0, 1]);
});

test('agent face rows are posed without rewriting the cached row', () => {
  const rows = [{
    at: [0, 0, 0],
    n: [0, 0, 1],
    area: 4,
    ensureAxis() { this.axis = { at: [0, 0, 0], dir: [0, 0, 1] }; },
  }];
  const posed = poseAgentCatalog(rows, translationMatrix(3, 0, 0));
  assert.deepEqual(posed[0].at, [3, 0, 0]);
  assert.equal(rows[0].at[0], 0);
  posed[0].ensureAxis();
  assert.deepEqual(posed[0].axis.at, [3, 0, 0]);
  assert.deepEqual(rows[0].axis.at, [0, 0, 0]);
});

test('transfer lists take owned buffers and leave sliced views attached', () => {
  const mesh = fakeMesh(2);
  const list = meshTransferList(mesh);
  assert.ok(list.includes(mesh.vertProperties.buffer));
  assert.ok(list.includes(mesh.triVerts.buffer));
  const shared = new ArrayBuffer(64);
  const sliced = new Float32Array(shared, 4, 3);
  assert.deepEqual(collectTransferBuffers({ vertProperties: sliced }), []);
  const copy = copyMeshForTransfer(mesh);
  assert.notEqual(copy.mesh.vertProperties.buffer, mesh.vertProperties.buffer);
  assert.ok(copy.transfers.includes(copy.mesh.vertProperties.buffer));
  assert.equal(mesh.vertProperties[0], 2);
});

test('export and a boolean see the moved solid', async () => {
  const base = await runScript(cubeScript());
  const moved = await runScript(moveScript(5));
  const matrix = translationMatrix(5, 0, 0);
  base.mesh.featureRigid = matrix;
  const baked = bakeRigidMesh(base.mesh, matrix);
  const box = (mesh) => {
    const np = mesh.numProp || 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const n = Math.floor(mesh.vertProperties.length / np);
    for (let i = 0; i < n; i += 1) {
      for (let k = 0; k < 3; k += 1) {
        const v = mesh.vertProperties[i * np + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
    return { min, max };
  };
  const bakedBox = box(baked);
  const movedBox = box(moved.mesh);
  for (let k = 0; k < 3; k += 1) {
    assert.ok(Math.abs(bakedBox.min[k] - movedBox.min[k]) < 1e-3);
    assert.ok(Math.abs(bakedBox.max[k] - movedBox.max[k]) < 1e-3);
  }
  const stl = meshToStl(base.mesh);
  assert.equal(new DataView(stl.buffer).getUint32(80, true), base.tris);
  assert.equal(base.mesh.vertProperties[0], baked.vertProperties[0] - 5);
  const wide = await runScript('let part = Manifold.cube([20, 10, 10], true);\nreturn part;\n');
  const turned = await runScript(
    'let part = Manifold.cube([20, 10, 10], true);\n'
    + 'part = rotateAbout(part, [0, 0, 1], 90, null, { bodies: [{ at: [0, 0, 0] }] });\n'
    + 'return part;\n',
  );
  const unmovedX = wide.mesh.vertProperties[0];
  const bakedTurn = bakeRigidMesh(wide.mesh, rotateAboutMatrix([0, 0, 1], 90, [0, 0, 0]));
  const turnedBox = box(turned.mesh);
  const bakedTurnBox = box(bakedTurn);
  for (let k = 0; k < 3; k += 1) {
    assert.ok(Math.abs(bakedTurnBox.min[k] - turnedBox.min[k]) < 1e-3);
    assert.ok(Math.abs(bakedTurnBox.max[k] - turnedBox.max[k]) < 1e-3);
  }
  assert.equal(wide.mesh.vertProperties[0], unmovedX);
  assert.notEqual(bakedTurn, wide.mesh);
  const separated = await runScript(booleanAfterMove());
  assert.ok(Math.abs(separated.volume - 1000) < 1, `volume ${separated.volume}`);
  const mesh = fakeMesh();
  const decision = decideMeshShip({
    script: booleanAfterMove(),
    previous: runOf(moveScript(20), mesh),
  });
  assert.equal(decision.action, 'rebuild');
});
