import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute, BufferGeometry } from 'three';
import { runScript } from '../lib/surfcad/index.js';
import { annotateFeatureEdges, indexBoundaryEdges } from './boundaryEdgeIds.js';
import { assembleSweepPath, splitEdgePathComponents } from './edgeSweepPath.js';
import { failedFeatureFromOutcome, failedFeatureIds } from './featureFailure.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import {
  composeChamferCommit,
  composeFilletCommit,
  replaceEditedBlend,
} from './filletMode.js';
import { isFilletSliverDirty } from './filletSliverGuard.js';
import { buildCoherentEdges, buildFeatureEdges } from './selectEdge.js';

const STARTER = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';
const CUBE_VOLUME = 40 * 30 * 20;

function geomOf(mesh) {
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  const nVert = Math.floor(src.length / np);
  const positions = new Float32Array(nVert * 3);
  for (let i = 0; i < nVert; i += 1) {
    positions[i * 3] = src[i * np];
    positions[i * 3 + 1] = src[i * np + 1];
    positions[i * 3 + 2] = src[i * np + 2];
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  return g;
}

function sliverDirty(mesh) {
  const np = mesh.numProp || 3;
  const V = mesh.vertProperties;
  const T = mesh.triVerts;
  const nTri = T.length / 3;
  let tiny = 0;
  for (let ti = 0; ti < nTri; ti += 1) {
    const i0 = T[ti * 3] * np;
    const i1 = T[ti * 3 + 1] * np;
    const i2 = T[ti * 3 + 2] * np;
    const ax = V[i1] - V[i0];
    const ay = V[i1 + 1] - V[i0 + 1];
    const az = V[i1 + 2] - V[i0 + 2];
    const bx = V[i2] - V[i0];
    const by = V[i2 + 1] - V[i0 + 1];
    const bz = V[i2 + 2] - V[i0 + 2];
    const area = 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    if (area < 1e-8) tiny += 1;
  }
  return isFilletSliverDirty(tiny, nTri);
}

async function solidOf(script, label) {
  let ran;
  try {
    ran = await runScript(script);
  } catch (error) {
    assert.fail(`${label} threw: ${error.message}`);
  }
  assert.equal(ran.featureSkip ?? null, null, `${label} skipped: ${ran.featureSkip?.message || ''}`);
  assert.equal(ran.status, 'NoError', label);
  assert.equal(ran.bodyCount, 1, `${label} bodies`);
  assert.equal(sliverDirty(ran.mesh), false, `${label} sliver dirty`);
  assert.ok(ran.volume > CUBE_VOLUME * 0.5 && ran.volume < CUBE_VOLUME - 1, `${label} volume ${ran.volume}`);
  return ran;
}

let faceLoop;
let cubeGeometry;

test.before(async () => {
  const cube = await runScript(STARTER);
  const g = geomOf(cube.mesh);
  const topo = indexBoundaryEdges({
    positions: g.attributes.position.array,
    indices: g.index.array,
    faceIDs: cube.mesh.faceID,
  });
  const edges = buildCoherentEdges(annotateFeatureEdges(buildFeatureEdges(g), topo));
  const byFace = new Map();
  for (const edge of edges) {
    for (const face of [edge.faceA, edge.faceB]) {
      if (!Number.isFinite(face)) continue;
      if (!byFace.has(face)) byFace.set(face, []);
      byFace.get(face).push(edge);
    }
  }
  for (const list of byFace.values()) {
    const split = splitEdgePathComponents(list);
    if (!split.ok || split.components.length !== 1 || split.components[0].length < 4) continue;
    const built = assembleSweepPath(split.components[0]);
    if (built.ok && built.value.closed) {
      faceLoop = split.components[0];
      break;
    }
  }
  assert.ok(faceLoop, 'cube face loop');
  cubeGeometry = g;
});

function commit(chamfer, buffer, edges, size, commitMode = 'replace') {
  const params = chamfer ? { chamfer: size } : { radius: size, strategy: 'sweep' };
  const opts = { edges, params, commitMode, ...(chamfer ? {} : { filletClass: 'easy', geometry: cubeGeometry }) };
  const created = chamfer ? composeChamferCommit(buffer, opts) : composeFilletCommit(buffer, opts);
  assert.equal(created.ok, true, created.message || '');
  return created.buffer;
}

function edit(chamfer, script, edges, size) {
  const kind = chamfer ? 'chamfer' : 'fillet';
  const feature = parseFeatureMarkers(script).filter((item) => item.kind === kind).at(-1);
  assert.ok(feature, kind);
  const params = chamfer ? { chamfer: size } : { radius: size, strategy: 'sweep' };
  const edited = replaceEditedBlend(script, feature, {
    chamfer,
    edges,
    params,
    ...(chamfer ? {} : { filletClass: 'easy', geometry: cubeGeometry }),
  });
  assert.equal(edited.ok, true, edited.message || '');
  assert.equal(edited.changed, true);
  assert.equal(parseFeatureMarkers(edited.buffer).length, parseFeatureMarkers(script).length);
  return edited.buffer;
}

for (const chamfer of [false, true]) {
  const kind = chamfer ? 'chamfer' : 'fillet';

  test(`${kind}: closed face loop on a cube creates and edits`, { timeout: 60_000 }, async () => {
    const created = commit(chamfer, STARTER, faceLoop, 2);
    assert.equal((created.match(/filletAlongPath\s*\(/g) || []).length, 1);
    const made = await solidOf(created, `${kind} create`);
    const edited = edit(chamfer, created, faceLoop, 4);
    const fresh = commit(chamfer, STARTER, faceLoop, 4);
    const editedSolid = await solidOf(edited, `${kind} edit`);
    const freshSolid = await solidOf(fresh, `${kind} fresh edit`);
    assert.ok(Math.abs(editedSolid.volume - freshSolid.volume) < 1e-3, `${editedSolid.volume} vs ${freshSolid.volume}`);
    assert.ok(Math.abs(editedSolid.volume - made.volume) > 1, 'edit did not change the solid');
  });

  test(`${kind}: closed loop through prior fillets, including a crossing loop`, { timeout: 60_000 }, async () => {
    const seam = (size) => `
let part = Manifold.cube([40, 30, 20], true);
for (const [fa, fb] of [[3, 6], [2, 3], [1, 2], [1, 6]]) {
  part = filletAlongPath(part, makeSweepPath(edgesBetween(part, fa, fb)), 6);
}
const top = convexEdges(part).filter((e) => {
  const m = [(e.va[0] + e.vb[0]) / 2, (e.va[1] + e.vb[1]) / 2, (e.va[2] + e.vb[2]) / 2];
  return Math.abs(m[1] - 15) < 0.35;
});
const path = makeSweepPath(top);
if (!path.closed) throw new Error('face loop was not closed');
part = filletAlongPath(part, path, ${size}${chamfer ? ", { profile: 'chamfer' }" : ''});
return part;
`;
    const created = await solidOf(seam(2), `${kind} seam create`);
    const edited = await solidOf(seam(4), `${kind} seam edit`);
    assert.ok(Math.abs(edited.volume - created.volume) > 1, 'seam edit did not change the solid');

    const cross = (size) => `
let part = Manifold.cube([40, 30, 20], true);
const path = { kind: 'sweepPath', closed: true, points: [[-20,-15,10],[20,15,10],[20,-15,10],[-20,15,10]] };
part = filletAlongPath(part, path, ${size}${chamfer ? ", { profile: 'chamfer' }" : ''});
return part;
`;
    const crossed = await solidOf(cross(3), `${kind} cross create`);
    const crossedEdit = await solidOf(cross(5), `${kind} cross edit`);
    assert.ok(Math.abs(crossedEdit.volume - crossed.volume) > 1, 'cross edit did not change the solid');
  });

  test(`${kind}: a forced failure skips that feature instead of throwing`, async () => {
    const begin = chamfer ? '// --- chamfer-mode begin ---' : '// --- fillet-mode begin ---';
    const end = chamfer ? '// --- chamfer-mode end ---' : '// --- fillet-mode end ---';
    const opts = chamfer ? ", { profile: 'chamfer' }" : '';
    const script = `let part = Manifold.cube([40, 30, 20], true);
${begin}
part = filletAlongPath(part, makeSweepPath(edge(part, 0)), 0${opts});
${end}
return part;
`;
    let ran;
    try {
      ran = await runScript(script);
    } catch (error) {
      assert.fail(`${kind} forced failure threw over the part: ${error.message}`);
    }
    assert.equal(ran.status, 'NoError');
    assert.equal(ran.bodyCount, 1);
    assert.ok(Math.abs(ran.volume - CUBE_VOLUME) < 1e-6, `skipped solid volume ${ran.volume}`);
    const skip = ran.featureSkip;
    assert.ok(skip, 'expected a feature skip');
    assert.match(skip.message, /radius must be a finite number > 0/);
    const failure = failedFeatureFromOutcome(script, {
      featureId: skip.featureId,
      featureBlock: skip.featureBlock,
      scriptLine: skip.scriptLine,
    });
    assert.equal(failure?.kind, kind);
    const red = failedFeatureIds(script, failure);
    assert.equal(red.has(failure.id), true);
    assert.equal(red.has(parseFeatureMarkers(script)[0].id), true);
  });
}
