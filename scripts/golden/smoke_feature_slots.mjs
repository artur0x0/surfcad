#!/usr/bin/env node
/**
 * Feature cards name saved contours.
 *
 * Insert Extrude opens a card titled Extrude. The profile slot picks c1
 * from the saved-contour list (the ghost id follows the hover). New contour
 * opens the plane card. X returns with c1 still in the slot. The rail
 * checkmark saves the next contour and returns to the same card with that
 * slot filled. Subtract and the edited distance survive the round trip.
 * Confirm writes that distance into the extrude block.
 *
 * Screenshots at 390 and 1280 go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window, Event */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5255);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = `const c1 = makeCrossSection({ center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileCircle(6, 24)); // @contour id=c1
let part = Manifold.cube([40, 30, 20], true);
return part;
`;

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

console.log('feature card slots (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('feature card slots: no system Chrome — set CHROME_PATH');
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
  await page.waitForFunction(() => {
    const model = window.monaco?.editor?.getModels?.()?.[0];
    return !!model && model.getValue().includes('@contour id=c1');
  }, null, { timeout: 8000 });
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

  const button = page.locator('button[aria-label^="Insert Extrude"]');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const card = page.locator('[data-feature-slot-card="makeExtrude"]');
  await card.waitFor({ timeout: 8000 });
  const title = (await page.locator('[data-feature-card-title]').innerText()).trim();
  check(`${label} card is titled Extrude`, title === 'Extrude', title);
  check(`${label} card has the distance slider and no contour radius`,
    await page.locator('[data-popup-number="radius"]').count() === 0
    && await page.locator('[data-popup-number="extrude-distance"]').count() === 1
    && await page.locator('[data-extrude-sense="negative"]').count() === 1);
  await page.evaluate(() => {
    const input = document.querySelector('[data-popup-number="extrude-distance"]');
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    const tracker = input._valueTracker;
    if (tracker) tracker.setValue(String(input.value));
    proto.set.call(input, '25');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => (
    document.querySelector('[data-popup-number="extrude-distance"]')?.value === '25'
  ), null, { timeout: 4000 });

  const row = page.locator('[data-slot-role="profile"] [data-slot-pick="c1"]');
  await row.hover();
  await page.waitForFunction(() => (
    document.querySelector('[data-feature-slot-card]')?.getAttribute('data-slot-hover') === 'c1'
  ), null, { timeout: 4000 });
  check(`${label} hover lights the saved contour`, true);
  await row.click();
  await page.waitForFunction(() => (
    document.querySelector('[data-slot-role="profile"] [data-slot-chip]')?.getAttribute('data-slot-chip') === 'c1'
  ), null, { timeout: 4000 });
  await page.locator('[data-contour-combine="subtract"]').click();

  await page.locator('[data-new-contour-role="profile"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  const planeTitle = (await page.locator('[data-feature-card-title]').innerText()).trim();
  check(`${label} New contour opens the plane card`, planeTitle === 'Contour', planeTitle);
  check(`${label} plane card says Select plane`,
    (await page.locator('[data-feature-card-confirm]').innerText()).includes('Select plane'));
  await page.locator('[data-contour-exit]').click();
  await card.waitFor({ timeout: 8000 });
  const afterX = await page.locator('[data-slot-role="profile"] [data-slot-chip]').getAttribute('data-slot-chip');
  check(`${label} X leaves the slot on c1`, afterX === 'c1', afterX || '');
  check(`${label} X keeps Subtract`,
    (await page.locator('[data-contour-combine="subtract"]').getAttribute('aria-pressed')) === 'true');
  check(`${label} X keeps the edited distance`,
    await page.locator('[data-popup-number="extrude-distance"]').inputValue() === '25');

  await page.locator('[data-new-contour-role="profile"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  await page.locator('[data-contour-confirm]').click();
  await card.waitFor({ timeout: 8000 });
  const filled = await page.locator('[data-slot-role="profile"] [data-slot-chip]').getAttribute('data-slot-chip');
  check(`${label} checkmark fills the slot with the new contour`, filled && filled !== 'c1', filled || '');
  check(`${label} the card is still Extrude`,
    (await page.locator('[data-feature-card-title]').innerText()).trim() === 'Extrude');
  check(`${label} Subtract survived the round trip`,
    (await page.locator('[data-contour-combine="subtract"]').getAttribute('aria-pressed')) === 'true');
  check(`${label} distance survived the round trip`,
    await page.locator('[data-popup-number="extrude-distance"]').inputValue() === '25');
  await page.screenshot({ path: join(SHOT_DIR, `feature-slots-${label}.png`) });

  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => !document.querySelector('[data-feature-slot-card]'), null, { timeout: 15000 });
  const script = await editorScript(page);
  check(`${label} Confirm names the new contour`, new RegExp(`makeExtrude\\(${filled}\\.contours, 25\\)`).test(script), filled);
  check(`${label} c1 stays in the script`, /@contour id=c1\b/.test(script));
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('feature card slots: vite did not start');
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
  console.log(`feature card slots: ${failed} failed`);
  process.exit(1);
}
console.log('feature card slots: ok');
