#!/usr/bin/env node
/**
 * Phone agent-chat tail. The tip's x stays within 2px of the Bot button
 * centre, and the tip does not touch the button. Checked at 390, and at
 * the other phone widths, after a resize and after the keyboard lift.
 *
 * DEV stub: `?agentPromptDemo=1&agentPromptState=chat`.
 */
/* global document, window, getComputedStyle */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4363);
const APP_URL = `http://127.0.0.1:${PORT}/?agentPromptDemo=1&agentPromptState=chat`;
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
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('agent prompt tail golden: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--logLevel', 'error'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const measure = (page) => page.evaluate(() => {
  const tip = document.querySelector('[data-agent-prompt-tail-tip]');
  const button = document.querySelector('[data-agent-chat-open]');
  const tail = document.querySelector('[data-agent-prompt-tail]');
  const prompt = document.querySelector('[data-agent-prompt]');
  const path = tail?.querySelector('path')?.getAttribute('d') || '';
  if (!tip || !button || !tail || !prompt) {
    return { ready: false, missing: { tip: !tip, button: !button, tail: !tail, prompt: !prompt } };
  }
  const tr = tip.getBoundingClientRect();
  const br = button.getBoundingClientRect();
  const pr = prompt.getBoundingClientRect();
  const buttonCx = br.left + br.width / 2;
  return {
    ready: tail.getAttribute('data-agent-prompt-tail-ready') === '1',
    tipX: tr.left,
    tipY: tr.top,
    buttonCx,
    buttonTop: br.top,
    buttonBottom: br.bottom,
    promptBottom: pr.bottom,
    dx: tr.left - buttonCx,
    gap: br.top - tr.top,
    width: window.innerWidth,
    compact: prompt.getAttribute('data-agent-prompt-compact'),
    pathDetour: /H [\d.]+ L [\d.]+ [\d.]+ L [\d.]+/.test(path),
    desktopTail: false,
  };
});

async function waitReady(page) {
  await page.waitForFunction(() => {
    const tail = document.querySelector('[data-agent-prompt-tail]');
    const button = document.querySelector('[data-agent-chat-open]');
    const tip = document.querySelector('[data-agent-prompt-tail-tip]');
    if (!tail || !button || !tip) return false;
    if (tail.getAttribute('data-agent-prompt-tail-ready') !== '1') return false;
    const br = button.getBoundingClientRect();
    return br.width > 8;
  }, null, { timeout: 20000 });
}

/** Viewport changes land after the CDP call returns. Poll until the tip has caught the button. */
async function waitAligned(page, width) {
  let last = null;
  const start = Date.now();
  while (Date.now() - start < 5000) {
    last = await measure(page);
    if (
      last
      && last.ready
      && last.width === width
      && Math.abs(last.dx) <= 2
      && last.gap > 0
    ) return last;
    await page.waitForTimeout(50);
  }
  return last;
}

function assertAligned(label, m) {
  check(
    `${label}: tip x is within 2px of the bot button centre`,
    m && m.ready && Math.abs(m.dx) <= 2,
    JSON.stringify(m),
  );
  check(
    `${label}: tip does not touch the button`,
    m && m.ready && m.gap > 0,
    JSON.stringify(m),
  );
}

console.log('agent prompt tail golden');
if (!(await waitForServer())) {
  console.log('  ❌ dev server did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});
attachConsentPresetToBrowser(browser);
const pageErrors = [];

const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});
page.on('pageerror', (err) => pageErrors.push(err.message));
await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.querySelector('[data-app-loading]') && !!document.querySelector('[data-agent-prompt]'), { timeout: 120000 });
await waitReady(page);
let m = await measure(page);
check('390: viewport width', m && m.width === 390, JSON.stringify(m && { width: m.width }));
check('390: compact prompt', m && m.compact === '1', JSON.stringify(m && { compact: m.compact }));
check('390: outline detours around the tip', m && m.pathDetour === true, JSON.stringify(m && { pathDetour: m.pathDetour }));
assertAligned('390', m);

for (const width of [320, 375, 430, 390]) {
  await page.setViewportSize({ width, height: 844 });
  m = await waitAligned(page, width);
  assertAligned(String(width), m);
}

await page.setViewportSize({ width: 700, height: 400 });
m = await waitAligned(page, 700);
assertAligned('rotation 700', m);

await page.setViewportSize({ width: 390, height: 844 });
await waitReady(page);
await page.evaluate(() => {
  document.querySelector('[data-agent-prompt]')?.style.setProperty('--agent-prompt-lift', '180px');
});
{
  const start = Date.now();
  while (Date.now() - start < 5000) {
    m = await measure(page);
    if (m && m.ready && Math.abs(m.dx) <= 2 && m.gap > 20) break;
    await page.waitForTimeout(50);
  }
}
assertAligned('keyboard lift', m);
check(
  'keyboard lift: the tip stays above the button',
  m && m.gap > 20,
  JSON.stringify(m && { gap: m.gap }),
);

const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
desktop.on('pageerror', (err) => pageErrors.push(err.message));
await desktop.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
await desktop.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await desktop.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await desktop.waitForFunction(() => !document.querySelector('[data-app-loading]') && !!document.querySelector('[data-agent-prompt]'), { timeout: 120000 });
await desktop.waitForTimeout(200);
const desk = await desktop.evaluate(() => ({
  tail: !!document.querySelector('[data-agent-prompt-tail]'),
  compact: document.querySelector('[data-agent-prompt]')?.getAttribute('data-agent-prompt-compact'),
  border: getComputedStyle(document.querySelector('[data-agent-prompt]')).borderTopWidth,
}));
check('desktop: no tail', desk && desk.tail === false && desk.compact === '0', JSON.stringify(desk));
check('desktop: rectangular border stays', desk && desk.border === '1px', JSON.stringify(desk));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`agent prompt tail golden: ${failed} failed`);
  process.exit(1);
}
console.log('agent prompt tail golden: all passed');
