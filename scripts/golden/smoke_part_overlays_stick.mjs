#!/usr/bin/env node
/**
 * Sketch contours and work planes stick to the part that declares them.
 *
 * They used to be listed from the editor script only and drawn on the
 * active pick part: a pick on B with the script pane still pinned on A
 * painted A's work planes on B, saved contours were anchored to the pick
 * mesh too, and B's own planes were not drawn. Now every visible part
 * paints its own contours and planes from its own script, in its own
 * frame, under a group at that part's live translation. Only the editor
 * part's overlays take contour / plane picks.
 *
 * This golden runs the pure source / anchor rules, then builds the same
 * three.js per-part groups the viewport builds and checks world positions
 * before and after a part switch and a part move. Wiring checks pin the
 * viewport and App to those rules.
 */
import { readFileSync } from 'node:fs';
import { Group, Mesh, PlaneGeometry, MeshBasicMaterial, Vector3 } from 'three';
import {
  overlayHitPartId,
  partOverlayAnchor,
  partOverlaySources,
  toPartLocal,
} from '../../src/utils/partOverlays.js';
import { listConstructionPlanes, listSavedContours, savedContourRings } from '../../src/utils/savedContours.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}
const same = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);

console.log('part overlays stick — contours and work planes follow their own part');

const SA = `const fr = { center: [0, 0, 12], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const xs = makeCrossSection(fr, profileCircle(4, 16));
let part = Manifold.cube([20, 20, 20], true);
return part;`;
const SB = `const frB = { center: [0, 0, -12], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
let part = Manifold.cube([10, 10, 10], true);
return part;`;
const SB_LIVE = `${SB.replace('return part;', '')}const frB2 = { center: [0, 0, 8], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
return part;`;

const parts = {
  A: { script: SA, visible: true, position: [0, 0, 0] },
  B: { script: SB, visible: true, position: [60, 0, 0] },
  H: { script: SA, visible: false, position: [-60, 0, 0] },
  E: { script: '', visible: true, position: [0, 60, 0] },
};

// ── Sources ────────────────────────────────────────────────────────────
{
  const src = partOverlaySources({ parts, editorId: 'B', editorScript: SB_LIVE });
  check('one source per visible part with a script (hidden and empty skipped)',
    src.map((s) => s.partId).join(',') === 'A,B', src.map((s) => s.partId).join(','));
  check('the editor part reads the live buffer, others their saved script',
    src.find((s) => s.partId === 'B').script === SB_LIVE && src.find((s) => s.partId === 'B').editor
    && src.find((s) => s.partId === 'A').script === SA && !src.find((s) => s.partId === 'A').editor);
  const single = partOverlaySources({ parts: {}, editorId: null, editorScript: SA });
  check('no assembly context: one editor source', single.length === 1 && single[0].editor && single[0].script === SA);
  const planesA = listConstructionPlanes(src[0].script);
  const planesB = listConstructionPlanes(src[1].script);
  check('each part lists its own work planes', planesA.length === 1 && planesA[0].name === 'fr'
    && planesB.length === 2 && planesB.every((p) => p.name.startsWith('frB')));
  check('each part lists its own sketch contours', listSavedContours(SA).length === 1 && listSavedContours(SB).length === 0);
}

// ── Anchors ────────────────────────────────────────────────────────────
{
  const solids = { A: [0, 0, 0], B: [60, 0, 0] };
  const ctx = (activeId, pick) => ({ activeId, activePosition: pick, solidPosition: (id) => solids[id] || null });
  check('active part: the pick mesh translation', same(partOverlayAnchor('B', { ...ctx('B', [60, 0, 0]) }), [60, 0, 0]));
  check('another part: its own solid, not the pick mesh',
    same(partOverlayAnchor('A', ctx('B', [60, 0, 0])), [0, 0, 0]));
  check('no solid yet: the row position', same(partOverlayAnchor('C', { ...ctx('B', [60, 0, 0]), rowPosition: [5, 6, 7] }), [5, 6, 7]));
  check('untagged (single part): the pick mesh', same(partOverlayAnchor(null, ctx(null, [1, 2, 3])), [1, 2, 3]));
  check('a world ray point moves into the part frame', same(toPartLocal([61, 2, 3], [60, 0, 0]), [1, 2, 3]));
}

// ── Scene: per-part groups across a switch and a move ──────────────────
{
  const solids = { A: [0, 0, 0], B: [60, 0, 0] };
  let activeId = 'A';
  const anchor = (id, row) => partOverlayAnchor(id, {
    activeId,
    activePosition: solids[activeId],
    solidPosition: (pid) => solids[pid] || null,
    rowPosition: row,
  });
  const root = new Group();
  for (const s of partOverlaySources({ parts, editorId: 'A', editorScript: SA })) {
    const group = new Group();
    group.userData = { overlayPartId: s.partId, rowPosition: s.position };
    for (const p of listConstructionPlanes(s.script)) {
      const quad = new Mesh(new PlaneGeometry(48, 48), new MeshBasicMaterial());
      quad.position.set(...p.plane.center);
      quad.userData = { planeId: p.id, plane: p.plane, partId: s.partId };
      group.add(quad);
    }
    for (const c of listSavedContours(s.script)) {
      const ring = savedContourRings(c, null)[0];
      const marker = new Group();
      marker.name = 'contour';
      marker.position.set(...ring[0]);
      group.add(marker);
    }
    group.position.set(...anchor(s.partId, s.position));
    root.add(group);
  }
  // The viewport's syncAnchoredOverlays step for part groups.
  const sync = () => {
    for (const g of root.children) g.position.set(...anchor(g.userData.overlayPartId, g.userData.rowPosition));
    root.updateMatrixWorld(true);
  };
  const world = (partId, i = 0) => {
    const g = root.children.find((c) => c.userData.overlayPartId === partId);
    const v = g.children[i].getWorldPosition(new Vector3());
    return [v.x, v.y, v.z];
  };
  sync();
  const aPlane0 = world('A', 0);
  const aContour0 = world('A', 1);
  check('A plane on A at load', same(aPlane0, [0, 0, 12]), aPlane0.join(','));
  check('B plane on B at load', same(world('B', 0), [60, 0, -12]), world('B', 0).join(','));
  activeId = 'B';
  sync();
  check('switch to B: A plane stays on A', same(world('A', 0), aPlane0), world('A', 0).join(','));
  check('switch to B: A contour stays on A', same(world('A', 1), aContour0), world('A', 1).join(','));
  check('switch to B: B plane stays on B', same(world('B', 0), [60, 0, -12]));
  solids.A = [0, 30, 0];
  sync();
  check('move A: A plane follows A', same(world('A', 0), [0, 30, 12]), world('A', 0).join(','));
  check('move A: A contour follows A', same(world('A', 1), [aContour0[0], aContour0[1] + 30, aContour0[2]]));
  check('move A: B plane does not move', same(world('B', 0), [60, 0, -12]));
  const quadB = root.children.find((c) => c.userData.overlayPartId === 'B').children[0];
  check('a plane hit names its part', overlayHitPartId(quadB) === 'B' && overlayHitPartId(new Group()) === undefined);
}

// ── Wiring ─────────────────────────────────────────────────────────────
{
  const vp = read('src/components/Viewport.jsx');
  const slice = (start, end) => {
    const i = vp.indexOf(start);
    return i < 0 ? '' : vp.slice(i, vp.indexOf(end, i + start.length));
  };
  const ghosts = slice('const paintSavedContourGhosts = useCallback', '}, [clearSavedContourGhosts, paintEdgeLines]);');
  const planes = slice('const paintConstructionPlanes = useCallback', '}, [clearConstructionPlanes]);');
  check('contours paint one group per part, tagged and placed at that part',
    /overlayPartId: entry\.partId/.test(ghosts) && /overlayAnchorForRef\.current\(entry\.partId/.test(ghosts));
  // #354 folded the selected stroke and the idle stroke into one bucketed
  // paintEdgeLines. The line is still local to the part group.
  check('contour lines are local to the part group (not anchored to the pick mesh)',
    (ghosts.match(/position: \[0, 0, 0\]/g) || []).length === 1 && !/anchorToActivePart/.test(ghosts));
  check('work planes paint one group per part, tagged and placed at that part',
    /overlayPartId: entry\.partId/.test(planes) && /overlayAnchorForRef\.current\(entry\.partId/.test(planes)
    && !/anchorToActivePart/.test(planes));
  check('each part overlays come from partOverlaySources (its own script)',
    /partOverlaySources\(\{/.test(vp) && /listConstructionPlanes\(src\.script\)/.test(vp) && /listSavedContours\(src\.script\)/.test(vp));
  check('syncAnchoredOverlays moves part groups with their own part',
    /hasOwnProperty\.call\(obj\.userData, 'overlayPartId'\)/.test(slice('const syncAnchoredOverlays', '}, []);')));
  check('assembly placement repaints part overlays', /setOverlayEpoch\(\(n\) => n \+ 1\)/.test(vp));
  check('only the editor part planes take a click',
    /overlayHitPartId\(hit\.object\)/.test(vp) && /editorOverlayPartIdRef\.current/.test(vp));
  check('contour pick ray is moved into the editor part frame',
    /pickContourByRay\(\s*toPartLocal\(origin, savedContourOffsetRef\.current\)/.test(vp));
  const app = read('src/App.jsx');
  check('App part context names the editor part', /return \{ parts, activeId: doc\.activeId \?\? null \};/.test(app));
  check('architecture.md documents per-part overlays', /partOverlaySources/.test(read('docs/architecture.md')));
}

if (failed) {
  console.log(`\npart overlays stick: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\npart overlays stick: all checks passed');
process.exit(0);
