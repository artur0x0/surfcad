#!/usr/bin/env node
/**
 * Fillet pick hit radius.
 *
 * A short corner edge is a few CSS pixels on a fitted phone view. Fillet
 * mode grows that hit segment to 44px (22px past each end) and accepts a tap
 * within 44px of it. The drawn stroke is not that segment. When two edges
 * are inside the radius, the nearer screen distance wins.
 *
 * At 390×844 and 1280×800: a tap about 15px past the end of a short corner
 * on a sheet and on a filleted box selects that edge. A tap between two
 * adjacent edges selects the nearer one. Long edges are not padded.
 */
import { readFileSync } from 'node:fs';
import { PerspectiveCamera } from 'three';
import { runScript } from '../../src/lib/surfcad/index.js';
import { buildSolidGeometry, featureGraphFor } from '../../src/utils/partSolidCache.js';
import { fitView } from '../../src/utils/viewCamera.js';
import {
  EDGE_FILLET_HIT_RADIUS_PX,
  EDGE_PICK_SLOP_COARSE_PX,
  EDGE_PICK_SLOP_PX,
  distPointToSegment2D,
  pickNearestEdgeScreen,
  projectWorldToCanvas,
} from '../../src/utils/selectEdge.js';

const SHEET = `
const spec = { v:1, sku:'SST316-125', t:3.175, r:3.81, k:0.38, plane:'XY', width:100, height:60,
  bends:[], tabs:[], holes:[] };
return sheetMetalSolid(spec);
`;

const BOX = `
let part = Manifold.cube([40, 30, 20], true);
const e = convexEdges(part).filter((ed) => Math.abs(ed.tangent[2]) > 0.9).slice(0, 4);
part = filletEdges(part, e, 3);
return part;
`;

const SIZES = [[390, 844], [1280, 800]];
const TAP_PX = 15;

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function worldLen(e) {
  return Math.hypot(e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]);
}

function projectEdges(edges, cam, W, H) {
  const scored = [];
  for (const e of edges) {
    const sa = projectWorldToCanvas(cam, e.va, W, H);
    const sb = projectWorldToCanvas(cam, e.vb, W, H);
    if (!sa || !sb) continue;
    scored.push({
      e,
      sa,
      sb,
      screenL: Math.hypot(sa.x - sb.x, sa.y - sb.y),
      worldL: worldLen(e),
      tz: Math.abs(e.tangent?.[2] || 0),
    });
  }
  return scored;
}

function fitCam(geometry, W, H) {
  const cam = new PerspectiveCamera(45, W / H, 0.1, 2000);
  cam.up.set(0, 0, 1);
  fitView({ camera: cam, geometry, dir: [1, 1, 1], up: [0, 0, 1], margin: 1.35 });
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

function filletPick(edges, cam, W, H, px, py) {
  return pickNearestEdgeScreen(edges, cam, W, H, px, py, EDGE_FILLET_HIT_RADIUS_PX, {
    minHitLengthPx: EDGE_FILLET_HIT_RADIUS_PX,
  });
}

function realDist(px, py, s) {
  return distPointToSegment2D(px, py, s.sa.x, s.sa.y, s.sb.x, s.sb.y);
}

/** 15px past either end, along the screen segment. */
function endTaps(target) {
  const dx = target.sb.x - target.sa.x;
  const dy = target.sb.y - target.sa.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return [
    { px: target.sb.x + ux * TAP_PX, py: target.sb.y + uy * TAP_PX },
    { px: target.sa.x - ux * TAP_PX, py: target.sa.y - uy * TAP_PX },
  ];
}

function shortCorner(scored, { vertical }) {
  const list = scored.filter((s) => s.worldL < 8 && s.screenL < 24 && s.screenL > 0.4);
  const pool = vertical ? list.filter((s) => s.tz > 0.85) : list;
  pool.sort((a, b) => a.screenL - b.screenL || a.worldL - b.worldL);
  return pool[0] || null;
}

function sharesVertex(a, b) {
  const pts = [a.va, a.vb];
  for (const p of pts) {
    for (const q of [b.va, b.vb]) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.05) return true;
    }
  }
  return false;
}

function unitAway(s, sx, sy) {
  const da = Math.hypot(s.sa.x - sx, s.sa.y - sy);
  const db = Math.hypot(s.sb.x - sx, s.sb.y - sy);
  const far = da >= db ? s.sa : s.sb;
  const dx = far.x - sx;
  const dy = far.y - sy;
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

/**
 * Near a corner where two long edges meet: a few pixels off one, still
 * inside the hit radius of the other, and farther from every remaining
 * edge. Both edges are longer than 44px, so the hit segment is the real one.
 */
function nearerTap(scored) {
  const long = scored.filter((s) => s.screenL >= EDGE_FILLET_HIT_RADIUS_PX);
  for (let i = 0; i < long.length; i++) {
    for (let j = i + 1; j < long.length; j++) {
      const a = long[i];
      const b = long[j];
      if (!sharesVertex(a.e, b.e)) continue;
      const ends = [
        [a.sa, a.e.va],
        [a.sb, a.e.vb],
      ];
      for (const [screenEnd, worldEnd] of ends) {
        const onB = [b.e.va, b.e.vb].some((p) => (
          Math.hypot(p[0] - worldEnd[0], p[1] - worldEnd[1], p[2] - worldEnd[2]) < 0.05
        ));
        if (!onB) continue;
        const [ux, uy] = unitAway(a, screenEnd.x, screenEnd.y);
        const nx = -uy;
        const ny = ux;
        for (const along of [18, 24, 32]) {
          for (const sign of [1, -1]) {
            for (const off of [8, 12]) {
              const px = screenEnd.x + ux * along + nx * sign * off;
              const py = screenEnd.y + uy * along + ny * sign * off;
              const dA = realDist(px, py, a);
              const dB = realDist(px, py, b);
              if (!(dA <= TAP_PX && dB > dA + 4 && dB < EDGE_FILLET_HIT_RADIUS_PX)) continue;
              let other = Infinity;
              for (const s of scored) {
                if (s === a) continue;
                const d = realDist(px, py, s);
                if (d < other) other = d;
              }
              if (other > dA + 4) return { px, py, key: a.e.key, dA, other };
            }
          }
        }
      }
    }
  }
  return null;
}

async function load(src) {
  const res = await runScript(src);
  if (!res?.mesh) throw new Error(res?.error || 'script failed');
  const solid = buildSolidGeometry(res.mesh);
  const edges = featureGraphFor(solid.geometry, solid.faceIDs).featureEdges;
  return { geometry: solid.geometry, edges };
}

console.log('fillet edge hit radius');

check('fillet hit radius is 44px', EDGE_FILLET_HIT_RADIUS_PX === 44);
check('general slop stays inside 24–40',
  EDGE_PICK_SLOP_PX >= 24 && EDGE_PICK_SLOP_PX <= 40
  && EDGE_PICK_SLOP_COARSE_PX >= 24 && EDGE_PICK_SLOP_COARSE_PX <= 40);

const view = readFileSync(new URL('../../src/components/Viewport.jsx', import.meta.url), 'utf8');
const pickFn = view.slice(view.indexOf('const pickEdgeAtClient'), view.indexOf('const measureHitGeometry'));
check('fillet pick passes the 44px hit length',
  /filletModeRef\.current/.test(pickFn)
  && /minHitLengthPx = EDGE_FILLET_HIT_RADIUS_PX/.test(pickFn)
  && /EDGE_FILLET_HIT_RADIUS_PX/.test(pickFn));
check('hover stroke stays 2px', /const EDGE_HOVER_CORE_PX = 2;/.test(view));
check('hit radius is not a stroke width',
  !/paintEdgeLines[\s\S]{0,2200}EDGE_FILLET_HIT_RADIUS_PX/.test(view));

const sheet = await load(SHEET);
const box = await load(BOX);

for (const [W, H] of SIZES) {
  const views = {};
  for (const [name, solid, vertical] of [
    ['sheet', sheet, true],
    ['box', box, false],
  ]) {
    const cam = fitCam(solid.geometry, W, H);
    const scored = projectEdges(solid.edges, cam, W, H);
    views[name] = { cam, scored, edges: solid.edges };
    const target = shortCorner(scored, { vertical });
    check(`${W} ${name} has a short corner edge`, !!target,
      target ? '' : `edges ${scored.length}`);
    if (!target) continue;
    let hit = null;
    let dReal = Infinity;
    for (const end of endTaps(target)) {
      const d = realDist(end.px, end.py, target);
      const picked = filletPick(solid.edges, cam, W, H, end.px, end.py);
      if (d <= TAP_PX + 0.05 && picked?.key === target.e.key) {
        hit = picked;
        dReal = d;
        break;
      }
    }
    check(
      `${W} ${name} tap within ${TAP_PX}px selects ${target.e.key} (${target.screenL.toFixed(1)}px)`,
      hit?.key === target.e.key && dReal <= TAP_PX + 0.05,
      `dReal ${dReal.toFixed(2)} hit ${hit?.key || 'none'} screen ${target.screenL.toFixed(1)} world ${target.worldL.toFixed(2)}`,
    );
  }

  const sheetBetween = nearerTap(views.sheet.scored);
  const betweenView = sheetBetween ? views.sheet : views.box;
  const between = sheetBetween || nearerTap(views.box.scored);
  const betweenName = sheetBetween ? 'sheet' : 'box';
  check(`${W} has a between-edges tap`, !!between);
  if (between) {
    const picked = filletPick(betweenView.edges, betweenView.cam, W, H, between.px, between.py);
    check(
      `${W} ${betweenName} tap between adjacent edges picks the nearer (${between.key})`,
      picked?.key === between.key,
      `hit ${picked?.key || 'none'} dNear ${between.dA.toFixed(2)} dOther ${between.other.toFixed(2)}`,
    );
  }
}

if (failed) {
  console.log(`fillet edge hit: ${failed} failed`);
  process.exit(1);
}
console.log('fillet edge hit: ok');
