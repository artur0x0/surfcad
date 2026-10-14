#!/usr/bin/env node
/**
 * Tap a contour hole to edit it. 390 and 1280.
 *
 * The chip opens the Hole card with Confirm, Edit centres, and Delete.
 * Confirm rewrites that spec and leaves the contour. Edit centres reopens
 * the dashed sketch on the baked plane, with the plane card closed.
 * Confirm rewrites the centres and leaves the hole. Delete removes the
 * hole block and leaves the centres chip. The bar stays on hole1 until
 * that delete. Esc on the card writes nothing.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5301);
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

console.log('hole tap-to-edit');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('hole tap-to-edit: no system Chrome — set CHROME_PATH');
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

function solveCall(script) {
  const at = script.indexOf('solveContour');
  const end = script.indexOf('); // @contour', at);
  return at < 0 || end < 0 ? '' : script.slice(at, end);
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

async function acceptHole(page) {
  await page.locator('button[aria-label^="Insert Hole"]').click();
  await page.locator('[data-hole-card]').waitFor({ timeout: 8000 });
  await page.locator('[data-hole-card] [data-feature-card-confirm]').click();
  await page.locator('[data-plane-editor]').waitFor({ timeout: 8000 });
  await page.locator('[data-contour-tool="polyline"]').click();
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-plane-editor]')
  ), null, { timeout: 8000 });
  const first = await projectHitsCanvas(page, [4, -3, 10]);
  const second = await projectHitsCanvas(page, [12, 4, 10]);
  if (!first?.ok || !second?.ok) {
    throw new Error(`centre taps missed the canvas ${JSON.stringify({ first, second })}`);
  }
  await page.mouse.click(first.x, first.y);
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().points === 1, null, { timeout: 4000 });
  await page.mouse.click(second.x, second.y);
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return sketch.points === 2 && sketch.sketchLines.some((line) => line.dashed);
  }, null, { timeout: 4000 });
  await page.locator('[data-contour-confirm]').click();
  await page.waitForFunction(() => (
    window.monaco.editor.getModels()[0].getValue().includes('holesOnContour')
  ), null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[data-part-row]'), null, { timeout: 15000 });
  await page.evaluate(() => document.querySelector('[data-part-row]')?.click());
  await page.waitForFunction(() => (
    document.querySelector('[data-part-selected="true"]')
  ), null, { timeout: 8000 });
  await page.waitForFunction(() => {
    const bars = [...document.querySelectorAll('[data-rollback-bar]')];
    return bars.length > 0
      && bars.every((bar) => bar.getAttribute('data-rollback-anchor') === 'hole1');
  }, null, { timeout: 8000 });
}

async function tapHole(page) {
  await page.evaluate(() => document.querySelector('[data-feature-id="hole1"]')?.click());
  await page.locator('[data-hole-card]').waitFor({ timeout: 8000 });
}

async function barOnHole(page) {
  return page.evaluate(() => {
    const bars = [...document.querySelectorAll('[data-rollback-bar]')];
    return bars.length > 0 && bars.every((bar) => bar.getAttribute('data-rollback-anchor') === 'hole1');
  });
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);
  await acceptHole(page);
  const created = await editorScript(page);
  const solve = solveCall(created);

  await tapHole(page);
  await page.keyboard.press('Escape');
  await page.locator('[data-hole-card]').waitFor({ state: 'detached', timeout: 4000 });
  check(`${label} Esc on the edit card writes nothing`, (await editorScript(page)) === created);

  await tapHole(page);
  const title = (await page.locator('[data-hole-card] [data-feature-card-title]').innerText()).trim();
  const confirmLabel = (await page.locator('[data-hole-card] [data-feature-card-confirm]').innerText()).trim();
  const editCentres = await page.locator('[data-hole-edit-centres]').count();
  check(`${label} edit card is Hole`, title === 'Hole', title);
  check(`${label} confirm rewrites the hole`, confirmLabel === 'Confirm', confirmLabel);
  check(`${label} edit centres is on the card`, editCentres === 1, String(editCentres));
  await page.screenshot({ path: join(SHOT_DIR, `hole-edit-card-${label}.png`) });

  await page.locator('[data-hole-side="-1"]').click();
  await page.locator('[data-hole-card] [data-feature-card-confirm]').click();
  await page.locator('[data-hole-card]').waitFor({ state: 'detached', timeout: 8000 });
  await page.waitForFunction(() => (
    window.monaco.editor.getModels()[0].getValue().includes('side: -1')
  ), null, { timeout: 15000 });
  const specEdited = await editorScript(page);
  check(`${label} spec confirm writes side -1`, specEdited.includes('side: -1'));
  check(`${label} spec confirm leaves the contour`, solveCall(specEdited) === solve, solveCall(specEdited).slice(0, 180));
  check(`${label} spec confirm keeps one hole`, (specEdited.match(/holesOnContour/g) || []).length === 1);
  check(`${label} spec confirm leaves the bar`, await barOnHole(page));

  await tapHole(page);
  await page.locator('[data-hole-edit-centres]').click();
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return !document.querySelector('[data-plane-editor]')
      && !!document.querySelector('[data-contour-tool="polyline"]')
      && sketch.entry === 'hole'
      && sketch.planeCard === false
      && (sketch.sketchLines || []).some((line) => line.dashed);
  }, null, { timeout: 8000 });
  await page.screenshot({ path: join(SHOT_DIR, `hole-edit-centres-${label}.png`) });
  await page.locator('[data-contour-confirm]').click();
  await page.locator('[data-contour-exit]').waitFor({ state: 'detached', timeout: 8000 });
  const centresEdited = await editorScript(page);
  check(`${label} centres confirm keeps one hole`, (centresEdited.match(/holesOnContour/g) || []).length === 1);
  check(`${label} centres confirm keeps the hole chip`, await page.locator('[data-feature-id="hole1"]').count() > 0);
  check(`${label} centres confirm leaves the bar`, await barOnHole(page));

  await tapHole(page);
  await page.locator('[data-feature-edit-delete]').click();
  await page.locator('[data-hole-card]').waitFor({ state: 'detached', timeout: 8000 });
  await page.waitForFunction(() => (
    !document.querySelector('[data-feature-id="hole1"]')
    && !!document.querySelector('[data-feature-id="contour:c1"]')
    && !window.monaco.editor.getModels()[0].getValue().includes('holesOnContour')
    && window.monaco.editor.getModels()[0].getValue().includes('role=centers')
  ), null, { timeout: 15000 });
  const deleted = await editorScript(page);
  check(`${label} delete removes the hole block only`,
    !deleted.includes('holesOnContour') && deleted.includes('role=centers'));
  await page.screenshot({ path: join(SHOT_DIR, `hole-edit-done-${label}.png`) });

  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('hole tap-to-edit: vite did not start');
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
  console.log(`hole tap-to-edit: ${failed} failed`);
  process.exit(1);
}
console.log('hole tap-to-edit: ok');
