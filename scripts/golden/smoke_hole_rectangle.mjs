#!/usr/bin/env node
/**
 * Rectangle on the hole centres sketch. 390 and 1280.
 *
 * The hole rail includes Rectangle, the same tool as the other contour
 * rails. The four corners are centres. The lines are dashed. Dimension
 * promotes that rectangle, and Accept writes the centres, the length
 * dimensions, and the constraints.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5311);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

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

console.log('hole rectangle');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('hole rectangle: no system Chrome — set CHROME_PATH');
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
  await page.waitForFunction(() => (window.monaco?.editor?.getModels?.() || []).length > 0, null, { timeout: 30000 });
  await page.evaluate((src) => {
    window.monaco.editor.getModels()[0].setValue(src);
  }, SCRIPT);
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function editorScript(page) {
  return page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

  await page.locator('button[aria-label^="Insert Hole"]').click();
  await page.locator('[data-hole-card]').waitFor({ timeout: 8000 });
  await page.locator('[data-hole-card] [data-feature-card-confirm]').click();
  await page.locator('[data-plane-editor]').waitFor({ timeout: 8000 });
  check(`${label} the hole rail has Rectangle`, await page.locator('[data-contour-tool="rectangle"]').count() === 1);
  check(`${label} Circle stays off the hole rail`, await page.locator('[data-contour-tool="circle"]').count() === 0);
  check(`${label} Polygon stays off the hole rail`, await page.locator('[data-contour-tool="polygon"]').count() === 0);
  await page.locator('[data-contour-tool="rectangle"]').click();
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return sketch.tool === 'rectangle'
      && sketch.planeCard === false
      && document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
      && (sketch.sketchLines || []).some((line) => line.dashed && line.color === 0x22d3ee);
  }, null, { timeout: 8000 });
  const sketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check(`${label} the rectangle is a dashed centres sketch`,
    sketch.entry === 'hole' && sketch.sketchLines.some((line) => line.dashed && line.color === 0x22d3ee),
    JSON.stringify(sketch.sketchLines));
  await page.screenshot({ path: join(SHOT_DIR, `hole-rect-sketch-${label}.png`) });

  await page.locator('[data-contour-tool="dimension"]').click();
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().dimensions >= 2, null, { timeout: 4000 });
  const promoted = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check(`${label} Dimension keeps the rectangle dimensions`, promoted.dimensions >= 2, String(promoted.dimensions));
  check(`${label} the promoted lines stay dashed`,
    (promoted.sketchLines || []).some((line) => line.dashed),
    JSON.stringify(promoted.sketchLines));

  await page.locator('[data-contour-confirm]').click();
  await page.locator('[data-contour-exit]').waitFor({ state: 'detached', timeout: 8000 });
  await page.waitForFunction(() => (
    window.monaco.editor.getModels()[0].getValue().includes('holesOnContour')
  ), null, { timeout: 15000 });
  const written = await editorScript(page);
  const centres = ['p0', 'p1', 'p2', 'p3'].filter((id) => written.includes(`id: '${id}'`));
  check(`${label} Accept writes four centres`, centres.length === 4, centres.join(','));
  check(`${label} the rectangle dimensions and constraints are in the contour`,
    written.includes("kind: 'length'")
      && written.includes("kind: 'horizontal'")
      && written.includes("kind: 'vertical'")
      && written.includes('construction: true')
      && written.includes('centers: true')
      && written.includes('holesOnContour(part, c1,'));
  await page.waitForFunction(() => document.querySelector('[data-part-row]'), null, { timeout: 15000 });
  await page.evaluate(() => document.querySelector('[data-part-row]')?.click());
  await page.waitForFunction(() => document.querySelector('[data-part-selected="true"]'), null, { timeout: 8000 });
  await page.waitForFunction(() => {
    const bars = [...document.querySelectorAll('[data-rollback-bar]')];
    return bars.length > 0 && bars.every((bar) => bar.getAttribute('data-rollback-anchor') === 'hole1');
  }, null, { timeout: 8000 });
  await page.screenshot({ path: join(SHOT_DIR, `hole-rect-done-${label}.png`) });

  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('hole rectangle: vite did not start');
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
  console.log(`hole rectangle: ${failed} failed`);
  process.exit(1);
}
console.log('hole rectangle: ok');
