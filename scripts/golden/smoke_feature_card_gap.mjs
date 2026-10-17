#!/usr/bin/env node
/* global window */
/**
 * Shared feature-card gap at 390 and 1280.
 *
 * Fillet's Tangent / Clear / Undo row and Delete Face's Undo / Clear row
 * both sit above Delete and Confirm. The gap is the shared footer padding,
 * the same on both cards.
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
<style>html, body, #root { margin: 0; height: 100%; background: #1e1e1e; }</style>
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
import { renderFeatureCardGapShot } from '/scripts/golden/feature_card_gap_shot.js';
renderFeatureCardGapShot(document.getElementById('root'));
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

async function showCard(page, name, phone) {
  await page.evaluate(({ name: next, phone: compact }) => {
    window.__SHOW_CARD__(next, compact);
  }, { name, phone });
  await page.waitForFunction((next) => {
    const card = window.document.querySelector('[data-feature-card]');
    const confirm = window.document.querySelector('[data-feature-card-confirm]');
    return card
      && card.style.width.endsWith('px')
      && confirm
      && window.document.querySelector('[data-feature-card-gap-shot]')?.getAttribute('data-feature-card-gap-shot') === next;
  }, name, { timeout: 5000 });
  await page.evaluate(() => new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  }));
}

function readGap() {
  const card = window.document.querySelector('[data-feature-card]');
  const body = card?.querySelector('[data-feature-sheet-body]');
  const footer = card?.querySelector('[data-feature-sheet-footer]');
  const links = body?.lastElementChild;
  const actions = window.document.querySelector('[data-feature-card-confirm]')?.parentElement;
  const box = (node) => {
    const rect = node?.getBoundingClientRect();
    return rect ? { top: rect.top, bottom: rect.bottom, height: rect.height } : null;
  };
  const linkBox = box(links);
  const actionBox = box(actions);
  const root = parseFloat(window.getComputedStyle(window.document.documentElement).fontSize) || 16;
  const footerPad = footer ? parseFloat(window.getComputedStyle(footer).paddingTop) || 0 : 0;
  const bodyPad = body ? parseFloat(window.getComputedStyle(body).paddingBottom) || 0 : 0;
  return {
    links: (links?.innerText || '').replace(/\s+/g, ' ').trim(),
    gap: linkBox && actionBox ? actionBox.top - linkBox.bottom : -1,
    footerPad,
    bodyPad,
    rem: root,
    deleteBtn: !!card?.querySelector('[data-feature-edit-delete]'),
    confirm: (window.document.querySelector('[data-feature-card-confirm]')?.textContent || '').replace(/\s+/g, ' ').trim(),
  };
}

async function runSize(label, width, height, phone) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30000 });

  const gaps = {};
  for (const name of ['fillet', 'delete-face']) {
    await showCard(page, name, phone);
    const metrics = await page.evaluate(readGap);
    gaps[name] = metrics;
    const expected = metrics.rem + metrics.bodyPad;
    check(`${label} ${name}: link row clears Delete and Confirm by the shared footer gap`,
      metrics.deleteBtn
        && metrics.confirm.includes('Confirm')
        && Math.abs(metrics.footerPad - metrics.rem) < 0.5
        && Math.abs(metrics.gap - expected) < 1.5
        && metrics.gap >= 16,
      JSON.stringify(metrics));
    const shot = join(shotDir, `feature-card-gap-${name}-${label}.png`);
    await page.locator('[data-feature-card]').screenshot({ path: shot });
    console.log(`  shot ${shot}`);
  }

  check(`${label}: Fillet link row is Tangent on, Clear, and Undo`,
    gaps.fillet.links === 'Tangent on Clear Undo',
    gaps.fillet.links);
  check(`${label}: Delete Face link row is Undo and Clear`,
    gaps['delete-face'].links === 'Undo Clear',
    gaps['delete-face'].links);
  check(`${label}: both cards share the same gap`,
    Math.abs(gaps.fillet.gap - gaps['delete-face'].gap) < 1
      && Math.abs(gaps.fillet.footerPad - gaps['delete-face'].footerPad) < 0.5,
    JSON.stringify(gaps));

  if (errors.length) console.log(`  ${label} page errors`, errors.slice(0, 6).join('\n'));
  check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 4).join(' | '));
  await page.close();
}

try {
  await runSize('390', 390, 780, true);
  await runSize('1280', 1280, 900, false);
} finally {
  await browser.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nFeature-card gap checks passed.');
