/* global document, window, getComputedStyle */
/**
 * Dimensions drive the contour, at 390px.
 *
 * A distance between two points keeps the first point and moves the second.
 * Length, angle, offset, and radius re-solve from that same start, so a
 * second value does not drift. The tag is portaled onto the page and stays
 * inside a 390px canvas. Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { emitSolveContour, parseSolveContour } from '../../src/utils/contourScript.js';
import { solveContour } from '../../src/utils/contourSolve.js';
import { dimensionAnchor } from '../../src/utils/contourPick.js';
import {
  armContourGesture,
  enterContourState,
  previewContourDimension,
  saveContourDimension,
} from '../../src/utils/contourMode.js';
import {
  liveDimension,
  selectContourGesture,
  suggestContourDimension,
  toggleContourPick,
} from '../../src/utils/contourGesture.js';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function near(actual, expected, eps = 1e-3) {
  return actual != null && Math.abs(actual - expected) <= eps;
}

function at(contour, id) {
  return contour.points.find((p) => p.id === id)?.at;
}

function gap(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function signedPointLine(p, a, d) {
  const L = Math.hypot(d[0], d[1]) || 1;
  return ((p[0] - a[0]) * (-d[1]) + (p[1] - a[1]) * d[0]) / L;
}

function angleDeg(contour, idA, idB) {
  const line = (id) => contour.lines.find((item) => item.id === id);
  const end = (id) => at(contour, id);
  const A = line(idA);
  const B = line(idB);
  const a0 = end(A.a);
  const a1 = end(A.b);
  const b0 = end(B.a);
  const b1 = end(B.b);
  const d1 = [a1[0] - a0[0], a1[1] - a0[1]];
  const d2 = [b1[0] - b0[0], b1[1] - b0[1]];
  const cross = d1[0] * d2[1] - d1[1] * d2[0];
  const dot = d1[0] * d2[0] + d1[1] * d2[1];
  return Math.atan2(Math.abs(cross), dot) * 180 / Math.PI;
}

function dimensionState(points, picks) {
  const armed = armContourGesture({
    ...enterContourState('crossSection', null),
    tool: 'polyline',
    params: { points },
  }, 'dimension');
  return { ...armed, picks };
}

console.log('point distance drives the second point');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

{
  const points = [[0, 0], [10, 0], [10, 10]];
  let state = dimensionState(points, [
    { id: 'p0', kind: 'point' },
    { id: 'p1', kind: 'point' },
  ]);
  const offer = suggestContourDimension(state.params.contour, state.picks);
  check('two points suggest a distance', offer.ok && offer.kind === 'distance' && near(offer.value, 10), String(offer.value));
  const anchor = dimensionAnchor(state.params.contour, { kind: 'distance', a: 'p0', b: 'p1' });
  check('the tag sits between the points', anchor && near(anchor[0], 5) && near(anchor[1], 0), JSON.stringify(anchor));

  state = liveDimension(state, { kind: 'distance', valueMm: 30, name: 'span' }).state;
  const moved = state.params.contour;
  check('first point stays at the start', near(at(moved, 'p0')[0], 0) && near(at(moved, 'p0')[1], 0), JSON.stringify(at(moved, 'p0')));
  check('second point moves to 30', near(gap(at(moved, 'p0'), at(moved, 'p1')), 30), JSON.stringify(at(moved, 'p1')));
  check('the untouched corner stays', near(at(moved, 'p2')[0], 10) && near(at(moved, 'p2')[1], 10), JSON.stringify(at(moved, 'p2')));
  check('one preview dimension', moved.dimensions.length === 1 && moved.dimensions[0].name === 'span');
  check('the pin is the first point', near(moved.dimensions[0].at.p0[0], 0) && near(moved.dimensions[0].at.p0[1], 0));

  state = liveDimension(state, { kind: 'distance', valueMm: 45, name: 'span' }).state;
  const again = state.params.contour;
  check('a second value does not drift the first point', near(at(again, 'p0')[0], 0) && near(at(again, 'p0')[1], 0), JSON.stringify(at(again, 'p0')));
  check('the second point follows 45', near(gap(at(again, 'p0'), at(again, 'p1')), 45), JSON.stringify(at(again, 'p1')));
  check('still one dimension', again.dimensions.length === 1);

  const cleared = liveDimension(state, { kind: 'distance', valueMm: NaN }).state;
  check('an empty value puts the points back', near(gap(at(cleared.params.contour, 'p0'), at(cleared.params.contour, 'p1')), 10));
  check('the preview dimension is gone until the next number', (cleared.params.contour.dimensions || []).length === 0);

  state = liveDimension(state, { kind: 'distance', valueMm: 30, name: 'span' }).state;
  const dropped = toggleContourPick(state, { id: 'p1', kind: 'point' });
  check('changing the pick drops the preview', (dropped.params.contour.dimensions || []).length === 0);
  check('the points return when the pick changes', near(gap(at(dropped.params.contour, 'p0'), at(dropped.params.contour, 'p1')), 10));

  state = liveDimension(dimensionState(points, [
    { id: 'p0', kind: 'point' },
    { id: 'p1', kind: 'point' },
  ]), { kind: 'distance', valueMm: 30, name: 'span' }).state;
  const confirmed = saveContourDimension(state, { kind: 'distance', valueMm: 30, name: 'span' });
  check('confirm keeps one distance', !confirmed.error && confirmed.state.params.contour.dimensions.length === 1, confirmed.error || '');
  check('confirm stays in the gesture', confirmed.state.gesture === 'dimension' && confirmed.state.dimensionLive == null);
  check('confirm clears the picks', (confirmed.state.picks || []).length === 0);
  const saved = confirmed.state.params.contour;
  check('confirm keeps the first point and the new distance', near(at(saved, 'p0')[0], 0) && near(gap(at(saved, 'p0'), at(saved, 'p1')), 30));
  const source = emitSolveContour(saved);
  check('the name stays a string on the dimension', /name: 'span'/.test(source) && !/\bconst\s+span\b/.test(source));
  const parsed = parseSolveContour(source);
  check('the pin round-trips', near(parsed.dimensions[0].at.p0[0], 0) && near(parsed.dimensions[0].at.p0[1], 0));
  const solvedAgain = solveContour(parsed);
  check('a second solve keeps the distance', near(gap(
    solvedAgain.points.find((p) => p.id === 'p0').at,
    solvedAgain.points.find((p) => p.id === 'p1').at,
  ), 30));

  const cancelled = selectContourGesture(liveDimension(dimensionState(points, [
    { id: 'p0', kind: 'point' },
    { id: 'p1', kind: 'point' },
  ]), { kind: 'distance', valueMm: 30 }).state, 'dimension');
  check('X drops the distance and writes nothing', cancelled.gesture == null && (cancelled.params.contour.dimensions || []).length === 0);
  check('X puts the second point back', near(gap(at(cancelled.params.contour, 'p0'), at(cancelled.params.contour, 'p1')), 10));
}

console.log('every dimension input re-solves');
{
  const tri = [[0, 0], [10, 0], [10, 10]];
  const length = liveDimension(dimensionState(tri, [{ id: 'e0', kind: 'line' }]), {
    kind: 'length', valueMm: 25,
  }).state;
  check('length becomes 25', near(gap(at(length.params.contour, 'p0'), at(length.params.contour, 'p1')), 25), JSON.stringify(at(length.params.contour, 'p1')));

  const angled = liveDimension(dimensionState(tri, [
    { id: 'e0', kind: 'line' },
    { id: 'e1', kind: 'line' },
  ]), { kind: 'angle', valueMm: 60, sense: 1 }).state;
  check('angle becomes 60', near(angleDeg(angled.params.contour, 'e0', 'e1'), 60, 0.05), String(angleDeg(angled.params.contour, 'e0', 'e1')));

  const offset = liveDimension(dimensionState(tri, [
    { id: 'p2', kind: 'point' },
    { id: 'e0', kind: 'line' },
  ]), { kind: 'offset', valueMm: 30, side: 1 }).state;
  const model = offset.params.contour;
  const e0 = model.lines.find((line) => line.id === 'e0');
  const a = at(model, e0.a);
  const b = at(model, e0.b);
  const off = signedPointLine(at(model, 'p2'), a, [b[0] - a[0], b[1] - a[1]]);
  check('offset becomes 30', near(Math.abs(off), 30, 0.05), String(off));
  check('the offset point moved', !near(at(model, 'p2')[1], 10, 0.5), JSON.stringify(at(model, 'p2')));

  const radiusState = {
    ...enterContourState('crossSection', null),
    gesture: 'dimension',
    tool: 'circle',
    params: {
      contour: {
        points: [{ id: 'p0', at: [0, 0] }],
        lines: [],
        arcs: [{ id: 'a0', center: 'p0', radius: 5, full: true, sweep: 'ccw', segments: 16 }],
        dimensions: [],
        constraints: [],
      },
    },
    picks: [{ id: 'a0', kind: 'arc' }],
  };
  const radius = liveDimension(radiusState, { kind: 'radius', valueMm: 12 }).state;
  check('radius becomes 12', near(radius.params.contour.arcs[0].radius, 12), String(radius.params.contour.arcs[0].radius));

  const rect = [[0, 0], [40, 0], [40, 20], [0, 20]];
  const lines = liveDimension(dimensionState(rect, [
    { id: 'e0', kind: 'line' },
    { id: 'e2', kind: 'line' },
  ]), { kind: 'distance', valueMm: 35, side: 1 }).state;
  const lined = lines.params.contour;
  const top = lined.lines.find((line) => line.id === 'e0');
  const bottom = lined.lines.find((line) => line.id === 'e2');
  const ta = at(lined, top.a);
  const tb = at(lined, top.b);
  const ba = at(lined, bottom.a);
  const dir = [tb[0] - ta[0], tb[1] - ta[1]];
  const cross = dir[0] * (at(lined, bottom.b)[1] - ba[1]) - dir[1] * (at(lined, bottom.b)[0] - ba[0]);
  const separation = signedPointLine(ba, ta, dir);
  check('line distance becomes 35', near(Math.abs(separation), 35, 0.05), String(separation));
  check('the lines stay parallel', near(cross, 0, 0.05), String(cross));

  const preview = previewContourDimension(dimensionState(tri, [
    { id: 'p0', kind: 'point' },
    { id: 'p1', kind: 'point' },
  ]), { kind: 'distance', valueMm: 22 });
  check('the session preview does not clear the gesture', preview.state.gesture === 'dimension' && preview.state.picks.length === 2);
  check('the session preview moves the second point', near(gap(at(preview.state.params.contour, 'p0'), at(preview.state.params.contour, 'p1')), 22));
}

console.log('390px tag');
{
  const driven = liveDimension(dimensionState([[0, 0], [10, 0], [10, 10]], [
    { id: 'p0', kind: 'point' },
    { id: 'p1', kind: 'point' },
  ]), { kind: 'distance', valueMm: 30, name: 'span' }).state.params.contour;
  const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
  check('system Chrome is available', !!exe, 'set CHROME_PATH');
  if (exe) {
    const root = new URL('../..', import.meta.url).pathname;
    const bundled = await build({
      stdin: {
        contents: `import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { PerspectiveCamera } from 'three';
import ContourTags from './src/components/ContourTags.jsx';
window.renderDistanceTag = (model) => {
  const canvas = document.getElementById('view');
  const camera = new PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 2000);
  camera.position.set(0, 0, 500);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const host = document.createElement('div');
  document.body.appendChild(host);
  createRoot(host).render(createElement(ContourTags, {
    model,
    plane: { center: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
    cameraRef: { current: camera },
    canvasRef: { current: canvas },
  }));
};`,
        resolveDir: root,
        loader: 'jsx',
      },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      write: false,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      loader: { '.css': 'empty', '.svg': 'text', '.png': 'dataurl' },
      logLevel: 'error',
    });
    const browser = await chromium.launch({ executablePath: exe, headless: true });
attachConsentPresetToBrowser(browser);
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=390"></head>
<body style="margin:0">
  <div id="shell" style="width:390px;height:700px;overflow:hidden;container-type:inline-size;position:relative">
    <canvas id="view" width="390" height="700" style="width:390px;height:700px;display:block"></canvas>
  </div>
</body></html>`);
      await page.addScriptTag({ content: bundled.outputFiles[0].text });
      await page.evaluate((model) => window.renderDistanceTag(model), driven);
      await page.waitForFunction(() => {
        const tag = document.querySelector('[data-contour-tag]');
        const layer = document.querySelector('[data-contour-tags]');
        const mark = document.querySelector('[data-contour-tag-visible="1"]');
        if (!tag || !layer || !mark) return false;
        const box = tag.getBoundingClientRect();
        const canvas = document.getElementById('view').getBoundingClientRect();
        const shell = document.getElementById('shell');
        const style = getComputedStyle(layer);
        const shown = getComputedStyle(mark).display !== 'none' && box.width > 8 && box.height > 8;
        const inside = box.left < canvas.right && box.right > canvas.left
          && box.top < canvas.bottom && box.bottom > canvas.top;
        window.__tagProbe = {
          text: tag.textContent,
          shown,
          inside,
          portaled: layer.parentElement === document.body,
          fixed: style.position === 'fixed',
          clipped: shell.contains(tag),
          canvasWidth: canvas.width,
          box: { x: box.x, y: box.y, w: box.width, h: box.height },
        };
        return shown && inside && window.__tagProbe.portaled && window.__tagProbe.fixed && !window.__tagProbe.clipped;
      });
      const probe = await page.evaluate(() => window.__tagProbe);
      check('the tag is visible inside the 390px canvas', probe.canvasWidth === 390 && probe.shown && probe.inside, JSON.stringify(probe));
      check('the tag reads the driven distance', /span/.test(probe.text) && /30 mm/.test(probe.text), probe.text);
      check('the tag is portaled and not clipped by the shell', probe.portaled && probe.fixed && !probe.clipped, JSON.stringify(probe));
      await page.screenshot({ path: join(SHOT_DIR, 'contour-dimension-drive-390.png') });
    } finally {
      await browser.close();
    }
  }
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\ncontour dimension drive ok');
