#!/usr/bin/env node
/**
 * Unused contour inside a Sheet Metallica-like sheet block.
 *
 * The contour sits inside the sheet-metal markers, which is the shape that
 * used to toast "Delete would change another feature — refusing." It is
 * unused, so Delete removes it immediately, shows an Undo toast, and Undo
 * puts the statement back. 390 and 1280. Edge refs on that same statement
 * are covered by the contour unit test; a live ref that does not match this
 * mesh soft-fails the run.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { contourFromRectangle } from '../../src/utils/contourSolve.js';
import { emitSolveContour } from '../../src/utils/contourScript.js';
import { contourUsedByText } from '../../src/utils/contourUsers.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';
import { contourStatements, emitNamedContourLine } from '../../src/utils/namedContour.js';
import {
  SHEET_METAL_END,
  composeSheetMetalCommit,
} from '../../src/utils/sheetMetal/sheetMetalScript.js';

const PORT = Number(process.env.SMOKE_PORT || 5263);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();

const SPEC = {
  v: 1,
  sku: 'SST316-125',
  material: 'Stainless Steel (316 Series)',
  t: 3.175,
  r: 3.81,
  k: 0.38,
  limits: {
    bendable: true,
    services: ['bending'],
    minFlange: 18.796,
    maxAngle: 120,
    minAngle: null,
    reliefDepth: 7.493,
    cornerRelief: 0.508,
    maxBendLength: 457.2,
    bendDeduction: 6.096,
    minFlat: [9.525, 38.1],
    maxFlat: [1117.6, 762],
    maxPart: [1117.6, 762],
    minPart: [9.525, 6.35],
    minHole: 1.27,
    minBridge: 1.27,
    minHoleToEdge: 0.9652,
    minHoleToBend: 13.462,
  },
  plane: 'XZ',
  width: 100,
  height: 60,
  bends: [
    { id: 'b1', panel: 'base', edge: 'u-', angle: 90, length: 28.2, flip: true },
    { id: 'b2', panel: 'b1', edge: 'u+', angle: 90, length: 28.2, flip: false },
    { id: 'b3', panel: 'base', edge: 'u+', angle: 90, length: 28.2, flip: true },
    { id: 'b4', panel: 'b3', edge: 'u+', angle: 90, length: 28.2, flip: false },
  ],
  tabs: [{ id: 't1', panel: 'base', edge: 'v+', width: 25, depth: 10, centered: true, offset: 37.5 }],
  holes: [{ id: 'h1', panel: 'base', u: -23.93, v: 1.91, d: 5, type: 'hole' }],
};

function sheetContourScript() {
  const composed = composeSheetMetalCommit('', SPEC);
  if (!composed.ok) throw new Error(composed.message || 'sheet commit failed');
  const model = contourFromRectangle(40, 30, true);
  const line = emitNamedContourLine({
    name: 'c1',
    id: 'c1',
    frame: { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
    profileExpr: emitSolveContour(model),
  });
  const endAt = composed.buffer.indexOf(SHEET_METAL_END);
  if (endAt < 0) throw new Error('sheet block has no end marker');
  return `${composed.buffer.slice(0, endAt)}${line}\n${composed.buffer.slice(endAt)}`;
}

const SCRIPT = sheetContourScript();
{
  const stmt = contourStatements(SCRIPT).find((row) => row.id === 'c1');
  const sheet = parseFeatureMarkers(SCRIPT).find((row) => row.kind === 'sheetMetal');
  if (!stmt || !sheet) throw new Error('script is missing the contour or the sheet block');
  if (!(stmt.start >= sheet.startOffset && stmt.end <= sheet.endOffset)) {
    throw new Error('contour is not inside the sheet-metal span');
  }
  if (contourUsedByText(SCRIPT, 'c1') !== 'Unused') throw new Error('contour is not unused');
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('sheet contour delete (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('sheet contour delete: no system Chrome — set CHROME_PATH');
  process.exit(1);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
  try { server.kill('SIGKILL'); } catch { /* already gone */ }
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

async function waitForServer(timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function editorScript(page) {
  return page.evaluate(() => (
    (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n')
  ));
}

async function clickDom(page, selector) {
  const clicked = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`missing ${selector}`);
}

async function ensurePartSelected(page) {
  if (await page.locator('[data-part-row]').count() === 0) {
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('[data-cad-run]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!clicked) throw new Error('Run is not in the page, so no part can be selected');
    await page.waitForFunction(() => document.querySelectorAll('[data-part-row]').length > 0, null, { timeout: 20000 });
  }
  const partsBtn = page.locator('[data-stage-btn="parts"]');
  const phone = await partsBtn.isVisible().catch(() => false);
  if (phone) {
    await partsBtn.click();
    await page.waitForFunction(() => (
      document.querySelector('[data-mobile-stage]')?.getAttribute('data-mobile-stage') === 'parts'
    ), null, { timeout: 8000 });
  }
  const row = page.locator('[data-part-row]').first();
  await row.waitFor({ state: 'visible', timeout: 8000 });
  await page.evaluate(() => {
    document.querySelector('[data-part-row]')?.click();
  });
  await page.waitForFunction(() => (
    document.querySelector('[data-part-row]')?.getAttribute('data-part-selected') === 'true'
  ), null, { timeout: 8000 });
  if (phone) await page.locator('[data-stage-btn="cad"]').click();
}

async function boot(page) {
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    return !!(canvas && canvas.clientWidth > 0 && window.__VIEWPORT__?.ready?.() && window.__MANIFOLD_CONTEXT__?.isReady);
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => (window.monaco?.editor?.getModels?.() || []).length > 0, null, { timeout: 30000 });
  await page.evaluate((src) => {
    const model = window.monaco.editor.getModels()[0];
    model.setValue(src);
  }, SCRIPT);
  const ran = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await ensurePartSelected(page);
  await page.locator('[data-cad-feature-strip] [data-contour-id="c1"]').waitFor({ timeout: 8000 });
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
  await boot(page);

  await clickDom(page, '[data-cad-feature-strip] [data-contour-id="c1"]');
  await page.locator('[data-contour-delete]').waitFor({ timeout: 8000 });
  check(`${label} the banner reads Unused`,
    (await page.locator('[data-contour-used-by]').innerText()).trim() === 'Unused');
  await page.locator('[data-contour-delete]').click();
  await page.locator('[data-delete-undo-toast]').waitFor({ timeout: 8000 });
  const toastText = ((await page.locator('[data-contour-toast]').innerText()) || '').replace(/\s+/g, ' ');
  check(`${label} there is no refuse toast`,
    !/refusing/i.test(toastText) && !/Delete would change another feature/.test(toastText), toastText);
  check(`${label} the Undo toast says Deleted contour`,
    toastText.includes('Deleted contour.'), toastText);
  check(`${label} no confirm dialog`, await page.locator('[data-contour-delete-dialog]').count() === 0);
  const after = await editorScript(page);
  check(`${label} the contour statement is gone`, !/@contour id=c1/.test(after));
  check(`${label} the sheet block stays`, /sheet-metal begin/.test(after) && /SST316-125/.test(after));
  await page.screenshot({ path: join(SHOT_DIR, `sheet-contour-delete-${label}.png`) });

  const undo = page.locator('[data-delete-undo-toast] [data-error-undo]');
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-delete-undo-toast] [data-error-undo]');
    return !!btn && !btn.disabled;
  }, null, { timeout: 8000 });
  await undo.click();
  await page.waitForFunction(() => {
    const text = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
    return /@contour id=c1/.test(text)
      && /sheet-metal begin/.test(text)
      && /sheet-metal end/.test(text)
      && /SST316-125/.test(text);
  }, null, { timeout: 15000 });
  check(`${label} Undo restores the contour and the sheet block`, true);
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('sheet contour delete: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
attachConsentPresetToBrowser(browser);
try {
  await runSize(browser, '390', {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await runSize(browser, '1280', {
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
} catch (err) {
  failed += 1;
  console.log(`  ❌ run — ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`sheet contour delete: ${failed} failed`);
  process.exit(1);
}
console.log('sheet contour delete: ok');
