#!/usr/bin/env node
/**
 * Slice 25 — Extrude solid (contour → makeExtrude).
 * - Extrude enters contour mode (Slice 24 shell)
 * - live solid preview payload (distance / direction / sense)
 * - Confirm composes profile + makeExtrude + placeInFrame (replace part)
 * - second Confirm replaces the same marked block (no duplicate stack)
 * - Profile Confirm stays Profile-only; Revolve Confirm is Slice 26 (solid)
 * - one-shot Xform Extrude stub replaced (no hardcoded plate)
 * - #30 fillet Strategy default remains sweep
 */
import {
  composeHelperInsert,
  HELPER_PALETTE_ITEMS,
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
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
  isExtrudeEntry,
  enterContourState,
  defaultExtrudeParams,
  normalizeExtrudeParams,
  extrudeWOffset,
  resolveExtrudeAxis,
  validateExtrudeParams,
  buildExtrudeSolidPreview,
  composeContourExtrude,
  composeContourProfile,
  composeContourCommit,
  stripContourExtrudeBlock,
  hasContourExtrudeBlock,
  hasContourProfileBlock,
  contourExtrudeOwnedRegion,
  countMakeCrossSection,
  countMakeExtrude,
  planeFromContourFace,
  resolveContourWorkplane,
} from '../../src/utils/contourMode.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('slice-25 extrude solid smoke');

const planarFace = {
  center: [0, 0, 10],
  normal: [0, 0, 1],
  area: 1200,
  triangleCount: 2,
  selectionMode: 'coplanar',
};

const starter = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

function rFace() {
  return resolveContourWorkplane(planarFace).face;
}

// ── Entry / defaults ───────────────────────────────────────────
{
  check('Extrude is contour entry', isContourEntry('makeExtrude'));
  check('isExtrudeEntry makeExtrude', isExtrudeEntry('makeExtrude'));
  check('isExtrudeEntry refuses Profile', !isExtrudeEntry('crossSection'));
  check('isExtrudeEntry refuses Revolve', !isExtrudeEntry('makeRevolve'));

  const st = enterContourState('makeExtrude', planarFace);
  check('enter Extrude keeps entry', st.entry === 'makeExtrude');
  check('enter Extrude default distance 10', st.extrude && st.extrude.distance === 10);
  check('enter Extrude default direction normal', st.extrude.direction === 'normal');
  check('enter Extrude default sense positive', st.extrude.sense === 'positive');

  const d = defaultExtrudeParams();
  check('defaultExtrudeParams mobile defaults', d.distance === 10 && d.direction === 'normal' && d.sense === 'positive');
}

// ── Params / loud fail ─────────────────────────────────────────
{
  const ok = validateExtrudeParams({ distance: 8, direction: 'normal', sense: 'positive' });
  check('valid extrude params', ok.ok && ok.normalized.distance === 8);

  const aliases = normalizeExtrudeParams({ distance: 4, direction: 'plane', sense: 'in' });
  check('alias direction plane → normal', aliases.direction === 'normal');
  check('alias sense in → negative', aliases.sense === 'negative');

  check('wOffset positive is 0', extrudeWOffset(10, 'positive') === 0);
  check('wOffset negative is -d', extrudeWOffset(10, 'negative') === -10);
  check('wOffset both is -d/2', extrudeWOffset(10, 'both') === -5);

  const badD = validateExtrudeParams({ distance: 0, direction: 'normal', sense: 'positive' });
  check('distance 0 loud fail', !badD.ok && /distance/i.test(badD.message || ''));

  const badS = validateExtrudeParams({ distance: 5, direction: 'normal', sense: 'sideways' });
  check('bad sense loud fail', !badS.ok && /sense/i.test(badS.message || ''));

  const plane = planeFromContourFace(rFace());
  const axN = resolveExtrudeAxis(plane, 'normal');
  check('direction normal ok', axN.ok && Math.abs(axN.axis[2] - 1) < 1e-9);
  const axZ = resolveExtrudeAxis(plane, 'z');
  check('direction +Z on +Z plane ok', axZ.ok);
  const axX = resolveExtrudeAxis(plane, 'x');
  check('direction +X on +Z plane loud fail', !axX.ok && /normal/i.test(axX.message || ''));
}

// ── Live solid preview ─────────────────────────────────────────
{
  const prev = buildExtrudeSolidPreview(
    rFace(),
    'circle',
    { radius: 5, segments: 16 },
    { distance: 10, direction: 'normal', sense: 'positive' },
  );
  check('solid preview has contours', prev && prev.contours[0].length >= 8);
  check('solid preview distance 10', prev && prev.distance === 10);
  check('solid preview w0 out is 0', prev && prev.w0 === 0);
  check('solid preview rings on plane', prev && prev.rings[0].every((p) => Math.abs(p[2] - 10) < 1e-6));

  const both = buildExtrudeSolidPreview(
    rFace(),
    'rectangle',
    { width: 10, height: 4, centered: true },
    { distance: 8, direction: 'normal', sense: 'both' },
  );
  check('solid preview both w0 = -4', both && both.w0 === -4);

  const bad = buildExtrudeSolidPreview(
    rFace(),
    'circle',
    { radius: 5, segments: 16 },
    { distance: -2, direction: 'normal', sense: 'positive' },
  );
  check('solid preview refuses bad distance', bad == null);

  const skew = buildExtrudeSolidPreview(
    rFace(),
    'circle',
    { radius: 5, segments: 16 },
    { distance: 6, direction: 'x', sense: 'positive' },
  );
  check('solid preview refuses skewed axis', skew == null);
}

// ── Compose Extrude ────────────────────────────────────────────
{
  const face = rFace();
  const first = composeContourExtrude(starter, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('compose ok', first.ok && typeof first.buffer === 'string');
  check('compose wants Auto-Run', first.run === true);
  check('has makeCrossSection', /makeCrossSection\s*\(/.test(first.buffer));
  check('has profileCircle', /profileCircle\s*\(/.test(first.buffer));
  check('has makeExtrude', /makeExtrude\s*\(/.test(first.buffer));
  check('has placeInFrame', /placeInFrame\s*\(/.test(first.buffer));
  check('unions onto existing part',
    /Manifold\.cube\(/.test(first.buffer)
    && /part\s*=\s*part\.add\(\s*placeInFrame\s*\(/.test(first.buffer)
    && !/placeOnFace\s*\(/.test(first.buffer));
  check('has extrude markers', hasContourExtrudeBlock(first.buffer));
  check('markers wrap solid', first.buffer.includes(CONTOUR_EXTRUDE_BEGIN) && first.buffer.includes(CONTOUR_EXTRUDE_END));
  check('one makeCrossSection', countMakeCrossSection(first.buffer) === 1);
  check('one makeExtrude', countMakeExtrude(first.buffer) === 1);
  check('no makeRevolve', !/makeRevolve\s*\(/.test(first.buffer));
  check('still returns part', /return\s+part\s*;/.test(first.buffer));
  check('no illegal bare top', !/\btop\b/.test(first.buffer.replace(/topFace/g, 'FACE')));
  check('w offset 0 for Out', /placeInFrame\([^,]+, makeExtrude\([^,]+, 10\), \[0, 0, 0\]\)/.test(first.buffer));

  const owned = contourExtrudeOwnedRegion(first.buffer);
  check('owned region has profile + solid',
    /makeCrossSection/.test(owned) && /makeExtrude/.test(owned) && /placeInFrame/.test(owned));

  const second = composeContourExtrude(first.buffer, {
    face,
    tool: 'rectangle',
    params: { width: 16, height: 8, centered: true },
    extrude: { distance: 6, direction: 'normal', sense: 'negative' },
  });
  check('update ok', second.ok);
  check('update still one makeCrossSection', countMakeCrossSection(second.buffer) === 1);
  check('update still one makeExtrude', countMakeExtrude(second.buffer) === 1);
  check('update uses profileRectangle', /profileRectangle\s*\(/.test(second.buffer));
  check('update dropped circle', !/profileCircle\s*\(/.test(second.buffer));
  check('update sense In uses -6', /placeInFrame\([^,]+, makeExtrude\([^,]+, 6\), \[0, 0, -6\]\)/.test(second.buffer));
  check('update keeps one return', (second.buffer.match(/\breturn\s+part\s*;/g) || []).length === 1);
  check('update still one extrude block', (second.buffer.match(/contour-mode extrude begin/g) || []).length === 1);

  const both = composeContourExtrude(starter, {
    face,
    tool: 'polygon',
    params: { polygonPreset: 'hexagon', radius: 7 },
    extrude: { distance: 12, direction: 'normal', sense: 'both' },
  });
  check('both-sense compose ok', both.ok && /profilePolygon/.test(both.buffer));
  check('both-sense w = -6', /placeInFrame\([^,]+, makeExtrude\([^,]+, 12\), \[0, 0, -6\]\)/.test(both.buffer));

  const defPlane = composeContourExtrude(starter, {
    face: null,
    tool: 'circle',
    params: { radius: 3, segments: 16 },
    extrude: { distance: 4, direction: 'z', sense: 'positive' },
  });
  check('default +Z + direction z ok', defPlane.ok && /normal:\s*\[0,\s*0,\s*1\]/.test(defPlane.buffer));

  const refuseR = composeContourExtrude(starter, {
    face,
    tool: 'circle',
    params: { radius: -2, segments: 8 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('compose refuses bad radius', !refuseR.ok && /radius/i.test(refuseR.message || ''));

  const refuseD = composeContourExtrude(starter, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 0, direction: 'normal', sense: 'positive' },
  });
  check('compose refuses distance 0', !refuseD.ok && /distance/i.test(refuseD.message || ''));

  const refuseDir = composeContourExtrude(starter, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'x', sense: 'positive' },
  });
  check('compose refuses skewed +X', !refuseDir.ok && /normal/i.test(refuseDir.message || ''));

  const stripped = stripContourExtrudeBlock(first.buffer);
  check('strip removes extrude markers', !hasContourExtrudeBlock(stripped));
  check('strip removes makeExtrude', countMakeExtrude(stripped) === 0);
  check('strip removes makeCrossSection', countMakeCrossSection(stripped) === 0);
  check('strip keeps part', /Manifold\.cube/.test(stripped));
  check('Back-equivalent has no orphan Extrude', countMakeExtrude(stripped) === 0);
}

// ── Commit router: Extrude vs Profile / Revolve ────────────────
{
  const face = rFace();
  const ext = composeContourCommit(starter, {
    entry: 'makeExtrude',
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('commit Extrude emits solid', ext.ok && ext.run && countMakeExtrude(ext.buffer) === 1);

  const prof = composeContourCommit(starter, {
    entry: 'crossSection',
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
  });
  check('commit Profile is Profile-only', prof.ok && prof.run === false && countMakeExtrude(prof.buffer) === 0);
  check('commit Profile is a named contour', /@contour id=c1/.test(prof.buffer) && !hasContourProfileBlock(prof.buffer));

  const rev = composeContourCommit(starter, {
    entry: 'makeRevolve',
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
  });
  check('commit Revolve emits solid (Slice C)', rev.ok && rev.run === true && /makeRevolve\s*\(/.test(rev.buffer));
  check('commit Revolve has no Extrude', countMakeExtrude(rev.buffer) === 0);

  // Profile-only then Extrude Confirm: replace profile block with extrude block.
  const thenExt = composeContourExtrude(prof.buffer, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('Extrude after Profile leaves the named contour', thenExt.ok && !hasContourProfileBlock(thenExt.buffer) && /@contour id=c1/.test(thenExt.buffer));
  check('Extrude after Profile has one solid', countMakeExtrude(thenExt.buffer) === 1);
  check('Extrude after Profile keeps the contour and its own profile', countMakeCrossSection(thenExt.buffer) === 2);
}

// ── Replaced one-shot Xform stub ───────────────────────────────
{
  const ext = composeHelperInsert(starter, 'makeExtrude', null, { height: 10 }, null, null);
  check('composeHelperInsert Extrude still emits makeExtrude', /makeExtrude\s*\(/.test(ext));
  check('stub uses makeCrossSection (not hardcoded plate)', /makeCrossSection\s*\(/.test(ext));
  check('stub is not the old [[-20, -15] plate', !/\[\[-20, -15\]/.test(ext));
  const item = HELPER_PALETTE_ITEMS.find((h) => h.id === 'makeExtrude');
  check('palette still has Extrude item', !!item);
  check('palette title mentions contour mode', /contour/i.test(item.title || ''));
}

// ── Function() under stubs (syntax + bindings) ─────────────────
{
  const face = rFace();
  const composed = composeContourExtrude(starter, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  const stubs = {
    Manifold: { cube: () => ({ add(x) { return x; } }) },
    facesByNormal: () => [{ center: [0, 0, 10], normal: [0, 0, 1] }],
    workplaneFromFace: () => ({
      center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0],
    }),
    profileCircle: (r) => ({ type: 'circle', contours: [[[r, 0], [0, r], [-r, 0], [0, -r]]] }),
    makeCrossSection: (_p, profile) => ({
      kind: 'crossSection',
      plane: { center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
      contours: profile.contours,
    }),
    makeExtrude: () => ({ _t: 'ex' }),
    placeInFrame: (_fr, solid) => solid,
    transformByFrame: (_fr, solid) => solid,
  };
  try {
    const fn = new Function(...Object.keys(stubs), `"use strict";\n${composed.buffer}`);
    const result = fn(...Object.values(stubs));
    check('composed Extrude Function() runs', result != null);
  } catch (e) {
    check('composed Extrude Function() runs', false, String(e.message || e));
  }
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
  check('fillet compose has no extrude markers', !hasContourExtrudeBlock(filBuf || ''));
}

// ── Contour then Extrude on an empty script is a new body ──────
{
  const profile = composeContourProfile('', {
    face: null,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
  });
  check('empty contour confirm ok', profile.ok === true, profile.message || '');
  check('empty contour has no starter cube', !/Manifold\.cube\s*\(/.test(profile.buffer || ''));
  check('empty contour does not declare part', !/\b(?:let|const|var)\s+part\b/.test(profile.buffer || ''));
  const ext = composeContourExtrude(profile.buffer, {
    face: null,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('extrude after contour ok', ext.ok === true, ext.message || '');
  check('extrude after contour is a new body', /let\s+part\s*=\s*placeInFrame\s*\(/.test(ext.buffer || ''));
  check('extrude after contour does not union', !/part\s*=\s*part\.add\(/.test(ext.buffer || ''));
  check('extrude after contour has no starter cube', !/Manifold\.cube\s*\(/.test(ext.buffer || ''));

  const wp = composeHelperInsert('', 'workplane');
  const afterPlane = composeContourProfile(wp, {
    face: null,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
  });
  const extPlane = composeContourExtrude(afterPlane.buffer, {
    face: null,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('workplane then extrude keeps the plane', /construction plane/.test(extPlane.buffer || ''));
  check('workplane then extrude is a new body', /let\s+part\s*=\s*placeInFrame\s*\(/.test(extPlane.buffer || ''));
  check('workplane then extrude has no starter cube', !/Manifold\.cube\s*\(/.test(extPlane.buffer || ''));
}

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll slice-25 checks passed.');
