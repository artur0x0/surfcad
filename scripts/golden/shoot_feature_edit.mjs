/* global window */
/**
 * Capture feature-edit shots. Writes only under GOLDEN_SHOT_DIR or os.tmpdir().
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
import { renderFeatureEditShot } from '/scripts/golden/feature_edit_shot.js';
renderFeatureEditShot(document.getElementById('root'), { compact: ${compact ? 'true' : 'false'} });
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

async function shoot(name, compact, width, height, edit) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    const line = `[${msg.type()}] ${msg.text()}`;
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(line);
    else if (line.includes('Viewport') || line.includes('Manifold') || line.includes('Error')) errors.push(line);
  });
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  try {
    await page.waitForFunction(() => window.__MESH__ === true || typeof window.__MESH_ERROR__ === 'string', null, { timeout: 45000 });
  } catch (err) {
    const state = await page.evaluate(() => ({
      ready: window.__READY__,
      mesh: window.__MESH__,
      error: window.__MESH_ERROR__,
      edit: typeof window.__EDIT__,
    }));
    console.log('state', state);
    console.log('page errors', errors);
    throw err;
  }
  const meshError = await page.evaluate(() => window.__MESH_ERROR__ || '');
  if (meshError) throw new Error(`${name} mesh: ${meshError}`);
  if (edit) {
    const opened = await page.evaluate(() => window.__EDIT__());
    if (!opened) throw new Error(`${name} edit did not open`);
    await page.locator('[data-edge-blend="fillet"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
  } else {
    await page.locator('[data-shot-feature-row]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
  }
  const file = join(shotDir, name);
  await page.screenshot({ path: file });
  console.log(`shot ${file} errors=${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 6).join('\n'));
  await page.close();
}

try {
  await shoot('feature-edit-before-dark-390.png', true, 390, 780, false);
  await shoot('feature-edit-fillet-dark-390.png', true, 390, 780, true);
  await shoot('feature-edit-fillet-dark-desktop.png', false, 1100, 760, true);
} finally {
  await browser.close();
  server.close();
  await vite.close();
}
