#!/usr/bin/env node
/* global window, document */
/**
 * Hiding a part in the parts list drops it from the viewport and leaves
 * its preview thumbnail up. The active part and another part, at 390px
 * and 1280px.
 *
 * Shots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
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
import { renderPartHideThumbnailShot } from '/scripts/golden/part_hide_thumbnail_shot.js';
renderPartHideThumbnailShot(document.getElementById('root'));
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

function preview(id) {
  return `[data-part-row="${id}"] [data-part-preview]`;
}

async function runSize(label, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  await page.locator(preview('box')).waitFor({ timeout: 15000 });
  await page.locator(preview('wide')).waitFor({ timeout: 15000 });
  const before = await page.evaluate(() => ({
    box: document.querySelector('[data-part-row="box"] [data-part-preview]')?.getAttribute('data-part-preview'),
    wide: document.querySelector('[data-part-row="wide"] [data-part-preview]')?.getAttribute('data-part-preview'),
    solids: window.__SOLIDS__ || [],
  }));
  check(`${label}: both thumbnails start as solids`, before.box === 'manifold' && before.wide === 'manifold', JSON.stringify(before));
  check(`${label}: both parts start in the viewport`, before.solids.includes('box') && before.solids.includes('wide'), before.solids.join(','));

  await page.locator('[data-part-visibility="wide"]').click();
  await page.waitForFunction(() => {
    const wide = document.querySelector('[data-part-row="wide"] [data-part-preview]')?.getAttribute('data-part-preview');
    const solids = window.__SOLIDS__ || [];
    return wide === 'manifold' && !solids.includes('wide') && solids.includes('box');
  }, null, { timeout: 10000 });
  const hidWide = await page.evaluate(() => ({
    preview: document.querySelector('[data-part-row="wide"] [data-part-preview]')?.getAttribute('data-part-preview'),
    pressed: document.querySelector('[data-part-visibility="wide"]')?.getAttribute('aria-pressed'),
    solids: window.__SOLIDS__ || [],
  }));
  check(`${label}: hiding another part keeps its thumbnail`, hidWide.preview === 'manifold', hidWide.preview);
  check(`${label}: hiding another part drops only that solid`, !hidWide.solids.includes('wide') && hidWide.solids.includes('box'), hidWide.solids.join(','));
  check(`${label}: the eye is off`, hidWide.pressed === 'false', hidWide.pressed);

  await page.locator('[data-part-visibility="box"]').click();
  await page.waitForFunction(() => {
    const box = document.querySelector('[data-part-row="box"] [data-part-preview]')?.getAttribute('data-part-preview');
    const solids = window.__SOLIDS__ || [];
    return box === 'manifold' && solids.length === 0;
  }, null, { timeout: 10000 });
  const hidBox = await page.evaluate(() => ({
    box: document.querySelector('[data-part-row="box"] [data-part-preview]')?.getAttribute('data-part-preview'),
    wide: document.querySelector('[data-part-row="wide"] [data-part-preview]')?.getAttribute('data-part-preview'),
    solids: window.__SOLIDS__ || [],
  }));
  check(`${label}: hiding the active part keeps its thumbnail`, hidBox.box === 'manifold' && hidBox.wide === 'manifold', JSON.stringify(hidBox));
  check(`${label}: the viewport is empty while both are hidden`, hidBox.solids.length === 0, hidBox.solids.join(','));
  const shot = join(shotDir, `part-hide-thumbnail-${label}.png`);
  await page.screenshot({ path: shot });
  console.log(`  shot ${shot}`);

  await page.locator('[data-part-visibility="wide"]').click();
  await page.waitForFunction(() => (window.__SOLIDS__ || []).includes('wide'), null, { timeout: 10000 });
  const shown = await page.evaluate(() => ({
    wide: document.querySelector('[data-part-row="wide"] [data-part-preview]')?.getAttribute('data-part-preview'),
    solids: window.__SOLIDS__ || [],
  }));
  check(`${label}: showing the part puts it back in the viewport`, shown.wide === 'manifold' && shown.solids.includes('wide') && !shown.solids.includes('box'), shown.solids.join(','));

  if (errors.length) console.log(`  ${label} page errors`, errors.slice(0, 4).join('\n'));
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
console.log('\nPart-hide thumbnail checks passed.');
