#!/usr/bin/env node
/**
 * Slice 26 — Revolve solid (contour → makeRevolve).
 * - Revolve enters contour mode (Slice 24 shell)
 * - live solid preview payload (angle / axis on plane / sense)
 * - Confirm composes profile + makeRevolve + placeInFrame (replace part)
 * - second Confirm replaces the same marked block (no duplicate stack)
 * - Profile Confirm stays Profile-only; Extrude from #32 unchanged
 * - Loft still shell-only (not a contour entry)
 * - #30 fillet Strategy default remains sweep
 * - Identity (u,v)→(radial,height): centered circle → sphere; washer → torus
 */
import Module from '../../built/manifold.js';
import {
  composeHelperInsert,
  HELPER_PALETTE_ITEMS,
  CONTOUR_REVOLVE_BEGIN,
  CONTOUR_REVOLVE_END,
  CONTOUR_EXTRUDE_BEGIN,
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
  isRevolveEntry,
  enterContourState,
  defaultRevolveParams,
  normalizeRevolveParams,
  revolveStartDeg,
  resolveRevolveAxis,
  validateRevolveParams,
  mapContoursToRevolve,
  buildRevolveSolidPreview,
  composeContourRevolve,
  composeContourExtrude,
  composeContourCommit,
  stripContourRevolveBlock,
  hasContourRevolveBlock,
  hasContourExtrudeBlock,
  hasContourProfileBlock,
  contourRevolveOwnedRegion,
  countMakeCrossSection,
  countMakeExtrude,
  countMakeRevolve,
  planeFromContourFace,
  resolveContourWorkplane,
  defaultExtrudeParams,
} from '../../src/utils/contourMode.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('slice-26 revolve solid smoke');

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
  check('Revolve is contour entry', isContourEntry('makeRevolve'));
  check('isRevolveEntry makeRevolve', isRevolveEntry('makeRevolve'));
  check('isRevolveEntry refuses Profile', !isRevolveEntry('crossSection'));
  check('isRevolveEntry refuses Extrude', !isRevolveEntry('makeExtrude'));
  check('isExtrudeEntry still Extrude-only', isExtrudeEntry('makeExtrude') && !isExtrudeEntry('makeRevolve'));
  check('Loft is not a contour entry', !isContourEntry('loft'));

  const st = enterContourState('makeRevolve', planarFace);
  check('enter Revolve keeps entry', st.entry === 'makeRevolve');
  check('enter Revolve default angle 360', st.revolve && st.revolve.angle === 360);
  check('enter Revolve default axis v', st.revolve.axis === 'v');
  check('enter Revolve default sense positive', st.revolve.sense === 'positive');
  check('enter Revolve still seeds Extrude defaults (unchanged)',
    st.extrude && st.extrude.distance === 10 && st.extrude.direction === 'normal');

  const d = defaultRevolveParams();
  check('defaultRevolveParams mobile defaults', d.angle === 360 && d.axis === 'v' && d.sense === 'positive');
  const ext = defaultExtrudeParams();
  check('defaultExtrudeParams unchanged', ext.distance === 10 && ext.direction === 'normal' && ext.sense === 'positive');
}

// ── Params / loud fail ─────────────────────────────────────────
{
  const ok = validateRevolveParams({ angle: 180, axis: 'v', sense: 'positive' });
  check('valid revolve params', ok.ok && ok.normalized.angle === 180);

  const aliases = normalizeRevolveParams({ angle: 90, axis: 'plane-y', sense: 'in' });
  check('alias axis plane-y → v', aliases.axis === 'v');
  check('alias sense in → negative', aliases.sense === 'negative');

  check('startDeg positive is 0', revolveStartDeg(90, 'positive') === 0);
  check('startDeg negative is -a', revolveStartDeg(90, 'negative') === -90);
  check('startDeg both is -a/2', revolveStartDeg(90, 'both') === -45);

  const badA = validateRevolveParams({ angle: 0, axis: 'v', sense: 'positive' });
  check('angle 0 loud fail', !badA.ok && /angle/i.test(badA.message || ''));

  const badOver = validateRevolveParams({ angle: 400, axis: 'v', sense: 'positive' });
  check('angle > 360 loud fail', !badOver.ok && /angle/i.test(badOver.message || ''));

  const badS = validateRevolveParams({ angle: 180, axis: 'v', sense: 'sideways' });
  check('bad sense loud fail', !badS.ok && /sense/i.test(badS.message || ''));

  const plane = planeFromContourFace(rFace());
  const axV = resolveRevolveAxis(plane, 'v');
  check('axis v on +Z plane ok', axV.ok && Math.abs(axV.world[1] - 1) < 1e-9);
  const axY = resolveRevolveAxis(plane, 'y');
  check('axis +Y on +Z plane ok (on-plane)', axY.ok);
  const axZ = resolveRevolveAxis(plane, 'z');
  check('axis +Z on +Z plane loud fail (normal)', !axZ.ok && /plane/i.test(axZ.message || ''));
}

// ── Contour remap (identity; axis through workplane origin) ────
{
  const circle = [
    [[5, 0], [0, 5], [-5, 0], [0, -5]],
  ];
  const mapped = mapContoursToRevolve(circle, [0, 1]);
  check('circle about V remaps', mapped.ok && mapped.mapped[0].length === 4);
  check('circle remap is identity (no min-radial shift)', mapped.ok && mapped.shift === 0);
  check('circle remap keeps negative radial (crossing accepted)',
    mapped.ok && mapped.mapped[0].some((p) => p[0] < -1e-6));
  check('circle remapped right edge stays at +r',
    mapped.ok && mapped.mapped[0].some((p) => Math.abs(p[0] - 5) < 1e-9));
  // Pin: re-adding `if (p[0] < -1e-6) refuse` must turn this red.
  check('centered circle is accepted (diameter-revolve / sphere)', mapped.ok === true);

  const washer = [[[10, 0], [20, 0], [20, 4], [10, 4]]];
  const wash = mapContoursToRevolve(washer, [0, 1]);
  check('offset washer remaps identity', wash.ok && wash.shift === 0);
  check('offset washer keeps hole (min radial 10, not 0)',
    wash.ok && Math.abs(wash.minR - 10) < 1e-9 && wash.mapped[0].every((p) => p[0] >= 10 - 1e-9));

  const crossing = [[[-2, 0], [8, 0], [8, 3], [-2, 3]]];
  const cross = mapContoursToRevolve(crossing, [0, 1]);
  check('crossing profile is accepted (Manifold clips +radial)', cross.ok === true);
  check('crossing remap keeps a negative-radial vertex',
    cross.ok && cross.mapped[0].some((p) => p[0] < -1e-6));

  const slim = [[[0, 0], [0, 4], [0, 8]]];
  const onAxis = mapContoursToRevolve(slim, [0, 1]);
  // Message-specific: `/axis/i` also matches the maxR arm, so gutting
  // `maxR - minR < 1e-9` left this pin green (fixture fell into maxR).
  check('on-axis slim profile loud fail',
    !onAxis.ok && /width off the axis/.test(onAxis.message || ''));

  // Sole rejecter for the zero-width gate: off-axis collinear has maxR=5,
  // so it cannot fall into `maxR < 1e-6`. Gutting `:289` must turn this red.
  const collinear = [[[5, 0], [5, 4], [5, 8]]];
  const zeroWidth = mapContoursToRevolve(collinear, [0, 1]);
  check('off-axis collinear zero-width loud fail',
    !zeroWidth.ok && /width off the axis/.test(zeroWidth.message || ''));

  // Reachable +radial-empty refuse (replaces the dead post-shift p[0]<0 arm).
  // Gutting `if (maxR < 1e-6)` must turn this red.
  const neg = [[[-12, 0], [-6, 0], [-6, 4], [-12, 4]]];
  const allNeg = mapContoursToRevolve(neg, [0, 1]);
  check('entirely-negative radial loud fail',
    !allNeg.ok && /radial|axis/i.test(allNeg.message || ''));
}

// ── Live solid preview ─────────────────────────────────────────
{
  const prev = buildRevolveSolidPreview(
    rFace(),
    'circle',
    { radius: 5, segments: 16 },
    { angle: 360, axis: 'v', sense: 'positive' },
  );
  check('solid preview has remapped contours', prev && prev.contours[0].length >= 8);
  check('solid preview angle 360', prev && prev.angle === 360);
  check('solid preview startDeg out is 0', prev && prev.startDeg === 0);
  check('solid preview axis along +Y', prev && Math.abs(prev.axis[1] - 1) < 1e-6);
  check('solid preview radial along +X', prev && Math.abs(prev.radial[0] - 1) < 1e-6);
  check('solid preview axis through workplane origin',
    prev && Math.hypot(prev.center[0] - 0, prev.center[1] - 0, prev.center[2] - 10) < 1e-6);
  check('solid preview identity remap keeps −radial (clip in paint)',
    prev && prev.contours[0].some((p) => p[0] < -1e-6));
  check('solid preview has +radial extent',
    prev && prev.contours[0].some((p) => p[0] > 1e-6));

  const both = buildRevolveSolidPreview(
    rFace(),
    'rectangle',
    { width: 10, height: 4, centered: true },
    { angle: 90, axis: 'v', sense: 'both' },
  );
  check('solid preview both startDeg = -45', both && both.startDeg === -45);

  const bad = buildRevolveSolidPreview(
    rFace(),
    'circle',
    { radius: 5, segments: 16 },
    { angle: -20, axis: 'v', sense: 'positive' },
  );
  check('solid preview refuses bad angle', bad == null);

  const skew = buildRevolveSolidPreview(
    rFace(),
    'circle',
    { radius: 5, segments: 16 },
    { angle: 180, axis: 'z', sense: 'positive' },
  );
  check('solid preview refuses axis along normal', skew == null);
}

// ── Compose Revolve ────────────────────────────────────────────
{
  const face = rFace();
  const first = composeContourRevolve(starter, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    revolve: { angle: 360, axis: 'v', sense: 'positive' },
  });
  check('compose ok', first.ok && typeof first.buffer === 'string');
  check('compose wants Auto-Run', first.run === true);
  check('has makeCrossSection', /makeCrossSection\s*\(/.test(first.buffer));
  check('has profileCircle', /profileCircle\s*\(/.test(first.buffer));
  check('has makeRevolve', /makeRevolve\s*\(/.test(first.buffer));
  check('has placeInFrame', /placeInFrame\s*\(/.test(first.buffer));
  check('unions onto existing part',
    /Manifold\.cube\(/.test(first.buffer)
    && /part\s*=\s*part\.add\(\s*placeInFrame\s*\(/.test(first.buffer)
    && !/placeOnFace\s*\(/.test(first.buffer));
  check('has revolve markers', hasContourRevolveBlock(first.buffer));
  check('markers wrap solid', first.buffer.includes(CONTOUR_REVOLVE_BEGIN) && first.buffer.includes(CONTOUR_REVOLVE_END));
  check('one makeCrossSection', countMakeCrossSection(first.buffer) === 1);
  check('one makeRevolve', countMakeRevolve(first.buffer) === 1);
  check('no makeExtrude', countMakeExtrude(first.buffer) === 0);
  check('no loft', !/\bloft\s*\(/.test(first.buffer));
  check('still returns part', /return\s+part\s*;/.test(first.buffer));
  check('no illegal bare top', !/\btop\b/.test(first.buffer.replace(/topFace/g, 'FACE')));
  check('emits 360° default', /, 96, 360\)/.test(first.buffer));
  check('identity remap (no min-radial shift)', !/\bu \+ 5\b/.test(first.buffer));
  check('emits identity [u, v] map', /\[u, v\]/.test(first.buffer));
  check('place frame center is workplane origin',
    /center:\s*xs\d*\.plane\.center/.test(first.buffer));

  const owned = contourRevolveOwnedRegion(first.buffer);
  check('owned region has profile + solid',
    /makeCrossSection/.test(owned) && /makeRevolve/.test(owned) && /placeInFrame/.test(owned));

  const second = composeContourRevolve(first.buffer, {
    face,
    tool: 'rectangle',
    params: { width: 16, height: 8, centered: true },
    revolve: { angle: 180, axis: 'v', sense: 'negative' },
  });
  check('update ok', second.ok);
  check('update still one makeCrossSection', countMakeCrossSection(second.buffer) === 1);
  check('update still one makeRevolve', countMakeRevolve(second.buffer) === 1);
  check('update uses profileRectangle', /profileRectangle\s*\(/.test(second.buffer));
  check('update dropped circle', !/profileCircle\s*\(/.test(second.buffer));
  check('update sense In rotates -180', /\.rotate\(\[0, 0, -180\]\)/.test(second.buffer));
  check('update angle 180', /, 96, 180\)/.test(second.buffer));
  check('update keeps one return', (second.buffer.match(/\breturn\s+part\s*;/g) || []).length === 1);
  check('update still one revolve block', (second.buffer.match(/contour-mode revolve begin/g) || []).length === 1);

  const both = composeContourRevolve(starter, {
    face,
    tool: 'polygon',
    params: { polygonPreset: 'hexagon', radius: 7 },
    revolve: { angle: 90, axis: 'v', sense: 'both' },
  });
  check('both-sense compose ok', both.ok && /profilePolygon/.test(both.buffer));
  check('both-sense start -45', /\.rotate\(\[0, 0, -45\]\)/.test(both.buffer));

  const alongU = composeContourRevolve(starter, {
    face,
    tool: 'circle',
    params: { radius: 3, segments: 16 },
    revolve: { angle: 360, axis: 'u', sense: 'positive' },
  });
  check('axis U compose ok', alongU.ok && /makeRevolve/.test(alongU.buffer));

  const worldY = composeContourRevolve(starter, {
    face,
    tool: 'circle',
    params: { radius: 3, segments: 16 },
    revolve: { angle: 270, axis: 'y', sense: 'positive' },
  });
  check('world +Y on +Z plane ok', worldY.ok && /, 96, 270\)/.test(worldY.buffer));

  const defPlane = composeContourRevolve(starter, {
    face: null,
    tool: 'circle',
    params: { radius: 3, segments: 16 },
    revolve: { angle: 360, axis: 'v', sense: 'positive' },
  });
  check('default +Z compose ok', defPlane.ok && /normal:\s*\[0,\s*0,\s*1\]/.test(defPlane.buffer));

  const refuseR = composeContourRevolve(starter, {
    face,
    tool: 'circle',
    params: { radius: -2, segments: 8 },
    revolve: { angle: 360, axis: 'v', sense: 'positive' },
  });
  check('compose refuses bad radius', !refuseR.ok && /radius/i.test(refuseR.message || ''));

  const refuseA = composeContourRevolve(starter, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    revolve: { angle: 0, axis: 'v', sense: 'positive' },
  });
  check('compose refuses angle 0', !refuseA.ok && /angle/i.test(refuseA.message || ''));

  const refuseDir = composeContourRevolve(starter, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    revolve: { angle: 180, axis: 'z', sense: 'positive' },
  });
  check('compose refuses axis along +Z', !refuseDir.ok && /plane/i.test(refuseDir.message || ''));

  const stripped = stripContourRevolveBlock(first.buffer);
  check('strip removes revolve markers', !hasContourRevolveBlock(stripped));
  check('strip removes makeRevolve', countMakeRevolve(stripped) === 0);
  check('strip removes makeCrossSection', countMakeCrossSection(stripped) === 0);
  check('strip keeps part', /Manifold\.cube/.test(stripped));
  check('Back-equivalent has no orphan Revolve', countMakeRevolve(stripped) === 0);
}

// ── Commit router: Revolve vs Profile / Extrude ────────────────
{
  const face = rFace();
  const rev = composeContourCommit(starter, {
    entry: 'makeRevolve',
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    revolve: { angle: 360, axis: 'v', sense: 'positive' },
  });
  check('commit Revolve emits solid', rev.ok && rev.run && countMakeRevolve(rev.buffer) === 1);

  const prof = composeContourCommit(starter, {
    entry: 'crossSection',
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
  });
  check('commit Profile is Profile-only', prof.ok && prof.run === false && countMakeRevolve(prof.buffer) === 0);
  check('commit Profile is a named contour', /@contour id=c1/.test(prof.buffer) && !hasContourProfileBlock(prof.buffer));
  check('commit Profile has no Extrude', countMakeExtrude(prof.buffer) === 0);

  const ext = composeContourCommit(starter, {
    entry: 'makeExtrude',
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('commit Extrude unchanged (solid + Auto-Run)', ext.ok && ext.run && countMakeExtrude(ext.buffer) === 1);
  check('commit Extrude has no Revolve', countMakeRevolve(ext.buffer) === 0);
  check('commit Extrude still has extrude markers', hasContourExtrudeBlock(ext.buffer));
  check('commit Extrude distance 10 / w 0', /placeInFrame\([^,]+, makeExtrude\([^,]+, 10\), \[0, 0, 0\]\)/.test(ext.buffer));

  // Profile-only then Revolve Confirm: replace profile block with revolve block.
  const thenRev = composeContourRevolve(prof.buffer, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    revolve: { angle: 360, axis: 'v', sense: 'positive' },
  });
  check('Revolve after Profile leaves the named contour', thenRev.ok && !hasContourProfileBlock(thenRev.buffer) && /@contour id=c1/.test(thenRev.buffer));
  check('Revolve after Profile has one solid', countMakeRevolve(thenRev.buffer) === 1);
  check('Revolve after Profile keeps the contour and its own profile', countMakeCrossSection(thenRev.buffer) === 2);

  // Extrude then Revolve: replace extrude block (no stack).
  const thenFromExt = composeContourRevolve(ext.buffer, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    revolve: { angle: 180, axis: 'v', sense: 'positive' },
  });
  check('Revolve after Extrude strips extrude', thenFromExt.ok && !hasContourExtrudeBlock(thenFromExt.buffer));
  check('Revolve after Extrude no makeExtrude', countMakeExtrude(thenFromExt.buffer) === 0);
  check('Revolve after Extrude one makeRevolve', countMakeRevolve(thenFromExt.buffer) === 1);

  // Revolve then Extrude: Extrude strips the revolve block.
  const backToExt = composeContourExtrude(rev.buffer, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  check('Extrude after Revolve strips revolve', backToExt.ok && !hasContourRevolveBlock(backToExt.buffer));
  check('Extrude after Revolve one makeExtrude', countMakeExtrude(backToExt.buffer) === 1);
  check('Extrude after Revolve no makeRevolve', countMakeRevolve(backToExt.buffer) === 0);
}

// ── Function() under stubs (syntax + bindings) ─────────────────
{
  const face = rFace();
  const composed = composeContourRevolve(starter, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    revolve: { angle: 360, axis: 'v', sense: 'positive' },
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
    makeRevolve: () => ({ _t: 'rv', rotate() { return this; } }),
    placeInFrame: (_fr, solid) => solid,
    transformByFrame: (_fr, solid) => solid,
  };
  try {
    const fn = new Function(...Object.keys(stubs), `"use strict";\n${composed.buffer}`);
    const result = fn(...Object.values(stubs));
    check('composed Revolve Function() runs', result != null);
  } catch (e) {
    check('composed Revolve Function() runs', false, String(e.message || e));
  }
}

// ── Extrude #32 + one-shot stubs preserved ─────────────────────
{
  const ext = composeHelperInsert(starter, 'makeExtrude', null, { height: 10 }, null, null);
  check('composeHelperInsert Extrude still emits makeExtrude', /makeExtrude\s*\(/.test(ext));
  check('Extrude stub uses makeCrossSection', /makeCrossSection\s*\(/.test(ext));
  const item = HELPER_PALETTE_ITEMS.find((h) => h.id === 'makeRevolve');
  check('palette still has Revolve item', !!item);
  check('palette title mentions contour mode', /contour/i.test(item.title || ''));
  check('extrude begin marker unchanged', CONTOUR_EXTRUDE_BEGIN.includes('extrude'));
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
  check('fillet compose has no revolve markers', !hasContourRevolveBlock(filBuf || ''));
}

// ── Volume contracts on built/manifold.js (identity remap) ─────
{
  const wasm = await Module();
  wasm.setup();
  const { CrossSection } = wasm;

  const circlePts = [];
  const n = 96;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    circlePts.push([5 * Math.cos(t), 5 * Math.sin(t)]);
  }
  const circleMapped = mapContoursToRevolve([circlePts], [0, 1]);
  check('volume probe: centered circle remaps', circleMapped.ok === true);
  const sph = new CrossSection(circleMapped.mapped).revolve(96, 360);
  const sphVol = sph.volume();
  const sphExpect = (4 / 3) * Math.PI * 125; // ≈ 523.60; Manifold 96-seg clip ≈ 522.66
  check(
    'centered circle → sphere vol ≈ 4/3πr³ (522–524)',
    sphVol > 522 && sphVol < 524,
    `vol=${sphVol} expected≈${sphExpect.toFixed(2)}`,
  );

  const washer = [[[10, 0], [20, 0], [20, 4], [10, 4]]];
  const washMapped = mapContoursToRevolve(washer, [0, 1]);
  check('volume probe: washer remaps', washMapped.ok === true);
  const tor = new CrossSection(washMapped.mapped).revolve(96, 360);
  const torVol = tor.volume();
  const cylVol = Math.PI * 10 * 10 * 4; // filled cylinder if minR-shifted ≈ 1256.64
  check(
    'offset washer → torus tube ~3767 (not filled cylinder)',
    torVol > 3700 && torVol < 3830 && Math.abs(torVol - cylVol) > 1000,
    `vol=${torVol} cylinder=${cylVol.toFixed(2)}`,
  );
}

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll slice-26 checks passed.');
