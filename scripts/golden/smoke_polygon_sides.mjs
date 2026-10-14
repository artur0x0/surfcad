#!/usr/bin/env node
/* global window, document */
/**
 * Polygon options at 390 and 1280.
 *
 * The contour card select lists triangle through octagon, three sides
 * through eight. Heptagon and octagon are drawn, and choosing one updates
 * the select.
 *
 * Shots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';

const PRESETS = ['triangle', 'square', 'pentagon', 'hexagon', 'heptagon', 'octagon'];
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

check('shot dir is not the artifacts folder', !String(shotDir).startsWith('/opt/cursor/artifacts'), shotDir);

const html = `<!doctype html><meta charset="utf-8">
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
import { renderPolygonSidesShot } from '/scripts/golden/polygon_sides_shot.js';
renderPolygonSidesShot(document.getElementById('root'));
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
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
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

async function runSize(label, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30000 });
  await page.locator('[data-polygon-preset]').waitFor({ timeout: 10000 });

  const options = await page.locator('[data-polygon-preset] option').evaluateAll((nodes) => (
    nodes.map((node) => node.value)
  ));
  check(`${label}: select is triangle through octagon`,
    options.length === PRESETS.length && PRESETS.every((name, i) => options[i] === name),
    JSON.stringify(options));

  const catalog = await page.evaluate(() => window.__POLYGON_PRESETS__);
  check(`${label}: side counts are 3 through 8`,
    PRESETS.every((name, i) => catalog[name] === i + 3),
    JSON.stringify(catalog));

  const figures = await page.locator('[data-polygon-figure]').evaluateAll((nodes) => (
    nodes.map((node) => ({
      name: node.getAttribute('data-polygon-figure'),
      sides: Number(node.getAttribute('data-sides')),
      corners: (node.querySelector('polygon')?.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).length,
    }))
  ));
  check(`${label}: heptagon has 7 corners and octagon has 8`,
    figures.some((fig) => fig.name === 'heptagon' && fig.sides === 7 && fig.corners === 7)
    && figures.some((fig) => fig.name === 'octagon' && fig.sides === 8 && fig.corners === 8),
    JSON.stringify(figures));

  await page.evaluate(() => window.__SET_PRESET__('octagon'));
  await page.waitForFunction(() => (
    document.querySelector('[data-polygon-preset]')?.value === 'octagon'
  ), null, { timeout: 4000 });
  check(`${label}: choosing octagon updates the select`,
    await page.locator('[data-polygon-preset]').inputValue() === 'octagon');

  const shot = join(shotDir, `polygon-sides-${label}.png`);
  await page.screenshot({ path: shot });
  console.log(`  shot ${shot}`);
  check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
  await page.close();
}

try {
  await runSize('390', 390, 844);
  await runSize('1280', 1280, 800);
} catch (err) {
  failed += 1;
  console.log(`  ❌ run — ${err?.stack || err}`);
} finally {
  await browser.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`polygon sides: ${failed} failed`);
  process.exit(1);
}
console.log('polygon sides: ok');
