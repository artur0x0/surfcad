#!/usr/bin/env node
/**
 * Feature-card sliders.
 * A length slider is a shaped thumb (index 0…1000). Joint angle is linear,
 * −90…90, step 1. Checked at 390 and 1280 on a local dev server.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(). Never staging.
 */
/* global document */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5251);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const VIEWS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 800 },
];

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

console.log('feature-card sliders');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('feature sliders: no system Chrome — set CHROME_PATH');
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

function sliderOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      min: el.getAttribute('min'),
      max: el.getAttribute('max'),
      step: el.getAttribute('step'),
      curve: el.getAttribute('data-slider-curve'),
    };
  }, selector);
}

async function boot(browser, vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      authenticated: true,
      user: { id: 'user-ar', firstName: 'Artur', lastName: 'Ross', email: 'artur@example.com', vaultName: null },
    }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ githubAppClientId: 'Iv1.golden' }),
  }));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('button[aria-label^="Insert Fillet"]', { timeout: 40000 });
  return { context, page, errors };
}

async function openCard(page, label) {
  const prefix = label.endsWith(':') ? label : `${label}:`;
  await page.locator(`button[aria-label^="${prefix}"]`).click();
}

if (!(await waitForServer())) {
  stop();
  console.log('feature sliders: dev server did not start');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, headless: true });
attachConsentPresetToBrowser(browser);
try {
  for (const vp of VIEWS) {
    const { context, page, errors } = await boot(browser, vp);
    await openCard(page, 'Insert Fillet');
    await page.waitForSelector('[data-popup-slider="radius"]', { timeout: 8000 });
    const fillet = await sliderOf(page, '[data-popup-slider="radius"]');
    check(`${vp.name} fillet radius is a log thumb`,
      fillet && fillet.min === '0' && fillet.max === '1000' && fillet.step === '1' && fillet.curve === 'log',
      JSON.stringify(fillet));
    const radiusBox = await page.locator('[data-popup-number="radius"]').inputValue();
    check(`${vp.name} fillet default is 2 mm`, radiusBox === '2', radiusBox);
    await page.locator('[data-popup-number="radius"]').fill('40');
    await page.locator('[data-popup-number="radius"]').blur();
    const typed = await page.locator('[data-popup-number="radius"]').inputValue();
    const thumb = await page.locator('[data-popup-slider="radius"]').inputValue();
    check(`${vp.name} typed 40 mm is kept`, typed === '40', typed);
    check(`${vp.name} a typed 40 mm parks the thumb at the end`, thumb === '1000', thumb);
    const filletShot = join(SHOT_DIR, `feature-sliders-fillet-${vp.name}.png`);
    await page.screenshot({ path: filletShot });
    check(`${vp.name} fillet shot saved outside artifacts`,
      existsSync(filletShot) && !filletShot.startsWith('/opt/cursor/artifacts'), filletShot);
    await page.locator('[data-feature-card-cancel]').click();
    await page.waitForSelector('[data-edge-blend]', { state: 'detached', timeout: 8000 });

    await openCard(page, 'Insert Chamfer');
    await page.waitForSelector('[data-popup-slider="size"]', { timeout: 8000 });
    const chamfer = await sliderOf(page, '[data-popup-slider="size"]');
    check(`${vp.name} chamfer size is a log thumb`,
      chamfer && chamfer.min === '0' && chamfer.max === '1000' && chamfer.step === '1' && chamfer.curve === 'log',
      JSON.stringify(chamfer));
    const sizeBox = await page.locator('[data-popup-number="size"]').inputValue();
    check(`${vp.name} chamfer default is 2 mm`, sizeBox === '2', sizeBox);
    await page.locator('[data-feature-card-cancel]').click();
    await page.waitForSelector('[data-edge-blend]', { state: 'detached', timeout: 8000 });

    await openCard(page, 'Insert Move');
    await page.waitForSelector('[data-popup-slider="dx"]', { timeout: 8000 });
    const move = await sliderOf(page, '[data-popup-slider="dx"]');
    check(`${vp.name} move X is a shaped thumb`,
      move && move.min === '0' && move.max === '1000' && move.curve === 'shaped',
      JSON.stringify(move));

    await page.locator('[data-feature-card-cancel]').click();
    await page.waitForSelector('[data-move-mode]', { state: 'detached', timeout: 8000 });

    await page.locator('[data-joints-button]').click();
    await page.waitForSelector('[data-joint-card]', { timeout: 8000 });
    await page.locator('[data-sticky-property="angle"]').click();
    await page.waitForSelector('[data-joint-angle-slider]', { timeout: 8000 });
    const angle = await sliderOf(page, '[data-joint-angle-slider]');
    check(`${vp.name} joint angle is ±90° at 1°`,
      angle && angle.min === '-90' && angle.max === '90' && angle.step === '1' && !angle.curve,
      JSON.stringify(angle));
    const number = await page.locator('[data-joint-angle]').inputValue();
    check(`${vp.name} joint angle box is degrees`, number === '0' || number === '', JSON.stringify(number));

    await page.locator('[data-sticky-property="distance"]').click();
    await page.waitForSelector('[data-popup-slider="joint-distance"]', { timeout: 8000 });
    const distance = await sliderOf(page, '[data-popup-slider="joint-distance"]');
    check(`${vp.name} joint distance is a shaped thumb`,
      distance && distance.min === '0' && distance.max === '1000' && distance.curve === 'shaped',
      JSON.stringify(distance));
    const jointShot = join(SHOT_DIR, `feature-sliders-joint-${vp.name}.png`);
    await page.screenshot({ path: jointShot });
    check(`${vp.name} joint shot saved outside artifacts`,
      existsSync(jointShot) && !jointShot.startsWith('/opt/cursor/artifacts'), jointShot);
    check(`${vp.name} no page errors`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`\nfeature sliders: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nfeature sliders: all checks passed');
process.exit(0);
