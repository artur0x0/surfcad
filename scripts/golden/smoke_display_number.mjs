#!/usr/bin/env node
/**
 * Calculated numbers show at most 4 decimals. 390 and 1280.
 * Echoing the chamfer size does not rewrite the script.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global window, document, HTMLInputElement, Event */
import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createServer as createVite } from 'vite';

const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
mkdirSync(shotDir, { recursive: true });

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

if (String(shotDir).startsWith('/opt/cursor/artifacts')) {
  console.log(`  ❌ screenshots must not use /opt/cursor/artifacts (${shotDir})`);
  process.exit(1);
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('  ❌ system Chrome is required');
  process.exit(1);
}

const htmlFor = (compact) => `<!doctype html><meta charset="utf-8">
<div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module">
import '/src/index.css';
import { renderDisplayNumberShot } from '/scripts/golden/display_number_shot.js';
renderDisplayNumberShot(document.getElementById('root'), { compact: ${compact ? 'true' : 'false'} });
window.__READY__ = true;
</script>`;

const vite = await createVite({
  root: new URL('../..', import.meta.url).pathname,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
const server = createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url.startsWith('/?')) {
    const compact = url.includes('compact=1');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(htmlFor(compact));
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end('no');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader'],
});
attachConsentPresetToBrowser(browser);

function tooManyDecimals(text) {
  return /\d+\.\d{5,}/.test(String(text || ''));
}

async function readFields(page) {
  return page.evaluate(() => {
    const valueOf = (id) => document.querySelector(`[data-popup-number="${id}"]`)?.value ?? '';
    return {
      size: valueOf('size'),
      offset: valueOf('offset'),
      angle: valueOf('angle'),
      hole: valueOf('hole'),
      inch: valueOf('inch'),
      readout: document.querySelector('[data-display-readout="length"]')?.textContent ?? '',
      script: window.__SCRIPT__,
      touched: window.__TOUCHED__ === true,
    };
  });
}

async function echoSize(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-popup-number="size"]');
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    desc.set.call(el, el.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      script: window.__SCRIPT__,
      touched: window.__TOUCHED__ === true,
      value: el.value,
    };
  });
}

async function pass(name, width, height, compact) {
  console.log(`\ndisplay numbers — ${name}`);
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30000 });
  await page.waitForSelector('[data-popup-number="size"]');
  const fields = await readFields(page);
  check(`${name} chamfer size is 0.0039 in`, fields.size === '0.0039', fields.size);
  check(`${name} offset is 4 decimals`, fields.offset === '0.3986', fields.offset);
  check(`${name} angle trims float noise`, fields.angle === '90', fields.angle);
  check(`${name} hole diameter is 4 decimals`, fields.hole === '0.1654', fields.hole);
  check(`${name} exact inch trims trailing zeros`, fields.inch === '1', fields.inch);
  check(`${name} readout trims the same way`, fields.readout === '0.0039 in', fields.readout);
  check(`${name} no field shows float noise`, [fields.size, fields.offset, fields.angle, fields.hole, fields.inch, fields.readout].every((text) => !tooManyDecimals(text)), JSON.stringify(fields));
  check(`${name} displaying the card did not rewrite the script`, fields.touched === false && fields.script.includes('0.1'), fields.script);
  const echoed = await echoSize(page);
  check(`${name} echoing the size does not rewrite the script`, echoed.touched === false && echoed.script.includes('0.1') && echoed.value === '0.0039', JSON.stringify(echoed));
  const shot = join(shotDir, `display-number-${name}.png`);
  await page.screenshot({ path: shot });
  check(`${name} shot saved outside artifacts`, existsSync(shot) && !shot.includes('/opt/cursor/artifacts'), shot);
  if (errors.length) check(`${name} page has no errors`, false, errors.join(' | '));
  await page.close();
}

try {
  await pass('390', 390, 844, true);
  await pass('1280', 1280, 900, false);
} finally {
  await browser.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ndisplay numbers ok');
