#!/usr/bin/env node
/**
 * Helper-sheet sliders.
 * A length slider is a shaped thumb. Counts stay linear. Seeds scale from
 * the static L=100 numbers by the part's characteristic length.
 * Checked at 390 and 1280 on a local dev server. Never staging.
 */
/* global document */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5252);
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

console.log('helper-sheet sliders');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('helper sliders: no system Chrome — set CHROME_PATH');
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

function scaled(staticDefault, lengthMm) {
  return Math.round(staticDefault * (lengthMm / 100) * 100) / 100;
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
  await page.waitForSelector('button[aria-label^="Insert Cube:"]', { timeout: 40000 });
  return { context, page, errors };
}

async function openCard(page, label) {
  const prefix = label.endsWith(':') ? label : `${label}:`;
  await page.locator(`button[aria-label^="${prefix}"]`).click();
}

async function closeCard(page) {
  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForSelector('[data-helper-param]', { state: 'detached', timeout: 8000 });
}

if (!(await waitForServer())) {
  stop();
  console.log('helper sliders: dev server did not start');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, headless: true });
attachConsentPresetToBrowser(browser);
try {
  for (const vp of VIEWS) {
    const { context, page, errors } = await boot(browser, vp);
    await openCard(page, 'Insert Cube');
    await page.waitForSelector('[data-helper-param="cube"]', { timeout: 8000 });
    const lengthMm = Number(await page.locator('[data-helper-param="cube"]').getAttribute('data-helper-length'));
    check(`${vp.name} helper length is a positive millimetre`, lengthMm > 0, String(lengthMm));
    const width = await sliderOf(page, '[data-popup-slider="width"]');
    check(`${vp.name} cube width is a shaped thumb`,
      width && width.min === '0' && width.max === '1000' && width.step === '1' && width.curve === 'shaped',
      JSON.stringify(width));
    const widthNum = Number(await page.locator('[data-popup-number="width"]').inputValue());
    check(`${vp.name} cube width seed scales from 40`,
      widthNum === scaled(40, lengthMm), `${widthNum} at L=${lengthMm}`);
    const pose = await sliderOf(page, '[data-popup-slider="x"]');
    check(`${vp.name} pose X is a shaped thumb`,
      pose && pose.min === '0' && pose.max === '1000' && pose.curve === 'shaped',
      JSON.stringify(pose));
    const cubeShot = join(SHOT_DIR, `helper-sliders-cube-${vp.name}.png`);
    await page.screenshot({ path: cubeShot });
    check(`${vp.name} cube shot saved outside artifacts`,
      existsSync(cubeShot) && !cubeShot.startsWith('/opt/cursor/artifacts'), cubeShot);
    await closeCard(page);

    await openCard(page, 'Insert Round box');
    await page.waitForSelector('[data-popup-slider="segments"]', { timeout: 8000 });
    const segments = await sliderOf(page, '[data-popup-slider="segments"]');
    check(`${vp.name} round-box segments stay linear 1…64`,
      segments && segments.min === '1' && segments.max === '64' && segments.step === '1' && !segments.curve,
      JSON.stringify(segments));
    await closeCard(page);

    await openCard(page, 'Insert Array');
    await page.waitForSelector('[data-popup-slider="sx"]', { timeout: 8000 });
    const spacing = await sliderOf(page, '[data-popup-slider="sx"]');
    check(`${vp.name} array spacing is a shaped thumb`,
      spacing && spacing.min === '0' && spacing.max === '1000' && spacing.curve === 'shaped',
      JSON.stringify(spacing));
    const spacingNum = Number(await page.locator('[data-popup-number="sx"]').inputValue());
    check(`${vp.name} array spacing seed scales from 45`,
      spacingNum === scaled(45, lengthMm), `${spacingNum} at L=${lengthMm}`);
    const arrayShot = join(SHOT_DIR, `helper-sliders-array-${vp.name}.png`);
    await page.screenshot({ path: arrayShot });
    check(`${vp.name} array shot saved outside artifacts`,
      existsSync(arrayShot) && !arrayShot.startsWith('/opt/cursor/artifacts'), arrayShot);
    check(`${vp.name} no page errors`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`\nhelper sliders: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nhelper sliders: all checks passed');
process.exit(0);
