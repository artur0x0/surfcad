#!/usr/bin/env node
/**
 * Cursor tool, rail icons, line drag, and double-tap point removal.
 * Touch and mouse at 390 and 1280.
 *
 * Cursor (Lucide mouse-pointer-2) drags a point or a line and does not add
 * a point. A line drag translates both endpoints. Polyline is Lucide
 * waypoints. Arc is Lucide spline. Double-tapping a dot removes it. The
 * next removal under the auto-closed minimum deletes the shape, and Back
 * restores that shape in one step.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5281);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'return Manifold.cube([40, 30, 20], true);\n';
const CORNERS = [
  [-6, -4, 10],
  [6, -4, 10],
  [6, 4, 10],
  [-6, 4, 10],
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

console.log('contour cursor (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour cursor: no system Chrome — set CHROME_PATH');
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
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    return !!(canvas && canvas.clientWidth > 0 && window.__VIEWPORT__?.ready?.() && window.__MANIFOLD_CONTEXT__?.isReady);
  }, null, { timeout: 90000 });
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function iconClass(page, tool) {
  return page.locator(`[data-contour-tool="${tool}"] svg`).first().getAttribute('class');
}

async function project(page, world) {
  return page.evaluate((w) => {
    const p = window.__VIEWPORT__.stageProject(w);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas) return null;
    const el = document.elementFromPoint(p.x, p.y);
    return { x: p.x, y: p.y, canvas: el === canvas };
  }, world);
}

async function sketch(page) {
  return page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
}

function uv(state, id) {
  return state.uvs.find((point) => point.id === id);
}

async function doubleTap(page, x, y) {
  await page.evaluate(async ({ x: px, y: py }) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const fire = (type) => {
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: px,
        clientY: py,
        button: 0,
        buttons: type === 'pointerdown' ? 1 : 0,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
      }));
      canvas.dispatchEvent(new MouseEvent(type === 'pointerdown' ? 'mousedown' : type === 'pointerup' ? 'mouseup' : 'mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: px,
        clientY: py,
        button: 0,
        buttons: type === 'pointerdown' ? 1 : 0,
      }));
    };
    const tap = () => {
      fire('pointerdown');
      fire('pointerup');
    };
    tap();
    await new Promise((resolve) => setTimeout(resolve, 40));
    tap();
  }, { x, y });
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

  await page.locator('button[aria-label^="Insert Create contour"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  const cursorIcon = await iconClass(page, 'cursor');
  const polylineIcon = await iconClass(page, 'polyline');
  const arcIcon = await iconClass(page, 'arc');
  check(`${label} cursor uses mouse-pointer-2`, /lucide-mouse-pointer2/.test(cursorIcon || ''), cursorIcon || '');
  check(`${label} polyline uses waypoints`, /lucide-waypoints/.test(polylineIcon || ''), polylineIcon || '');
  check(`${label} arc uses spline`, /lucide-spline/.test(arcIcon || ''), arcIcon || '');
  await page.screenshot({ path: join(SHOT_DIR, `contour-cursor-${label}-icons.png`) });

  await page.locator('[data-contour-tool="polyline"]').click();
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });

  for (let i = 0; i < CORNERS.length; i += 1) {
    const hit = await project(page, CORNERS[i]);
    check(`${label} point ${i + 1} is on the canvas`, !!hit?.canvas, JSON.stringify(hit));
    if (!hit?.canvas) continue;
    await page.mouse.click(hit.x, hit.y);
    await page.waitForFunction((n) => window.__VIEWPORT__.stageContourSketch().points === n, i + 1, { timeout: 4000 });
  }
  check(`${label} four polyline points`, (await sketch(page)).points === 4);

  await page.locator('[data-contour-tool="cursor"]').click();
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().tool === 'cursor', null, { timeout: 4000 });
  const outside = await project(page, [0, 12, 10]);
  check(`${label} empty cursor tap is on the canvas`, !!outside?.canvas, JSON.stringify(outside));
  if (outside?.canvas) await page.mouse.click(outside.x, outside.y);
  await page.waitForTimeout(150);
  check(`${label} cursor does not add a point`, (await sketch(page)).points === 4, JSON.stringify(await sketch(page)));

  const before = await sketch(page);
  const mid = await project(page, [0, -4, 10]);
  const dest = await project(page, [0, 0, 10]);
  check(`${label} line drag starts on the canvas`, !!mid?.canvas && !!dest?.canvas, JSON.stringify({ mid, dest }));
  if (mid?.canvas && dest?.canvas) {
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(dest.x, dest.y, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
  const dragged = await sketch(page);
  const d0 = uv(dragged, 'p0');
  const d1 = uv(dragged, 'p1');
  const s0 = uv(before, 'p0');
  const s1 = uv(before, 'p1');
  const s2 = uv(before, 'p2');
  const d2 = uv(dragged, 'p2');
  const same = d0 && d1 && s0 && s1
    && Math.abs((d0.u - s0.u) - (d1.u - s1.u)) < 0.2
    && Math.abs((d0.v - s0.v) - (d1.v - s1.v)) < 0.2
    && Math.hypot(d0.u - s0.u, d0.v - s0.v) > 1;
  const held = s2 && d2 && Math.hypot(d2.u - s2.u, d2.v - s2.v) < 0.2;
  check(`${label} line drag moves both ends`, dragged.points === 4 && same && held,
    JSON.stringify({ before: before.uvs, after: dragged.uvs }));
  await page.screenshot({ path: join(SHOT_DIR, `contour-cursor-${label}-line.png`) });

  const depth = dragged.undoDepth;
  const dot = await project(page, [6, 4, 10]);
  check(`${label} double-tap lands on the canvas`, !!dot?.canvas, JSON.stringify(dot));
  if (dot?.canvas) await doubleTap(page, dot.x, dot.y);
  await page.waitForTimeout(200);
  const trimmed = await sketch(page);
  check(`${label} double-tap removes one point`, trimmed.points === 3, JSON.stringify(trimmed));
  check(`${label} removing a point is one undo step`, trimmed.undoDepth === depth + 1,
    `before ${depth} after ${trimmed.undoDepth}`);

  const second = await project(page, [-6, 4, 10]);
  if (second?.canvas) await doubleTap(page, second.x, second.y);
  await page.waitForTimeout(200);
  const cleared = await sketch(page);
  check(`${label} under three points deletes the shape`, cleared.points === 0, JSON.stringify(cleared));
  await page.locator('[data-contour-back]').click();
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().points === 3, null, { timeout: 4000 });
  const restored = await sketch(page);
  check(`${label} Back restores the deleted shape`, restored.points === 3 && restored.tool === 'cursor', JSON.stringify(restored));
  await page.screenshot({ path: join(SHOT_DIR, `contour-cursor-${label}-undo.png`) });
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('contour cursor: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  await runSize(browser, '390', {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await runSize(browser, '1280', {
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
} catch (err) {
  failed += 1;
  console.log(`  ❌ run — ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`contour cursor: ${failed} failed`);
  process.exit(1);
}
console.log('contour cursor: ok');
