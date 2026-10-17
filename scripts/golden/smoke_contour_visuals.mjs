#!/usr/bin/env node
/**
 * Contour drawing visuals at 390px and 1280px.
 *
 * Sketch lines are a 3px stroke and point dots read about 8px. A length
 * dimension draws extension lines, a double-headed arrow, and the opaque
 * value chip centered on the arrow. An angle draws the arc with arrowheads.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5244);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'return Manifold.cube([40, 30, 20], true);\n';

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

console.log('contour drawing visuals');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour drawing visuals: no system Chrome — set CHROME_PATH');
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
  const ran = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function startSketch(page) {
  await boot(page);
  await page.locator('button[aria-label^="Insert Create contour"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  await page.locator('[data-contour-tool="polyline"]').click();
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().tool === 'polyline');
}

async function chooseTriangle(page) {
  const sets = [
    [[-8, -6, 10], [8, -6, 10], [0, 8, 10]],
    [[-8, 6, 10], [8, 6, 10], [0, -8, 10]],
    [[-10, 8, 10], [10, 8, 10], [0, -4, 10]],
  ];
  const view = await page.evaluate((candidates) => {
    const canvas = document.querySelector('canvas').getBoundingClientRect();
    return {
      top: canvas.top,
      height: canvas.height,
      scored: candidates.map((pts) => ({
        pts,
        projected: pts.map((p) => window.__VIEWPORT__.stageProject(p)),
      })),
    };
  }, sets);
  const usable = view.scored.filter((row) => row.projected.every(Boolean));
  const upper = usable.filter((row) => {
    const midY = row.projected.reduce((sum, p) => sum + p.y, 0) / row.projected.length;
    return midY < view.top + view.height * 0.48;
  });
  const pool = upper.length ? upper : usable;
  if (!pool.length) return null;
  pool.sort((a, b) => {
    const span = (row) => {
      const xs = row.projected.map((p) => p.x);
      const ys = row.projected.map((p) => p.y);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    };
    return span(b) - span(a);
  });
  return pool[0].pts;
}

async function addPoint(page, world, n) {
  const at = await page.evaluate((p) => window.__VIEWPORT__.stageProject(p), world);
  if (!at) throw new Error(`point off screen ${world.join(',')}`);
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction((count) => window.__VIEWPORT__.stageContourSketch().points >= count, n, { timeout: 4000 });
}

async function clickWorld(page, world) {
  const at = await page.evaluate((p) => window.__VIEWPORT__.stageProject(p), world);
  if (!at) throw new Error(`miss ${world.join(',')}`);
  await page.mouse.click(at.x, at.y);
}

function mid(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

async function figureProbe(page, kind) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < 4000) {
    last = await page.evaluate((want) => {
      const group = document.querySelector(`[data-contour-dim-kind="${want}"]`);
      const chip = document.querySelector('[data-contour-tag]');
      if (!group || !chip) return null;
      const lx = Number(group.getAttribute('data-contour-dim-label-x'));
      const ly = Number(group.getAttribute('data-contour-dim-label-y'));
      const box = chip.getBoundingClientRect();
      const exts = [...document.querySelectorAll('[data-contour-dim-ext]')];
      return {
        kind: group.getAttribute('data-contour-dim-kind'),
        exts: exts.length,
        extLen: exts.map((el) => el.getTotalLength()),
        arrows: document.querySelectorAll('[data-contour-dim-arrow]').length,
        arc: Boolean(document.querySelector('[data-contour-dim-arc]')),
        shaft: Boolean(document.querySelector('[data-contour-dim-shaft]')),
        gap: Math.hypot((box.left + box.width / 2) - lx, (box.top + box.height / 2) - ly),
        opaque: String(chip.className).includes('bg-white'),
        text: chip.textContent || '',
      };
    }, kind);
    if (last && last.kind === kind && last.gap < 8 && last.arrows === 2) return last;
    await page.waitForTimeout(40);
  }
  return last;
}

async function runViewport(page, width) {
  console.log(`\nviewport ${width}`);
  await startSketch(page);
  const pts = await chooseTriangle(page);
  check(`${width} triangle is on the upper canvas`, Array.isArray(pts) && pts.length === 3, JSON.stringify(pts));
  if (!pts) return;
  await addPoint(page, pts[0], 1);
  await addPoint(page, pts[1], 2);
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return sketch.sketchLinePx === 3 && sketch.sketchPointPx >= 7.2 && sketch.sketchPointPx <= 8.8;
  }, null, { timeout: 8000 });
  const open = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check(`${width} open sketch lines are 3px`, open.sketchLinePx === 3, JSON.stringify(open));
  check(`${width} point dots are about 8px`, open.sketchPointPx >= 7.2 && open.sketchPointPx <= 8.8, JSON.stringify(open));
  await addPoint(page, pts[2], 3);

  await page.locator('[data-contour-tool="dimension"]').click();
  await page.waitForFunction(() => /Dimension/.test(document.querySelector('[data-feature-card]')?.textContent || ''));
  await clickWorld(page, mid(pts[0], pts[1]));
  const length = await figureProbe(page, 'length');
  const promoted = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check(`${width} promoted sketch lines stay 3px`, promoted.sketchLinePx === 3, JSON.stringify(promoted));
  check(`${width} length has two extension lines`, length?.exts === 2 && length.extLen.every((n) => n > 8), JSON.stringify(length));
  check(`${width} length has a double-headed arrow`, length?.arrows === 2 && length.shaft && !length.arc, JSON.stringify(length));
  check(`${width} length chip is centered on the arrow`, length?.gap < 8 && length.opaque, JSON.stringify(length));
  await page.screenshot({ path: join(SHOT_DIR, `contour-visuals-length-${width}.png`) });

  await clickWorld(page, mid(pts[1], pts[2]));
  const angle = await figureProbe(page, 'angle');
  check(`${width} angle is an arc with arrowheads`, angle?.kind === 'angle' && angle.arc && angle.arrows === 2 && !angle.shaft, JSON.stringify(angle));
  check(`${width} angle has extension lines`, angle?.exts === 2 && angle.extLen.every((n) => n > 8), JSON.stringify(angle));
  check(`${width} angle chip is centered on the arc`, angle?.gap < 8 && /°/.test(angle.text), JSON.stringify(angle));
  await page.screenshot({ path: join(SHOT_DIR, `contour-visuals-angle-${width}.png`) });
}

const up = await waitForServer();
if (!up) {
  console.log('contour drawing visuals: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, headless: true });
attachConsentPresetToBrowser(browser);
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 800 } });
    await page.addInitScript(() => { window.__SURFCAD_NO_TUTORIAL = true; });
    await runViewport(page, width);
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\ncontour drawing visuals ok');
