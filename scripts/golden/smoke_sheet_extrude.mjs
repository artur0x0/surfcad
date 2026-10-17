#!/usr/bin/env node
/**
 * Extrude on a sheet-metal part, and on a regular part.
 *
 * Sheet Metallica keeps its study comment after `return part`. Confirm used
 * to append the contour and the extrude block after that return, so the
 * strip showed the chip and the worker never built the solid. The block
 * now lands before the return, outside the sheet span, and unions onto
 * the flange. A cube still unions too. Taps at 390 and 1280. Volume and
 * triangle count both increase. Screenshots go to GOLDEN_SHOT_DIR or
 * os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { runScript } from '../../src/lib/surfcad/index.js';
import { composeContourExtrude } from '../../src/utils/contourMode.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';
import { contourStatements, findReturnPartIndex } from '../../src/utils/namedContour.js';
import { composeSheetMetalCommit } from '../../src/utils/sheetMetal/sheetMetalScript.js';

const PORT = Number(process.env.SMOKE_PORT || 5277);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();

const SPEC = {
  v: 1,
  sku: 'SST316-125',
  material: 'Stainless Steel (316 Series)',
  t: 3.175,
  r: 1,
  k: 0.38,
  plane: 'XZ',
  width: 100,
  height: 60,
  bends: [],
  tabs: [],
  holes: [],
};

const STUDY = [
  '// --- fea-study begin ---',
  '// @fea-study {"v":1,"id":"s1"}',
  '// --- fea-study end ---',
  '',
].join('\n');

const CUBE = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

const FACE = {
  type: 'planar',
  center: [0, 80, 0],
  normal: [0, 1, 0],
  planeFrame: {
    center: [0, 80, 0],
    normal: [0, 1, 0],
    x: [1, 0, 0],
    y: [0, 0, 1],
  },
};

function sheetWithStudy() {
  const composed = composeSheetMetalCommit('', SPEC);
  if (!composed.ok) throw new Error(composed.message || 'sheet commit failed');
  const src = composed.buffer.replace(/\s*$/, '');
  if (!/return part;$/.test(src)) throw new Error('sheet script has no trailing return');
  return `${src}\n${STUDY}`;
}

const SHEET = sheetWithStudy();

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

function placedBeforeReturn(buffer) {
  const ret = findReturnPartIndex(buffer);
  const contour = contourStatements(buffer).find((row) => row.id === 'c1');
  const sheet = parseFeatureMarkers(buffer).find((row) => row.kind === 'sheetMetal');
  const extrudeAt = buffer.indexOf('contour-mode extrude begin id=extrude1');
  const studyAt = buffer.indexOf('fea-study begin');
  return { ret, contour, sheet, extrudeAt, studyAt };
}

async function nodeChecks() {
  console.log('sheet extrude (script)');
  const sheetOnly = await runScript(SHEET);
  const sheetWrote = composeContourExtrude(SHEET, {
    face: FACE,
    tool: 'circle',
    params: { radius: 8, segments: 16 },
    extrude: { distance: 12, direction: 'normal', sense: 'positive' },
  });
  check('sheet extrude writes', sheetWrote.ok && sheetWrote.featureId === 'extrude1', sheetWrote.message || '');
  const sheetPlace = sheetWrote.ok ? placedBeforeReturn(sheetWrote.buffer) : null;
  check('sheet extrude is before return and outside the span', !!sheetPlace
    && sheetPlace.extrudeAt >= 0
    && sheetPlace.extrudeAt < sheetPlace.ret
    && sheetPlace.contour
    && sheetPlace.contour.start > sheetPlace.sheet.endOffset
    && sheetPlace.studyAt > sheetPlace.ret
    && /part = part\.add\(placeInFrame/.test(sheetWrote.buffer));
  if (sheetWrote.ok) {
    const sheetBoth = await runScript(sheetWrote.buffer);
    check('sheet extrude increases volume and triangles',
      sheetBoth.volume > sheetOnly.volume + 100 && sheetBoth.tris > sheetOnly.tris,
      `volume ${sheetOnly.volume} -> ${sheetBoth.volume}, tris ${sheetOnly.tris} -> ${sheetBoth.tris}`);
  }

  const cubeOnly = await runScript(CUBE);
  const cubeWrote = composeContourExtrude(CUBE, {
    face: FACE,
    tool: 'circle',
    params: { radius: 8, segments: 16 },
    extrude: { distance: 12, direction: 'normal', sense: 'positive' },
  });
  check('cube extrude writes', cubeWrote.ok, cubeWrote.message || '');
  if (cubeWrote.ok) {
    const cubeBoth = await runScript(cubeWrote.buffer);
    check('cube extrude increases volume and triangles',
      cubeBoth.volume > cubeOnly.volume + 100 && cubeBoth.tris > cubeOnly.tris
      && cubeWrote.buffer.indexOf('makeExtrude') < findReturnPartIndex(cubeWrote.buffer),
      `volume ${cubeOnly.volume} -> ${cubeBoth.volume}, tris ${cubeOnly.tris} -> ${cubeBoth.tris}`);
  }
}

await nodeChecks();
if (failed) {
  console.log(`sheet extrude: ${failed} failed`);
  process.exit(1);
}

console.log('sheet extrude (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('sheet extrude: no system Chrome — set CHROME_PATH');
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

async function measure(page) {
  return page.evaluate(() => ({
    volume: Number(window.__MANIFOLD_CONTEXT__?.lastResult?.volume),
    tris: window.__VIEWPORT__?.stageVerifyFraming?.().tris || 0,
  }));
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
}

async function loadScript(page, src) {
  await page.evaluate((text) => {
    window.monaco.editor.getModels()[0].setValue(text);
  }, src);
  const ran = await page.evaluate(async (text) => window.__VIEWPORT__.executeScript(text), src);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  return measure(page);
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
  await page.locator('[data-part-row]').first().waitFor({ state: 'visible', timeout: 8000 });
  await page.evaluate(() => {
    document.querySelector('[data-part-row]')?.click();
  });
  await page.waitForFunction(() => (
    document.querySelector('[data-part-row]')?.getAttribute('data-part-selected') === 'true'
  ), null, { timeout: 8000 });
  if (phone) await page.locator('[data-stage-btn="cad"]').click();
}

async function newContour(page) {
  await page.locator('[data-new-contour-role="profile"][data-new-contour-index="0"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  await page.locator('[data-contour-confirm]').click();
  await page.locator('[data-feature-slot-card]').waitFor({ timeout: 8000 });
}

async function confirmExtrude(page) {
  const button = page.locator('button[aria-label^="Insert Extrude"]');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.locator('[data-feature-slot-card]').waitFor({ timeout: 8000 });
  await newContour(page);
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => !document.querySelector('[data-feature-slot-card]'), null, { timeout: 15000 });
}

async function grew(page, before) {
  await page.waitForFunction((prev) => {
    const volume = Number(window.__MANIFOLD_CONTEXT__?.lastResult?.volume);
    const tris = window.__VIEWPORT__?.stageVerifyFraming?.().tris || 0;
    return volume > prev.volume + 1 && tris > prev.tris;
  }, before, { timeout: 30000 });
  return measure(page);
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

  const sheetBefore = await loadScript(page, SHEET);
  await ensurePartSelected(page);
  await confirmExtrude(page);
  const sheetScript = await editorScript(page);
  const sheetPlace = placedBeforeReturn(sheetScript);
  check(`${label} sheet extrude is before return`, sheetPlace.extrudeAt >= 0 && sheetPlace.extrudeAt < sheetPlace.ret);
  check(`${label} sheet contour is outside the sheet span`, !!sheetPlace.contour
    && sheetPlace.contour.start > sheetPlace.sheet.endOffset
    && sheetPlace.contour.end <= sheetPlace.ret);
  check(`${label} sheet study stays after return`, sheetPlace.studyAt > sheetPlace.ret);
  check(`${label} sheet extrude unions`, /part = part\.add\(placeInFrame\(c1\.plane, makeExtrude\(c1\.contours/.test(sheetScript));
  await page.locator('[data-cad-feature-strip] [data-feature-chip="extrude"]').waitFor({ timeout: 8000 });
  const sheetAfter = await grew(page, sheetBefore);
  check(`${label} sheet volume and triangles increase`,
    sheetAfter.volume > sheetBefore.volume + 1 && sheetAfter.tris > sheetBefore.tris,
    `volume ${sheetBefore.volume} -> ${sheetAfter.volume}, tris ${sheetBefore.tris} -> ${sheetAfter.tris}`);
  await page.screenshot({ path: join(SHOT_DIR, `sheet-extrude-${label}.png`) });

  const cubeBefore = await loadScript(page, CUBE);
  await ensurePartSelected(page);
  await confirmExtrude(page);
  const cubeScript = await editorScript(page);
  check(`${label} cube extrude is before return`, cubeScript.indexOf('makeExtrude') < findReturnPartIndex(cubeScript)
    && /let part = Manifold\.cube\(\[40, 30, 20\], true\)/.test(cubeScript)
    && /part = part\.add\(placeInFrame/.test(cubeScript));
  const cubeAfter = await grew(page, cubeBefore);
  check(`${label} cube volume and triangles increase`,
    cubeAfter.volume > cubeBefore.volume + 1 && cubeAfter.tris > cubeBefore.tris,
    `volume ${cubeBefore.volume} -> ${cubeAfter.volume}, tris ${cubeBefore.tris} -> ${cubeAfter.tris}`);
  await page.screenshot({ path: join(SHOT_DIR, `sheet-extrude-cube-${label}.png`) });
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('sheet extrude: vite did not start');
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
  console.log(`sheet extrude: ${failed} failed`);
  process.exit(1);
}
console.log('sheet extrude: ok');
