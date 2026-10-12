/**
 * Contour status colours, the conflict note, the repeated word, and dragging.
 * No Manifold. No screenshots.
 *
 * A free closed polyline is blue and dof = 2n. A fully constrained rectangle
 * is black. A half-constrained rectangle is blue on free entities and black
 * on locked ones, and that colour matches whether the point drags. A
 * contradictory pair paints only the lines it names. A horizontal
 * point with the other end fixed changes u only. A fixed point does not move.
 * An inconsistent temporary lock keeps the previous point. The script is
 * written on release only when a block already exists. The saved ghost uses
 * the status colour. Repeated is the word, not red.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { analyzeContour, contourFromPolyline, contourFromRectangle } from '../../src/utils/contourSolve.js';
import { emitSolveContour } from '../../src/utils/contourScript.js';
import { listSavedContours } from '../../src/utils/savedContours.js';
import {
  CONTOUR_DRAFT_COLOR,
  CONTOUR_REPEATED_COLOR,
  CONTOUR_STATUS_COLOR,
  CONTOUR_STATUS_LEGEND,
  contourEntityColor,
  contourStatusHex,
  contourPaintModel,
  contourStatusNote,
  savedContourStatus,
} from '../../src/utils/contourStatus.js';
import {
  contourPointDragAllowed,
  dragContourPoint,
  planContourDragRelease,
} from '../../src/utils/contourDrag.js';
import { contourBlockReady } from '../../src/utils/contourProfileWrite.js';
import { CONTOUR_PROFILE_BEGIN, CONTOUR_PROFILE_END } from '../../src/utils/helperPaletteSnippets.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

console.log('colours');
{
  check('a free entity is the draft blue', contourEntityColor('under') === 0x22d3ee && CONTOUR_STATUS_COLOR.under === CONTOUR_DRAFT_COLOR);
  check('a locked entity is black', contourEntityColor('full') === 0x000000);
  check('conflict is red-400', contourEntityColor('conflict') === 0xf87171);
  check('repeated is amber and not a geometry colour', CONTOUR_REPEATED_COLOR === 0xfbbf24 && contourEntityColor('repeated') !== CONTOUR_REPEATED_COLOR);
  check('grey is not a status colour', ![CONTOUR_STATUS_COLOR.under, CONTOUR_STATUS_COLOR.full, CONTOUR_STATUS_COLOR.conflict].includes(0x9ca3af));
  check('unpromoted draft stays blue', CONTOUR_DRAFT_COLOR === 0x22d3ee);
  check('no contour does not paint a status wire', contourPaintModel(null) == null);
  check('the legend names free, locked, conflict, and repeated', CONTOUR_STATUS_LEGEND.map((item) => `${item.status}:${contourStatusHex(item.color)}`).join(',') === 'under:#22d3ee,full:#000000,conflict:#f87171,repeated:#fbbf24');
}

console.log('free polyline is blue');
{
  const spec = contourFromPolyline([[0, 0], [10, 0], [0, 10]]);
  const solved = analyzeContour(spec);
  const paint = contourPaintModel(spec);
  check('dof is 2n', solved.dof === 6 && solved.points.length === 3, `dof ${solved.dof}`);
  check('status under', solved.status === 'under');
  check('every point is blue', paint.pointColors.every((c) => c === 0x22d3ee), paint.pointColors.map((c) => c.toString(16)).join(','));
  check('every edge is blue', paint.segments.every((s) => s.color === 0x22d3ee && s.status === 'under'));
  check('every free point drags', solved.points.every((p) => contourPointDragAllowed(spec, p.id)));
}

console.log('fully constrained is black');
{
  const spec = contourFromRectangle(40, 20, true);
  const solved = analyzeContour(spec);
  const paint = contourPaintModel(spec);
  check('status full', solved.status === 'full' && solved.dof === 0, `${solved.status} dof ${solved.dof}`);
  check('every point is black', paint.pointColors.every((c) => c === 0x000000));
  check('every edge is black', paint.segments.every((s) => s.color === 0x000000 && s.status === 'full'));
  check('no locked point drags', solved.points.every((p) => !contourPointDragAllowed(spec, p.id)));
}

console.log('half constrained is mixed');
{
  const spec = contourFromRectangle(40, 20, true);
  spec.dimensions = spec.dimensions.filter((d) => d.id !== 'd0');
  const solved = analyzeContour(spec);
  const paint = contourPaintModel(spec);
  const point = (id) => paint.pointColors[solved.points.findIndex((p) => p.id === id)];
  const edge = (id) => paint.segments.find((s) => s.id === id);
  check('one degree of freedom remains', solved.status === 'under' && solved.dof === 1, `${solved.status} dof ${solved.dof}`);
  check('the fixed corners are black', point('p0') === 0x000000 && point('p3') === 0x000000);
  check('the free corners are blue', point('p1') === 0x22d3ee && point('p2') === 0x22d3ee);
  check('the locked edge is black', edge('e3')?.color === 0x000000 && edge('e3')?.status === 'full');
  check('the free edges are blue', ['e0', 'e1', 'e2'].every((id) => edge(id)?.color === 0x22d3ee && edge(id)?.status === 'under'));
  check('colour matches the drag lock', solved.points.every((p) => (
    contourPointDragAllowed(spec, p.id) === (solved.entities.points[p.id] === 'under')
  )));
  check('nothing is grey', paint.pointColors.every((c) => c !== 0x9ca3af) && paint.segments.every((s) => s.color !== 0x9ca3af));
}

console.log('contradictory pair');
{
  const spec = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10, 1] },
      { id: 'p2', at: [1, 10] },
      { id: 'p3', at: [30, 30] },
    ],
    lines: [
      { id: 'e0', a: 'p0', b: 'p1' },
      { id: 'e1', a: 'p0', b: 'p2' },
    ],
    arcs: [],
    dimensions: [
      { id: 'd0', kind: 'length', edge: 'e0', value: 10, name: 'width' },
      { id: 'd1', kind: 'length', edge: 'e1', value: 10 },
    ],
    constraints: [
      { id: 'k0', kind: 'parallel', items: ['e0', 'e1'] },
      { id: 'k1', kind: 'perpendicular', items: ['e0', 'e1'] },
      { id: 'k2', kind: 'fix', items: ['p0'], at: { p0: [0, 0] } },
      { id: 'k3', kind: 'fix', items: ['p3'], at: { p3: [30, 30] } },
    ],
  };
  const solved = analyzeContour(spec);
  const paint = contourPaintModel(spec);
  const note = contourStatusNote(solved);
  const named = (id) => paint.segments.find((s) => s.id === id);
  check('status conflict', solved.status === 'conflict');
  check('the named lines are red', named('e0')?.color === 0xf87171 && named('e1')?.color === 0xf87171);
  check('the untouched fixed point stays black', paint.pointColors[3] === 0x000000 && solved.entities.points.p3 === 'full');
  check('a point the pair does not name is not red', solved.entities.points.p1 !== 'conflict');
  check('the note names the primary id', note.conflict && note.text.includes(note.primaryId) && note.text.includes('k0'), note.text);
  check('the note names the other id', note.text.includes('k1') && /Also conflicts with/.test(note.text), note.text);
}

console.log('repeated is a word, not red');
{
  const spec = contourFromRectangle(40, 20, true);
  spec.constraints.push({ id: 'k9', kind: 'horizontal', items: ['e0'] });
  const solved = analyzeContour(spec);
  const note = contourStatusNote(spec);
  const paint = contourPaintModel(spec);
  check('status stays full', solved.status === 'full' && solved.conflict == null);
  check('the word is Repeated.', note.text === 'Repeated.' && note.repeated && !note.conflict, note.text);
  check('nothing is red', paint.pointColors.every((c) => c !== 0xf87171) && paint.segments.every((s) => s.color !== 0xf87171));
}

console.log('drag');
{
  const horiz = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10, 0] },
      { id: 'p2', at: [0, 10] },
    ],
    lines: [
      { id: 'e0', a: 'p0', b: 'p1' },
      { id: 'e1', a: 'p1', b: 'p2' },
      { id: 'e2', a: 'p2', b: 'p0' },
    ],
    arcs: [],
    dimensions: [],
    constraints: [
      { id: 'k0', kind: 'horizontal', items: ['e0'] },
      { id: 'k1', kind: 'fix', items: ['p0'], at: { p0: [0, 0] } },
    ],
  };
  const before = horiz.points.map((p) => p.at.slice());
  const moved = dragContourPoint(horiz, 'p1', [14, 5]);
  check('horizontal drag changes u only', moved.moved && near(moved.uv[0], 14) && near(moved.uv[1], 0), JSON.stringify(moved.uv));
  check('the fixed end stays put', near(moved.spec.points[0].at[0], 0) && near(moved.spec.points[0].at[1], 0));
  check('the source spec is untouched', before[1][0] === 10 && before[1][1] === 0);

  const fixed = contourFromRectangle(40, 20, true);
  const stay = dragContourPoint(fixed, 'p0', [5, 5]);
  check('a fixed point does not move', !stay.moved && !contourPointDragAllowed(fixed, 'p0'));
  check('both coordinates stay', near(stay.uv[0], -20) && near(stay.uv[1], -10), JSON.stringify(stay.uv));

  const circle = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10, 0] },
    ],
    lines: [],
    arcs: [{ id: 'a0', center: 'p0', radius: 10, full: true, sweep: 'ccw', segments: 32 }],
    dimensions: [],
    constraints: [
      { id: 'k0', kind: 'fix', items: ['p0'], at: { p0: [0, 0] } },
      { id: 'k1', kind: 'fix', items: ['a0'], at: { p0: [0, 0], a0: [10] } },
      { id: 'k2', kind: 'coincident', items: ['p1', 'a0'] },
    ],
  };
  const locked = dragContourPoint(circle, 'p1', [10, 10]);
  check('an inconsistent lock keeps the previous point', !locked.moved && locked.inconsistent && near(locked.uv[0], 10) && near(locked.uv[1], 0), JSON.stringify(locked.uv));

  const conflict = {
    ...horiz,
    constraints: [
      { id: 'k0', kind: 'parallel', items: ['e0', 'e1'] },
      { id: 'k1', kind: 'perpendicular', items: ['e0', 'e1'] },
    ],
  };
  const refused = dragContourPoint(conflict, 'p1', [20, 4]);
  check('a conflict does not move', !refused.moved && !contourPointDragAllowed(conflict, 'p1'));
}

console.log('script write is pointer-up only');
{
  const spec = contourFromPolyline([[0, 0], [30, 0], [30, 12]]);
  const expr = emitSolveContour(spec);
  const block = `${CONTOUR_PROFILE_BEGIN}\nconst plane = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };\nconst xs = makeCrossSection(plane, ${expr});\n${CONTOUR_PROFILE_END}`;
  const empty = '';
  check('drafting has no block', contourBlockReady(empty, 'crossSection') === false);
  check('a legacy profile block still answers the no-id query', contourBlockReady(block, 'crossSection') === true);
  const still = empty;
  const during = planContourDragRelease({ buffer: still, entry: 'crossSection', moved: true });
  check('a move does not write', during.write === false && still === '');
  check('release without a block does not write', planContourDragRelease({ buffer: empty, entry: 'crossSection', moved: true }).write === false);
  check('release of an unmoved point does not write', planContourDragRelease({ buffer: block, entry: 'crossSection', moved: false, contourId: 'xs' }).write === false);
  check('release without an id does not invent a contour', planContourDragRelease({ buffer: block, entry: 'crossSection', moved: true }).write === false);
  check('release of that contour writes once', planContourDragRelease({ buffer: block, entry: 'crossSection', moved: true, contourId: 'xs' }).write === true);
  const listed = listSavedContours(block);
  check('the saved contour is read back', listed.length === 1 && listed[0].params.contour?.points?.length === 3);
  check('the saved ghost uses the free blue', savedContourStatus(listed[0]) === 'under' && contourEntityColor(savedContourStatus(listed[0])) === 0x22d3ee);
  const full = listSavedContours(`${CONTOUR_PROFILE_BEGIN}\nconst plane = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };\nconst xs = makeCrossSection(plane, ${emitSolveContour(contourFromRectangle(40, 20))});\n${CONTOUR_PROFILE_END}`);
  check('a full ghost is black', savedContourStatus(full[0]) === 'full' && contourEntityColor('full') === 0x000000);
}

console.log('card note');
{
  const root = new URL('../..', import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), 'contour-status-'));
  const out = join(dir, 'ui.mjs');
  const res = await build({
    stdin: {
      contents: `export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
export { default as ContourGestureCard } from './src/components/ContourGestureCard.jsx';
export { default as ContourModeChip } from './src/components/ContourModeChip.jsx';`,
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
  const conflict = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10, 1] },
      { id: 'p2', at: [1, 10] },
    ],
    lines: [
      { id: 'e0', a: 'p0', b: 'p1' },
      { id: 'e1', a: 'p0', b: 'p2' },
    ],
    arcs: [],
    dimensions: [],
    constraints: [
      { id: 'k0', kind: 'parallel', items: ['e0', 'e1'] },
      { id: 'k1', kind: 'perpendicular', items: ['e0', 'e1'] },
    ],
  };
  const card = markup(ui.ContourGestureCard, {
    gesture: 'constraints',
    model: conflict,
    picks: [],
  });
  check('the card names the primary id', /data-contour-conflict="k0"/.test(card) && card.includes('k0'), card.slice(0, 400));
  check('the card names the other conflict', card.includes('k1'));
  const chip = markup(ui.ContourModeChip, {
    tool: 'polyline',
    entry: 'crossSection',
    params: { points: [[0, 0], [10, 1], [1, 10]], contour: conflict },
    onCancel: () => {},
    onConfirm: () => {},
  });
  check('the chip names the same conflict', /data-contour-conflict="k0"/.test(chip) && chip.includes('Also conflicts with'));
  const repeated = contourFromRectangle(40, 20, true);
  repeated.constraints = [...repeated.constraints, { id: 'k9', kind: 'horizontal', items: ['e0'] }];
  const again = markup(ui.ContourGestureCard, {
    gesture: 'constraints',
    model: repeated,
    picks: [],
  });
  check('the card says Repeated.', again.includes('Repeated.'));
  check('repeated is amber and not a conflict', /data-contour-repeated/.test(again) && /text-amber-300/.test(again) && !/data-contour-conflict/.test(again));
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\ncontour status ok');
