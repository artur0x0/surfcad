#!/usr/bin/env node
/* global window, document */
/**
 * Feature-edit Delete.
 *
 * At 390px and desktop: a feature another block uses asks
 * "Delete along with N features", then removes those blocks as one undo
 * step. A feature with no feature dependents deletes immediately. Either
 * path shows a Deleted toast with Undo. Toast Undo restores the script.
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
renderFeatureEditDeleteShot(document.getElementById('root'), { compact: ${compact ? 'true' : 'false'} });
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
    throw err;
  }
  const meshError = await page.evaluate(() => window.__MESH_ERROR__ || '');
  if (meshError) throw new Error(`${label} mesh: ${meshError}`);
  const original = await page.evaluate(() => ({
    script: window.__SCRIPT__,
    sig: window.__ORIGINAL_SIG__,
    head: window.__HISTORY_HEAD__,
  }));
  check(`${label}: model is up`, !!original.sig, original.sig);

  const opened = await page.evaluate(() => window.__OPEN_EDIT__('cylinder'));
  check(`${label}: cylinder edit opened`, opened === true);
  await page.locator('[data-feature-edit-delete]').waitFor({ timeout: 15000 });
  const deleteBox = await page.locator('[data-feature-edit-delete]').boundingBox();
  const confirmBox = await page.getByRole('button', { name: 'Confirm', exact: true }).boundingBox();
  check(`${label}: Delete is left of Confirm`, !!deleteBox && !!confirmBox && deleteBox.x + deleteBox.width <= confirmBox.x + 2,
    `delete=${JSON.stringify(deleteBox)} confirm=${JSON.stringify(confirmBox)}`);
  const dialogShot = join(shotDir, `feature-edit-delete-dialog-${label}.png`);
  await page.screenshot({ path: dialogShot });
  console.log(`  shot ${dialogShot}`);

  const headBefore = await page.evaluate(() => window.__HISTORY_HEAD__);
  await page.locator('[data-feature-edit-delete]').click();
  const confirmDialog = page.locator('[data-feature-edit-delete-dialog]');
  await confirmDialog.waitFor({ timeout: 10000 });
  const confirmLabel = (await page.locator('[data-feature-edit-delete-confirm]').innerText()).trim();
  check(`${label}: cylinder confirm reads Delete along with 1 feature`,
    confirmLabel === 'Delete along with 1 feature', confirmLabel);
  await page.locator('[data-feature-edit-delete-confirm]').click();
  const toast = page.locator('[data-feature-edit-delete-toast]');
  await toast.waitFor({ timeout: 10000 });
  const toastText = (await toast.innerText()).replace(/\s+/g, ' ');
  check(`${label}: toast says Deleted`, /Deleted\./.test(toastText), toastText);
  check(`${label}: toast is not a refuse`, !/refusing/.test(toastText), toastText);
  await page.locator('[data-feature-edit-delete-toast] [data-error-undo]').waitFor({ timeout: 5000 });

  await page.waitForFunction(() => !document.querySelector('#helper-param-title'), null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const script = window.__SCRIPT__ || '';
    return script.includes('cube begin')
      && !script.includes('cylinder begin')
      && !script.includes('fillet-mode begin')
      && script.includes('// header comment')
      && script.includes('// kept between')
      && window.__MESH_SIG__?.()
      && window.__MESH_SIG__() !== window.__ORIGINAL_SIG__;
  }, null, { timeout: 30000 });
  const after = await page.evaluate(() => ({
    script: window.__SCRIPT__,
    sig: window.__MESH_SIG__(),
    head: window.__HISTORY_HEAD__,
    err: window.__DELETE_ERROR__ || '',
    confirm: !!document.querySelector('[data-feature-edit-delete-dialog]'),
    helper: !!document.querySelector('#helper-param-title'),
    toast: !!document.querySelector('[data-feature-edit-delete-toast]'),
    executionError: !!document.querySelector('[data-execution-error]'),
  }));
  check(`${label}: cylinder and fillet are gone`, !after.script.includes('cylinder begin') && !after.script.includes('fillet-mode begin') && after.script.includes('cube begin'));
  check(`${label}: comments stay`, after.script.includes('// kept between') && after.script.includes('// header comment'));
  check(`${label}: model rebuilt`, after.sig && after.sig !== original.sig, `was ${original.sig} now ${after.sig}`);
  check(`${label}: one undo step`, after.head === headBefore + 1, `head ${headBefore} -> ${after.head}`);
  check(`${label}: edit dialog is gone and toast stays`, !after.confirm && !after.helper && after.toast, after.err);
  check(`${label}: delete did not raise the error popup`, !after.executionError, after.err);
  const toastShot = join(shotDir, `feature-edit-delete-toast-${label}.png`);
  await page.screenshot({ path: toastShot });
  console.log(`  shot ${toastShot}`);

  await page.locator('[data-feature-edit-delete-toast] [data-error-undo]').click();
  await page.waitForFunction((expected) => window.__SCRIPT__ === expected && window.__MESH_SIG__?.() === window.__ORIGINAL_SIG__,
    original.script,
    { timeout: 30000 });
  const restored = await page.evaluate(() => ({
    script: window.__SCRIPT__,
    sig: window.__MESH_SIG__(),
    head: window.__HISTORY_HEAD__,
    toast: !!document.querySelector('[data-feature-edit-delete-toast]'),
  }));
  check(`${label}: toast Undo restores the identical script`, restored.script === original.script);
  check(`${label}: toast Undo restores the model`, restored.sig === original.sig, `sig ${restored.sig}`);
  check(`${label}: toast Undo steps back once`, restored.head === headBefore, `head ${restored.head}`);
  check(`${label}: toast closes after Undo`, !restored.toast);

  const openedFillet = await page.evaluate(() => window.__OPEN_EDIT__('fillet'));
  check(`${label}: fillet edit opened`, openedFillet === true);
  await page.locator('[data-feature-edit-delete]').waitFor({ timeout: 15000 });
  await page.locator('[data-feature-edit-delete]').click();
  await page.waitForFunction(() => {
    const script = window.__SCRIPT__ || '';
    return script.includes('cube begin')
      && script.includes('cylinder begin')
      && !script.includes('fillet-mode begin')
      && window.__MESH_SIG__?.()
      && window.__MESH_SIG__() !== window.__ORIGINAL_SIG__;
  }, null, { timeout: 30000 });
  const quiet = await page.evaluate(() => ({
    confirm: !!document.querySelector('[data-feature-edit-delete-dialog]'),
    toast: document.querySelector('[data-feature-edit-delete-toast]')?.innerText || '',
    executionError: !!document.querySelector('[data-execution-error]'),
  }));
  check(`${label}: no confirm when nothing depends on the feature`, !quiet.confirm && !quiet.executionError);
  check(`${label}: immediate delete still shows Deleted`, /Deleted\./.test(quiet.toast) && !/refusing/.test(quiet.toast), quiet.toast);

  await page.locator('[data-feature-bar-undo]').click();
  await page.waitForFunction(
    (expected) => window.__SCRIPT__ === expected && window.__MESH_SIG__?.() === window.__ORIGINAL_SIG__,
    original.script,
    { timeout: 30000 },
  );

  if (label === '390') {
    const openedCube = await page.evaluate(() => window.__OPEN_EDIT__('cube'));
    check('390: cube edit opened', openedCube === true);
    await page.locator('[data-feature-edit-delete]').waitFor({ timeout: 15000 });
    await page.locator('[data-feature-edit-delete]').click();
    await page.locator('[data-feature-edit-delete-dialog]').waitFor({ timeout: 10000 });
    const cubeLabel = (await page.locator('[data-feature-edit-delete-confirm]').innerText()).trim();
    check('390: cube confirm reads Delete along with 1 feature', cubeLabel === 'Delete along with 1 feature', cubeLabel);
    await page.locator('[data-feature-edit-delete-confirm]').click();
    await page.locator('[data-execution-error]').waitFor({ timeout: 20000 });
    await page.locator('[data-execution-error] [data-error-undo]').waitFor({ timeout: 5000 });
    const broken = await page.evaluate(() => ({
      script: window.__SCRIPT__ || '',
      confirm: !!document.querySelector('[data-feature-edit-delete-dialog]'),
      helper: !!document.querySelector('#helper-param-title'),
      popup: !!document.querySelector('[data-execution-error]'),
      undo: !!document.querySelector('[data-execution-error] [data-error-undo]'),
      toast: !!document.querySelector('[data-feature-edit-delete-toast]'),
    }));
    check('390: failed rerun removes the cube and the fillet that used it',
      !broken.script.includes('cube begin')
      && broken.script.includes('cylinder begin')
      && !broken.script.includes('fillet-mode begin')
      && broken.script.includes('// kept between'));
    check('390: error popup has Undo', broken.popup && broken.undo);
    check('390: no stuck dialog after a failed delete', !broken.confirm && !broken.helper && !broken.toast);
    await page.locator('[data-execution-error] [data-error-undo]').click();
    await page.waitForFunction((expected) => window.__SCRIPT__ === expected, original.script, { timeout: 30000 });
    check('390: error Undo restores the script', (await page.evaluate(() => window.__SCRIPT__)) === original.script);
  }

  if (errors.length) console.log(`  ${label} page errors`, errors.slice(0, 4).join('\n'));
  await page.close();
}

try {
  await runSize('390', true, 390, 780);
  await runSize('desktop', false, 1100, 760);
} finally {
  await browser.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nFeature-edit delete checks passed.');
