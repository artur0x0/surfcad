#!/usr/bin/env node
/**
 * Sheet-metal and cross-section sliders.
 * Length thumbs are shaped. The base thumb reaches 1200 mm. Seeds follow
 * the part length, then the SKU floor. The section thumb continues past
 * the box. Gauge numbers stay on the picker. The unit toggle writes the
 * global display unit.
 * Checked at 390 and 1280 on a local dev server. Never staging.
 */
/* global document, window, Event */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { newPartStarterScript } from '../../src/utils/helperPaletteSnippets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.SMOKE_PORT || 5254);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const VIEWS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 800 },
];
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
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

console.log('sheet-metal and section sliders');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('sheet sliders: no system Chrome — set CHROME_PATH');
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

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((el, next) => {
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    proto.set.call(el, String(next));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

if (!(await waitForServer())) {
  stop();
  console.log('sheet sliders: dev server did not start');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, headless: true });
attachConsentPresetToBrowser(browser);
try {
  for (const vp of VIEWS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.route('**/api/auth/me', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: false }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ githubAppClientId: 'Iv1.golden' }),
    }));
    await page.route('**/sendcutsend-catalog*.json', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: catalog,
    }));
    await page.route('**/sendcutsend-specs*.json', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: specs,
    }));
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('button[aria-label^="Insert Cube:"]', { timeout: 40000 });
    await page.waitForFunction(() => window.monaco?.editor?.getModels?.()?.length > 0, null, { timeout: 30000 });
    await page.evaluate((text) => {
      const model = window.monaco.editor.getModels()[0];
      if (!model.getValue().trim()) model.setValue(text);
      document.querySelector('button[aria-label="Run script"]')?.click();
    }, newPartStarterScript());
    await page.waitForFunction(() => {
      const run = document.querySelector('[data-cad-run]');
      return !run || run.getAttribute('data-cad-run') !== 'running';
    }, null, { timeout: 60000 });
    await page.evaluate(() => document.querySelector('button[title="Enable Cross Section"]')?.click());
    await page.waitForSelector('[data-section-offset]', { timeout: 8000 });
    const section = await sliderOf(page, '[data-section-offset]');
    check(`${vp.name} section position is a shaped thumb`,
      section && section.min === '0' && section.max === '1000' && section.step === '1' && section.curve === 'shaped',
      JSON.stringify(section));
    const sectionShot = join(SHOT_DIR, `sheet-sliders-section-${vp.name}.png`);
    await page.screenshot({ path: sectionShot });
    check(`${vp.name} section shot saved outside artifacts`,
      existsSync(sectionShot) && !sectionShot.startsWith('/opt/cursor/artifacts'), sectionShot);
    await page.locator('[data-cross-section-dismiss]').evaluate((el) => el.click());

    await page.locator('[data-sheet-metal-button]').click();
    await page.waitForSelector('[data-sheet-metal-picker]', { timeout: 10000 });
    await page.waitForFunction(() => [...document.querySelectorAll('#sm-material option')].some((o) => o.value), null, { timeout: 15000 });
    await page.selectOption('#sm-material', { label: '5052 H32 Aluminum' });
    await page.waitForFunction(() => {
      const gauge = document.querySelector('#sm-gauge option[value="ALU-090"]');
      return !!(gauge && !gauge.disabled);
    }, null, { timeout: 10000 });
    const gaugeText = await page.locator('#sm-gauge option[value="ALU-090"]').textContent();
    check(`${vp.name} gauge number stays on the picker`, /ga/.test(gaugeText || ''), gaugeText || '');
    await page.selectOption('#sm-gauge', 'ALU-090');
    await page.locator('[data-sheet-metal-start]').click();
    await page.waitForSelector('[data-sheet-metal-step="plane"]', { timeout: 15000 });
    await page.locator('[data-sm-plane="XY"]').click();
    await page.waitForSelector('[data-sheet-metal-base]', { timeout: 10000 });

    const lengthMm = Number(await page.locator('[data-sheet-metal-base]').getAttribute('data-sheet-length'));
    check(`${vp.name} sheet length is a positive millimetre`, lengthMm > 0, String(lengthMm));
    const width = await sliderOf(page, '[data-sm-slider="sm-base-x"]');
    check(`${vp.name} base X is a shaped thumb`,
      width && width.min === '0' && width.max === '1000' && width.step === '1' && width.curve === 'shaped',
      JSON.stringify(width));
    const widthNum = Number(await page.locator('[data-sm-number="sm-base-x"]').inputValue());
    const heightNum = Number(await page.locator('[data-sm-number="sm-base-y"]').inputValue());
    const expectW = Math.round(Math.max(lengthMm, 1.5 * 25.4) * 100) / 100;
    const expectH = Math.round(Math.max(0.6 * lengthMm, 0.375 * 25.4) * 100) / 100;
    check(`${vp.name} base seeds follow L then the SKU floor`,
      near(widthNum, expectW) && near(heightNum, expectH),
      `got ${widthNum}×${heightNum}, want ${expectW}×${expectH} at L=${lengthMm}`);
    const baseShot = join(SHOT_DIR, `sheet-sliders-base-${vp.name}.png`);
    await page.screenshot({ path: baseShot });
    check(`${vp.name} base shot saved outside artifacts`,
      existsSync(baseShot) && !baseShot.startsWith('/opt/cursor/artifacts'), baseShot);
    await setRange(page, '[data-sm-slider="sm-base-x"]', 1000);
    const atEnd = Number(await page.locator('[data-sm-number="sm-base-x"]').inputValue());
    check(`${vp.name} base thumb reaches 1200 mm`, near(atEnd, 1200, 0.2), String(atEnd));

    await page.locator('[data-sm-unit="in"]').click();
    const stored = await page.evaluate(() => ({
      global: window.localStorage.getItem('surfcad.displayUnit'),
      sheet: window.localStorage.getItem('surfcad.sheetMetal.displayUnit'),
    }));
    check(`${vp.name} inch toggle writes the global unit only`,
      stored.global === 'in' && stored.sheet == null, JSON.stringify(stored));
    const inchWidth = Number(await page.locator('[data-sm-number="sm-base-x"]').inputValue());
    check(`${vp.name} base width converts to inches`, near(inchWidth, 1200 / 25.4, 0.02), String(inchWidth));
    check(`${vp.name} no page errors`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`\nsheet sliders: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nsheet sliders: all checks passed');
process.exit(0);
