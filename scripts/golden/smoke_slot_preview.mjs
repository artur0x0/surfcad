#!/usr/bin/env node
/**
 * Slot-card preview and orbit at 390 and 1280.
 *
 * New contour, Select plane, then the rail checkmark returns to Extrude.
 * The extrude preview mesh is in the scene. A one-finger drag on the canvas
 * above that card rotates the camera.
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

const PORT = Number(process.env.SMOKE_PORT || 5296);
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

console.log('slot preview and orbit (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('slot preview: no system Chrome — set CHROME_PATH');
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

function quatDelta(a, b) {
  if (!a?.quaternion || !b?.quaternion || a.quaternion.length < 4 || b.quaternion.length < 4) return Infinity;
  let d = 0;
  for (let i = 0; i < 4; i += 1) d = Math.max(d, Math.abs(a.quaternion[i] - b.quaternion[i]));
  return d;
}

async function boot(page) {
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.addInitScript(() => { window.__SURFCAD_NO_TUTORIAL = true; });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    return !!(canvas && canvas.clientWidth > 0 && window.__VIEWPORT__?.ready?.() && window.__MANIFOLD_CONTEXT__?.isReady);
  }, null, { timeout: 90000 });
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function touchDrag(client, from, to) {
  const steps = 8;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, id: 1 }],
  });
  for (let i = 1; i <= steps; i += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
        id: 1,
      }],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
  await boot(page);

  const button = page.locator('button[aria-label^="Insert Extrude"]');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const card = page.locator('[data-feature-slot-card="makeExtrude"]');
  await card.waitFor({ timeout: 8000 });
  await page.locator('[data-new-contour-role="profile"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  await page.locator('[data-contour-confirm]').click();
  await card.waitFor({ timeout: 8000 });
  await page.waitForFunction(() => {
    const names = window.__VIEWPORT__.stageContourOverlays()?.names || [];
    return names.includes('contourExtrudePreview') || names.includes('contourExtrudePreviewGroup');
  }, null, { timeout: 8000 });
  const names = await page.evaluate(() => window.__VIEWPORT__.stageContourOverlays().names);
  check(`${label} extrude preview mesh exists`,
    names.includes('contourExtrudePreview') && names.includes('contourExtrudePreviewGroup'),
    names.join(','));
  await page.waitForTimeout(400);

  const start = await page.evaluate(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const rect = canvas?.getBoundingClientRect();
    const cardBox = document.querySelector('[data-feature-card]')?.getBoundingClientRect();
    if (!rect || !cardBox) return null;
    const x = rect.left + rect.width * 0.5;
    const y = Math.min(cardBox.top - 36, rect.top + rect.height * 0.32);
    const el = document.elementFromPoint(x, y);
    return {
      x, y, tag: el ? el.tagName : '', above: y < cardBox.top - 8, cardTop: cardBox.top,
    };
  });
  check(`${label} drag starts on the canvas above the card`,
    !!start && start.tag === 'CANVAS' && start.above, JSON.stringify(start));
  const before = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  if (start?.tag === 'CANVAS') {
    await touchDrag(client, start, { x: start.x + 120, y: start.y + 28 });
    await page.waitForTimeout(80);
  }
  const after = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  const delta = quatDelta(before, after);
  console.log(`  ${label} orbit quat ${delta.toFixed(4)}`);
  check(`${label} one-finger drag orbits with the card open`, delta > 0.02, `Δq ${delta}`);
  const still = await page.evaluate(() => window.__VIEWPORT__.stageContourOverlays().names);
  check(`${label} preview mesh stays after the drag`,
    still.includes('contourExtrudePreview'), still.join(','));
  await page.screenshot({ path: join(SHOT_DIR, `slot-preview-${label}.png`) });
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('slot preview: vite did not start');
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
    hasTouch: true,
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
  console.log(`slot preview: ${failed} failed`);
  process.exit(1);
}
console.log('slot preview: ok');
