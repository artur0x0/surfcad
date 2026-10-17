#!/usr/bin/env node
/**
 * Viewport orbit loop.
 *
 * 1. The feel constants are the doubled TrackballControls defaults plus one
 *    damping step that matches two 0.2 steps (0.36). Viewport applies them
 *    and does not set enableDamping.
 * 2. Under the Vite dev server (React StrictMode double-mount) the canvas
 *    keeps exactly one requestAnimationFrame loop, one controls.update() per
 *    frame, and one wheel listener. The leaked first loop used to leave two
 *    of each.
 *
 * Uses system Chrome, same as golden:app-loads. Set CHROME_PATH to override.
 */
/* global document, window, EventTarget, performance, requestAnimationFrame */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import {
  TRACKBALL_DYNAMIC_DAMPING_FACTOR,
  TRACKBALL_PAN_SPEED,
  TRACKBALL_DESKTOP_ROTATE_SPEED,
  TRACKBALL_ZOOM_SPEED,
} from '../../src/utils/trackballFeel.js';

const PORT = Number(process.env.SMOKE_PORT || 5191);
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

console.log('viewport orbit loop');

check('desktop rotateSpeed is 3× the TrackballControls default', TRACKBALL_DESKTOP_ROTATE_SPEED === 3);
check('zoomSpeed is 2× the TrackballControls default', TRACKBALL_ZOOM_SPEED === 2.4);
check('panSpeed is 2× the TrackballControls default', TRACKBALL_PAN_SPEED === 0.6);
check('dynamicDampingFactor matches two 0.2 steps', TRACKBALL_DYNAMIC_DAMPING_FACTOR === 0.36);
check(
  'one damping step decays like two default steps',
  Math.abs(Math.sqrt(1 - TRACKBALL_DYNAMIC_DAMPING_FACTOR) - (Math.sqrt(0.8) ** 2)) < 1e-12,
);

const viewport = readFileSync(new URL('../../src/components/Viewport.jsx', import.meta.url), 'utf8');
const arch = readFileSync(new URL('../../docs/architecture.md', import.meta.url), 'utf8');
check('viewport applies the shared feel helper', viewport.includes('applyTrackballFeel(controls)'));
check('viewport does not set enableDamping', !viewport.includes('enableDamping'));
check('cleanup cancels the animation frame', viewport.includes('cancelAnimationFrame(rafId)'));
check('cleanup disposes TrackballControls', viewport.includes('orbitControls.dispose()'));
const animateAt = viewport.indexOf('const animate = () => {');
const animateEnd = viewport.indexOf('animate();', animateAt);
const animateBlock = viewport.slice(animateAt, animateEnd);
check('the loop updates its own controls instance', animateBlock.includes('controls.update()')
  && !animateBlock.includes('controlsRef'));
check('architecture documents the orbit loop lifecycle', /Viewport orbit loop/.test(arch)
  && /cancelAnimationFrame/.test(arch)
  && /dynamicDampingFactor/.test(arch));

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('viewport orbit loop: no system Chrome — set CHROME_PATH. Static checks done.');
  if (failed) process.exit(1);
  process.exit(0);
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

  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    const orig = window.requestAnimationFrame.bind(window);
    const ids = new WeakMap();
    let next = 1;
    const frames = [];
    let cur = null;
    window.__orbitFrames = frames;
    window.requestAnimationFrame = (cb) => {
      if (cb && cb.__surfcadSampler) return orig(cb);
      let id = ids.get(cb);
      if (!id) {
        id = next++;
        ids.set(cb, id);
      }
      return orig((t) => {
        if (!cur || cur.t !== t) {
          cur = { t, ids: [], updates: 0, renders: 0 };
          frames.push(cur);
          if (frames.length > 2000) frames.splice(0, 500);
        }
        window.__orbitFrame = cur;
        cur.ids.push(id);
        return cb(t);
      });
    };

    const counts = new WeakMap();
    const origAdd = EventTarget.prototype.addEventListener;
    const origRem = EventTarget.prototype.removeEventListener;
    function bump(target, type, delta) {
      let m = counts.get(target);
      if (!m) { m = {}; counts.set(target, m); }
      m[type] = (m[type] || 0) + delta;
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

    window.__surfcadFindOrbit = function () {
      const root = document.getElementById('root');
      if (!root) return null;
      const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
      if (!key) return null;
      const start = root[key].current || root[key];
      const seen = new Set();
      let controls = null;
      const renderers = [];
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
          if (c && typeof c.setPixelRatio === 'function' && typeof c.render === 'function' && c.domElement) {
            renderers.push(c);
          }
          hook = hook.next;
        }
        walk(fiber.child);
        walk(fiber.sibling);
      }
      walk(start);
      if (!controls) return null;
      const renderer = renderers.find((r) => r.domElement === controls.domElement) || null;
      return { controls, renderer, rendererCount: renderers.length };
    };
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
  await page.waitForTimeout(600);

  const live = await page.evaluate(({ rotate, zoom, pan, damp }) => {
    const found = window.__surfcadFindOrbit();
    const controls = found.controls;
    const rendererEntry = found.renderer;
    if (!controls.__armed) {
      const origU = controls.update;
      controls.update = function () {
        const f = window.__orbitFrame;
        const r = origU.call(this);
        if (f) f.updates++;
        return r;
      };
      controls.__armed = true;
    }
    if (rendererEntry && !rendererEntry.__armed) {
      const origR = rendererEntry.render;
      rendererEntry.render = function (...args) {
        const f = window.__orbitFrame;
        const r = origR.apply(this, args);
        if (f) f.renders++;
        return r;
      };
      rendererEntry.__armed = true;
    }
    const listeners = window.__listenerCounts.get(controls.domElement) || {};
    const devClient = performance.getEntriesByType('resource').some((e) => e.name.includes('/@vite/client'));
    return {
      rotateSpeed: controls.rotateSpeed,
      zoomSpeed: controls.zoomSpeed,
      panSpeed: controls.panSpeed,
      dynamicDampingFactor: controls.dynamicDampingFactor,
      enableDamping: controls.enableDamping,
      wheel: listeners.wheel || 0,
      devClient,
      hasViewportHook: typeof window.__VIEWPORT__ === 'object',
      expect: { rotate, zoom, pan, damp },
    };
  }, {
    rotate: TRACKBALL_DESKTOP_ROTATE_SPEED,
    zoom: TRACKBALL_ZOOM_SPEED,
    pan: TRACKBALL_PAN_SPEED,
    damp: TRACKBALL_DYNAMIC_DAMPING_FACTOR,
  });

  check('page is the Vite dev build (StrictMode)', live.devClient && live.hasViewportHook);
  check('live rotateSpeed matches the constant', live.rotateSpeed === live.expect.rotate, String(live.rotateSpeed));
  check('live zoomSpeed matches the constant', live.zoomSpeed === live.expect.zoom, String(live.zoomSpeed));
  check('live panSpeed matches the constant', live.panSpeed === live.expect.pan, String(live.panSpeed));
  check('live dynamicDampingFactor matches the constant', live.dynamicDampingFactor === live.expect.damp, String(live.dynamicDampingFactor));
  check('enableDamping is unset on the live controls', live.enableDamping === undefined, String(live.enableDamping));
  check('one wheel listener on the canvas', live.wheel === 1, `wheel=${live.wheel}`);

  const loop = await page.evaluate(() => new Promise((resolve) => {
    const start = window.__orbitFrames.length;
    let n = 0;
    const step = () => {
      n += 1;
      if (n >= 40) {
        const frames = window.__orbitFrames.slice(start);
        const counts = {};
        for (const f of frames) {
          for (const id of new Set(f.ids)) counts[id] = (counts[id] || 0) + 1;
        }
        const perpetual = Object.entries(counts).filter(([, c]) => c >= frames.length * 0.8);
        const tail = frames.slice(10);
        const updates = tail.map((f) => f.updates);
        const renders = tail.map((f) => f.renders);
        const median = (arr) => {
          const s = [...arr].sort((a, b) => a - b);
          return s[Math.floor(s.length / 2)];
        };
        resolve({
          frames: frames.length,
          perpetual: perpetual.length,
          updatesPerFrame: median(updates),
          rendersPerFrame: median(renders),
        });
        return;
      }
      requestAnimationFrame(step);
    };
    step.__surfcadSampler = true;
    requestAnimationFrame(step);
  }));

  check('exactly one active animate loop after mount', loop.perpetual === 1, JSON.stringify(loop));
  check('one controls.update() per frame', loop.updatesPerFrame === 1, JSON.stringify(loop));
  check('one renderer.render per frame', loop.rendersPerFrame === 1, JSON.stringify(loop));
} catch (err) {
  check('dev viewport mounted', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.log(`\n❌ FAIL (${failed})`);
  process.exit(1);
}
console.log('\n✅ PASS');
