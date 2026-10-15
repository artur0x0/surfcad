#!/usr/bin/env node
/**
 * Page-zoom lock in the CAD view.
 *
 * Viewport meta refuses browser page zoom. touch-action keeps a pinch on the
 * canvas and the side rails from becoming a page zoom, and keeps double-tap
 * zoom off buttons. iOS Safari ignores user-scalable, so document listeners
 * cancel gesture* and multi-touch moves that are not on the canvas. A
 * one-finger move in the Parts list is left alone. Every input on the loaded
 * phone page is at least 16px, including the part-name field.
 *
 * Prefers Playwright WebKit with an iPhone profile. This environment usually
 * has no WebKit binary, so it falls back to system Chrome with the same
 * iPhone 13 device descriptor (touch, mobile viewport, mobile UA). That is
 * emulation, not a device. Set CHROME_PATH to override Chrome.
 *
 * Screenshots, if any, go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* The evaluate callbacks run in the browser. eslint lints this file as Node. */
/* global document, window, Event, EventTarget, Touch, TouchEvent, getComputedStyle, performance */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chromium, webkit, devices } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5194);
const APP_URL = `http://127.0.0.1:${PORT}/`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const IPHONE = devices['iPhone 13'];

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('page zoom lock');

const viewportMeta = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const meta = (viewportMeta.match(/<meta name="viewport" content="([^"]*)"/) || [])[1] || '';
check('viewport meta locks scale and keeps viewport-fit=cover',
  meta.includes('width=device-width')
  && meta.includes('initial-scale=1')
  && meta.includes('maximum-scale=1')
  && meta.includes('user-scalable=no')
  && meta.includes('viewport-fit=cover'));

const lockSrc = readFileSync(new URL('../../src/utils/pageZoomLock.js', import.meta.url), 'utf8');
const viewportSrc = readFileSync(new URL('../../src/components/Viewport.jsx', import.meta.url), 'utf8');
check('lock cancels gesture events and off-canvas multi-touch',
  /gesturestart/.test(lockSrc)
  && /gesturechange/.test(lockSrc)
  && /gestureend/.test(lockSrc)
  && /touches\.length < 2/.test(lockSrc)
  && /passive: false/.test(lockSrc)
  && /touchTargetIsCanvas/.test(lockSrc));
check('viewport effect installs the lock and returns its cleanup',
  /installPageZoomLock\(canvas\)/.test(viewportSrc)
  && /return installPageZoomLock\(canvas\)/.test(viewportSrc));

function iphoneContextOptions() {
  if (!IPHONE) {
    return {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    };
  }
  const rest = { ...IPHONE };
  delete rest.defaultBrowserType;
  return rest;
}

async function launch() {
  const contextOptions = iphoneContextOptions();
  try {
    const browser = await webkit.launch({ headless: true });
    return { browser, engine: 'webkit', contextOptions };
  } catch (err) {
    const message = String(err && err.message ? err.message : err).split('\n')[0];
    console.log(`  WebKit binary unavailable (${message}). Chromium + iPhone 13 emulation.`);
    const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
    if (!exe) throw new Error('no system Chrome and no Playwright WebKit');
    const browser = await chromium.launch({
      executablePath: exe,
      args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
    });
    return { browser, engine: 'chromium-iphone-emulation', contextOptions };
  }
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
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let browser;
try {
  if (!await waitForServer()) {
    check('dev server started', false, `no response on ${APP_URL}`);
    process.exit(1);
  }
  check('dev server started', true);

  const launched = await launch();
  browser = launched.browser;
  console.log(`  engine: ${launched.engine}`);
  check('mobile engine is WebKit or Chromium iPhone emulation',
    launched.engine === 'webkit' || launched.engine === 'chromium-iphone-emulation');

  const context = await browser.newContext(launched.contextOptions);
  const page = await context.newPage();
  await page.addInitScript(() => {
    const counts = new WeakMap();
    const origAdd = EventTarget.prototype.addEventListener;
    const origRem = EventTarget.prototype.removeEventListener;
    function bump(target, type, delta) {
      let map = counts.get(target);
      if (!map) { map = {}; counts.set(target, map); }
      map[type] = (map[type] || 0) + delta;
    }
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      bump(this, type, 1);
      return origAdd.call(this, type, fn, opts);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, opts) {
      bump(this, type, -1);
      return origRem.call(this, type, fn, opts);
    };
    window.__listenerCounts = counts;
  });

  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }));

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const left = document.querySelector('[data-rail-pair="left"]');
    const right = document.querySelector('[data-rail-pair="right"]');
    const parts = document.querySelector('[data-parts-rows]');
    const button = document.querySelector('[data-zoom-to-fit]');
    return !!(canvas && left && right && parts && button);
  }, null, { timeout: 90000 });

  const report = await page.evaluate(() => {
    const touchAction = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      return getComputedStyle(el).touchAction;
    };

    function points(target, count) {
      const list = [];
      for (let i = 0; i < count; i++) {
        const x = 24 + i * 36;
        const y = 48 + i * 18;
        if (typeof Touch === 'function') {
          list.push(new Touch({ identifier: i + 1, target, clientX: x, clientY: y }));
        } else {
          list.push({ identifier: i + 1, target, clientX: x, clientY: y });
        }
      }
      return list;
    }

    function dispatchTouchMove(target, count) {
      const touches = points(target, count);
      let ev = null;
      if (typeof TouchEvent === 'function' && typeof Touch === 'function') {
        try {
          ev = new TouchEvent('touchmove', {
            bubbles: true,
            cancelable: true,
            touches,
            targetTouches: touches,
            changedTouches: touches,
          });
        } catch { ev = null; }
      }
      if (!ev) {
        ev = new Event('touchmove', { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'touches', { configurable: true, value: touches });
      }
      target.dispatchEvent(ev);
      return ev;
    }

    const gesture = {};
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
      gesture[type] = ev.defaultPrevented;
    }

    const right = document.querySelector('[data-rail-pair="right"]');
    const parts = document.querySelector('[data-parts-rows]');
    const canvas = document.querySelector('.viewport-shell > canvas');
    const twoFingerRail = dispatchTouchMove(right, 2).defaultPrevented;
    const twoFingerParts = dispatchTouchMove(parts, 2).defaultPrevented;
    const oneFingerParts = dispatchTouchMove(parts, 1).defaultPrevented;

    let canvasReached = false;
    let canvasPreventedBeforeControls = null;
    canvas.addEventListener('touchmove', (event) => {
      canvasReached = true;
      canvasPreventedBeforeControls = event.defaultPrevented;
    }, { capture: true, once: true });
    dispatchTouchMove(canvas, 2);

    const listeners = window.__listenerCounts.get(document) || {};
    const devClient = performance.getEntriesByType('resource').some((entry) => entry.name.includes('/@vite/client'));

    return {
      meta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
      shell: touchAction('.viewport-shell'),
      canvas: touchAction('.viewport-shell > canvas'),
      left: touchAction('[data-rail-pair="left"]'),
      right: touchAction('[data-rail-pair="right"]'),
      button: touchAction('[data-zoom-to-fit]'),
      gesture,
      twoFingerRail,
      twoFingerParts,
      oneFingerParts,
      canvasReached,
      canvasPreventedBeforeControls,
      listeners,
      devClient,
    };
  });

  check('page is the Vite dev build (StrictMode)', report.devClient);
  check('live viewport meta matches the lock',
    report.meta.includes('width=device-width')
    && report.meta.includes('initial-scale=1')
    && report.meta.includes('maximum-scale=1')
    && report.meta.includes('user-scalable=no')
    && report.meta.includes('viewport-fit=cover'),
    report.meta);
  check('viewer shell touch-action is none', report.shell === 'none', String(report.shell));
  check('canvas touch-action is none', report.canvas === 'none', String(report.canvas));
  check('left rail touch-action is pan-y (tool list still scrolls)', report.left === 'pan-y', String(report.left));
  check('right rail touch-action is none', report.right === 'none', String(report.right));
  check('sample button touch-action is manipulation', report.button === 'manipulation', String(report.button));
  check('gesturestart is defaultPrevented', report.gesture.gesturestart === true);
  check('gesturechange is defaultPrevented', report.gesture.gesturechange === true);
  check('gestureend is defaultPrevented', report.gesture.gestureend === true);
  check('two-finger touchmove on the right rail is defaultPrevented', report.twoFingerRail === true);
  check('two-finger touchmove in the Parts list is defaultPrevented', report.twoFingerParts === true);
  check('one-finger touchmove in the Parts list is not defaultPrevented', report.oneFingerParts === false);
  check('two-finger touchmove still reaches the canvas', report.canvasReached === true);
  check('page-zoom lock does not cancel the canvas touch', report.canvasPreventedBeforeControls === false,
    String(report.canvasPreventedBeforeControls));
  check('one gesturestart listener after StrictMode', report.listeners.gesturestart === 1,
    `gesturestart=${report.listeners.gesturestart}`);
  check('one gesturechange listener after StrictMode', report.listeners.gesturechange === 1,
    `gesturechange=${report.listeners.gesturechange}`);
  check('one gestureend listener after StrictMode', report.listeners.gestureend === 1,
    `gestureend=${report.listeners.gestureend}`);
  check('one document touchmove listener after StrictMode', report.listeners.touchmove === 1,
    `touchmove=${report.listeners.touchmove}`);

  await page.dblclick('[data-title-chip="button"][data-title-role="part"]');
  await page.waitForSelector('[data-title-chip="input"]', { timeout: 5000 });

  const fonts = await page.evaluate(() => {
    const fields = [...document.querySelectorAll('input, textarea, select')];
    return fields.map((el) => {
      const size = parseFloat(getComputedStyle(el).fontSize);
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        size,
        title: el.getAttribute('data-title-chip') || '',
        id: el.id || '',
        cls: (el.className && String(el.className).slice(0, 80)) || '',
      };
    });
  });
  const small = fonts.filter((field) => !(field.size >= 16));
  check('every input, textarea, and select is at least 16px', small.length === 0 && fonts.length > 0,
    small.length
      ? JSON.stringify(small)
      : `checked ${fonts.length}`);
} catch (err) {
  check('page zoom lock ran', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll page-zoom lock checks passed.');
