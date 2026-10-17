#!/usr/bin/env node
/**
 * Sketch status colours at 390 and 1280, touch only.
 *
 * An unconstrained rectangle is blue and a corner drag changes its width.
 * Fully dimensioning it turns every point and edge black, and a drag does
 * not move a corner or the camera. Deleting the width leaves a mixed
 * rectangle: locked corners and the edge between them are black and do not
 * drag, free corners and edges are blue and do.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5289);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'return Manifold.cube([40, 30, 20], true);\n';
const BLUE = 0x22d3ee;
const BLACK = 0x000000;
const GREY = 0x9ca3af;

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

console.log('sketch status colours');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('sketch status colours: no system Chrome — set CHROME_PATH');
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

async function boot(page) {
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.addInitScript(() => { window.__SURFCAD_NO_TUTORIAL = true; });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    return !!(canvas && canvas.clientWidth > 0 && window.__VIEWPORT__?.ready?.() && window.__MANIFOLD_CONTEXT__?.isReady);
  }, null, { timeout: 90000 });
  const ran = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function sketch(page) {
  return page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
}

function quatDelta(a, b) {
  if (!a?.quaternion || !b?.quaternion) return Infinity;
  let d = 0;
  for (let i = 0; i < 4; i += 1) d = Math.max(d, Math.abs(a.quaternion[i] - b.quaternion[i]));
  return d;
}

async function touchDrag(client, from, to) {
  const steps = 8;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, id: 1 }],
  });
  for (let i = 1; i <= steps; i += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
        id: 1,
      }],
    });
  }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [{ x: to.x, y: to.y, id: 1 }],
  });
}

function ink(state) {
  const dots = state?.dots || [];
  const lines = state?.lines || [];
  return {
    dots,
    lines,
    grey: dots.some((d) => d.color === GREY) || lines.some((l) => l.color === GREY),
    all(color) {
      return dots.length > 0 && lines.length > 0
        && dots.every((d) => d.color === color)
        && lines.every((l) => l.color === color);
    },
  };
}

async function muteTags(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-contour-tag], [data-contour-tags] *')) {
      el.style.pointerEvents = 'none';
    }
  });
}

async function dragPoint(client, page, id, dx, dy) {
  await muteTags(page);
  const before = await sketch(page);
  const dot = (before.dots || []).find((item) => item.id === id);
  const uv = (before.uvs || []).find((item) => item.id === id);
  if (!dot || !uv) return { delta: Infinity, cam: Infinity, missing: true };
  const camBefore = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  await touchDrag(client, dot, { x: dot.x + dx, y: dot.y + dy });
  await page.waitForTimeout(150);
  const camAfter = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  const after = (await sketch(page)).uvs.find((item) => item.id === id);
  const delta = after ? Math.hypot(after.u - uv.u, after.v - uv.v) : Infinity;
  return { delta, cam: quatDelta(camBefore, camAfter), missing: false };
}

async function runSize(browser, label, viewport) {
  const context = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  try {
    await boot(page);
    await page.locator('button[aria-label^="Insert Create contour"]').click();
    await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
    await page.locator('[data-contour-tool="rectangle"]').click();
    await page.locator('[data-feature-card-confirm]').click();
    await page.waitForFunction(() => (
      document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
      && !document.querySelector('[data-contour-chip]')
    ), null, { timeout: 8000 });
    await page.waitForFunction(() => {
      const state = window.__VIEWPORT__.stageContourSketch();
      return (state.dots || []).length === 4 && (state.lines || []).length >= 1;
    }, null, { timeout: 8000 });

    const legend = await page.locator('[data-contour-status-legend]').evaluate((el) => {
      const box = el.getBoundingClientRect();
      const rows = [...el.querySelectorAll('[data-contour-status]')].map((node) => ({
        status: node.getAttribute('data-contour-status'),
        text: (node.textContent || '').trim(),
        color: node.querySelector('[data-contour-status-swatch]')?.getAttribute('data-contour-status-color') || '',
      }));
      return {
        rows,
        onScreen: box.width > 0 && box.height > 0 && box.top >= 0 && box.left >= 0
          && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
      };
    });
    check(`${label} legend names free, locked, conflict, and repeated`,
      legend.onScreen
      && legend.rows.map((row) => `${row.status}:${row.text}:${row.color}`).join(',')
        === 'under:Free:#22d3ee,full:Locked:#000000,conflict:Conflict:#f87171,repeated:Repeated:#fbbf24',
      JSON.stringify(legend));

    const free = ink(await sketch(page));
    check(`${label} an unconstrained rectangle is blue`, free.all(BLUE) && !free.grey, JSON.stringify({
      dots: free.dots.map((d) => d.color?.toString(16)),
      lines: free.lines.map((l) => l.color?.toString(16)),
    }));
    const widthBefore = (await sketch(page)).width;
    const corner = (await sketch(page)).dots.slice().sort((a, b) => b.x - a.x)[0];
    await touchDrag(client, corner, { x: corner.x + 36, y: corner.y });
    await page.waitForTimeout(150);
    const widthAfter = (await sketch(page)).width;
    check(`${label} the blue rectangle is draggable`, widthAfter > widthBefore + 0.5, `${widthBefore} -> ${widthAfter}`);

    await page.locator('[data-contour-tool="dimension"]').click();
    await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 8000 });
    await page.waitForFunction((black) => {
      const state = window.__VIEWPORT__.stageContourSketch();
      const dots = state.dots || [];
      const lines = state.lines || [];
      return state.dimensions >= 2
        && dots.length === 4
        && lines.length >= 4
        && dots.every((dot) => dot.color === black)
        && lines.every((line) => line.color === black);
    }, BLACK, { timeout: 8000 });
    const lockedInk = ink(await sketch(page));
    check(`${label} a fully dimensioned rectangle is black`, lockedInk.all(BLACK) && !lockedInk.grey);

    await page.locator('[data-contour-tool="dimension"]').click();
    await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().gesture === '', null, { timeout: 4000 });
    let locked = { delta: Infinity, cam: Infinity };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      locked = await dragPoint(client, page, 'p0', 40, 24);
      if (locked.cam < 1e-3) break;
    }
    check(`${label} the black rectangle is not draggable`,
      !locked.missing && locked.delta < 0.5 && locked.cam < 1e-3,
      `Δ ${locked.delta} cam ${locked.cam}`);

    await page.evaluate(() => document.querySelector('[data-contour-tag="d0"]')?.click());
    await page.locator('[data-contour-dimension-delete]').waitFor({ timeout: 4000 });
    await page.locator('[data-contour-dimension-delete]').click();
    await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().dimensions === 1, null, { timeout: 4000 });
    await page.waitForFunction(({ blue, black }) => {
      const state = window.__VIEWPORT__.stageContourSketch();
      const colorOf = (id) => (state.dots || []).find((dot) => dot.id === id)?.color;
      const lineOf = (id) => (state.lines || []).find((line) => line.id === id)?.color;
      return colorOf('p0') === black && colorOf('p3') === black
        && colorOf('p1') === blue && colorOf('p2') === blue
        && lineOf('e3') === black
        && ['e0', 'e1', 'e2'].every((id) => lineOf(id) === blue);
    }, { blue: BLUE, black: BLACK }, { timeout: 8000 });
    const mixed = ink(await sketch(page));
    check(`${label} a half-constrained rectangle is mixed`,
      !mixed.grey
      && mixed.dots.some((d) => d.color === BLUE)
      && mixed.dots.some((d) => d.color === BLACK)
      && mixed.lines.some((l) => l.color === BLUE)
      && mixed.lines.some((l) => l.color === BLACK));

    const moved = await dragPoint(client, page, 'p1', 48, 8);
    check(`${label} a blue corner still drags`, !moved.missing && moved.delta > 0.5, `Δ ${moved.delta}`);
    let held = { delta: Infinity, cam: Infinity };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      held = await dragPoint(client, page, 'p0', 40, 24);
      if (held.cam < 1e-3) break;
    }
    check(`${label} a black corner stays locked`,
      !held.missing && held.delta < 0.5 && held.cam < 1e-3,
      `Δ ${held.delta} cam ${held.cam}`);

    await page.screenshot({ path: join(SHOT_DIR, `sketch-status-${label}.png`) });
    check(`${label} no page error`, errors.length === 0, errors.join(' | '));
  } finally {
    await client.detach().catch(() => {});
    await context.close();
  }
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
attachConsentPresetToBrowser(browser);
try {
  if (!await waitForServer()) throw new Error('vite did not start');
  await runSize(browser, '390', { width: 390, height: 844 });
  await runSize(browser, '1280', { width: 1280, height: 800 });
} catch (err) {
  failed += 1;
  console.log(`  ❌ ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nsketch status colours golden passed');
