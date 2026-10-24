#!/usr/bin/env node
/* global window, document */
/**
 * Editing one part dots only that row. Saving it leaves the other parts'
 * real dirty state alone. 390px and 1280px.
 *
 * Shots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createServer as createVite } from 'vite';

const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
mkdirSync(shotDir, { recursive: true });
const artifactDir = join(shotDir, 'part-dirty');
mkdirSync(artifactDir, { recursive: true });

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
import { renderPartDirtyShot } from '/scripts/golden/part_dirty_shot.js';
renderPartDirtyShot(document.getElementById('root'));
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

async function flags(page) {
  return page.evaluate(() => {
    const ids = window.__IDS;
    const rowFor = (id) => [...document.querySelectorAll('[data-part-row]')]
      .find((el) => el.getAttribute('data-part-row') === id);
    const read = (id) => {
      const row = rowFor(id);
      const save = row?.querySelector('[data-part-save]');
      return {
        row: row?.getAttribute('data-part-dirty') || '',
        save: save?.getAttribute('data-part-dirty') || '',
        pending: !!row?.querySelector('[data-part-pending]'),
        dot: !!row?.querySelector('button [data-part-dirty]'),
      };
    };
    return {
      sheet: read(ids.sheet),
      loft: read(ids.loft),
      bracket: read(ids.bracket),
    };
  });
}

function onlyBracket(state) {
  return state.bracket.row === 'true'
    && state.bracket.dot
    && state.sheet.row === 'false'
    && !state.sheet.dot
    && state.loft.row === 'false'
    && !state.loft.dot
    && !state.bracket.pending
    && !state.sheet.pending
    && !state.loft.pending;
}

async function shot(page, label, name) {
  const file = join(shotDir, `part-dirty-${label}-${name}.png`);
  await page.screenshot({ path: file });
  copyFileSync(file, join(artifactDir, `part-dirty-${label}-${name}.png`));
  console.log(`  shot ${file}`);
}

async function runSize(label, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  const bootError = await page.evaluate(() => window.__READY_ERROR || '');
  check(`${label}: parts list booted`, !bootError, bootError);
  await page.locator('[data-part-row]').first().waitFor({ timeout: 15000 });

  const clean = await flags(page);
  check(`${label}: all three parts start clean`,
    clean.sheet.row === 'false' && clean.loft.row === 'false' && clean.bracket.row === 'false'
    && !clean.sheet.dot && !clean.loft.dot && !clean.bracket.dot,
    JSON.stringify(clean));

  await page.evaluate(() => window.__editPart(window.__IDS.bracket));
  await page.waitForFunction(() => {
    const id = window.__IDS.bracket;
    return [...document.querySelectorAll('[data-part-row]')]
      .find((el) => el.getAttribute('data-part-row') === id)
      ?.getAttribute('data-part-dirty') === 'true';
  }, null, { timeout: 5000 });
  const edited = await flags(page);
  check(`${label}: editing Bracket dots only Bracket`, onlyBracket(edited), JSON.stringify(edited));
  await shot(page, label, 'edited');

  await page.evaluate(() => window.__editPart(window.__IDS.loft));
  await page.waitForFunction(() => {
    const id = window.__IDS.loft;
    const row = [...document.querySelectorAll('[data-part-row]')]
      .find((el) => el.getAttribute('data-part-row') === id);
    return !!row?.querySelector('button [data-part-dirty]');
  }, null, { timeout: 5000 });
  const both = await flags(page);
  check(`${label}: LoftZilla's own edit dots LoftZilla and leaves Sheet clean`,
    both.loft.row === 'true' && both.loft.dot
    && both.bracket.row === 'true' && both.bracket.dot
    && both.sheet.row === 'false' && !both.sheet.dot,
    JSON.stringify(both));

  await page.evaluate(() => {
    window.__COMMIT_HOLD = new Promise((resolve) => { window.__RELEASE_COMMIT = resolve; });
  });
  const bracketId = await page.evaluate(() => window.__IDS.bracket);
  await page.locator(`[data-part-save="${bracketId}"]`).click();
  await page.waitForFunction(() => {
    const id = window.__IDS.bracket;
    const row = [...document.querySelectorAll('[data-part-row]')]
      .find((el) => el.getAttribute('data-part-row') === id);
    return !!row?.querySelector('[data-part-pending]');
  }, null, { timeout: 5000 });
  const saving = await flags(page);
  check(`${label}: Bracket's save spinner does not clear LoftZilla's dot`,
    saving.bracket.pending && !saving.bracket.dot
    && saving.loft.row === 'true' && saving.loft.dot
    && saving.sheet.row === 'false' && !saving.sheet.dot,
    JSON.stringify(saving));
  await shot(page, label, 'saving');

  await page.evaluate(() => {
    const release = window.__RELEASE_COMMIT;
    window.__COMMIT_HOLD = null;
    window.__RELEASE_COMMIT = null;
    if (release) release();
  });
  await page.waitForFunction(() => {
    const ids = window.__IDS;
    const rowFor = (id) => [...document.querySelectorAll('[data-part-row]')]
      .find((el) => el.getAttribute('data-part-row') === id);
    const bracket = rowFor(ids.bracket);
    const loft = rowFor(ids.loft);
    return bracket?.getAttribute('data-part-dirty') === 'false'
      && !bracket.querySelector('[data-part-pending]')
      && loft?.getAttribute('data-part-dirty') === 'true';
  }, null, { timeout: 5000 });
  const after = await flags(page);
  check(`${label}: saving Bracket clears only Bracket`,
    after.bracket.row === 'false' && !after.bracket.dot && !after.bracket.pending
    && after.loft.row === 'true' && after.loft.dot
    && after.sheet.row === 'false' && !after.sheet.dot,
    JSON.stringify(after));
  await shot(page, label, 'saved');

  const files = await page.evaluate(async () => {
    const ids = window.__IDS;
    return {
      sheet: await window.__readPart(ids.sheet),
      loft: await window.__readPart(ids.loft),
      bracket: await window.__readPart(ids.bracket),
      originalLoft: window.__ORIGINAL[ids.loft],
      originalSheet: window.__ORIGINAL[ids.sheet],
    };
  });
  check(`${label}: Bracket's file is the edit that was saved`, files.bracket.includes('// edited'), files.bracket);
  check(`${label}: LoftZilla's file is still the old baseline`, files.loft === files.originalLoft, files.loft);
  check(`${label}: Sheet Metallica's file is untouched`, files.sheet === files.originalSheet, files.sheet);

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
console.log('\nPart dirty checks passed.');
