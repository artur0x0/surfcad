#!/usr/bin/env node
/**
 * Slice 09 — sequential helper-palette compose stays runnable.
 * Proves filletEdges → cube → hole yields one trailing `return part;`,
 * no starter/const redeclarations, and Function() accepts the buffer
 * under stubbed helpers (syntax + binding check).
 */
import {
  composeHelperInsert,
  buildHelperSnippet,
  isBufferEmpty,
  HELPER_PALETTE_ITEMS,
} from '../../src/utils/helperPaletteSnippets.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function countMatches(text, re) {
  const m = String(text).match(re);
  return m ? m.length : 0;
}

function assertSingleTrailingReturn(buf, label) {
  const returns = countMatches(buf, /\breturn\s+part\s*;/g);
  check(`${label}: exactly one return part`, returns === 1, `got ${returns}`);
  check(
    `${label}: return is trailing`,
    /\nreturn\s+part\s*;\s*$/.test(buf),
    'return part; not at end',
  );
}

function assertNoRedeclares(buf, label) {
  const seen = new Set();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(buf))) {
    if (seen.has(m[1])) {
      failed++;
      console.log(`  ❌ ${label}: redeclared ${m[1]}`);
      return;
    }
    seen.add(m[1]);
  }
  check(`${label}: no const/let/var redeclarations`, true);
}

function solid(tag = 's') {
  const o = { _t: tag };
  o.subtract = () => solid(`${tag}-sub`);
  o.add = (x) => x;
  o.volume = () => 1;
  return o;
}

/** Stub Manifold + helpers so Function() only checks syntax/bindings. */
function stubRunner(source) {
  const stubs = {
    Manifold: {
      cube: () => solid('cube'),
      cylinder: () => solid('cyl'),
      sphere: () => solid('sph'),
    },
    tube: () => solid('tube'),
    hexPrism: () => solid('hex'),
    roundedBox: () => solid('rb'),
    filletEdges: (p) => p,
    chamferEdges: (p) => p,
    // Non-empty so Slice 22 Path mid-match IIFE does not throw under stubRunner.
    convexEdges: () => [
      { va: [0, 0, 0], vb: [10, 0, 0] },
      { va: [10, 0, 0], vb: [10, 8, 0] },
    ],
    facesByNormal: () => [0],
    workplaneFromFace: () => ({}),
    holeSpan: () => 20,
    hole: (p) => p,
    holePattern: (p) => p,
    clearanceHole: (p) => p,
    tapDrillHole: (p) => p,
    cboreHole: (p) => p,
    cskHole: (p) => p,
    shell: () => solid('shell'),
    hollow: (p) => p,
    addDraft: (p) => p,
    draftFaces: (p) => p,
    cut: (p) => p,
    booleanBodies: (p) => p,
    move: (p) => p,
    moveFace: (p) => p,
    deleteFace: (p) => p,
    rectTube: () => solid('rectTube'),
    center: (p) => p,
    align: (p) => p,
    mirror: (p) => p,
    array3D: (p) => p,
    polarArray: (p) => p,
    makeExtrude: () => solid('ex'),
    makeRevolve: () => solid('rev'),
    makeLoft: () => solid('loft'),
    offsetPlaneFrame: (plane, offset) => ({
      center: [
        (plane?.center?.[0] || 0),
        (plane?.center?.[1] || 0),
        (plane?.center?.[2] || 0) + offset,
      ],
      normal: plane?.normal || [0, 0, 1],
      x: plane?.x || [1, 0, 0],
      y: plane?.y || [0, 1, 0],
    }),
    profileCircle: (r) => ({ type: 'circle', contours: [[[r, 0], [0, r], [-r, 0], [0, -r]]] }),
    profileRectangle: (w, h) => ({ type: 'rectangle', contours: [[[0, 0], [w, 0], [w, h], [0, h]]] }),
    profilePolygon: (pts) => ({ type: 'polygon', contours: [pts] }),
    makeCrossSection: (plane, profile) => ({
      kind: 'crossSection',
      plane: plane && plane.center ? plane : {
        center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0],
      },
      contours: (profile && profile.contours) || [[[1, 0], [0, 1], [-1, 0]]],
    }),
    makeSweepPath: () => ({ kind: 'sweepPath', closed: false, points: [[0,0,0],[1,0,0]], length: 1, edgeCount: 1 }),
    CrossSection: function CrossSection() { return {}; },
    sweepPoints: () => solid('sweep'),
    placeInFrame: (_, solidArg) => solidArg,
    transformByFrame: (_, solidArg) => solidArg,
  };
  const keys = Object.keys(stubs);
  const fn = new Function(...keys, `"use strict";\n${source}`);
  return fn(...keys.map((k) => stubs[k]));
}

console.log('slice-09 helper compose smoke');

// ── Repro from review: blind += vs compose ─────────────────────
{
  let blind = '';
  for (const id of ['filletEdges', 'cube', 'hole']) {
    blind += buildHelperSnippet(id, { bufferEmpty: isBufferEmpty(blind) });
  }
  check(
    'blind += still broken (baseline)',
    /return\s+part\s*;[\s\S]+Manifold\.cube/.test(blind),
    'expected dead code after return',
  );
}

{
  let buf = '';
  for (const id of ['filletEdges', 'cube', 'hole']) {
    buf = composeHelperInsert(buf, id);
  }
  assertSingleTrailingReturn(buf, 'fillet→cube→hole');
  assertNoRedeclares(buf, 'fillet→cube→hole');
  check(
    'fillet→cube→hole: no dead code after return',
    !/return\s+part\s*;[\s\S]*\S/.test(buf.replace(/\s+$/, '')),
  );
  check(
    'fillet→cube→hole: keeps fillet + cube + hole ops',
    /filletEdges/.test(buf) && /Manifold\.cube/.test(buf) && /\bclearanceHole\s*\(/.test(buf),
  );
  try {
    const result = stubRunner(buf);
    check('fillet→cube→hole: Function() runs under stubs', result != null);
  } catch (e) {
    check('fillet→cube→hole: Function() runs under stubs', false, String(e.message || e));
  }
}

// ── Every palette item in sequence stays single-return / no redecl ─
{
  // Slice 22 Path requires an edge selection (soft-fails null otherwise).
  const pathEdges = [
    { key: '0-1', a: 0, b: 1, va: [0, 0, 0], vb: [10, 0, 0], mid: [5, 0, 0], length: 10 },
    { key: '1-2', a: 1, b: 2, va: [10, 0, 0], vb: [10, 8, 0], mid: [10, 4, 0], length: 8 },
  ];
  let buf = '';
  for (const item of HELPER_PALETTE_ITEMS) {
    const next = item.id === 'sweepPath'
      ? composeHelperInsert(buf, item.id, null, null, null, pathEdges)
      : composeHelperInsert(buf, item.id);
    check(`compose ${item.id} returns string`, typeof next === 'string' && next.length > 0);
    buf = next;
  }
  assertSingleTrailingReturn(buf, 'all palette items');
  assertNoRedeclares(buf, 'all palette items');
  try {
    stubRunner(buf);
    check('all palette items: Function() runs under stubs', true);
  } catch (e) {
    check('all palette items: Function() runs under stubs', false, String(e.message || e));
  }
}

check('unknown id → null', composeHelperInsert('', 'not-a-helper') === null);

check('comment-only buffer counts as empty', isBufferEmpty('// note\n/* x */'));
{
  const next = composeHelperInsert('// note\n', 'filletEdges');
  check('comment-first gets starter part', /let\s+part\s*=/.test(next));
  check('comment-first keeps comment', next.includes('// note'));
}

{
  let buf = composeHelperInsert('', 'filletEdges');
  buf = composeHelperInsert(buf, 'cube');
  const stripped = buf.replace(/(?:\r?\n)?return\s+part\s*;\s*$/, '');
  const afterFillet = stripped.indexOf('filletEdges');
  const mid = stripped.indexOf('\n', afterFillet) + 1;
  const withCenter = composeHelperInsert(buf, 'center', mid);
  const body = withCenter.replace(/(?:\r?\n)?return\s+part\s*;\s*$/, '');
  const cAt = body.indexOf('part = center');
  const fAt = body.indexOf('filletEdges');
  // Second cube assign is `part = Manifold.cube` (starter is `let part = ...`)
  const cubeRe = body.indexOf('\npart = Manifold.cube');
  check('mid-caret inserts center', cAt >= 0);
  check('mid-caret center after fillet line', cAt > fAt, `cAt=${cAt} fAt=${fAt}`);
  check(
    'mid-caret center before later cube assign',
    cubeRe < 0 || cAt < cubeRe,
    `cAt=${cAt} cubeRe=${cubeRe}`,
  );
  check('mid-caret still one trailing return', /\nreturn\s+part\s*;\s*$/.test(withCenter));
}


// ── Hotfix: sequential selected-edge fillets stay parseable ─────
{
  const e1 = [{ mid: [20, 15, 10], va: [20, 0, 10], vb: [20, 30, 10] }];
  const e2 = [{ mid: [-20, 15, 10], va: [-20, 0, 10], vb: [-20, 30, 10] }];
  let buf = composeHelperInsert('', 'cube', null, { width: 40, depth: 30, height: 20, center: true });
  buf = composeHelperInsert(
    buf, 'filletEdges', null,
    { strategy: 'planar', radius: 3, sphericalCorners: true, edgeScope: 'selected', body: 'part' },
    null, e1,
  );
  const twice = composeHelperInsert(
    buf, 'filletEdges', null,
    { strategy: 'planar', radius: 6, sphericalCorners: true, edgeScope: 'selected', body: 'part' },
    null, e2,
  );
  check('sequential fillets: string', typeof twice === 'string' && twice.length > 0);
  check('sequential fillets: selEdges2', /selEdges2/.test(twice));
  check('sequential fillets: unique _mids2', /_mids2/.test(twice));
  check('sequential fillets: no orphan filter close', !/selEdges2 = \(\(\) => \{\s*return _mids/.test(twice));
  assertSingleTrailingReturn(twice, 'sequential fillets');
  assertNoRedeclares(twice, 'sequential fillets');
  try {
    // Parse only — stub convexEdges() returns [] so runtime mid-match would throw.
    new Function(twice);
    check('sequential fillets: parseable (Function)', true);
  } catch (e) {
    check('sequential fillets: parseable (Function)', false, String(e.message || e));
  }

  const soft = composeHelperInsert(
    buf, 'filletEdges', null,
    { strategy: 'planar', radius: 3, sphericalCorners: true, edgeScope: 'selected', body: 'part' },
    null, [],
  );
  check('selected-edge soft-fail → null (no JS)', soft === null);
}

if (failed) {
  console.log(`\nFAILED: ${failed}`);
  process.exit(1);
}
console.log('\nAll slice-09 compose checks passed.');
