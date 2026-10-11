/**
 * Contour Dimension and Arc. No Manifold. No screenshots.
 *
 * One line is a length. Two lines split at 15° from parallel. A point and a
 * line are an offset. An arc is a radius. Confirm writes the dimension as a
 * string name inside solveContour and does not leave the gesture. An inch
 * converts at the field. The card is a number input. Arc rounds a corner.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { displayToMm } from '../../src/utils/displayUnit.js';
import { emitSolveContour } from '../../src/utils/contourScript.js';
import { solveContour } from '../../src/utils/contourSolve.js';
import { stickyPickToggle } from '../../src/utils/stickyPick.js';
import { pickContourScreen } from '../../src/utils/contourPick.js';
import { isolateLoftStationParams } from '../../src/utils/helperPaletteSnippets.js';
import {
  armContourGesture,
  composeContourExtrude,
  composeContourProfile,
  enterContourState,
  resolveContourWorkplane,
  saveContourArc,
  saveContourDimension,
  switchContourTool,
} from '../../src/utils/contourMode.js';
import { writeContourProfileBlock } from '../../src/utils/contourProfileWrite.js';
import {
  linesFromParallelDeg,
  suggestContourDimension,
} from '../../src/utils/contourGesture.js';
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const square = {
  points: [
    { id: 'p0', at: [0, 0] },
    { id: 'p1', at: [40, 0] },
    { id: 'p2', at: [40, 20] },
    { id: 'p3', at: [0, 20] },
  ],
  lines: [
    { id: 'e0', a: 'p0', b: 'p1' },
    { id: 'e1', a: 'p1', b: 'p2' },
    { id: 'e2', a: 'p2', b: 'p3' },
    { id: 'e3', a: 'p3', b: 'p0' },
  ],
  arcs: [],
  dimensions: [],
  constraints: [],
};

console.log('suggestion');
{
  const length = suggestContourDimension(square, [{ id: 'e0', kind: 'line' }]);
  check('one line is a length', length.kind === 'length' && length.kinds.length === 1 && Math.abs(length.value - 40) < 1e-6);

  const parallel = suggestContourDimension(square, [
    { id: 'e0', kind: 'line' },
    { id: 'e2', kind: 'line' },
  ]);
  check('parallel lines suggest a distance', parallel.kind === 'distance' && parallel.kinds.includes('angle'), parallel.kind);
  check('the parallel pair is within 15°', linesFromParallelDeg(square, 'e0', 'e2') <= 15);

  const corner = suggestContourDimension(square, [
    { id: 'e0', kind: 'line' },
    { id: 'e1', kind: 'line' },
  ]);
  check('a square corner suggests an angle', corner.kind === 'angle' && corner.kinds.includes('distance'), corner.kind);
  check('the corner is more than 15° from parallel', linesFromParallelDeg(square, 'e0', 'e1') > 15);

  const tilted = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [10, 0] },
      { id: 'p2', at: [0, 1] },
      { id: 'p3', at: [10, 1 + 10 * Math.tan(16 * Math.PI / 180)] },
    ],
    lines: [
      { id: 'e0', a: 'p0', b: 'p1' },
      { id: 'e1', a: 'p2', b: 'p3' },
    ],
    arcs: [],
    dimensions: [],
    constraints: [],
  };
  const sixteen = linesFromParallelDeg(tilted, 'e0', 'e1');
  const offer = suggestContourDimension(tilted, [{ id: 'e0', kind: 'line' }, { id: 'e1', kind: 'line' }]);
  check('16° suggests an angle', sixteen > 15 && offer.kind === 'angle', `${sixteen.toFixed(2)} ${offer.kind}`);

  const offset = suggestContourDimension(square, [
    { id: 'p2', kind: 'point' },
    { id: 'e0', kind: 'line' },
  ]);
  check('point and line are an offset', offset.kind === 'offset' && Math.abs(offset.value - 20) < 1e-6, String(offset.value));

  const circle = armContourGesture(
    { ...enterContourState('crossSection', null), tool: 'circle', params: { radius: 5, segments: 32 } },
    'dimension',
  );
  const radius = suggestContourDimension(circle.params.contour, [{ id: 'a0', kind: 'arc' }]);
  check('an arc is a radius', radius.kind === 'radius' && Math.abs(radius.value - 5) < 1e-6);
  const solved = solveContour(circle.params.contour);
  check('promoted circle has 32 samples', solved.contours[0].length === 32, String(solved.contours[0]?.length));
  check('promoted circle starts at +u', Math.abs(solved.contours[0][0][0] - 5) < 1e-4 && Math.abs(solved.contours[0][0][1]) < 1e-4);
}

console.log('gesture does not clear the polyline');
{
  const drawn = {
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: [[0, 0], [40, 0], [40, 20]] },
  };
  const armed = armContourGesture(drawn, 'dimension');
  check('points stay', armed.params.points.length === 3 && armed.tool === 'polyline');
  check('promotion closes the third point', armed.params.contour.lines.length === 3);
  const back = switchContourTool(armed, 'polyline');
  check('polyline again keeps the points', back.gesture == null && back.params.points.length === 3);
  check('a different tool still starts clean', switchContourTool(armed, 'circle').params.contour == null);
}

console.log('confirm writes the dimension and stays');
{
  const drawn = armContourGesture({
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: [[0, 0], [40, 0], [40, 20], [0, 20]] },
  }, 'dimension');
  const picked = { ...drawn, picks: [{ id: 'e0', kind: 'line', label: 'e0' }] };
  const inch = displayToMm(1, 'in');
  check('an inch is 25.4 mm at the field', Math.abs(inch - 25.4) < 1e-9);
  const saved = saveContourDimension(picked, { kind: 'length', valueMm: 40, name: 'width', side: 1, sense: 1 });
  check('confirm stays in dimension', saved.state.gesture === 'dimension' && !saved.error, saved.error || '');
  const call = emitSolveContour(saved.state.params.contour);
  check('name is a string', call.includes("name: 'width'"));
  check('no const binding', !call.includes('const width'));
  const face = resolveContourWorkplane(null).face;
  const block = writeContourProfileBlock('', {
    entry: 'crossSection',
    face,
    tool: 'polyline',
    params: saved.state.params,
  });
  check('profile block is written', block.ok && block.written && /solveContour\(/.test(block.buffer), block.message || '');
  check('the write is a named contour', /const c1 = makeCrossSection\(/.test(block.buffer) && /@contour id=c1/.test(block.buffer));
  check('the block is the profile, not a solid', !/makeExtrude|makeRevolve|makeLoft/.test(block.buffer));

  const ext = composeContourExtrude('let part = Manifold.cube([20, 20, 20], true);', {
    face,
    tool: 'rectangle',
    params: { width: 40, height: 20, centered: true },
    extrude: { distance: 12, direction: 'normal', sense: 'positive' },
  });
  check('extrude fixture composes', ext.ok, ext.message || '');
  if (ext.ok) {
    const patched = writeContourProfileBlock(ext.buffer, {
      entry: 'makeExtrude',
      face,
      tool: 'rectangle',
      params: saved.state.params,
      loft: null,
    });
    const extrudeRegion = patched.buffer.slice(
      patched.buffer.indexOf('contour-mode extrude begin'),
      patched.buffer.indexOf('contour-mode extrude end'),
    );
    check('dimension writes a named contour beside the extrude',
      patched.ok && patched.written && /@contour id=c1/.test(patched.buffer) && /solveContour\(/.test(patched.buffer));
    check('extrude block is not rewritten', extrudeRegion === ext.buffer.slice(
      ext.buffer.indexOf('contour-mode extrude begin'),
      ext.buffer.indexOf('contour-mode extrude end'),
    ));
    check('extrude distance stays', /makeExtrude\([^)]*12\)/.test(patched.buffer), patched.buffer);
    check('still one extrude', (patched.buffer.match(/makeExtrude\s*\(/g) || []).length === 1);
  }
}

console.log('arc rounds two segments');
{
  const drawn = armContourGesture({
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: [[0, 0], [10, 0], [10, 10]] },
  }, 'arc');
  const picked = { ...drawn, picks: [{ id: 'e0', kind: 'line' }, { id: 'e1', kind: 'line' }] };
  const rounded = saveContourArc(picked, 2);
  check('arc stays in the gesture', rounded.state.gesture === 'arc' && !rounded.error, rounded.error || '');
  check('one arc and two tangents', rounded.state.params.contour.arcs.length === 1
    && rounded.state.params.contour.constraints.filter((c) => c.kind === 'tangent').length === 2);
}

console.log('loft station keeps its own contour');
{
  const spec = square;
  const a = isolateLoftStationParams({ profileType: 'circle', radius: 3, segments: 16 });
  const b = isolateLoftStationParams({ profileType: 'contour', contour: spec, radius: 9, segments: 16 });
  check('a station without a contour does not gain one', a.contour == null && a.radius === 3);
  check('the selected station keeps its contour', b.contour === spec && b.radius === 9);
}

console.log('sticky pick and hit order');
{
  let picks = [];
  picks = stickyPickToggle(picks, { id: 'e0', kind: 'line' }, 2);
  picks = stickyPickToggle(picks, { id: 'e1', kind: 'line' }, 2);
  picks = stickyPickToggle(picks, { id: 'e2', kind: 'line' }, 2);
  check('a third pick drops the oldest', picks.map((p) => p.id).join(',') === 'e1,e2', picks.map((p) => p.id).join(','));
  const project = (uv) => ({ x: uv[0], y: uv[1] });
  const point = pickContourScreen(square, project, 0, 0, 10);
  const line = pickContourScreen(square, project, 20, 0.4, 10);
  check('a point wins over the line', point?.kind === 'point' && point.id === 'p0');
  check('a line hits away from its ends', line?.kind === 'line' && line.id === 'e0', JSON.stringify(line));
}

console.log('card and rail');
{
  const root = new URL('../..', import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), 'contour-dim-'));
  const out = join(dir, 'ui.mjs');
  const res = await build({
    stdin: {
      contents: `export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
export { default as ContourModeRail } from './src/components/ContourModeRail.jsx';
export { default as ContourGestureCard } from './src/components/ContourGestureCard.jsx';`,
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
  const armed = armContourGesture({
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points: [[0, 0], [40, 0], [40, 20], [0, 20]] },
  }, 'dimension');
  const card = markup(ui.ContourGestureCard, {
    gesture: 'dimension',
    model: armed.params.contour,
    picks: [{ id: 'e0', kind: 'line', label: 'e0' }],
    onApply: () => {},
    onCancel: () => {},
  });
  check('number input', /type="number"/.test(card) && /data-unit="mm"/.test(card));
  check('value is filled on first paint', /value="40"/.test(card));
  check('no slider', !/type="range"/.test(card));
  check('dimension card', /data-contour-card="dimension"/.test(card) && /data-sticky-property="length"/.test(card));
  check('name field', /data-field-label="Name"/.test(card));
}

void composeContourProfile;

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\ncontour dimension ok');
