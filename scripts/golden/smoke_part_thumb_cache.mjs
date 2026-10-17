#!/usr/bin/env node
/* global window */
/**
 * Hidden parts that have never been displayed still get thumbnails.
 * A reload paints them from the IndexedDB cache and does not run again.
 * 390px and 1280px.
 *
 * Shots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createServer as createVite } from 'vite';

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
import { renderPartThumbCacheShot } from '/scripts/golden/part_thumb_cache_shot.js';
renderPartThumbCacheShot(document.getElementById('root'));
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
attachConsentPresetToBrowser(browser);

function solid(row) {
  return !!row && row.preview === 'manifold' && row.bright > 40;
}

async function runSize(label, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const state = window.__thumbState?.();
    const ok = (row) => !!row && row.preview === 'manifold' && row.bright > 40;
    return state && ok(state.sheet) && ok(state.loft) && ok(state.bracket);
  }, null, { timeout: 90000 });
  const built = await page.evaluate(() => window.__thumbState());
  check(`${label}: hidden parts that were never displayed have thumbnails`,
    solid(built.sheet) && solid(built.loft),
    JSON.stringify(built));
  check(`${label}: the visible part has a thumbnail too`, solid(built.bracket), JSON.stringify(built.bracket));
  check(`${label}: only the visible part is in the viewport`,
    built.solids.length === 1 && built.solids[0] === 'bracket',
    (built.solids || []).join(','));
  check(`${label}: hidden parts were built off the CAD view`,
    built.exec === 2,
    `exec ${built.exec}`);
  const shot = join(shotDir, `part-thumb-cache-${label}.png`);
  await page.screenshot({ path: shot });
  console.log(`  shot ${shot}`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const state = window.__thumbState?.();
    const ok = (row) => !!row && row.preview === 'manifold' && row.bright > 40;
    return state
      && state.exec === 0
      && state.sheet?.source === 'cache'
      && state.loft?.source === 'cache'
      && ok(state.sheet)
      && ok(state.loft);
  }, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  const cached = await page.evaluate(() => window.__thumbState());
  check(`${label}: reload paints hidden thumbnails from the cache`,
    cached.sheet?.source === 'cache'
    && cached.loft?.source === 'cache'
    && solid(cached.sheet)
    && solid(cached.loft),
    JSON.stringify(cached));
  check(`${label}: reload does not run the scripts again`, cached.exec === 0, `exec ${cached.exec}`);
  check(`${label}: reload still keeps hidden parts out of the viewport`,
    cached.solids.length === 1 && cached.solids[0] === 'bracket',
    (cached.solids || []).join(','));
  const reloadShot = join(shotDir, `part-thumb-cache-reload-${label}.png`);
  await page.screenshot({ path: reloadShot });
  console.log(`  shot ${reloadShot}`);

  await page.evaluate(() => window.__forgetPartThumb('loft'));
  await page.waitForFunction(() => {
    const state = window.__thumbState?.();
    const ok = (row) => !!row && row.preview === 'manifold' && row.bright > 40;
    return state
      && state.loft?.preview === 'empty'
      && state.loft.bright < 5
      && ok(state.sheet);
  }, null, { timeout: 10000 });
  const dropped = await page.evaluate(async () => ({
    state: window.__thumbState(),
    loft: await window.__thumbUrl('loft'),
    sheet: await window.__thumbUrl('sheet'),
  }));
  check(`${label}: deleting a part drops its thumbnail and keeps the other`,
    dropped.state.loft?.preview === 'empty'
    && dropped.loft == null
    && typeof dropped.sheet === 'string'
    && solid(dropped.state.sheet),
    JSON.stringify({ preview: dropped.state.loft, sheet: typeof dropped.sheet, loft: dropped.loft }));

  if (errors.length) {
    check(`${label}: no page errors`, false, errors.slice(0, 4).join('\n'));
  }
  await page.close();
}

try {
  await runSize('390', 390, 844);
  await runSize('1280', 1280, 800);
} finally {
  await browser.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nPart thumbnail cache checks passed.');
