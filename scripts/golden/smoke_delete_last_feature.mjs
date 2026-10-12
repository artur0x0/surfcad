#!/usr/bin/env node
/* global window, document */
/**
 * Deleting the only feature in a part must not leave `return part;`.
 * An empty part clears the viewport, so there is no error toast.
 * The Deleted toast is one undo step and restores the feature.
 *
 * At 390px and 1280px. Shots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
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
import { renderFeatureEditDeleteShot } from '/scripts/golden/feature_edit_delete_shot.js';
import { newPartStarterScript } from '/src/utils/helperPaletteSnippets.js';
renderFeatureEditDeleteShot(document.getElementById('root'), {
  compact: ${compact ? 'true' : 'false'},
  script: newPartStarterScript(),
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

async function runSize(label, compact, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  try {
    await page.waitForFunction(
      () => window.__MESH__ === true || typeof window.__MESH_ERROR__ === 'string',
      null,
      { timeout: 45000 },
    );
  } catch (err) {
    const state = await page.evaluate(() => ({
      ready: window.__READY__,
      mesh: window.__MESH__,
      error: window.__MESH_ERROR__,
    }));
    console.log(label, 'state', state);
    console.log(label, 'errors', errors.slice(0, 8));
    throw err;
  }
  const meshError = await page.evaluate(() => window.__MESH_ERROR__ || '');
  if (meshError) throw new Error(`${label} mesh: ${meshError}`);
  const original = await page.evaluate(() => ({
    script: window.__SCRIPT__,
    sig: window.__ORIGINAL_SIG__,
    head: window.__HISTORY_HEAD__,
  }));
  check(`${label}: the only feature is up`, !!original.sig && /cube begin/.test(original.script) && /return part;/.test(original.script));

  const opened = await page.evaluate(() => window.__OPEN_EDIT__('cube'));
  check(`${label}: cube edit opened`, opened === true);
  await page.locator('[data-feature-edit-delete]').waitFor({ timeout: 15000 });
  const headBefore = await page.evaluate(() => window.__HISTORY_HEAD__);
  await page.locator('[data-feature-edit-delete]').click();
  const toast = page.locator('[data-feature-edit-delete-toast]');
  await toast.waitFor({ timeout: 10000 });
  const toastText = (await toast.innerText()).replace(/\s+/g, ' ');
  check(`${label}: toast says Deleted`, /Deleted\./.test(toastText), toastText);
  check(`${label}: toast offers Undo`, /Undo/.test(toastText), toastText);
  await page.locator('[data-feature-edit-delete-toast] [data-error-undo]').waitFor({ timeout: 5000 });

  await page.waitForFunction(() => {
    const script = window.__SCRIPT__ ?? null;
    return script === ''
      && !document.querySelector('[data-execution-error]')
      && window.__MESH_SIG__?.() === '';
  }, null, { timeout: 20000 });
  const after = await page.evaluate(() => ({
    script: window.__SCRIPT__,
    sig: window.__MESH_SIG__(),
    head: window.__HISTORY_HEAD__,
    err: window.__DELETE_ERROR__ || '',
    confirm: !!document.querySelector('[data-feature-edit-delete-dialog]'),
    helper: !!document.querySelector('#helper-param-title'),
    toast: !!document.querySelector('[data-feature-edit-delete-toast]'),
    executionError: document.querySelector('[data-execution-error]')?.innerText || '',
  }));
  check(`${label}: no error toast`, !after.executionError, after.executionError);
  check(`${label}: script no longer references part`, after.script === '' && !/\bpart\b/.test(after.script));
  check(`${label}: viewport cleared`, after.sig === '');
  check(`${label}: one undo step`, after.head === headBefore + 1, `head ${headBefore} -> ${after.head}`);
  check(`${label}: Deleted toast stays and the dialog is gone`, after.toast && !after.confirm && !after.helper, after.err);
  const shot = join(shotDir, `delete-last-feature-${label}.png`);
  await page.screenshot({ path: shot });
  console.log(`  shot ${shot}`);

  await page.locator('[data-feature-edit-delete-toast] [data-error-undo]').click();
  await page.waitForFunction(
    (expected) => window.__SCRIPT__ === expected && window.__MESH_SIG__?.() === window.__ORIGINAL_SIG__,
    original.script,
    { timeout: 30000 },
  );
  const restored = await page.evaluate(() => ({
    script: window.__SCRIPT__,
    sig: window.__MESH_SIG__(),
    head: window.__HISTORY_HEAD__,
    toast: !!document.querySelector('[data-feature-edit-delete-toast]'),
    executionError: !!document.querySelector('[data-execution-error]'),
  }));
  check(`${label}: Undo restores the feature script`, restored.script === original.script);
  check(`${label}: Undo restores the model`, restored.sig === original.sig, `sig ${restored.sig}`);
  check(`${label}: Undo steps back once`, restored.head === headBefore, `head ${restored.head}`);
  check(`${label}: no error toast after Undo`, !restored.executionError && !restored.toast);

  if (errors.length) console.log(`  ${label} page errors`, errors.slice(0, 4).join('\n'));
  await page.close();
}

try {
  await runSize('390', true, 390, 844);
  await runSize('1280', false, 1280, 800);
} finally {
  await browser.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nDelete-last-feature checks passed.');
