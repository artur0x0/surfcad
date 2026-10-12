import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { annotateFeatureEdges, indexBoundaryEdges } from './boundaryEdgeIds.js';
import { projectReference } from './contourRef.js';
import {
  chainSegments,
  edgeReferenceHit,
  faceOutlineHit,
  materializeReference,
  referenceHitAt,
  vertexHit,
} from './contourRefPick.js';
import { resolveContourSpec } from './contourRefResolve.js';
import { buildSolidGeometry, contourBoundariesFor } from './partSolidCache.js';
import { buildCoherentEdges, buildFeatureEdges } from './selectEdge.js';

// Sheet Metallica: hat section, tab, and a hole. Face ids restart on each
// flange box and bend zone. The thickness faces are small next to the
// flanges, which is what dropped every boundary from the fillet catalog.
const SPEC = {
  v: 1,
  sku: 'SST316-125',
  material: 'Stainless Steel (316 Series)',
  t: 3.175,
  r: 3.81,
  k: 0.38,
  plane: 'XZ',
  width: 100,
  height: 60,
  bends: [
    { id: 'b1', panel: 'base', edge: 'u-', angle: 90, length: 28.2, flip: true },
    { id: 'b2', panel: 'b1', edge: 'u+', angle: 90, length: 28.2, flip: false },
    { id: 'b3', panel: 'base', edge: 'u+', angle: 90, length: 28.2, flip: true },
    { id: 'b4', panel: 'b3', edge: 'u+', angle: 90, length: 28.2, flip: false },
  ],
  tabs: [{ id: 't1', panel: 'base', edge: 'v+', width: 25, depth: 10, centered: true, offset: 37.5 }],
  holes: [{ id: 'h1', panel: 'base', u: -23.93, v: 1.91, d: 5, type: 'hole' }],
};

// Outward side of the base (material runs along -Y). x along +X, y along -Z.
const PLANE = {
  center: [0, 0, 0],
  normal: [0, 1, 0],
  x: [1, 0, 0],
  y: [0, 0, -1],
};

function scriptOf(spec) {
  return `const sheetSpec = ${JSON.stringify(spec)};\nlet part = sheetMetalSolid(sheetSpec);\nreturn part;\n`;
}

function pairKey(edge) {
  const lo = Math.min(edge.faceA, edge.faceB);
  const hi = Math.max(edge.faceA, edge.faceB);
  return `${lo}:${hi}`;
}

function chainOf(edge) {
  return chainSegments(edge.segments || [])[0] || null;
}

function ySpan(points) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p[1] < min) min = p[1];
    if (p[1] > max) max = p[1];
  }
  return max - min;
}

let loaded;
function load() {
  loaded ??= (async () => {
    const sheet = await runScript(scriptOf(SPEC));
    const longer = {
      ...SPEC,
      bends: SPEC.bends.map((bend) => (bend.id === 'b2' ? { ...bend, length: 40 } : bend)),
    };
    const edited = await runScript(scriptOf(longer));
    const box = await runScript('let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n');
    const out = {
      sheet: catalog(sheet.mesh),
      edited: catalog(edited.mesh),
      box: catalog(box.mesh),
    };
    sheet.manifold?.delete?.();
    edited.manifold?.delete?.();
    box.manifold?.delete?.();
    return out;
  })();
  return loaded;
}

function catalog(mesh) {
  const solid = buildSolidGeometry(mesh);
  const geom = solid.geometry;
  const fillet = indexBoundaryEdges({
    positions: geom.attributes.position.array,
    indices: geom.index.array,
    faceIDs: solid.faceIDs,
  });
  const contour = contourBoundariesFor(geom, solid.faceIDs);
  const raw = buildFeatureEdges(geom);
  const coherent = buildCoherentEdges(annotateFeatureEdges(raw, fillet));
  return { fillet, contour, coherent, geom };
}

function disposeAll(ctx) {
  ctx.sheet.geom.dispose();
  ctx.edited.geom.dispose();
  ctx.box.geom.dispose();
}

test('sheet metal edges, vertices, and face loops project and follow a flange edit', { timeout: 60_000 }, async () => {
  const ctx = await load();
  try {
    const { fillet, contour, coherent } = ctx.sheet;
    assert.equal(fillet.edges.length, 0, 'fillet catalog drops every Sheet Metallica edge');
    assert.ok(contour.edges.length > 20, `contour edges ${contour.edges.length}`);

    const spansLowerEdge = (points, length) => (
      length > 40
      && points?.length >= 2
      && points.every((p) => Math.abs(p[2] + 30) < 0.5 && Math.abs(p[1]) < 0.3 && Math.abs(p[0]) <= 50.1)
    );
    const meshedLower = contour.edges.filter((edge) => spansLowerEdge(chainOf(edge), edge.length));
    assert.equal(meshedLower.length, 0, 'the mesh catalog has no 100 mm base lower edge');
    const coherentLower = coherent.filter((edge) => spansLowerEdge([edge.va, edge.vb], edge.length));
    assert.equal(coherentLower.length, 0, 'coherent edges also drop the naked lower edge');

    const counts = new Map();
    for (const edge of contour.edges) counts.set(pairKey(edge), (counts.get(pairKey(edge)) || 0) + 1);
    const collided = [...counts.values()].filter((n) => n > 1);
    assert.equal(collided.length, 0, `face pairs still collide: ${collided.length}`);

    const flat = contour.edges.filter((edge) => {
      const chain = chainOf(edge);
      return chain && chain.length >= 2 && edge.length > 30 && ySpan(chain) < 0.05;
    });
    assert.ok(flat.length >= 2, `edges in the base plane ${flat.length}`);
    const movedFlat = flat.find((edge) => {
      const next = ctx.edited.contour.edges.find((item) => pairKey(item) === pairKey(edge));
      if (!next) return false;
      return Math.hypot(next.mid[0] - edge.mid[0], next.mid[1] - edge.mid[1], next.mid[2] - edge.mid[2]) > 1;
    });
    assert.ok(movedFlat, 'a flange edit should move a referenced edge');
    const edge = movedFlat;
    const projected = projectReference(PLANE, chainOf(edge));
    assert.equal(projected.broken, false);
    assert.equal(projected.geom.kind, 'line');
    const made = materializeReference(PLANE, {
      kind: 'edge',
      faceA: edge.faceA,
      faceB: edge.faceB,
      mid: edge.mid,
      worldPoints: chainOf(edge),
    });
    assert.equal(made.geom.kind, 'line');

    const picked = coherent.find((item) => {
      if (!item?.va || !item?.vb) return false;
      const near = Math.hypot(item.mid[0] - edge.mid[0], item.mid[1] - edge.mid[1], item.mid[2] - edge.mid[2]);
      if (near > 1) return false;
      const hit = edgeReferenceHit(contour, {
        key: 'coh-0-0',
        boundaryId: 0,
        va: item.va,
        vb: item.vb,
        mid: item.mid,
      });
      return hit && pairKey(hit) === pairKey(edge);
    });
    assert.ok(picked, 'a coherent pick with a fillet id still names the sheet edge');
    const hit = edgeReferenceHit(contour, {
      key: 'coh-9-1',
      boundaryId: 0,
      va: picked.va,
      vb: picked.vb,
      mid: picked.mid,
    });
    assert.equal(pairKey(hit), pairKey(edge));

    const project = (world) => ({ x: world[0], y: world[2] });
    const endWorld = chainOf(edge)[0];
    const tapped = vertexHit(contour.edges, project, endWorld[0], endWorld[2], 12);
    assert.equal(tapped?.kind, 'vertex');
    const tappedGeom = materializeReference(PLANE, tapped);
    assert.equal(tappedGeom.geom.kind, 'point');
    const vertex = {
      kind: 'vertex',
      faceA: edge.faceA,
      faceB: edge.faceB,
      mid: edge.mid.slice(),
      end: 0,
      worldPoints: [endWorld.slice()],
    };
    const vertexGeom = materializeReference(PLANE, vertex);
    assert.equal(vertexGeom.geom.kind, 'point');

    let faceId = null;
    let bestArea = 0;
    for (const face of contour.faces) {
      const n = face.normal;
      if (n[1] < 0.99) continue;
      if (face.area > bestArea) {
        bestArea = face.area;
        faceId = face.id;
      }
    }
    assert.ok(faceId != null, 'base face');
    const lowerOutline = faceOutlineHit(contour.edges, faceId, project, 0, -30);
    assert.equal(lowerOutline?.kind, 'face');
    const onHole = (lowerOutline.worldPoints || []).every((p) => (
      Math.hypot(p[0] + 23.93, p[1], p[2] - 1.91) < 4
    ));
    assert.equal(onHole, true, 'a lower-edge tap on the mesh face binds a hole chord');
    const outline = faceOutlineHit(contour.edges, faceId, project, 0, 0);
    assert.equal(outline.kind, 'face');
    assert.ok(outline.loopWorld.length >= 4, `loop ${outline.loopWorld?.length}`);
    const faceRef = materializeReference(PLANE, outline);
    assert.equal(faceRef.geom.kind, 'line');
    assert.ok(faceRef.loop.length >= 4);
    const loopSpan = projectReference(PLANE, outline.loopWorld);
    assert.equal(loopSpan.broken, false);

    const moved = ctx.edited.contour.edges.find((item) => pairKey(item) === pairKey(edge));
    assert.ok(moved, `edited mesh lost pair ${pairKey(edge)}`);
    const spec = {
      points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [10, 0] }],
      lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
      arcs: [],
      dimensions: [],
      constraints: [],
      refs: [{
        id: 'r0',
        kind: 'edge',
        faceA: edge.faceA,
        faceB: edge.faceB,
        mid: edge.mid.slice(),
        geom: made.geom,
      }, {
        id: 'r1',
        kind: 'vertex',
        faceA: vertex.faceA,
        faceB: vertex.faceB,
        mid: vertex.mid.slice(),
        end: vertex.end,
        geom: vertexGeom.geom,
      }, {
        id: 'r2',
        kind: 'face',
        faceId,
        boundary: {
          faceA: faceRef.boundary.faceA,
          faceB: faceRef.boundary.faceB,
          mid: faceRef.boundary.mid.slice(),
        },
        geom: faceRef.geom,
        loop: faceRef.loop.map((p) => p.slice()),
      }],
    };
    const outcome = resolveContourSpec(spec, ctx.edited.contour.edges, PLANE, { meshReady: true });
    assert.equal(
      outcome.broken,
      false,
      outcome.spec.refs.map((ref) => `${ref.kind}:${ref.broken ? 'broken' : 'ok'}`).join(' '),
    );
    assert.equal(outcome.spec.refs[0].broken, undefined);
    assert.equal(outcome.spec.refs[1].broken, undefined);
    assert.equal(outcome.spec.refs[2].broken, undefined);
    assert.equal(outcome.spec.refs[0].geom.kind, 'line');
    assert.equal(outcome.spec.refs[1].geom.kind, 'point');
    assert.ok(outcome.spec.refs[2].loop.length >= 4);
    const shift = Math.hypot(
      outcome.spec.refs[0].mid[0] - edge.mid[0],
      outcome.spec.refs[0].mid[1] - edge.mid[1],
      outcome.spec.refs[0].mid[2] - edge.mid[2],
    );
    assert.ok(shift > 1, `reference did not follow the flange (${shift.toFixed(2)} mm)`);

    const boxPairs = ctx.box.fillet.edges.map(pairKey).sort();
    const boxContour = ctx.box.contour.edges.map(pairKey).sort();
    assert.deepEqual(boxContour, boxPairs);
    assert.ok(boxPairs.length === 12);

    const boxPlane = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
    const projectBox = (world) => ({ x: world[0], y: world[1] });
    for (const edge of ctx.box.contour.edges) {
      const chain = chainOf(edge);
      const hit = referenceHitAt(ctx.box.contour.edges, projectBox, edge.mid, 12);
      assert.equal(pairKey(hit), pairKey(edge), `cube tap left ${pairKey(edge)}`);
      const expected = projectReference(boxPlane, chain);
      const made = materializeReference(boxPlane, hit);
      if (expected.broken) {
        assert.equal(made, null);
        continue;
      }
      assert.equal(made.geom.kind, 'line');
      const da = Math.hypot(made.geom.a[0] - expected.geom.a[0], made.geom.a[1] - expected.geom.a[1]);
      const db = Math.hypot(made.geom.b[0] - expected.geom.b[0], made.geom.b[1] - expected.geom.b[1]);
      const fa = Math.hypot(made.geom.a[0] - expected.geom.b[0], made.geom.a[1] - expected.geom.b[1]);
      const fb = Math.hypot(made.geom.b[0] - expected.geom.a[0], made.geom.b[1] - expected.geom.a[1]);
      assert.ok((da <= 0.05 && db <= 0.05) || (fa <= 0.05 && fb <= 0.05), pairKey(edge));
    }
  } finally {
    disposeAll(ctx);
  }
});
