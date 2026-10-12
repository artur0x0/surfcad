/**
 * Contour Constraints. No Manifold. No screenshots.
 *
 * The suggestion bands are inclusive at 20° and 15°. Each of the eight
 * kinds composes. Equal of a line and an arc is refused. Tangent stores
 * side. The card is StickyPickApply and the icon is data-contour-icon.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { emitSolveContour } from '../../src/utils/contourScript.js';
import { solveContour } from '../../src/utils/contourSolve.js';
import {
  armContourGesture,
  enterContourState,
  resolveContourWorkplane,
  saveContourConstraint,
  switchContourTool,
} from '../../src/utils/contourMode.js';
import { writeContourProfileBlock } from '../../src/utils/contourProfileWrite.js';
import {
  buildConstraint,
  suggestContourConstraint,
} from '../../src/utils/contourGesture.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function lineAt(deg) {
  const t = deg * Math.PI / 180;
  return {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10 * Math.cos(t), 10 * Math.sin(t)] },
    ],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [],
    dimensions: [],
    constraints: [],
  };
}

function twoLines(deg) {
  const t = deg * Math.PI / 180;
  return {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10, 0] },
      { id: 'p2', at: [0, 2] },
      { id: 'p3', at: [10 * Math.cos(t), 2 + 10 * Math.sin(t)] },
    ],
    lines: [
      { id: 'e0', a: 'p0', b: 'p1' },
      { id: 'e1', a: 'p2', b: 'p3' },
    ],
    arcs: [],
    dimensions: [],
    constraints: [],
  };
}

const linePick = [{ id: 'e0', kind: 'line' }];
const pairPick = [{ id: 'e0', kind: 'line' }, { id: 'e1', kind: 'line' }];

console.log('one line');
{
  const flat = suggestContourConstraint(lineAt(0), linePick);
  check('0° is the horizontal band', flat.band === 'x' && flat.kind === 'horizontal' && flat.kinds.includes('vertical') && flat.kinds.includes('fix'));
  const twenty = suggestContourConstraint(lineAt(20), linePick);
  check('20° stays in the horizontal band', twenty.band === 'x' && twenty.kind === 'horizontal', twenty.band);
  const twentyOne = suggestContourConstraint(lineAt(21), linePick);
  check('21° uses the longer span and stays horizontal', twentyOne.band === 'span' && twentyOne.kind === 'horizontal', twentyOne.band);
  const mid = suggestContourConstraint(lineAt(45), linePick);
  check('45° is horizontal because |du| equals |dv|', mid.band === 'span' && mid.kind === 'horizontal');
  const sixtyNine = suggestContourConstraint(lineAt(69), linePick);
  check('69° is vertical on the longer span', sixtyNine.band === 'span' && sixtyNine.kind === 'vertical', sixtyNine.kind);
  const seventy = suggestContourConstraint(lineAt(70), linePick);
  check('70° is the vertical band', seventy.band === 'y' && seventy.kind === 'vertical', seventy.band);
  const upright = suggestContourConstraint(lineAt(90), linePick);
  check('90° is vertical', upright.kind === 'vertical' && upright.kinds.join(',') === 'horizontal,vertical,fix');
}

console.log('two lines');
{
  const parallel = suggestContourConstraint(twoLines(0), pairPick);
  check('parallel lines suggest parallel', parallel.kind === 'parallel' && parallel.band === 'parallel');
  const fifteen = suggestContourConstraint(twoLines(15), pairPick);
  check('15° is still the parallel band', fifteen.band === 'parallel' && fifteen.kind === 'parallel', fifteen.band);
  const sixteen = suggestContourConstraint(twoLines(16), pairPick);
  check('16° suggests parallel and still offers perpendicular', sixteen.band === 'other' && sixteen.kind === 'parallel' && sixteen.kinds.includes('perpendicular') && sixteen.kinds.includes('equal'), sixteen.band);
  const seventyFour = suggestContourConstraint(twoLines(74), pairPick);
  check('74° is not yet perpendicular', seventyFour.band === 'other' && seventyFour.kind === 'parallel', seventyFour.kind);
  const seventyFive = suggestContourConstraint(twoLines(75), pairPick);
  check('75° suggests perpendicular', seventyFive.band === 'perpendicular' && seventyFive.kind === 'perpendicular' && seventyFive.kinds.includes('parallel'), seventyFive.band);
  const square = suggestContourConstraint(twoLines(90), pairPick);
  check('90° suggests perpendicular', square.kind === 'perpendicular');
}

console.log('other picks');
{
  const point = {
    points: [{ id: 'p0', at: [1, 2] }, { id: 'p1', at: [4, 5] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [{ id: 'a0', center: 'p0', radius: 3, full: true }],
    dimensions: [],
    constraints: [],
  };
  check('one point is fix', suggestContourConstraint(point, [{ id: 'p0', kind: 'point' }]).kinds.join(',') === 'fix');
  check('one arc is fix', suggestContourConstraint(point, [{ id: 'a0', kind: 'arc' }]).kind === 'fix');
  check('two points are coincident', suggestContourConstraint(point, [
    { id: 'p0', kind: 'point' },
    { id: 'p1', kind: 'point' },
  ]).kind === 'coincident');
  check('a point and a line are coincident', suggestContourConstraint(point, [
    { id: 'p1', kind: 'point' },
    { id: 'e0', kind: 'line' },
  ]).kind === 'coincident');
  check('a point and an arc are coincident', suggestContourConstraint(point, [
    { id: 'p1', kind: 'point' },
    { id: 'a0', kind: 'arc' },
  ]).kind === 'coincident');
  const lineArc = suggestContourConstraint(point, [
    { id: 'e0', kind: 'line' },
    { id: 'a0', kind: 'arc' },
  ]);
  check('a line and an arc are tangent only', lineArc.kind === 'tangent' && lineArc.kinds.join(',') === 'tangent' && lineArc.side === 1, `${lineArc.kinds.join(',')} side ${lineArc.side}`);

  const touching = {
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [10, 0] }],
    lines: [],
    arcs: [
      { id: 'a0', center: 'p0', radius: 5, full: true },
      { id: 'a1', center: 'p1', radius: 5, full: true },
    ],
    dimensions: [],
    constraints: [],
  };
  const touch = suggestContourConstraint(touching, [{ id: 'a0', kind: 'arc' }, { id: 'a1', kind: 'arc' }]);
  check('touching arcs suggest tangent', touch.kind === 'tangent' && touch.kinds.includes('equal') && touch.side === 1, touch.kind);

  const nested = {
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [6, 0] }],
    lines: [],
    arcs: [
      { id: 'a0', center: 'p0', radius: 10, full: true },
      { id: 'a1', center: 'p1', radius: 4, full: true },
    ],
    dimensions: [],
    constraints: [],
  };
  const inside = suggestContourConstraint(nested, [{ id: 'a0', kind: 'arc' }, { id: 'a1', kind: 'arc' }]);
  check('internally tangent arcs store side -1', inside.kind === 'tangent' && inside.side === -1);

  const sameFar = {
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [40, 0] }],
    lines: [],
    arcs: [
      { id: 'a0', center: 'p0', radius: 5, full: true },
      { id: 'a1', center: 'p1', radius: 5, full: true },
    ],
    dimensions: [],
    constraints: [],
  };
  const equalArcs = suggestContourConstraint(sameFar, [{ id: 'a0', kind: 'arc' }, { id: 'a1', kind: 'arc' }]);
  check('equal radii that are apart suggest equal', equalArcs.kind === 'equal' && equalArcs.kinds.includes('tangent'));

  const different = {
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [40, 0] }],
    lines: [],
    arcs: [
      { id: 'a0', center: 'p0', radius: 5, full: true },
      { id: 'a1', center: 'p1', radius: 10, full: true },
    ],
    dimensions: [],
    constraints: [],
  };
  const apart = suggestContourConstraint(different, [{ id: 'a0', kind: 'arc' }, { id: 'a1', kind: 'arc' }]);
  check('different radii that are apart still offer equal', apart.kind === 'tangent' && apart.kinds.includes('equal'), apart.kind);
}

console.log('compose');
function compose(model, picks, kind, side = 1) {
  const built = buildConstraint(model, picks, { kind, side });
  if (!built.ok) return { ok: false, message: built.message };
  let solved;
  try {
    solved = solveContour({ ...model, constraints: [...model.constraints, built.constraint] });
  } catch (err) {
    return { ok: false, message: err.message };
  }
  const call = emitSolveContour(solved);
  return { ok: true, call, constraint: built.constraint, solved };
}

{
  const kinds = [
    ['horizontal', lineAt(20), linePick],
    ['vertical', lineAt(80), linePick],
    ['parallel', twoLines(10), pairPick],
    ['perpendicular', twoLines(80), pairPick],
    ['equal', twoLines(30), pairPick],
    ['coincident', {
      points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [3, 4] }],
      lines: [],
      arcs: [],
      dimensions: [],
      constraints: [],
    }, [{ id: 'p0', kind: 'point' }, { id: 'p1', kind: 'point' }]],
    ['fix', lineAt(10), [{ id: 'p0', kind: 'point' }]],
    ['tangent', {
      points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [10, 0] }, { id: 'p2', at: [5, 4] }],
      lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
      arcs: [{ id: 'a0', center: 'p2', radius: 4, full: true }],
      dimensions: [],
      constraints: [],
    }, [{ id: 'e0', kind: 'line' }, { id: 'a0', kind: 'arc' }]],
  ];
  for (const [kind, model, picks] of kinds) {
    const made = compose(model, picks, kind);
    check(`${kind} composes`, made.ok && made.call.includes(`kind: '${kind}'`), made.message || '');
  }
  const below = {
    points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [10, 0] }, { id: 'p2', at: [5, -4] }],
    lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
    arcs: [{ id: 'a0', center: 'p2', radius: 4, full: true }],
    dimensions: [],
    constraints: [],
  };
  const belowPicks = [{ id: 'e0', kind: 'line' }, { id: 'a0', kind: 'arc' }];
  const belowOffer = suggestContourConstraint(below, belowPicks);
  const tangent = compose(below, belowPicks, 'tangent', belowOffer.side);
  check('tangent below the line stores side -1', belowOffer.side === -1 && tangent.ok && /side: -1/.test(tangent.call), tangent.call || tangent.message);
  const fixed = compose(lineAt(0), [{ id: 'p0', kind: 'point' }], 'fix');
  check('fix stores the current point', fixed.ok && /at: \{ p0: \[0, 0\] \}/.test(fixed.call), fixed.call || '');

  let refused = false;
  try {
    emitSolveContour({
      points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [10, 0] }],
      lines: [{ id: 'e0', a: 'p0', b: 'p1' }],
      arcs: [{ id: 'a0', center: 'p0', radius: 5, full: true }],
      dimensions: [],
      constraints: [{ id: 'k9', kind: 'equal', items: ['e0', 'a0'] }],
    });
  } catch (err) {
    refused = /equal needs two lines or two arcs/.test(err.message);
  }
  check('equal of a line and an arc is refused', refused);
}

console.log('confirm stays');
{
  const drawn = armContourGesture({
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: [[0, 0], [30, 0], [30, 12]] },
  }, 'constraints');
  check('constraints does not clear the polyline', drawn.params.points.length === 3 && drawn.gesture === 'constraints');
  const other = switchContourTool(drawn, 'circle');
  check('a different tool keeps the contour', other.tool === 'circle' && other.gesture == null && other.params.contour?.points?.length === 3);
  const picked = { ...drawn, picks: [{ id: 'e0', kind: 'line' }] };
  const saved = saveContourConstraint(picked, { kind: 'horizontal', side: 1 });
  check('confirm stays in constraints', saved.state.gesture === 'constraints' && !saved.error, saved.error || '');
  const face = resolveContourWorkplane(null).face;
  const block = writeContourProfileBlock('', {
    entry: 'crossSection',
    face,
    tool: 'polyline',
    params: saved.state.params,
  });
  check('the profile block contains the constraint', block.ok && block.written && /kind: 'horizontal'/.test(block.buffer), block.message || '');
}

console.log('card and rail');
{
  const root = new URL('../..', import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), 'contour-con-'));
  const out = join(dir, 'ui.mjs');
  const res = await build({
    stdin: {
      contents: `export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
export { default as ContourModeRail } from './src/components/ContourModeRail.jsx';
export { default as ContourGestureCard } from './src/components/ContourGestureCard.jsx';
export { default as ContourTags } from './src/components/ContourTags.jsx';`,
      resolveDir: root,
      loader: 'jsx',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'text', '.png': 'dataurl' },
    logLevel: 'error',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  writeFileSync(out, res.outputFiles[0].text);
  const ui = await import(out);
  rmSync(dir, { recursive: true, force: true });
  const markup = (C, props) => {
    const err = console.error;
    console.error = () => {};
    try { return ui.renderToStaticMarkup(ui.createElement(C, props)); }
    finally { console.error = err; }
  };
  const rail = markup(ui.ContourModeRail, { tool: 'polyline', entry: 'crossSection' });
  const ids = [...rail.matchAll(/data-contour-tool="([^"]+)"/g)].map((m) => m[1]);
  check('rail order', ids.join(',') === 'circle,rectangle,polygon,polyline,arc,dimension,constraints', ids.join(','));
  check('constrain title', /title="Constrain"/.test(rail) || rail.includes('Constrain'));
  const armed = armContourGesture({
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: [[0, 0], [40, 0], [40, 10]] },
  }, 'constraints');
  const card = markup(ui.ContourGestureCard, {
    gesture: 'constraints',
    model: armed.params.contour,
    picks: [{ id: 'e0', kind: 'line', label: 'e0' }],
  });
  check('constraint card', /data-contour-card="constraint"/.test(card));
  check('horizontal icon', /data-contour-icon="horizontal"/.test(card));
  check('no number field', !/type="number"/.test(card));
  const tags = markup(ui.ContourTags, {
    model: {
      ...armed.params.contour,
      constraints: [{ id: 'k0', kind: 'horizontal', items: ['e0'] }],
    },
    plane: { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
    selectedId: 'k0',
  });
  check('floating icon', /data-contour-icon="horizontal"/.test(tags) && /data-contour-tag-delete="k0"/.test(tags));
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\ncontour constraints ok');
