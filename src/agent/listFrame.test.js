/**
 * list_faces on a placed crankset (playtest position [430, 0, 290]) returns
 * the part mesh. That frame is local on purpose: select_faces and joint_pick
 * match keys against the same mesh. The result says so with frame: "local".
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from '../utils/partSolidCache.js';
import { fingerprintsFromGeometry } from '../utils/facePaint.js';
import { buildFeatureEdges } from '../utils/selectEdge.js';
import { indexBoundaryEdgesFromGeometry } from '../utils/boundaryEdgeIds.js';
import { worldPoint } from '../utils/partPose.js';
import { agentFaceCatalog } from './faceCatalog.js';
import { buildEdgeList, buildFaceList, buildGroupedEdgeList } from './state/listPickables.js';
import { listFacesCommand } from './commands/listFaces.js';
import { listEdgesCommand } from './commands/listEdges.js';
import { listFeatureEdgesCommand } from './commands/listFeatureEdges.js';

const PLACED = { t: [430, 0, 290], q: [0, 0, 0, 1] };
const CUBE = 'const part = Manifold.cube([20, 30, 40], true);\nreturn part;\n';

function near(a, b, tol = 1e-3) {
  return Array.isArray(a) && Array.isArray(b) && a.length >= 3
    && a.every((v, i) => Math.abs(v - b[i]) <= tol);
}

test('a placed part lists faces and edges in its own frame', { timeout: 60_000 }, async () => {
  const run = await runScript(CUBE);
  assert.ok(run.mesh, run.error || 'no mesh');
  const solid = buildSolidGeometry(run.mesh);
  const catalog = agentFaceCatalog(solid.geometry, solid.faceIDs);
  const fingerprints = fingerprintsFromGeometry(solid.geometry, solid.faceIDs);
  const topo = indexBoundaryEdgesFromGeometry(solid.geometry, solid.faceIDs);
  const ctx = {
    listFaces: () => ({ partId: 'crank', ...buildFaceList(catalog) }),
    listEdges: () => ({
      partId: 'crank',
      raw: true,
      ...buildEdgeList(buildFeatureEdges(solid.geometry), fingerprints),
    }),
    listFeatureEdges: () => ({ partId: 'crank', grouped: true, ...buildGroupedEdgeList(topo) }),
  };

  const faces = listFacesCommand.run(ctx, {}).result;
  assert.equal(faces.frame, 'local');
  const top = faces.faces.find((row) => row.normal[2] > 0.9 && row.type === 'planar');
  assert.ok(top, 'cube has a +Z face');
  assert.ok(near(top.center, [0, 0, 20]), `local center ${top.center}`);
  assert.ok(near(top.key.at, top.center), 'the select_faces key stays on the local center');
  const world = worldPoint(top.center, PLACED);
  assert.ok(near(world, [430, 0, 310]), `world would be ${world}`);
  assert.ok(!near(top.center, world), 'placement is not applied to list_faces');

  const edges = listEdgesCommand.run(ctx, { raw: true }).result;
  assert.equal(edges.frame, 'local');
  assert.ok(edges.edges.length > 0);
  for (const edge of edges.edges) {
    const placed = worldPoint(edge.mid, PLACED);
    assert.ok(!near(edge.mid, placed), `edge mid ${edge.mid} was shifted to the assembly`);
  }

  const grouped = listFeatureEdgesCommand.run(ctx, {}).result;
  assert.equal(grouped.frame, 'local');
  assert.ok(grouped.edges.some((edge) => /^e\d+$/.test(edge.key)));
  for (const edge of grouped.edges) {
    assert.ok(!near(edge.mid, worldPoint(edge.mid, PLACED)));
  }
  const viaEdges = listEdgesCommand.run(ctx, { grouped: true }).result;
  assert.equal(viaEdges.frame, 'local');

  run.manifold?.delete?.();
});
