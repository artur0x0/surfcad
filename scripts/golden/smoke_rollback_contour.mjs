#!/usr/bin/env node
/**
 * The rollback bar can sit between a contour and the feature that uses it.
 * The contour stays live, the feature is rolled back, and the solid is the
 * prefix that was already built.
 *
 * Shots: 390×844 and 1280×900, under GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global window */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';
import { markerWithId } from '../../src/utils/featureBlockId.js';
import {
  CUBE_BEGIN,
  CUBE_END,
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
} from '../../src/utils/helperPaletteSnippets.js';

const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
mkdirSync(shotDir, { recursive: true });

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function region(begin, end, id, body) {
  return `${markerWithId(begin, id)}\n${body}\n${markerWithId(end, id)}`;
}

const CUBE = region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true);');
const CONTOUR = 'const c1 = makeCrossSection({ center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileCircle(4, 16)); // @contour id=c1';
const EXTRUDE = region(
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
  'extrude1',
  'part = part.add(placeInFrame(c1.plane, makeExtrude(c1.contours, 12), [0, 0, 0]));',
);
const FULL = [CUBE, CONTOUR, EXTRUDE, 'return part;', ''].join('\n');
const PREFIX = [CUBE, 'return part;', ''].join('\n');

const htmlFor = (compact) => `<!doctype html><meta charset="utf-8">
<div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module">
import '/src/index.css';
import { renderRollbackBarShot } from '/scripts/golden/rollback_bar_shot.js';
renderRollbackBarShot(document.getElementById('root'), {
  compact: ${compact ? 'true' : 'false'},
  script: ${JSON.stringify(FULL)},
  prefix: ${JSON.stringify(PREFIX)},
});
window.__READY__ = true;
</script>`;

const vite = await createVite({
  root: new URL('../..', import.meta.url).pathname,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
const server = createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url.startsWith('/?')) {
    const compact = url.includes('compact=1');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(htmlFor(compact));
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end('no');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader'],
});

async function dragBar(page, point) {
  const bar = page.locator('[data-rollback-bar]');
  const box = await bar.boundingBox();
  if (!box) throw new Error('rollback bar has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 12 });
  await page.mouse.up();
}

async function runSize(label, compact, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  try {
    await page.waitForFunction(() => {
      const bar = window.document.querySelector('[data-rollback-bar]');
      const contour = window.document.querySelector('[data-feature-id="contour:c1"]');
      const extrude = window.document.querySelector('[data-feature-id="extrude1"]');
      if (!bar || !contour || !extrude || window.__MESH__ !== true) return typeof window.__MESH_ERROR__ === 'string';
      return bar.getAttribute('data-rollback-anchor') === 'end';
    }, null, { timeout: 120000 });
  } catch (err) {
    const state = await page.evaluate(() => ({
      mesh: window.__MESH__,
      error: window.__MESH_ERROR__,
      anchor: window.document.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') || '',
    }));
    console.log(label, 'state', state);
    console.log(label, 'errors', errors.slice(0, 8));
    throw err;
  }
  const meshError = await page.evaluate(() => window.__MESH_ERROR__ || '');
  if (meshError) throw new Error(`${label} mesh: ${meshError}`);

  const sigs = await page.evaluate(() => ({
    prefix: window.__PREFIX_SIG__,
    full: window.__FULL_SIG__,
  }));
  check(`${label}: the extrude changes the solid`, sigs.prefix && sigs.full && sigs.prefix !== sigs.full, JSON.stringify(sigs));

  const mid = await page.evaluate(() => {
    const contour = window.document.querySelector('[data-feature-id="contour:c1"]').getBoundingClientRect();
    const extrude = window.document.querySelector('[data-feature-id="extrude1"]').getBoundingClientRect();
    return {
      x: (contour.right + extrude.left) / 2,
      y: (contour.top + contour.bottom) / 2,
    };
  });
  await page.evaluate(() => { window.__ROLLBACK_DONE__ = ''; });
  await dragBar(page, mid);
  await page.waitForFunction(() => window.__ROLLBACK_DONE__ === 'contour:c1', null, { timeout: 60000 });
  const rolled = await page.evaluate(() => {
    const read = (id) => {
      const node = window.document.querySelector(`[data-feature-id="${id}"]`);
      return {
        rolled: node?.getAttribute('data-feature-rolled-back') || '',
        opacity: node ? window.getComputedStyle(node).opacity : '',
        failed: node?.getAttribute('data-feature-failed') || '',
      };
    };
    const line = window.document.querySelector('[data-rollback-line]');
    const contour = window.document.querySelector('[data-feature-id="contour:c1"]');
    const extrude = window.document.querySelector('[data-feature-id="extrude1"]');
    const lineBox = line.getBoundingClientRect();
    const contourBox = contour.getBoundingClientRect();
    const extrudeBox = extrude.getBoundingClientRect();
    return {
      anchor: window.document.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') || '',
      cube: read('cube1'),
      contour: read('contour:c1'),
      extrude: read('extrude1'),
      error: !!window.document.querySelector('[data-execution-error]'),
      sig: window.__MESH_SIG__,
      script: window.__SCRIPT__ || '',
      centerDelta: (lineBox.left + lineBox.width / 2) - ((contourBox.right + extrudeBox.left) / 2),
    };
  });
  check(`${label}: the bar sits on the contour`, rolled.anchor === 'contour:c1', rolled.anchor);
  check(`${label}: the contour stays live`,
    !rolled.contour.rolled && rolled.contour.opacity === '1' && !rolled.contour.failed,
    JSON.stringify(rolled.contour));
  check(`${label}: the extrude is rolled back`,
    rolled.extrude.rolled === '1' && rolled.extrude.opacity === '0.4' && !rolled.extrude.failed,
    JSON.stringify(rolled.extrude));
  check(`${label}: the cube stays live`,
    !rolled.cube.rolled && rolled.cube.opacity === '1',
    JSON.stringify(rolled.cube));
  check(`${label}: the solid is the cube, with no error`,
    rolled.sig === sigs.prefix && !rolled.error,
    `${rolled.sig} vs ${sigs.prefix} error=${rolled.error}`);
  check(`${label}: the script still has the extrude`,
    rolled.script.includes('makeExtrude'),
    'script rewritten');
  check(`${label}: the line is centred in that gap`,
    Math.abs(rolled.centerDelta) <= 2,
    String(rolled.centerDelta));

  const shotPath = join(shotDir, `rollback-contour-${label}.png`);
  await page.screenshot({ path: shotPath });
  console.log(`  shot ${shotPath}`);

  if (errors.length) console.log(`  ${label} page errors`, errors.slice(0, 4).join('\n'));
  await page.close();
}

try {
  await runSize('390', true, 390, 844);
  await runSize('1280', false, 1280, 900);
} finally {
  await browser.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\nrollback contour: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nrollback contour: all checks passed');
process.exit(0);
