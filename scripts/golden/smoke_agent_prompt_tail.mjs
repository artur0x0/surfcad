#!/usr/bin/env node
/**
 * Phone agent-chat tail. The tip's x stays within 2px of the Bot button
 * centre, and the tip does not touch the button. Checked at 390, and at
 * the other phone widths, after a resize and after the keyboard lift.
 *
 * The pane always has a visible border (the measured outline, or the CSS
 * border before a measurement), never a clip-path over the glass, and it
 * paints above the feature strip when the keyboard lifts it that high.
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
  const path = tail?.querySelector('[data-agent-prompt-outline]')?.getAttribute('d') || '';
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

// The pane's border. With the tail measured, one outline path runs around
// the box and the tail in the outline token and the CSS border is
// transparent (no line across the tail base). The glass is a plain rounded
// box: no clip-path, which Safari does not apply to a backdrop-filter.
const OUTLINE = 'rgb(107, 114, 128)';
const chrome = (page_) => page_.evaluate(() => {
  const tail = document.querySelector('[data-agent-prompt-tail]');
  const fill = tail?.querySelector('[data-agent-prompt-bubble]');
  const outline = tail?.querySelector('[data-agent-prompt-outline]');
  const tailFill = tail?.querySelector('.agent-prompt-bubble-tail-fill');
  const svg = outline?.ownerSVGElement;
  const prompt = document.querySelector('[data-agent-prompt]');
  if (!tail || !fill || !outline || !svg || !prompt) return null;
  const fs = getComputedStyle(fill);
  const os = getComputedStyle(outline);
  const pr = prompt.getBoundingClientRect();
  const fr = fill.getBoundingClientRect();
  const or = outline.getBoundingClientRect();
  return {
    ready: tail.getAttribute('data-agent-prompt-tail-ready'),
    shape: tail.getAttribute('data-agent-prompt-tail-shape'),
    borderWidth: fs.borderTopWidth,
    borderColor: fs.borderTopColor,
    radius: fs.borderTopLeftRadius,
    clip: fs.clipPath,
    fillBg: fs.backgroundColor,
    fillMatchesPrompt: Math.abs(fr.width - pr.width) <= 1 && Math.abs(fr.height - pr.height) <= 1,
    svgVisible: getComputedStyle(svg).visibility,
    stroke: os.stroke,
    strokeWidth: os.strokeWidth,
    outlineWidth: or.width,
    outlineBelowBox: or.bottom - pr.bottom,
    tailFillD: tailFill?.getAttribute('d') || '',
    viewBox: svg.getAttribute('viewBox'),
  };
});
await page.evaluate(() => {
  document.querySelector('[data-agent-prompt]')?.style.removeProperty('--agent-prompt-lift');
  window.dispatchEvent(new window.Event('resize'));
});
await waitReady(page);
m = await waitAligned(page, 390);
let c = await chrome(page);
check(
  'measured: the outline path is the border, in the outline token, around the box and the tail',
  c && c.ready === '1' && c.shape === 'tail' && c.svgVisible === 'visible' && c.stroke === OUTLINE
    && parseFloat(c.strokeWidth) >= 1 && c.outlineWidth >= 200 && c.outlineBelowBox >= 4,
  JSON.stringify(c),
);
check(
  'measured: the CSS border is transparent, so no line crosses the tail base',
  c && c.borderWidth === '1px' && /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/.test(c.borderColor),
  JSON.stringify(c && { borderColor: c.borderColor, borderWidth: c.borderWidth }),
);
check(
  'the glass is a plain rounded box the size of the prompt: no clip-path, no viewBox scaling',
  c && c.clip === 'none' && c.radius === '16px' && c.fillMatchesPrompt === true && c.viewBox == null
    && /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+ Z$/.test(c.tailFillD),
  JSON.stringify(c && { clip: c.clip, radius: c.radius, fillMatchesPrompt: c.fillMatchesPrompt, viewBox: c.viewBox, tailFillD: c.tailFillD }),
);

// Before any measurement (or if the measure never lands) the pane is the
// CSS box: glass fill and a visible border, with the SVG hidden.
const unmeasured = await page.evaluate(() => {
  const tail = document.querySelector('[data-agent-prompt-tail]');
  const fill = tail.querySelector('[data-agent-prompt-bubble]');
  const svg = tail.querySelector('svg');
  const was = tail.getAttribute('data-agent-prompt-tail-ready');
  tail.setAttribute('data-agent-prompt-tail-ready', '0');
  const fs = getComputedStyle(fill);
  const out = {
    borderWidth: fs.borderTopWidth,
    borderColor: fs.borderTopColor,
    borderBottom: fs.borderBottomColor,
    fillBg: fs.backgroundColor,
    visibility: fs.visibility,
    svg: getComputedStyle(svg).visibility,
  };
  tail.setAttribute('data-agent-prompt-tail-ready', was);
  return out;
});
check(
  'not measured: rectangular glass with a visible border on every side',
  unmeasured && unmeasured.borderWidth === '1px' && unmeasured.borderColor === OUTLINE && unmeasured.borderBottom === OUTLINE
    && unmeasured.visibility === 'visible' && unmeasured.svg === 'hidden'
    && !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(unmeasured.fillBg),
  JSON.stringify(unmeasured),
);

// Keyboard up: the chat is lifted over the feature strip. It must paint
// above the strip (and every other piece of viewer chrome), and stay under
// the modal layer.
const stacking = await page.evaluate(async () => {
  const prompt = document.querySelector('[data-agent-prompt]');
  const strip = document.querySelector('[data-cad-feature-strip]');
  if (!prompt || !strip) return { missing: { prompt: !prompt, strip: !strip } };
  const sr = strip.getBoundingClientRect();
  const before = prompt.getBoundingClientRect();
  const lift = Math.max(0, before.top - sr.top + 12);
  prompt.style.setProperty('--agent-prompt-lift', `${lift}px`);
  await new Promise((r) => setTimeout(r, 400));
  const pr = prompt.getBoundingClientRect();
  const top = Math.max(pr.top, sr.top);
  const bottom = Math.min(pr.bottom, sr.bottom);
  const covered = [];
  for (let i = 1; i <= 7; i += 1) {
    const x = pr.left + (pr.width * i) / 8;
    const y = top + (bottom - top) / 2;
    const hit = document.elementFromPoint(x, y);
    covered.push(!!hit && prompt.contains(hit));
  }
  const out = {
    overlap: Math.round(bottom - top),
    covered,
    promptZ: Number(getComputedStyle(prompt).zIndex),
    stripZ: Number(getComputedStyle(strip).zIndex),
    pillZ: Number(getComputedStyle(document.querySelector('[data-agent-chat-open]')?.closest('[class*="z-"]') || document.body).zIndex) || null,
  };
  prompt.style.removeProperty('--agent-prompt-lift');
  return out;
});
check(
  'lifted over the feature strip, the chat paints on top of it',
  stacking && stacking.overlap >= 10 && stacking.covered.every(Boolean),
  JSON.stringify(stacking),
);
check(
  'chat z-order: above the feature strip and the stage pill, under the modal layer (z-50)',
  stacking && stacking.promptZ > stacking.stripZ && stacking.promptZ > 30 && stacking.promptZ < 40,
  JSON.stringify(stacking),
);
await page.waitForTimeout(300);
await waitReady(page);

// The tail cannot be placed (no Bot button). The glass fill must stay as
// a rounded rectangle. This is the phone bug where the text floated.
await page.evaluate(() => {
  const button = document.querySelector('[data-agent-chat-open]');
  if (button) button.style.display = 'none';
  window.dispatchEvent(new window.Event('resize'));
});
await page.waitForFunction(() => {
  const tail = document.querySelector('[data-agent-prompt-tail]');
  return tail?.getAttribute('data-agent-prompt-tail-shape') === 'box'
    && tail.getAttribute('data-agent-prompt-tail-ready') === '1';
}, null, { timeout: 5000 });
const box = await page.evaluate(() => {
  const tail = document.querySelector('[data-agent-prompt-tail]');
  const fill = tail?.querySelector('.agent-prompt-bubble-fill');
  const outline = tail?.querySelector('[data-agent-prompt-outline]');
  const path = outline?.getAttribute('d') || '';
  const user = document.querySelector('.agent-prompt-msg--user');
  return {
    shape: tail?.getAttribute('data-agent-prompt-tail-shape') || '',
    ready: tail?.getAttribute('data-agent-prompt-tail-ready') || '',
    visibility: tail ? getComputedStyle(tail).visibility : '',
    stroke: outline ? getComputedStyle(outline).stroke : '',
    tailFill: tail?.querySelector('.agent-prompt-bubble-tail-fill')?.getAttribute('d') || '',
    fill: fill ? getComputedStyle(fill).backgroundColor : '',
    pathDetour: /H [\d.]+ L [\d.]+ [\d.]+ L [\d.]+/.test(path),
    userClass: user?.className || '',
    userFill: user ? getComputedStyle(user).backgroundColor : '',
  };
});
const opaque = (color) => typeof color === 'string' && color.length > 0 && !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(color);
check(
  'no button: rectangular glass fill stays',
  box && box.shape === 'box' && box.ready === '1' && box.visibility !== 'hidden' && opaque(box.fill) && box.pathDetour === false,
  JSON.stringify(box),
);
check(
  'no button: the border stays (the outline path around the box, no tail fill)',
  box && box.stroke === OUTLINE && box.tailFill === '',
  JSON.stringify(box),
);
check(
  'user row keeps a surface fill',
  box && /surface-panel/.test(box.userClass) && opaque(box.userFill),
  JSON.stringify(box),
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
