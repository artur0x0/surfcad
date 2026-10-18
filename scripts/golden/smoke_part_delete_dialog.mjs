#!/usr/bin/env node
/* global window */
/**
 * Delete-part dialog at 390 and 1280.
 *
 * The two delete buttons have 12–16px between them. Delete from assembly
 * drops immediately. Delete from assembly & repo names the vault file and
 * waits for Cancel or Delete.
 *
 * Shots go to GOLDEN_SHOT_DIR or os.tmpdir(). Never /opt/cursor/artifacts.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createServer as createVite } from 'vite';
import { partRepoDeleteConfirmCopy } from '../../src/utils/assembly.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const COPY = partRepoDeleteConfirmCopy('assemblies/Widget/FilletKilla.js');

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

console.log('part delete dialog — source');
{
  const feed = read('src/components/PartFeed.jsx');
  const asm = read('src/utils/assembly.js');
  const map = read('docs/ui-map.md');
  const arch = read('docs/architecture.md');
  const pkg = read('package.json');
  const eslint = read('eslint.config.js');
  const actionsAt = feed.indexOf('gap-[14px]');
  const choose = feed.slice(actionsAt, feed.indexOf('Delete from assembly & repo', actionsAt));

  ok('the two delete buttons are stacked 14px apart',
    /data-part-delete-actions/.test(feed)
    && /gap-\[14px\]/.test(choose)
    && choose.indexOf('data-part-delete-confirm=') < choose.indexOf('data-part-delete-confirm-repo')
    && !/sm:flex-row/.test(choose));
  ok('assembly delete still drops on the first tap',
    /partDeleteChoice\(pending\.step, choice\)/.test(feed)
    && /next\.step === 'confirm-repo'/.test(feed)
    && /onDeletePart\?\.\(pending\.id, \{ fromRepo: next\.action === 'drop-repo' \}\)/.test(feed));
  ok('the second confirm names the vault file',
    /partRepoDeleteConfirmCopy\(pendingDelete\.id\)/.test(feed)
    && /data-part-delete-repo-message/.test(feed)
    && /data-part-delete-repo-commit/.test(feed)
    && /This can't be undone from SurfCAD\./.test(asm));
  ok('docs and the golden script record the exception',
    /golden:part-delete-dialog/.test(map)
    && /golden:part-delete-dialog/.test(arch)
    && /can't be undone from SurfCAD/.test(map)
    && /can't be undone from SurfCAD/.test(arch)
    && /14px/.test(map)
    && /partRepoDeleteConfirmCopy/.test(arch)
    && /"golden:part-delete-dialog": "node scripts\/golden\/smoke_part_delete_dialog\.mjs"/.test(pkg)
    && /scripts\/golden\/part_delete_dialog_shot\.js/.test(eslint));
}

if (failed) {
  console.log(`\n❌ FAIL (${failed} failed, ${passed} passed)`);
  process.exit(1);
}

const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
mkdirSync(shotDir, { recursive: true });
ok('shots stay out of /opt/cursor/artifacts', !shotDir.includes('/opt/cursor/artifacts'), shotDir);

const html = `<!doctype html><meta charset="utf-8">
<style>html, body, #root { margin: 0; height: 100%; background: #111827; }</style>
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
import '/scripts/golden/part_delete_dialog_shot.js';
window.renderPartDeleteDialog(document.getElementById('root'));
</script>`;

const vite = await createVite({
  root,
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

function readGap() {
  const assembly = window.document.querySelector('[data-part-delete-confirm]');
  const repo = window.document.querySelector('[data-part-delete-confirm-repo]');
  const actions = window.document.querySelector('[data-part-delete-actions]');
  const a = assembly?.getBoundingClientRect();
  const b = repo?.getBoundingClientRect();
  const rowGap = actions ? parseFloat(window.getComputedStyle(actions).rowGap) : -1;
  return {
    between: a && b ? b.top - a.bottom : -1,
    rowGap,
    assemblyTop: a ? a.top : -1,
    repoTop: b ? b.top : -1,
  };
}

async function deleted(page) {
  return page.evaluate(() => window.__DELETED__);
}

async function openChoose(page) {
  await page.evaluate(() => { window.__DELETED__ = null; });
  const id = await page.evaluate(() => window.__PART_ID__);
  await page.locator(`[data-part-delete="${id}"]`).click();
  await page.locator('[data-part-delete-dialog][data-part-delete-step="choose"]').waitFor();
  await page.locator('[data-part-delete-confirm-repo]').waitFor();
  return id;
}

async function runSize(browser, width, height) {
  const label = String(width);
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30000 });
  ok(`${label}: viewport`, (await page.viewportSize()).width === width);

  await openChoose(page);
  const gap = await page.evaluate(readGap);
  ok(`${label}: 12–16px between the delete buttons`,
    gap.between >= 12 && gap.between <= 16 && gap.rowGap >= 12 && gap.rowGap <= 16 && gap.repoTop > gap.assemblyTop,
    JSON.stringify(gap));
  const chooseShot = join(shotDir, `part-delete-choose-${label}.png`);
  await page.screenshot({ path: chooseShot });
  console.log(`  shot ${chooseShot}`);

  await page.locator('[data-part-delete-confirm-repo]').click();
  await page.locator('[data-part-delete-dialog][data-part-delete-step="repo"]').waitFor();
  const message = (await page.locator('[data-part-delete-repo-message]').innerText()).replace(/\s+/g, ' ').trim();
  const commitLabel = (await page.locator('[data-part-delete-repo-commit]').innerText()).trim();
  ok(`${label}: repo confirm names FilletKilla.js`,
    message === COPY && commitLabel === 'Delete' && (await deleted(page)) == null,
    message);
  const repoShot = join(shotDir, `part-delete-repo-${label}.png`);
  await page.screenshot({ path: repoShot });
  console.log(`  shot ${repoShot}`);

  await page.locator('[data-part-delete-cancel]').click();
  await page.locator('[data-part-delete-dialog]').waitFor({ state: 'hidden' });
  ok(`${label}: cancel on the second step keeps the part`, (await deleted(page)) == null);

  await openChoose(page);
  await page.locator('[data-part-delete-confirm]').click();
  await page.locator('[data-part-delete-dialog]').waitFor({ state: 'hidden' });
  const assemblyDrop = await deleted(page);
  ok(`${label}: assembly delete has no second confirm`,
    assemblyDrop?.fromRepo === false && assemblyDrop?.id === 'assemblies/Widget/FilletKilla.js',
    JSON.stringify(assemblyDrop));

  await openChoose(page);
  await page.locator('[data-part-delete-confirm-repo]').click();
  await page.locator('[data-part-delete-repo-commit]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('[data-part-delete-dialog]').waitFor({ state: 'hidden' });
  ok(`${label}: escape on the second step keeps the part`, (await deleted(page)) == null);

  await openChoose(page);
  await page.locator('[data-part-delete-confirm-repo]').click();
  await page.locator('[data-part-delete-repo-commit]').waitFor();
  await page.locator('[data-part-delete-dialog]').click({ position: { x: 8, y: 8 } });
  await page.locator('[data-part-delete-dialog]').waitFor({ state: 'hidden' });
  ok(`${label}: scrim click on the second step keeps the part`, (await deleted(page)) == null);

  await openChoose(page);
  await page.locator('[data-part-delete-confirm-repo]').click();
  await page.locator('[data-part-delete-repo-commit]').click();
  await page.locator('[data-part-delete-dialog]').waitFor({ state: 'hidden' });
  const repoDrop = await deleted(page);
  ok(`${label}: Delete on the second step removes the repo file`,
    repoDrop?.fromRepo === true && repoDrop?.id === 'assemblies/Widget/FilletKilla.js',
    JSON.stringify(repoDrop));

  ok(`${label}: no page errors`, errors.length === 0, errors.slice(0, 4).join(' | '));
  await page.close();
}

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  await runSize(browser, 390, 844);
  await runSize(browser, 1280, 900);
} finally {
  await browser?.close();
  server.close();
  await vite.close();
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
