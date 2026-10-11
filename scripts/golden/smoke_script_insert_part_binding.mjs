#!/usr/bin/env node
/**
 * Script-insert / existing-part-binding.
 *
 * Playtest: Extrude on top of another Extrude → TDZ
 * `Cannot access 'part' before initialization` when a second insert redeclares
 * or references `part` before the live binding.
 *
 * Locked:
 * 1. Extrude Accept on a script that already has `part` stacks cleanly.
 * 2. Insert after the last part decl/assign; prefer `part = part.add(…)` over
 *    a second `let part`; keep `return part`.
 * 3. Empty-script Contour→Extrude stays `let part = placeInFrame` (no host cube).
 * 4. A TDZ-ordered mutation (part.add before let part) fails at runtime → RED
 *    if reintroduced; composeHelperInsert clamps caret-before-decl inserts.
 */
import {
  composeHelperInsert,
  findLastPartBindingEnd,
  scriptHasPriorSolid,
} from '../../src/utils/helperPaletteSnippets.js';
import {
  composeContourExtrude,
  countMakeExtrude,
  hasContourExtrudeBlock,
} from '../../src/utils/contourMode.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const face = {
  type: 'planar',
  center: [0, 0, 0],
  normal: [0, 0, 1],
  area: 100,
  triangleCount: 2,
  selectionMode: 'coplanar',
};
const faceTop = {
  type: 'planar',
  center: [0, 0, 10],
  normal: [0, 0, 1],
  area: 100,
  triangleCount: 2,
  selectionMode: 'coplanar',
};

const stubs = {
  Manifold: { cube: () => ({ add(x) { return x; }, volume: () => 1 }) },
  profileRectangle: () => ({ contours: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }),
  profileCircle: () => ({ contours: [[[1, 0], [0, 1], [-1, 0], [0, -1]]] }),
  makeCrossSection: (_p, profile) => ({
    plane: { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
    contours: profile.contours,
  }),
  makeExtrude: () => ({ _e: 1, add() { return this; } }),
  placeInFrame: () => ({ _p: 1, add(x) { return x || this; } }),
  placeOnFace: () => { throw new Error('placeOnFace must not run'); },
};

function runStrict(buf) {
  const fn = new Function(...Object.keys(stubs), `"use strict";\n${buf}`);
  return fn(...Object.values(stubs));
}

function extrude(buffer, opts) {
  return composeContourExtrude(buffer, {
    face: opts.face || face,
    tool: opts.tool || 'rectangle',
    params: opts.params || { width: 20, height: 12, centered: true },
    extrude: opts.extrude || { distance: 34.6, direction: 'normal', sense: 'negative' },
  });
}

console.log('script-insert part-binding');

// ── Empty Contour→Extrude stays placeInFrame (no host cube) ────
{
  const empty = extrude('', {});
  check('empty Extrude ok', empty.ok === true, empty.message || '');
  check('empty Extrude is let part = placeInFrame',
    /let\s+part\s*=\s*placeInFrame\s*\(/.test(empty.buffer));
  check('empty Extrude has no host cube', !/Manifold\.cube\s*\(/.test(empty.buffer));
  check('empty Extrude has no part.add', !/part\s*=\s*part\.add\(/.test(empty.buffer));
  check('empty Extrude has markers', hasContourExtrudeBlock(empty.buffer));
  try {
    runStrict(empty.buffer);
    check('empty Extrude Function() runs', true);
  } catch (e) {
    check('empty Extrude Function() runs', false, String(e.message || e));
  }
}

// ── Extrude-on-Extrude stacks (playtest) ───────────────────────
{
  const first = extrude('', {});
  const second = extrude(first.buffer, {
    face: faceTop,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 15, direction: 'normal', sense: 'positive' },
  });
  check('stacked Extrude ok', second.ok === true, second.message || '');
  check('stacked keeps founding let part',
    (second.buffer.match(/\blet\s+part\s*=/g) || []).length === 1);
  check('stacked unions with part.add',
    (second.buffer.match(/part\s*=\s*part\.add\(\s*placeInFrame\s*\(/g) || []).length === 1);
  check('stacked has two extrude blocks',
    (second.buffer.match(/contour-mode extrude begin/g) || []).length === 2);
  check('stacked has two makeExtrude', countMakeExtrude(second.buffer) === 2);
  check('stacked still one return part',
    (second.buffer.match(/\breturn\s+part\s*;/g) || []).length === 1);
  const letIdx = second.buffer.search(/\blet\s+part\s*=/);
  const addIdx = second.buffer.search(/part\s*=\s*part\.add\(/);
  check('stacked let part precedes part.add', letIdx >= 0 && addIdx > letIdx);
  try {
    runStrict(second.buffer);
    check('stacked Extrude Function() runs (no TDZ)', true);
  } catch (e) {
    check('stacked Extrude Function() runs (no TDZ)', false, String(e.message || e));
  }
}

// ── Host cube: no id appends; the same id rewrites ─────────────
{
  const starter = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';
  const first = extrude(starter, {
    face: faceTop,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  const second = extrude(first.buffer, {
    face: faceTop,
    tool: 'circle',
    params: { radius: 7, segments: 24 },
    extrude: { distance: 8, direction: 'normal', sense: 'positive' },
  });
  check('host confirm with no id ok', second.ok === true, second.message || '');
  check('host confirm with no id appends a second block',
    (second.buffer.match(/contour-mode extrude begin/g) || []).length === 2);
  check('host confirm with no id adds a second part.add',
    (second.buffer.match(/part\s*=\s*part\.add\(\s*placeInFrame\s*\(/g) || []).length === 2);
  check('host confirm with no id keeps both radii',
    /profileCircle\(7/.test(second.buffer) && /profileCircle\(5/.test(second.buffer));
  check('host cube survives', /Manifold\.cube\(/.test(second.buffer));
  const rewritten = composeContourExtrude(first.buffer, {
    face: faceTop,
    tool: 'circle',
    params: { radius: 7, segments: 24 },
    extrude: { distance: 8, direction: 'normal', sense: 'positive' },
    featureId: first.featureId,
  });
  check('host same id rewrites one block', rewritten.ok
    && (rewritten.buffer.match(/contour-mode extrude begin/g) || []).length === 1
    && /profileCircle\(7/.test(rewritten.buffer) && !/profileCircle\(5/.test(rewritten.buffer));
}

// ── Binding discovery + caret clamp (no TDZ insert-before-decl) ─
{
  const first = extrude('', {});
  const stripped = first.buffer.replace(/\s*return\s+part\s*;\s*$/, '');
  check('scriptHasPriorSolid on founding Extrude', scriptHasPriorSolid(stripped));
  const end = findLastPartBindingEnd(stripped);
  check('findLastPartBindingEnd after let part',
    end > 0 && /let\s+part\s*=/.test(stripped.slice(0, end)));
  check('binding end is not before the decl',
    stripped.search(/\blet\s+part\s*=/) < end);

  const clamped = composeHelperInsert(first.buffer, 'crossSection', 0, {
    profileType: 'circle',
    radius: 5,
    segments: 32,
    body: 'part',
    _contourExtrude: {
      distance: 10,
      sense: 'positive',
      plane: { center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
    },
  }, faceTop, null);
  check('caret-0 insert still ok', typeof clamped === 'string');
  const letIdx = clamped.search(/\blet\s+part\s*=/);
  const addIdx = clamped.search(/part\s*=\s*part\.add\(/);
  check('caret-0 clamp puts let part before part.add', letIdx >= 0 && addIdx > letIdx);
  check('caret-0 clamp keeps balanced extrude markers',
    (clamped.match(/contour-mode extrude begin/g) || []).length
      === (clamped.match(/contour-mode extrude end/g) || []).length);
  try {
    runStrict(clamped);
    check('caret-0 clamped insert Function() runs', true);
  } catch (e) {
    check('caret-0 clamped insert Function() runs', false, String(e.message || e));
  }
}

// ── Mutation: TDZ-style insert-before-decl must fail at runtime ─
{
  const tdzOrdered = `// --- contour-mode extrude begin ---
const fr2 = { center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const xs2 = makeCrossSection(fr2, profileCircle(5, 32));
part = part.add(placeInFrame(xs2.plane, makeExtrude(xs2.contours, 10), [0, 0, 0]));
// --- contour-mode extrude end ---
// --- contour-mode extrude begin ---
const fr = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const xs = makeCrossSection(fr, profileRectangle(20, 12, true));
let part = placeInFrame(xs.plane, makeExtrude(xs.contours, 34.6), [0, 0, -34.6]);
// --- contour-mode extrude end ---
return part;
`;
  let tdzMsg = '';
  try {
    runStrict(tdzOrdered);
    tdzMsg = 'expected TDZ but ran';
  } catch (e) {
    tdzMsg = String(e.message || e);
  }
  check(
    'TDZ-style insert-before-decl fails (mutation → RED if compose regresses)',
    /before initialization/i.test(tdzMsg),
    tdzMsg,
  );
}

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll script-insert part-binding checks passed.');
