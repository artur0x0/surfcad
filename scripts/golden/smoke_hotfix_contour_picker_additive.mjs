#!/usr/bin/env node
/**
 * Hotfix — contour picker + additive Advanced Confirm.
 *
 * (a) Saved Profile / makeCrossSection contours are listed and have wire rings.
 * (b) Entering Extrude / Revolve / Sweep / Loft auto-picks the latest contour.
 *     A later manual pick and a rail-tool draw still win.
 * (c) Profile + Workplane sit in Advanced; Prim → Adv → Feat → Xform and the
 *     #41 icons stay; workplane emit still has no bare `top`.
 * (d) Confirm on an existing cube unions the new solid (cube volume + feature).
 *     Second Confirm replaces that block only. Empty buffer stays
 *     `let part = placeInFrame` (no host cube, no placeOnFace).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Module from '../../built/manifold.js';
import {
  HELPER_PALETTE_GROUPS,
  composeHelperInsert,
  itemsByGroup,
} from '../../src/utils/helperPaletteSnippets.js';
import {
  composeContourCommit,
  composeContourExtrude,
  composeContourProfile,
  countMakeCrossSection,
  countMakeExtrude,
  enterContourState,
  hasContourExtrudeBlock,
  switchContourTool,
} from '../../src/utils/contourMode.js';
import {
  applySavedContour,
  listSavedContours,
  savedContourRings,
  withAutoPickedContour,
} from '../../src/utils/savedContours.js';
import { defaultTopPlaneFrame } from '../../src/utils/crossSectionSubstrate.js';

const here = dirname(fileURLToPath(import.meta.url));
const wasm = await Module();
wasm.setup();
const { Manifold } = wasm;

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('hotfix: contour picker + additive Advanced Confirm');

const starter = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';
const face = {
  type: 'planar',
  center: [0, 0, 10],
  normal: [0, 0, 1],
  area: 1200,
  triangleCount: 2,
  selectionMode: 'coplanar',
};

function extrude(buffer, radius = 5) {
  return composeContourExtrude(buffer, {
    face,
    tool: 'circle',
    params: { radius, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
}

// ── (a) saved contours visible + selectable ────────────────────
{
  check('empty script lists nothing', listSavedContours('').length === 0);
  check('comment-only lists nothing', listSavedContours('// no contours\n').length === 0);

  const profile = composeContourProfile(starter, {
    face,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
  });
  check('profile confirm ok', profile.ok === true);
  const saved = listSavedContours(profile.buffer);
  check('profile contour is listed', saved.length === 1, `n=${saved.length}`);
  check('listed contour is the circle', saved[0] && saved[0].tool === 'circle' && saved[0].params.radius === 5);
  check('label names the binding', /c1 · circle r5/.test(saved[0]?.label || ''));
  check('id is the marker, not an offset', saved[0]?.id === 'c1' && !String(saved[0]?.id).includes('@'));
  const rings = savedContourRings(saved[0], defaultTopPlaneFrame([0, 0, 10]));
  check('host-plane ghost has a closed ring', rings.length >= 1 && rings[0].length >= 4);

  const poly = composeContourProfile(starter, {
    face,
    tool: 'polyline',
    params: { points: [[0, 0], [12, 0], [12, 6], [0, 6]] },
  });
  const polySaved = listSavedContours(poly.buffer);
  check('polyline contour is listed', polySaved.length === 1 && polySaved[0].tool === 'polyline');
  check('polyline ghost ring', savedContourRings(polySaved[0], defaultTopPlaneFrame([0, 0, 10])).length >= 1);

  const solid = extrude(starter, 5);
  check('extrude confirm ok', solid.ok === true, solid.message || '');
  const fromSolid = listSavedContours(solid.buffer);
  check('extrude contour is listed with its plane',
    fromSolid.length === 1 && fromSolid[0].plane && Math.abs(fromSolid[0].plane.center[2] - 10) < 1e-6);
  const literalRings = savedContourRings(fromSolid[0], null);
  check('literal-plane ghost does not need a host', literalRings.length >= 1 && literalRings[0].length >= 4);

  const picked = applySavedContour(enterContourState('makeExtrude', null), fromSolid[0]);
  check('pick seeds the extrude profile',
    picked.tool === 'circle' && picked.params.radius === 5 && picked.pickedContourId === fromSolid[0].id);
  const driven = composeContourCommit(starter, {
    entry: 'makeExtrude',
    face: picked.planeFace,
    tool: picked.tool,
    params: picked.params,
    extrude: picked.extrude,
  });
  check('picked contour drives Extrude',
    driven.ok && /profileCircle\(5/.test(driven.buffer) && /makeExtrude\(/.test(driven.buffer));
}

// ── (b) auto-pick last; manual override; new draw ─────────────
{
  const older = `const fr = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const xs = makeCrossSection(fr, profileCircle(4, 16));
const xs2 = makeCrossSection(fr, profileRectangle(18, 9, true));
let part = Manifold.cube([40, 30, 20], true);
return part;
`;
  const list = listSavedContours(older);
  check('two saved contours, oldest first', list.length === 2 && list[0].tool === 'circle' && list[1].tool === 'rectangle');
  const auto = withAutoPickedContour(enterContourState('makeRevolve', null), list);
  check('auto-pick is the latest contour',
    auto.tool === 'rectangle' && auto.params.width === 18 && auto.pickedContourId === list[1].id);
  check('auto-pick also covers Sweep and Loft',
    withAutoPickedContour(enterContourState('makeSweep', null), list).pickedContourId === list[1].id
    && withAutoPickedContour(enterContourState('makeLoft', null), list).tool === 'rectangle');
  check('Profile enter does not auto-pick',
    withAutoPickedContour(enterContourState('crossSection', null), list).pickedContourId == null);
  check('empty picker does not invent a pick',
    withAutoPickedContour(enterContourState('makeExtrude', null), []).pickedContourId == null);

  const manual = applySavedContour(auto, list[0]);
  check('manual pick overrides auto',
    manual.tool === 'circle' && manual.params.radius === 4 && manual.pickedContourId === list[0].id);
  const drawn = switchContourTool(manual, 'polygon');
  check('new draw clears the pick',
    drawn.tool === 'polygon' && drawn.pickedContourId == null && drawn.params.polygonPreset === 'hexagon');
}

// ── (c) palette placement + icons + no bare top ───────────────
{
  check(
    'group order Prim Adv Feat Xform',
    HELPER_PALETTE_GROUPS.join('|') === 'Primitives|Advanced|Features|Transforms',
  );
  const grouped = itemsByGroup();
  check(
    'Advanced holds Profile Workplane then solids',
    grouped.Advanced.map((i) => i.id).join(',')
      === 'crossSection,workplane,makeExtrude,makeRevolve,makeSweep,makeLoft',
  );
  check('Features no longer has Profile', !grouped.Features.some((i) => i.id === 'crossSection'));
  check('Transforms no longer has Workplane', !grouped.Transforms.some((i) => i.id === 'workplane'));
  check('Fillet stays in Features', grouped.Features.some((i) => i.id === 'filletEdges'));

  const rail = readFileSync(join(here, '../../src/components/HelperInsertPalette.jsx'), 'utf8');
  check('Create contour icon NotebookPen', /crossSection:\s*NotebookPen/.test(rail));
  check('Workplane icon Layers3', /workplane:\s*Layers3/.test(rail));
  check('Extrude icon ArrowUpFromLine', /makeExtrude:\s*ArrowUpFromLine/.test(rail));
  check('Revolve icon Rotate3d', /makeRevolve:\s*Rotate3d/.test(rail));
  check('Sweep icon Route (inherited from the retired Path button)', /makeSweep:\s*Route/.test(rail));
  check('Loft icon Pyramid', /makeLoft:\s*Pyramid/.test(rail));
  check('Fillet icon SquareRoundCorner', /filletEdges:\s*SquareRoundCorner/.test(rail));
  check('rail captions Block / Polish / Move',
    /Primitives:\s*'Block'/.test(rail) && /Advanced:\s*'Adv'/.test(rail)
    && /Features:\s*'Polish'/.test(rail) && /Transforms:\s*'Move'/.test(rail));
  check('Hole icon Drill', /hole:\s*Drill/.test(rail));
  check('Shell icon PackageOpen', /shell:\s*PackageOpen/.test(rail));
  check('Array icon Boxes', /array3D:\s*Boxes/.test(rail));
  check('Draft icon Angle', /addDraft:\s*Angle/.test(rail));

  const wp = composeHelperInsert(starter, 'workplane');
  check('workplane emit has no bare top', wp && !/\btop\b/.test(wp.replace(/topFace/g, 'FACE')));
  check('workplane is a literal plane, not a new host cube',
    /normal:\s*\[0,\s*0,\s*1\]/.test(wp)
    && /x:\s*\[1,\s*0,\s*0\]/.test(wp)
    && (wp.match(/Manifold\.cube\s*\(/g) || []).length === 1
    && !/facesByNormal/.test(wp));

  const docs = readFileSync(join(here, '../../HELPER_FUNCTIONS.md'), 'utf8');
  check('HELPER notes additive Confirm',
    /when `part` already exists/i.test(docs) && /part\.add\(placeInFrame/.test(docs));
  const palette = readFileSync(join(here, '../../src/utils/helperPaletteSnippets.js'), 'utf8');
  // Block/Shape subtract mode (dcf0c0b) made Confirm add OR subtract; default stays add.
  check('palette copy says Confirm adds or subtracts onto an existing part',
    /Confirm adds or subtracts when part already exists/.test(palette));
}

// ── (d) additive Confirm keeps cube volume + new feature ──────
{
  const first = extrude(starter, 5);
  check('first Confirm ok', first.ok === true, first.message || '');
  const ownedStart = first.buffer.indexOf('contour-mode extrude begin');
  check('cube stays outside the extrude block',
    ownedStart > 0 && /Manifold\.cube\(\[40,\s*30,\s*20\]/.test(first.buffer.slice(0, ownedStart)));
  check('one additive placeInFrame',
    (first.buffer.match(/part\s*=\s*part\.add\(\s*placeInFrame\s*\(/g) || []).length === 1);
  check('no placeOnFace', !/placeOnFace\s*\(/.test(first.buffer));
  check('one extrude block', (first.buffer.match(/contour-mode extrude begin/g) || []).length === 1);

  const radius = Number((first.buffer.match(/profileCircle\(\s*([\d.]+)/) || [])[1]);
  const height = Number((first.buffer.match(/makeExtrude\([^,]+,\s*([\d.]+)/) || [])[1]);
  check('parsed feature size', radius === 5 && height === 10, `r=${radius} h=${height}`);
  const cube = Manifold.cube([40, 30, 20], true);
  const feature = Manifold.cylinder(height, radius, radius, 32, false).translate([0, 0, 10]);
  const unioned = cube.add(feature);
  const cubeVol = cube.volume();
  const featureVol = feature.volume();
  const unionVol = unioned.volume();
  check('union keeps cube volume', unionVol > cubeVol + 50, `union=${unionVol} cube=${cubeVol}`);
  check('union keeps the new feature', unionVol > featureVol + 50, `union=${unionVol} feature=${featureVol}`);
  cube.delete();
  feature.delete();
  unioned.delete();

  const second = composeContourExtrude(first.buffer, {
    face,
    tool: 'circle',
    params: { radius: 7, segments: 24 },
    extrude: { distance: 8, direction: 'normal', sense: 'positive' },
  });
  check('second Confirm ok', second.ok === true, second.message || '');
  check('second Confirm still one block', (second.buffer.match(/contour-mode extrude begin/g) || []).length === 1);
  check('second Confirm still one union',
    (second.buffer.match(/part\s*=\s*part\.add\(\s*placeInFrame\s*\(/g) || []).length === 1);
  check('second Confirm still one cube', (second.buffer.match(/Manifold\.cube\(/g) || []).length === 1);
  check('second Confirm replaces the feature',
    /profileCircle\(7/.test(second.buffer) && !/profileCircle\(5/.test(second.buffer));
  check('second Confirm one makeExtrude', countMakeExtrude(second.buffer) === 1);
  check('second Confirm one makeCrossSection', countMakeCrossSection(second.buffer) === 1);
  check('markers still wrap the block', hasContourExtrudeBlock(second.buffer));

  const empty = extrude('', 5);
  check('empty Confirm ok', empty.ok === true, empty.message || '');
  check('empty Confirm is let part = placeInFrame', /let\s+part\s*=\s*placeInFrame\s*\(/.test(empty.buffer));
  check('empty Confirm has no host add', !/part\s*=\s*part\.add\(/.test(empty.buffer));
  check('empty Confirm has no starter cube', !/Manifold\.cube\s*\(/.test(empty.buffer));
  check('empty Confirm has no placeOnFace', !/placeOnFace\s*\(/.test(empty.buffer));
}

if (failed) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll contour-picker + additive Confirm checks passed.');
