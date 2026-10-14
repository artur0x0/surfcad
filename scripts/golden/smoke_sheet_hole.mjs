#!/usr/bin/env node
/**
 * Sheet-metal holes from the centres sketch. 390 and 1280.
 *
 * Hole on a sheet taps a panel. Next opens the dashed centres sketch on
 * that panel. The plane card stays closed. Accept writes one
 * sheetSpec.holes row per centre. No centres, Back, and Esc write nothing.
 * The contour is not stored.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { newPartStarterScript } from '../../src/utils/helperPaletteSnippets.js';
import { readSheetMetalSpec } from '../../src/utils/sheetMetal/sheetMetalScript.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.SMOKE_PORT || 5302);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const catalog = readFileSync(join(ROOT, 'scripts/golden/fixtures/scs/catalog.json'), 'utf8');
const specs = readFileSync(join(ROOT, 'scripts/golden/fixtures/scs/specs.json'), 'utf8');

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

console.log('sheet panel holes');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('sheet panel holes: no system Chrome — set CHROME_PATH');
  process.exit(1);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
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
  return page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
}

async function openSheet(page) {
  await page.evaluate((text) => {
    window.monaco.editor.getModels()[0].setValue(text);
  }, newPartStarterScript());
  await page.locator('[data-sheet-metal-button]').click();
  await page.waitForSelector('[data-sheet-metal-picker]', { timeout: 10000 });
  await page.waitForFunction(() => [...document.querySelectorAll('#sm-material option')].some((o) => o.value), null, { timeout: 15000 });
  await page.selectOption('#sm-material', { label: '5052 H32 Aluminum' });
  await page.waitForFunction(() => {
    const gauge = document.querySelector('#sm-gauge option[value="ALU-090"]');
    return !!(gauge && !gauge.disabled);
  }, null, { timeout: 10000 });
  await page.selectOption('#sm-gauge', 'ALU-090');
  await page.locator('[data-sheet-metal-start]').click();
  await page.waitForSelector('[data-sheet-metal-step="plane"]', { timeout: 15000 });
  await page.locator('[data-sm-plane="XY"]').click();
  await page.waitForSelector('[data-sheet-metal-base]', { timeout: 10000 });
  await page.locator('[data-sheet-metal-base] [data-sm-accept]').click();
  await page.waitForSelector('[data-sheet-metal-step="edit"]', { timeout: 15000 });
}

async function tapBase(page) {
  await page.locator('[data-sheet-tool="hole"]').click();
  const opened = await page.evaluate(() => {
    window.__SHEET__?.tap({ kind: 'panel', panel: 'base', point: [0, 0, 1] });
    return !!window.__SHEET__;
  });
  if (!opened) throw new Error('sheet tap is not installed');
  await page.locator('[data-sheet-metal-hole]').waitFor({ timeout: 8000 });
}

async function projectHitsCanvas(page, world) {
  return page.evaluate((w) => {
    const p = window.__VIEWPORT__.stageProject(w);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas) return { ok: false, reason: 'no project' };
    const el = document.elementFromPoint(p.x, p.y);
    return { ok: el === canvas, x: p.x, y: p.y, tag: el ? el.tagName : '' };
  }, world);
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.route('**/sendcutsend-catalog*.json', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: catalog,
  }));
  await page.route('**/sendcutsend-specs*.json', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: specs,
  }));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-sheet-metal-button]', { timeout: 90000 });
  await page.waitForFunction(() => window.monaco?.editor?.getModels?.()?.length > 0, null, { timeout: 30000 });
  await openSheet(page);
  const before = await editorScript(page);

  await tapBase(page);
  const title = (await page.locator('[data-sheet-metal-hole] [data-feature-card-title]').innerText()).trim();
  const next = await page.locator('[data-sm-next]').count();
  const uv = await page.locator('#sm-hole-u').count();
  check(`${label} the panel card is Hole`, title === 'Hole', title);
  check(`${label} Next opens the sketch`, next === 1, String(next));
  check(`${label} a new hole has no U V sliders`, uv === 0, String(uv));
  await page.screenshot({ path: join(SHOT_DIR, `hole-sheet-card-${label}.png`) });
  await page.locator('[data-sm-back]').click();
  await page.locator('[data-sheet-metal-hole]').waitFor({ state: 'detached', timeout: 4000 });
  check(`${label} Back writes nothing`, (await editorScript(page)) === before);

  await tapBase(page);
  await page.locator('[data-sm-next]').click();
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return sketch.entry === 'hole'
      && sketch.planeCard === false
      && !document.querySelector('[data-plane-editor]')
      && document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done';
  }, null, { timeout: 8000 });
  await page.keyboard.press('Escape');
  await page.locator('[data-contour-exit]').waitFor({ state: 'detached', timeout: 4000 });
  await page.locator('[data-sheet-metal-step="edit"]').waitFor({ timeout: 8000 });
  check(`${label} Esc on the sketch writes nothing`, (await editorScript(page)) === before);

  await tapBase(page);
  await page.locator('[data-sm-next]').click();
  await page.waitForFunction(() => (
    window.__VIEWPORT__.stageContourSketch().entry === 'hole'
    && document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
  ), null, { timeout: 8000 });
  const thick = readSheetMetalSpec(await editorScript(page))?.t || 2;
  await page.locator('[data-contour-tool="polyline"]').click();
  const first = await projectHitsCanvas(page, [12, 8, thick]);
  const second = await projectHitsCanvas(page, [-8, -4, thick]);
  check(`${label} centre taps land on the canvas`, !!first?.ok && !!second?.ok, JSON.stringify({ first, second }));
  if (first?.ok) await page.mouse.click(first.x, first.y);
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().points === 1, null, { timeout: 4000 });
  if (second?.ok) await page.mouse.click(second.x, second.y);
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return sketch.points === 2 && sketch.sketchLines.some((line) => line.dashed);
  }, null, { timeout: 4000 });
  const sketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  const dashed = (sketch.sketchLines || []).filter((line) => line.dashed);
  check(`${label} sketch lines are dashed`, dashed.length > 0, JSON.stringify(sketch.sketchLines));
  check(`${label} the plane card stays closed`, sketch.planeCard === false && sketch.entry === 'hole');
  await page.screenshot({ path: join(SHOT_DIR, `hole-sheet-sketch-${label}.png`) });

  await page.locator('[data-contour-confirm]').click();
  await page.locator('[data-contour-exit]').waitFor({ state: 'detached', timeout: 8000 });
  await page.locator('[data-sheet-metal-step="edit"]').waitFor({ timeout: 8000 });
  const written = await editorScript(page);
  const spec = readSheetMetalSpec(written);
  const holes = spec?.holes || [];
  check(`${label} Accept writes two holes on the base`,
    holes.length === 2 && holes.every((hole) => hole.panel === 'base' && Number.isFinite(hole.u) && Number.isFinite(hole.v)),
    JSON.stringify(holes));
  check(`${label} both holes share one diameter`, holes.length === 2 && holes[0].d === holes[1].d);
  check(`${label} the centres are not a contour`,
    !written.includes('solveContour') && !written.includes('holesOnContour') && !written.includes('role=centers'));
  const holeCount = await page.locator('[data-sheet-metal-step="edit"]').getAttribute('data-sm-holes');
  check(`${label} the sheet still lists the holes`, holeCount === '2', holeCount);
  await page.screenshot({ path: join(SHOT_DIR, `hole-sheet-done-${label}.png`) });

  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('sheet panel holes: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
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
  console.log(`sheet panel holes: ${failed} failed`);
  process.exit(1);
}
console.log('sheet panel holes: ok');
