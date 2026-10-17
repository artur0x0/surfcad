#!/usr/bin/env node
/**
 * Safari desktop trackpad pinch → camera zoom (gesture*), without page zoom.
 * Chromium ctrlKey wheel pinch is unchanged.
 *
 * Real Mac trackpad verification still needs Artur; this uses synthetic events.
 */
/* global document, window, Event, WheelEvent */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5195);
const APP_URL = `http://127.0.0.1:${PORT}/`;

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
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('viewport safari gesture zoom');

const gestureSrc = readFileSync(new URL('../../src/utils/viewportGestureZoom.js', import.meta.url), 'utf8');
const viewportSrc = readFileSync(new URL('../../src/components/Viewport.jsx', import.meta.url), 'utf8');
const lockSrc = readFileSync(new URL('../../src/utils/pageZoomLock.js', import.meta.url), 'utf8');

check('viewport installs gesture zoom on the canvas',
  /installViewportGestureZoom\(canvas/.test(viewportSrc));
check('page zoom lock skips canvas gestures on desktop',
  /documentShouldPreventCanvasGesture/.test(lockSrc)
  && /touchTargetIsCanvas/.test(lockSrc));
check('gesture scale maps to a zoom factor', /gestureScaleToZoomFactor/.test(gestureSrc));

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
  try { server.kill('SIGKILL'); } catch { /* gone */ }
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

async function waitForServer(timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('vite did not start');
}

function orbitFindInitScript() {
  return () => {
    window.__surfcadFindOrbit = function () {
      const root = document.getElementById('root');
      if (!root) return null;
      const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
      if (!key) return null;
      const start = root[key].current || root[key];
      const seen = new Set();
      let controls = null;
      let bestArea = -1;
      function walk(fiber) {
        if (!fiber || seen.has(fiber)) return;
        seen.add(fiber);
        let hook = fiber.memoizedState;
        for (let g = 0; hook && g < 800; g++) {
          const c = hook.memoizedState && hook.memoizedState.current;
          if (c && typeof c.rotateSpeed === 'number' && c.object && c.object.isCamera && c.domElement) {
            const area = c.domElement.clientWidth * c.domElement.clientHeight;
            if (area > bestArea) {
              controls = c;
              bestArea = area;
            }
          }
          hook = hook.next;
        }
        walk(fiber.child);
        walk(fiber.sibling);
      }
      walk(start);
      return controls ? { controls } : null;
    };
  };
}

async function runChromium() {
  const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!exe) {
    console.log('  Chromium unavailable — static checks only');
    return;
  }
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(orbitFindInitScript());
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }));
  await page.goto(APP_URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => {
    const found = window.__surfcadFindOrbit?.();
    const canvas = found && found.controls && found.controls.domElement;
    return !!(canvas && canvas.clientWidth > 0 && window.__VIEWPORT__);
  }, null, { timeout: 60000 });

  const wheel = await page.evaluate(() => {
    const found = window.__surfcadFindOrbit();
    const controls = found.controls;
    const camera = controls.object;
    const before = camera.position.distanceTo(controls.target);
    const ev = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -120,
      ctrlKey: true,
    });
    controls.domElement.dispatchEvent(ev);
    for (let i = 0; i < 3; i += 1) controls.update();
    const after = camera.position.distanceTo(controls.target);
    return { before, after, zoomed: after < before - 1e-6 };
  });
  check('ctrlKey wheel still dollies the camera in Chromium', wheel.zoomed,
    JSON.stringify(wheel));
  await browser.close();
}

async function runWebKitGesture() {
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
  } catch (err) {
    console.log(`  WebKit unavailable (${String(err?.message || err).split('\n')[0]}) — skip gesture simulation`);
    return;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(orbitFindInitScript());
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { get: () => 0, configurable: true });
  });
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }));
  await page.goto(APP_URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => {
    const found = window.__surfcadFindOrbit?.();
    const canvas = found && found.controls && found.controls.domElement;
    return !!(canvas && canvas.clientWidth > 0 && window.__VIEWPORT__);
  }, null, { timeout: 60000 });

  const report = await page.evaluate(() => {
    const found = window.__surfcadFindOrbit();
    const canvas = found.controls.domElement;
    const camera = found.controls.object;
    const before = camera.position.distanceTo(found.controls.target);

    const makeGesture = (type, scale) => {
      let ev;
      if (typeof window.GestureEvent === 'function') {
        ev = new window.GestureEvent(type, { bubbles: true, cancelable: true, scale });
      } else {
        ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'scale', { configurable: true, value: scale });
      }
      canvas.dispatchEvent(ev);
      return ev.defaultPrevented;
    };

    const prevented = makeGesture('gesturestart', 1);
    makeGesture('gesturechange', 1.15);
    makeGesture('gestureend', 1.15);
    const after = camera.position.distanceTo(found.controls.target);
    const metaScale = parseFloat(document.querySelector('meta[name="viewport"]')?.content?.match(/initial-scale=([^,]+)/)?.[1] || '1');

    return {
      prevented,
      before,
      after,
      zoomed: after < before - 1e-6,
      metaScale,
    };
  });

  check('gesture handler preventDefault on the canvas', report.prevented === true);
  check('synthetic gesturechange dollies the camera', report.zoomed, JSON.stringify(report));
  check('viewport meta scale unchanged after gesture', report.metaScale === 1, String(report.metaScale));
  await browser.close();
}

try {
  await waitForServer();
  await runChromium();
  await runWebKitGesture();
} catch (err) {
  check('smoke harness', false, String(err?.message || err));
} finally {
  stop();
}

if (failed) {
  console.log(`\n❌ FAIL (${failed})`);
  process.exit(1);
}
console.log('\n✅ PASS');
