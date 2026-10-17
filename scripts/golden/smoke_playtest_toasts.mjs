#!/usr/bin/env node
/* global window */
/**
 * Artur playtest toasts at 390 and 1280.
 *
 * The remote-ahead toast has Get latest and Keep mine. Get latest opens the
 * shared Parts conflict dialog. Keep mine runs that dialog's keep handler
 * and dismisses the toast. The delete Undo toast stays one line, at 2×
 * its previous height, with the same gap between Undo and X.
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
import { renderPlaytestToastShot } from '/scripts/golden/playtest_toast_shot.js';
renderPlaytestToastShot(document.getElementById('root'));
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

function sameChoice(a, b) {
  return !!a && !!b && a.action === b.action && a.path === b.path && a.kind === b.kind;
}

async function runSize(label, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30000 });
  const toast = page.locator('[data-git-behind-toast]');
  await toast.waitFor({ timeout: 10000 });
  const buttons = await page.evaluate(() => {
    const root = window.document.querySelector('[data-git-behind-toast]');
    const labels = [...root.querySelectorAll('button')].map((node) => (node.textContent || '').trim());
    return {
      labels,
      parts: !!root.querySelector('[data-git-behind-toast-parts]'),
      msg: (root.querySelector('[data-git-behind-toast-msg]')?.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  });
  check(`${label}: toast has Get latest and Keep mine`,
    buttons.labels.includes('Get latest') && buttons.labels.includes('Keep mine') && !buttons.parts,
    JSON.stringify(buttons));
  check(`${label}: toast names one new commit`, /1 new commit/.test(buttons.msg), buttons.msg);
  const toastShot = join(shotDir, `playtest-behind-toast-${label}.png`);
  await page.screenshot({ path: toastShot });
  console.log(`  shot ${toastShot}`);

  check(`${label}: dialog is closed before Get latest`,
    await page.locator('[data-git-behind-ask]').count() === 0);
  await page.locator('[data-git-behind-toast-get]').click();
  const ask = page.locator('[data-git-dialog="behind"] [data-git-behind-ask]');
  await ask.waitFor({ timeout: 10000 });
  const opened = await page.evaluate(() => {
    const node = window.document.querySelector('[data-git-behind-ask]');
    const target = window.__TOAST_TARGET__;
    return {
      count: window.document.querySelectorAll('[data-git-behind-ask]').length,
      path: node?.getAttribute('data-git-behind-path') || '',
      kind: node?.getAttribute('data-git-behind-kind') || '',
      reload: !!window.document.querySelector('[data-git-dialog="behind"] [data-git-behind-reload]'),
      keep: !!window.document.querySelector('[data-git-dialog="behind"] [data-git-behind-keep]'),
      branch: !!window.document.querySelector('[data-git-dialog="behind"] [data-git-behind-branch]'),
      target,
    };
  });
  check(`${label}: Get latest opens the shared dialog once`,
    opened.count === 1 && opened.reload && opened.keep && opened.branch
      && opened.path === opened.target?.path && opened.kind === opened.target?.kind,
    JSON.stringify(opened));
  const popupShot = join(shotDir, `playtest-behind-popup-${label}.png`);
  await page.screenshot({ path: popupShot });
  console.log(`  shot ${popupShot}`);

  await page.locator('[data-git-dialog="behind"] [data-git-dialog-cancel]').click();
  await page.waitForFunction(() => !window.document.querySelector('[data-git-behind-ask]'), null, { timeout: 5000 });
  check(`${label}: cancel leaves the toast up`, await toast.count() === 1);

  await page.evaluate(() => {
    window.__BEHIND_CALLS__ = [];
    window.document.querySelector('button[data-part-behind]')?.click();
  });
  await ask.waitFor({ timeout: 10000 });
  const fromMarker = await page.evaluate(() => {
    const node = window.document.querySelector('[data-git-behind-ask]');
    return {
      path: node?.getAttribute('data-git-behind-path') || '',
      kind: node?.getAttribute('data-git-behind-kind') || '',
    };
  });
  check(`${label}: the Parts marker opens that same path`,
    fromMarker.path === opened.path && fromMarker.kind === opened.kind,
    JSON.stringify(fromMarker));
  await page.locator('[data-git-dialog="behind"] [data-git-dialog-cancel]').click();
  await page.waitForFunction(() => !window.document.querySelector('[data-git-behind-ask]'), null, { timeout: 5000 });

  await page.locator('[data-git-behind-toast-keep]').click();
  await page.waitForFunction(() => !window.document.querySelector('[data-git-behind-toast]'), null, { timeout: 5000 });
  const kept = await page.evaluate(() => window.__KEEP_DONE__);
  const afterKeep = await page.evaluate(() => ({
    toast: !!window.document.querySelector('[data-git-behind-toast]'),
    ask: !!window.document.querySelector('[data-git-behind-ask]'),
    calls: window.__BEHIND_CALLS__ || [],
  }));
  check(`${label}: Keep mine dismisses the toast without the dialog`,
    kept?.status === 'kept' && !afterKeep.toast && !afterKeep.ask && afterKeep.calls.length === 1
      && afterKeep.calls[0].action === 'keep'
      && afterKeep.calls[0].path === opened.path
      && afterKeep.calls[0].kind === opened.kind,
    JSON.stringify({ kept, afterKeep }));

  await page.evaluate(() => window.document.querySelector('button[data-part-behind]')?.click());
  await ask.waitFor({ timeout: 10000 });
  await page.locator('[data-git-dialog="behind"] [data-git-behind-keep]').click();
  await page.waitForFunction(() => (window.__BEHIND_CALLS__ || []).length >= 2, null, { timeout: 5000 });
  const both = await page.evaluate(() => window.__BEHIND_CALLS__ || []);
  check(`${label}: toast Keep mine matches the dialog Keep mine`,
    sameChoice(both[0], both[1]) && both[1].action === 'keep',
    JSON.stringify(both));

  await page.evaluate(() => window.__SHOW_DELETE__());
  const undoToast = page.locator('[data-delete-undo-toast]');
  await undoToast.waitFor({ timeout: 5000 });
  await page.waitForFunction(() => {
    const popup = window.document.querySelector('[data-delete-undo-toast] [data-error-popup]');
    return popup && parseFloat(popup.style.minHeight) > 0;
  }, null, { timeout: 5000 });
  const metrics = await page.evaluate(() => {
    const root = window.document.querySelector('[data-delete-undo-toast]');
    const popup = root?.querySelector('[data-error-popup]');
    const row = popup?.querySelector('[data-error-popup-row]');
    const text = root?.querySelector('[data-feature-edit-dependent]');
    const actions = popup?.querySelector('[data-error-actions]');
    const undo = root?.querySelector('[data-error-undo]');
    const dismiss = root?.querySelector('[data-error-dismiss]');
    const box = (node) => {
      const rect = node?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null;
    };
    const cs = popup ? window.getComputedStyle(popup) : null;
    const chrome = cs
      ? (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
        + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
      : 0;
    const popupBox = box(popup);
    const rowBox = box(row);
    const textBox = box(text);
    const undoBox = box(undo);
    const dismissBox = box(dismiss);
    const base = (rowBox?.h || 0) + chrome;
    const textCs = text ? window.getComputedStyle(text) : null;
    return {
      text: (text?.textContent || '').replace(/\s+/g, ' ').trim(),
      popupH: popupBox?.h || 0,
      rowH: rowBox?.h || 0,
      textH: textBox?.h || 0,
      lineH: parseFloat(textCs?.lineHeight) || 0,
      lines: text?.getClientRects().length || 0,
      nowrap: window.getComputedStyle(popup?.querySelector('[data-error-popup-text]') || text).whiteSpace,
      base,
      ratio: base > 0 ? (popupBox?.h || 0) / base : 0,
      gap: parseFloat(window.getComputedStyle(actions).columnGap) || 0,
      boxGap: undoBox && dismissBox ? dismissBox.x - (undoBox.x + undoBox.w) : 0,
      undoW: undoBox?.w || 0,
      dismissW: dismissBox?.w || 0,
      roomy: popup?.getAttribute('data-error-roomy') != null,
    };
  });
  check(`${label}: Deleted toast is one line`,
    metrics.text === 'Deleted.' && metrics.lines === 1 && metrics.nowrap === 'nowrap'
      && metrics.textH > 0 && metrics.lineH > 0 && metrics.textH <= metrics.lineH + 1,
    JSON.stringify(metrics));
  check(`${label}: Deleted toast is 2× the previous card height`,
    metrics.roomy && Math.abs(metrics.ratio - 2) < 0.05 && metrics.popupH > metrics.rowH,
    JSON.stringify(metrics));
  check(`${label}: Undo and X stay 44px with the same gap`,
    metrics.undoW >= 44 && metrics.dismissW >= 44
      && Math.abs(metrics.gap - 16) < 0.5
      && Math.abs(metrics.boxGap - 16) < 1,
    JSON.stringify(metrics));
  const undoShot = join(shotDir, `playtest-undo-toast-${label}.png`);
  await page.screenshot({ path: undoShot });
  console.log(`  shot ${undoShot}`);

  if (errors.length) console.log(`  ${label} page errors`, errors.slice(0, 6).join('\n'));
  check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 4).join(' | '));
  await page.close();
}

try {
  await runSize('390', 390, 780);
  await runSize('1280', 1280, 900);
} finally {
  await browser.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nPlaytest toast checks passed.');
