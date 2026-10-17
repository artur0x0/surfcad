#!/usr/bin/env node
/**
 * Rolling the bar to the start shows an empty part and no error.
 * The copy no longer declares part, so the dangling return is not run.
 *
 * Shots: 390×844 and 1280×900, under GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global window */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createServer as createVite } from 'vite';
import { markerWithId } from '../../src/utils/featureBlockId.js';
import {
  CUBE_BEGIN,
  CUBE_END,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
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
const FILLET = region(
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
  'fillet1',
  [
    'const selEdges = edgesBetween(part, 0, 6);',
    'const path = makeSweepPath(selEdges);',
    'part = filletAlongPath(part, path, 2);',
  ].join('\n'),
);
const FULL = [CUBE, FILLET, 'return part;', ''].join('\n');
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
attachConsentPresetToBrowser(browser);

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
      const fillet = window.document.querySelector('[data-feature-id="fillet1"]');
      if (!bar || !fillet || window.__MESH__ !== true) return typeof window.__MESH_ERROR__ === 'string';
      return bar.getAttribute('data-rollback-anchor') === 'end'
        && !!window.__VIEWPORT__?._lastRenderedMesh;
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

  const start = await page.evaluate(() => {
    const cube = window.document.querySelector('[data-feature-id="cube1"]').getBoundingClientRect();
    return { x: Math.max(4, cube.left - 18), y: (cube.top + cube.bottom) / 2 };
  });
  await page.evaluate(() => { window.__ROLLBACK_DONE__ = ''; window.__MESH_ERROR__ = ''; });
  await dragBar(page, start);
  await page.waitForFunction(() => window.__ROLLBACK_DONE__ === 'start' || !!window.__MESH_ERROR__, null, { timeout: 60000 });
  const rolled = await page.evaluate(() => {
    const read = (id) => {
      const node = window.document.querySelector(`[data-feature-id="${id}"]`);
      return node?.getAttribute('data-feature-rolled-back') || '';
    };
    return {
      anchor: window.document.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') || '',
      cube: read('cube1'),
      fillet: read('fillet1'),
      popup: window.document.querySelector('[data-execution-error]')?.textContent || '',
      mesh: window.__VIEWPORT__?._lastRenderedMesh || null,
      sig: window.__MESH_SIG__ || '',
      done: window.__ROLLBACK_DONE__ || '',
      error: window.__MESH_ERROR__ || '',
    };
  });
  check(`${label}: the bar sits at the start`, rolled.anchor === 'start' && rolled.done === 'start', JSON.stringify({
    anchor: rolled.anchor, done: rolled.done, error: rolled.error,
  }));
  check(`${label}: every feature is rolled back`,
    rolled.cube === '1' && rolled.fillet === '1',
    JSON.stringify({ cube: rolled.cube, fillet: rolled.fillet }));
  check(`${label}: the part is empty and there is no error`,
    !rolled.mesh && rolled.sig === '' && !rolled.popup && !rolled.error
      && !errors.some((msg) => /part/i.test(msg)),
    JSON.stringify({ popup: rolled.popup, error: rolled.error, sig: rolled.sig, page: errors.slice(0, 2) }));

  const shotPath = join(shotDir, `rollback-start-${label}.png`);
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
  console.log(`\nrollback start: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nrollback start: all checks passed');
process.exit(0);
