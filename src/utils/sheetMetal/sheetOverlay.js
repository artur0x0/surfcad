/**
 * Sheet-metal viewport overlay (three.js): plane pick quads, the live
 * preview of the spec (+ draft feature), and fat pick handles for edges.
 * Every pickable object carries userData.sm = { kind, … } for the tap router.
 * Built in the part's local frame; Viewport anchors it to the active part.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Shape,
  Vector3,
} from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { SHEET_PLANES, normalizeSheetSpec, panelPoint, sheetFreeEdges, solveSheet, vAdd, vMul } from './sheetModel.js';
import { makeSheetMetalMaterial } from './sheetMaterial.js';

const COLORS = {
  plane: 0xfb923c,
  planeHot: 0xf97316,
  draft: 0x22d3ee,
  edge: 0xf97316,
  edgeHot: 0x22d3ee,
  hole: 0x0f172a,
};

/**
 * Bend/tab edge highlight, in CSS pixels.
 * LineMaterial treats `linewidth` as pixels of `resolution` (the canvas CSS
 * size, not the drawing buffer). A 2.5px core is about 5 device pixels at
 * DPR 2 and 8 at DPR 3, so it stays a thin line on a 390px phone instead of
 * vanishing the way a 1px WebGL line does. Opacity is below the old
 * 0.85 / 0.95 fat bars and still reads as orange on the gray sheet.
 * The halo is wider and faint so the core stays a line.
 */
export const SHEET_EDGE_LINE = Object.freeze({
  corePx: 2.5,
  haloPx: 5,
  opacity: 0.65,
  hotOpacity: 0.82,
  haloOpacity: 0.16,
  // Ineligible edges stay visible so the corner reads as a real edge, without a handle.
  dimOpacity: 0.22,
});

function sheetEdgeLine(a, b, { color, linewidth, opacity, resolution }) {
  const geom = new LineSegmentsGeometry();
  geom.setPositions([a[0], a[1], a[2], b[0], b[1], b[2]]);
  const mat = new LineMaterial({
    color,
    linewidth,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
  });
  const [rw, rh] = resolution;
  mat.resolution.set(Math.max(1, rw || 1), Math.max(1, rh || 1));
  const line = new LineSegments2(geom, mat);
  line.frustumCulled = false;
  // The undrawn box is the fingertip target. A screen-space line raycast
  // would steal taps from that volume.
  line.raycast = () => {};
  return line;
}

/** Keep edge linewidths in CSS pixels after the canvas is resized. */
export function syncSheetEdgeLineResolution(root, width, height) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  root?.traverse?.((obj) => {
    if (obj.material?.isLineMaterial) obj.material.resolution.set(w, h);
  });
}

const basis = (X, Y, Z, o) => new Matrix4()
  .makeBasis(new Vector3(...X), new Vector3(...Y), new Vector3(...Z))
  .setPosition(new Vector3(...o));

function boxMesh(X, Y, Z, origin, sx, sy, sz, material, sm) {
  if (!(sx > 1e-6 && sy > 1e-6 && sz > 1e-6)) return null;
  const g = new BoxGeometry(sx, sy, sz);
  g.translate(sx / 2, sy / 2, sz / 2);
  g.applyMatrix4(basis(X, Y, Z, origin));
  const m = new Mesh(g, material);
  if (sm) m.userData.sm = sm;
  return m;
}

function sectorMesh(bend, t, r, material, sm) {
  if (!(bend.theta > 1e-6) || !(bend.q1 - bend.q0 > 1e-6)) return null;
  const n = Math.max(2, Math.ceil((bend.theta / (Math.PI / 2)) * 12));
  const pt = (rad, phi) => (bend.flip
    ? [rad * Math.sin(phi), rad * Math.cos(phi)]
    : [rad * Math.sin(phi), -rad * Math.cos(phi)]);
  const shape = new Shape();
  const first = pt(r + t, 0);
  shape.moveTo(first[0], first[1]);
  for (let i = 1; i <= n; i++) shape.lineTo(...pt(r + t, (bend.theta * i) / n));
  for (let i = n; i >= 0; i--) shape.lineTo(...pt(Math.max(r, 1e-4), (bend.theta * i) / n));
  const g = new ExtrudeGeometry(shape, { depth: bend.q1 - bend.q0, bevelEnabled: false, curveSegments: 1 });
  const origin = vAdd(bend.axis, vMul(bend.q1, bend.e));
  g.applyMatrix4(basis(bend.d, bend.N, vMul(-1, bend.e), origin));
  const m = new Mesh(g, material);
  if (sm) m.userData.sm = sm;
  return m;
}

/** Translucent plane quads for the base-flange plane pick (S2). */
function planeQuads(group, hot = null, size = 80) {
  for (const p of Object.values(SHEET_PLANES)) {
    const g = new PlaneGeometry(size, size);
    // PlaneGeometry lies in XY facing +Z → map to (U, V, N).
    g.applyMatrix4(basis(p.U, p.V, p.N, [0, 0, 0]));
    const mat = new MeshBasicMaterial({
      color: p.id === hot ? COLORS.planeHot : COLORS.plane,
      transparent: true,
      opacity: p.id === hot ? 0.45 : 0.22,
      side: DoubleSide,
      depthWrite: false,
    });
    const m = new Mesh(g, mat);
    m.userData.sm = { kind: 'plane', plane: p.id };
    m.renderOrder = 5;
    group.add(m);
  }
}

/**
 * mode = { stage, spec, draft?: { kind, … }, tool }
 * Returns a Group (caller anchors + adds to scene) or null.
 */
export function buildSheetOverlay(mode) {
  if (!mode) return null;
  const group = new Group();
  group.name = 'sheetMetalOverlay';
  if (mode.stage === 'plane') {
    planeQuads(group, mode.hoverPlane || null);
    return group;
  }
  const spec = normalizeSheetSpec(mode.previewSpec || mode.spec);
  if (!spec) return group;
  let solved;
  try {
    solved = solveSheet(spec);
  } catch {
    return group;
  }
  const metal = makeSheetMetalMaterial();
  // Unlit on purpose: a lit draft goes black under the scene point light.
  const draftMat = new MeshBasicMaterial({
    color: COLORS.draft,
    transparent: true,
    opacity: 0.75,
    side: DoubleSide,
  });
  const draftIds = new Set();
  if (mode.draft?.id) draftIds.add(mode.draft.id);
  for (const edge of mode.draft?.edges || []) {
    if (edge?.id) draftIds.add(edge.id);
  }
  const matFor = (id) => (draftIds.has(id) ? draftMat : metal);
  for (const p of solved.panels) {
    const m = boxMesh(p.U, p.V, p.N, panelPoint(p, p.u0, p.v0, 0), p.u1 - p.u0, p.v1 - p.v0, spec.t,
      matFor(p.id === 'base' && mode.stage === 'base' ? mode.draft?.id : p.id), { kind: 'panel', panel: p.id });
    if (m) group.add(m);
  }
  for (const b of solved.bends) {
    const m = sectorMesh(b, spec.t, spec.r, matFor(b.id), { kind: 'bend', id: b.id });
    if (m) group.add(m);
  }
  for (const tab of solved.tabs) {
    const m = boxMesh(tab.d, tab.e, tab.N, vAdd(tab.E0, vMul(tab.q0, tab.e)), tab.depth, tab.q1 - tab.q0, spec.t,
      matFor(tab.id), { kind: 'tab', id: tab.id });
    if (m) group.add(m);
  }
  const holeMat = new MeshBasicMaterial({ color: COLORS.hole });
  for (const h of solved.holes) {
    const d = Number(h.d) || 0;
    if (!(d > 0)) continue;
    const g = new CylinderGeometry(d / 2, d / 2, spec.t * 1.2, 32);
    // Cylinder axis is +Y → map Y to the panel normal.
    const p = h.panelRef;
    g.applyMatrix4(basis(p.U, p.N, vMul(-1, p.V), vAdd(h.center, vMul(spec.t / 2, p.N))));
    const m = new Mesh(g, draftIds.has(h.id) ? draftMat : holeMat);
    m.userData.sm = { kind: 'hole', id: h.id };
    group.add(m);
  }
  // Edge highlights: a thin screen-space line, plus an undrawn box so a
  // fingertip still hits the edge. Only for the active tool.
  const pickingNew = !!(mode.draft?.isNew && mode.draft.kind === mode.tool
    && (mode.tool === 'bend' || mode.tool === 'tab'));
  if (mode.stage === 'edit' && (mode.tool === 'bend' || mode.tool === 'tab') && (!mode.draft || pickingNew)) {
    const hot = new Set();
    const mark = (panel, edgeName) => {
      if (panel && edgeName) hot.add(`${panel}:${edgeName}`);
    };
    if (Array.isArray(mode.draft?.edges) && mode.draft.edges.length) {
      for (const edge of mode.draft.edges) mark(edge.panel, edge.edge);
    } else if (mode.draft?.panel && mode.draft?.edge) mark(mode.draft.panel, mode.draft.edge);
    else if (mode.hotEdge) mark(mode.hotEdge.panel, mode.hotEdge.edge);
    const resolution = Array.isArray(mode.lineResolution) && mode.lineResolution.length >= 2
      ? mode.lineResolution
      : [390, 844];
    // Same footprint as the old fat bar (≥ 5% of the base). Not drawn.
    const size = Math.max(4, spec.t * 3, Math.max(spec.width, spec.height) * 0.05);
    // A new card still offers the committed free edges, so another tap can join
    // the feature. Eligibility stays on that committed spec: a corner that is
    // dim before the card stays dim.
    let edgeSpec = spec;
    let edgeSolved = solved;
    if (pickingNew) {
      const committed = normalizeSheetSpec(mode.spec);
      if (committed) {
        edgeSpec = committed;
        try {
          edgeSolved = solveSheet(committed);
        } catch {
          edgeSpec = spec;
          edgeSolved = solved;
        }
      }
    }
    for (const e of sheetFreeEdges(edgeSpec, edgeSolved)) {
      const forBend = mode.tool === 'bend';
      if (forBend ? !e.bendable : !e.tabbable) continue;
      if (!(e.length > 1e-3)) continue;
      if (forBend && !e.eligible) {
        const dim = sheetEdgeLine(e.a, e.b, {
          color: COLORS.edge,
          linewidth: SHEET_EDGE_LINE.corePx,
          opacity: SHEET_EDGE_LINE.dimOpacity,
          resolution,
        });
        dim.name = 'sheetEdgeDim';
        dim.renderOrder = 6;
        dim.userData.sheetEdgeDim = { panel: e.panel, edge: e.edge };
        group.add(dim);
        continue;
      }
      const key = `${e.panel}:${e.edge}`;
      const isHot = hot.has(key);
      const sm = { kind: 'edge', panel: e.panel, edge: e.edge };
      const handle = new Group();
      handle.name = 'sheetEdgeHandle';
      handle.userData.sm = sm;
      const dir = new Vector3(...e.b).sub(new Vector3(...e.a));
      const len = dir.length();
      const g = new BoxGeometry(size, len, size);
      const mid = new Vector3(...e.a).add(new Vector3(...e.b)).multiplyScalar(0.5);
      const hit = new Mesh(g, new MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      }));
      hit.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
      hit.position.copy(mid);
      hit.userData.sm = sm;
      hit.userData.sheetEdgeHit = true;
      handle.add(hit);
      const color = isHot ? COLORS.edgeHot : COLORS.edge;
      const halo = sheetEdgeLine(e.a, e.b, {
        color,
        linewidth: SHEET_EDGE_LINE.haloPx,
        opacity: SHEET_EDGE_LINE.haloOpacity,
        resolution,
      });
      const core = sheetEdgeLine(e.a, e.b, {
        color,
        linewidth: SHEET_EDGE_LINE.corePx,
        opacity: isHot ? SHEET_EDGE_LINE.hotOpacity : SHEET_EDGE_LINE.opacity,
        resolution,
      });
      halo.renderOrder = 7;
      core.renderOrder = 8;
      core.userData.sheetEdgeLine = { role: 'core', hot: isHot, ...SHEET_EDGE_LINE };
      handle.add(halo);
      handle.add(core);
      group.add(handle);
    }
  }
  return group;
}

/** First sheet-metal pick in a raycast hit list. */
export function sheetPickFromHits(hits) {
  for (const hit of hits || []) {
    const sm = hit?.object?.userData?.sm;
    if (sm) return { ...sm, point: hit.point ? [hit.point.x, hit.point.y, hit.point.z] : null };
  }
  return null;
}

export function disposeSheetOverlay(scene, group) {
  if (!group) return;
  scene?.remove(group);
  group.traverse((obj) => {
    obj.geometry?.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) m?.dispose?.();
  });
}
