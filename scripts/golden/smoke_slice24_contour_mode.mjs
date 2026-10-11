#!/usr/bin/env node
/**
 * Slice 24 — Contour-mode shell (Profile-in-mode only).
 * - Extrude / Revolve / Loft / Profile are contour entries
 * - planar workplane as a literal frame on the pick; non-planar loud refuse
 * - circle / rect / polygon / polyline → makeCrossSection preview
 * - Confirm composes Profile only (no makeExtrude)
 * - second Confirm replaces the in-mode block
 * - #30 fillet Strategy default remains sweep
 */
import {
  composeHelperInsert,
  HELPER_PALETTE_ITEMS,
} from '../../src/utils/helperPaletteSnippets.js';
import {
  resolveFaceModal,
} from '../../src/utils/faceFeaturePlacement.js';
import {
  pickFilletStrategy,
  resolveFilletStrategy,
} from '../../src/utils/filletAlongPath.js';
import {
  isContourEntry,
  isContourTool,
  CONTOUR_ENTRY_IDS,
  CONTOUR_TOOLS,
  CONTOUR_NO_SOLID,
  defaultContourParams,
  enterContourState,
  switchContourTool,
  toolToProfileParams,
  resolveContourWorkplane,
  planeFromContourFace,
  workplaneQuadCorners,
  workplaneOverlaySize,
  intersectRayPlane,
  worldToPlaneUV,
  validateContourProfile,
  buildContourPreview,
  assembleContourCrossSection,
  composeContourProfile,
  stripContourProfileBlock,
  hasContourProfileBlock,
  countMakeCrossSection,
  countMakeExtrude,
} from '../../src/utils/contourMode.js';
import { listSavedContours } from '../../src/utils/savedContours.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('slice-24 contour-mode shell smoke');

const planarFace = {
  center: [0, 0, 10],
  normal: [0, 0, 1],
  area: 1200,
  triangleCount: 2,
  selectionMode: 'coplanar',
};

const cylFace = {
  center: [15, 0, 5],
  normal: [1, 0, 0],
  area: 800,
  triangleCount: 24,
  selectionMode: 'angular-tolerance',
};

const irregularFace = {
  center: [0, 0, 0],
  normal: [0.1, 0.2, 0.9],
  area: 500,
  triangleCount: 40,
  selectionMode: 'all-connected',
};

const starter = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

// ── Entry / tools ──────────────────────────────────────────────
{
  check('Extrude is contour entry', isContourEntry('makeExtrude'));
  check('Revolve is contour entry', isContourEntry('makeRevolve'));
  check('Profile is contour entry', isContourEntry('crossSection'));
  check('Fillet is NOT contour entry', !isContourEntry('filletEdges'));
  check('entry set size 6 (Extrude/Revolve/Loft/Sweep/Profile/Workplane)', CONTOUR_ENTRY_IDS.size === 6);
  check('workplane is a contour entry', isContourEntry('workplane'));
  check('Loft is contour entry', isContourEntry('makeLoft'));
  check('Sweep is contour entry', isContourEntry('makeSweep'));
  check('circle/rect/polygon/polyline tools', CONTOUR_TOOLS.length === 4);
  check('isContourTool circle', isContourTool('circle'));
  check('isContourTool refuses loft', !isContourTool('loft'));

  const st = enterContourState('makeExtrude', planarFace);
  check('enter Extrude starts on circle', st.tool === 'circle' && st.entry === 'makeExtrude');
  check('enter Extrude keeps planar face', st.planeFace && st.planeFace.type === 'planar');
  check('enter Extrude no refuse', st.enterRefuse == null);

  const stBad = enterContourState('crossSection', cylFace);
  check('enter on cylinder uses default plane', stBad.planeFace == null);
  check('enter on cylinder loud refuse', /planar/i.test(stBad.enterRefuse || ''));

  const sw = switchContourTool(st, 'rectangle');
  check('switch tool to rectangle', sw.tool === 'rectangle' && sw.params.width === 20);
}

// ── Workplane ──────────────────────────────────────────────────
{
  const r0 = resolveContourWorkplane(null);
  check('no face → default +Z', r0.ok && r0.source === 'defaultTop' && r0.plane.normal[2] === 1);

  const r1 = resolveContourWorkplane(planarFace);
  check('planar → ok face', r1.ok && r1.face && r1.face.type === 'planar');
  check('planar plane origin on z=10', Math.abs(r1.plane.center[2] - 10) < 1e-6);
  check('planar plane +Z', Math.abs(r1.plane.normal[2] - 1) < 1e-9);

  const r2 = resolveContourWorkplane(cylFace);
  check('cylindrical → refuse', r2.ok === false && /planar/i.test(r2.message || ''));

  const r3 = resolveContourWorkplane(irregularFace);
  check('irregular → refuse', r3.ok === false);

  const plane = planeFromContourFace(r1.face);
  const corners = workplaneQuadCorners(plane, 20);
  check('workplane quad 4 corners', corners.length === 4);
  check('quad on plane z=10', corners.every((p) => Math.abs(p[2] - 10) < 1e-6));
  check('overlay size from area', workplaneOverlaySize(planarFace) > 20);

  const hit = intersectRayPlane([0, 0, 40], [0, 0, -1], plane);
  check('ray hits +Z plane', hit && Math.abs(hit[2] - 10) < 1e-6);
  const uv = worldToPlaneUV(hit, plane);
  check('hit at origin UV', Math.abs(uv[0]) < 1e-6 && Math.abs(uv[1]) < 1e-6);

  const miss = intersectRayPlane([0, 0, 40], [1, 0, 0], plane);
  check('parallel ray misses', miss == null);
}

// ── Profile params / loud fail ─────────────────────────────────
{
  check('circle params', toolToProfileParams('circle', { radius: 4 }).profileType === 'circle');
  check('rect params', toolToProfileParams('rectangle', { width: 10, height: 6 }).profileType === 'rectangle');
  check('poly params', toolToProfileParams('polygon', { polygonPreset: 'hexagon' }).polygonPreset === 'hexagon');
  check('polyline → custom', toolToProfileParams('polyline', { points: [[0, 0], [1, 0], [0, 1]] }).polygonPreset === 'custom');

  const okC = validateContourProfile('circle', defaultContourParams('circle'));
  check('default circle valid', okC.ok);

  const badR = validateContourProfile('circle', { radius: 0, segments: 32 });
  check('radius 0 loud fail', !badR.ok && /radius/i.test(badR.message || ''));

  const badP = validateContourProfile('polyline', { points: [[0, 0], [1, 0]] });
  check('2-pt polyline loud fail', !badP.ok && /3 points|polyline/i.test(badP.message || ''));

  const deg = validateContourProfile('polyline', { points: [[0, 0], [1, 0], [2, 0]] });
  check('collinear polyline loud fail', !deg.ok && /zero area|degenerate/i.test(deg.message || ''));

  const prev = buildContourPreview(rFace(), 'circle', { radius: 5, segments: 16 });
  check('preview rings', prev && prev.rings.length === 1);
  check('preview on plane', prev.rings[0].every((p) => Math.abs(p[2] - 10) < 1e-6));

  const xs = assembleContourCrossSection(rFace(), 'rectangle', { width: 10, height: 4, centered: true });
  check('assemble kind', xs.kind === 'crossSection' && xs.profile.type === 'rectangle');
}

function rFace() {
  return resolveContourWorkplane(planarFace).face;
}

// ── Compose Profile only (no Extrude) ──────────────────────────
{
  const face = rFace();
  const first = composeContourProfile(starter, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
  });
  check('compose ok', first.ok && typeof first.buffer === 'string');
  check('has makeCrossSection', /makeCrossSection\s*\(/.test(first.buffer));
  check('has profileCircle', /profileCircle\s*\(/.test(first.buffer));
  // The contour owns a literal frame. A host query is not a plane the
  // parser can read back, and a separate `const fr` is not the contour.
  check('no host workplane query for a picked face', !/workplaneFromFace/.test(first.buffer));
  check('picked face is inlined on the contour',
    /const c1 = makeCrossSection\(\{ center: \[0, 0, 10\], normal: \[0, 0, 1\]/.test(first.buffer));
  check('contour marker id is c1', /\/\/ @contour id=c1/.test(first.buffer));
  check('no profile-marker block', !hasContourProfileBlock(first.buffer));
  {
    const read = listSavedContours(first.buffer);
    const shifted = listSavedContours(`// moved\n${first.buffer}`);
    check('picked-face profile reads back with its plane',
      read.length === 1 && read[0].id === 'c1' && read[0].name === 'c1' && read[0].host === false
      && Math.abs(read[0].plane.center[2] - 10) < 1e-9
      && Math.abs(read[0].plane.normal[2] - 1) < 1e-9);
    check('id ignores a character offset', shifted[0]?.id === 'c1' && !String(read[0]?.id).includes('@'));
  }
  check('one makeCrossSection', countMakeCrossSection(first.buffer) === 1);
  check('zero makeExtrude', countMakeExtrude(first.buffer) === 0);
  check('no makeRevolve', !/makeRevolve\s*\(/.test(first.buffer));
  check('still returns part', /return\s+part\s*;/.test(first.buffer));
  check('no illegal bare top', !/\btop\b/.test(first.buffer.replace(/topFace/g, 'FACE')));

  const second = composeContourProfile(first.buffer, {
    face,
    tool: 'rectangle',
    params: { width: 16, height: 8, centered: true },
  });
  check('second confirm appends', second.ok && countMakeCrossSection(second.buffer) === 2);
  check('second confirm keeps the circle and adds a rectangle',
    /profileCircle\s*\(/.test(second.buffer) && /profileRectangle\s*\(/.test(second.buffer));
  check('names are c1 and c2', /@contour id=c1/.test(second.buffer) && /@contour id=c2/.test(second.buffer));
  const rewritten = composeContourProfile(second.buffer, {
    face,
    tool: 'polygon',
    params: { polygonPreset: 'hexagon', radius: 7 },
    contourId: 'c1',
    contourName: 'c1',
  });
  check('same id rewrites c1 only', rewritten.ok && countMakeCrossSection(rewritten.buffer) === 2);
  check('c1 dropped the circle', !/profileCircle\s*\(/.test(rewritten.buffer));
  check('c2 rectangle remains', /profileRectangle\s*\(/.test(rewritten.buffer));
  check('id c1 stays on the binding', /const c1 = makeCrossSection\(/.test(rewritten.buffer) && /@contour id=c1/.test(rewritten.buffer));
  check('rewrite still zero Extrude', countMakeExtrude(rewritten.buffer) === 0);
  check('rewrite keeps one return', (rewritten.buffer.match(/\breturn\s+part\s*;/g) || []).length === 1);

  const poly = composeContourProfile(starter, {
    face,
    tool: 'polyline',
    params: { points: [[-4, -3], [4, -3], [0, 5]] },
  });
  check('polyline compose ok', poly.ok && /profilePolygon\s*\(/.test(poly.buffer));
  check('polyline tapped points', /profilePolygon\(\[\[-4, -3\], \[4, -3\], \[0, 5\]\]/.test(poly.buffer));
  check('polyline is not default hexagon', !/4\.3301/.test(poly.buffer));
  check('polyline no Extrude', countMakeExtrude(poly.buffer) === 0);

  const hex = composeContourProfile(starter, {
    face,
    tool: 'polygon',
    params: { polygonPreset: 'hexagon', radius: 7 },
  });
  check('hex compose ok', hex.ok && /profilePolygon\s*\(/.test(hex.buffer));

  const defPlane = composeContourProfile(starter, {
    face: null,
    tool: 'circle',
    params: { radius: 3, segments: 16 },
  });
  check('default +Z compose owns a literal frame',
    defPlane.ok && /const c1 = makeCrossSection\(\{ center: \[0, 0, 0\], normal: \[0, 0, 1\]/.test(defPlane.buffer)
    && !/facesByNormal/.test(defPlane.buffer));

  const refuse = composeContourProfile(starter, {
    face,
    tool: 'circle',
    params: { radius: -2, segments: 8 },
  });
  check('compose refuses bad radius', !refuse.ok && /radius/i.test(refuse.message || ''));

  const stripped = stripContourProfileBlock(first.buffer);
  check('a named contour is not a profile-marker block', !hasContourProfileBlock(first.buffer));
  check('strip leaves the named contour', stripped === first.buffer && countMakeCrossSection(stripped) === 1);
  check('strip keeps part', /Manifold\.cube/.test(stripped));

  check('NO_SOLID copy present', /Extrude/.test(CONTOUR_NO_SOLID));

  // Guard must not refuse pre-existing solids; only the emitted contour region.
  const withSolid =
    'let part = Manifold.cube([40, 30, 20], true);\n'
    + 'part = makeExtrude(profileRectangle(10, 5), 4, part);\n'
    + 'return part;\n';
  const ontoSolid = composeContourProfile(withSolid, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
  });
  check('compose onto existing Extrude is ok', ontoSolid.ok === true);
  check('compose onto Extrude adds a named contour', /@contour id=c1/.test(ontoSolid.buffer || '') && !hasContourProfileBlock(ontoSolid.buffer || ''));
  const contourLine = (ontoSolid.buffer.match(/const c1 = .*/) || [''])[0];
  check('named contour line has no solid call',
    /makeCrossSection\(/.test(contourLine) && !/makeExtrude|makeRevolve|makeLoft|sweepPoints/.test(contourLine));
  check('existing Extrude still in buffer', countMakeExtrude(ontoSolid.buffer) === 1);
}

// ── One-shot Extrude compose still exists (Slice B; UI must not call it) ──
{
  const ext = composeHelperInsert(starter, 'makeExtrude', null, { height: 10 }, null, null);
  check('legacy makeExtrude compose still works', /makeExtrude\s*\(/.test(ext));
  const item = HELPER_PALETTE_ITEMS.find((h) => h.id === 'makeExtrude');
  check('palette still has Extrude item', !!item);
}

// ── #30 fillet / sweep stack preserved ─────────────────────────
{
  check('pickFilletStrategy is sweep', pickFilletStrategy() === 'sweep');
  check('resolveFilletStrategy() is sweep', resolveFilletStrategy() === 'sweep');
  check('resolveFilletStrategy(auto) is sweep', resolveFilletStrategy('auto') === 'sweep');
  check('resolveFilletStrategy(planar) still planar', resolveFilletStrategy('planar') === 'planar');

  const fillet = HELPER_PALETTE_ITEMS.find((h) => h.id === 'filletEdges');
  check('palette Fillet exists', !!fillet);
  const strat = (fillet?.params || []).find((p) => p.name === 'strategy');
  check('palette Fillet Strategy default sweep (#30)', strat && strat.default === 'sweep');

  const edges = [
    { a: 0, b: 1, va: [0, 0, 0], vb: [10, 0, 0], length: 10, key: 'e0' },
    { a: 1, b: 2, va: [10, 0, 0], vb: [10, 8, 0], length: 8, key: 'e1' },
  ];
  const modal = resolveFaceModal(fillet, null, edges);
  check('fillet edge modal opens', modal.mode === 'params');
  const modalStrat = (modal.item?.params || []).find((p) => p.name === 'strategy');
  check('fillet modal Strategy default sweep (#30)', modalStrat && modalStrat.default === 'sweep');

  const filBuf = composeHelperInsert(starter, 'filletEdges', null, {
    body: 'part',
    strategy: 'auto',
    radius: 2,
    sphericalCorners: true,
    profile: 'fillet',
    reverse: false,
    edgeScope: 'selected',
  }, null, edges);
  check('fillet compose still emits filletAlongPath or filletEdges',
    /filletAlongPath\s*\(|filletEdges\s*\(/.test(filBuf || ''));
  check('fillet compose has no contour markers', !hasContourProfileBlock(filBuf || ''));
}

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll slice-24 checks passed.');
