#!/usr/bin/env node
/**
 * Contour drag and Normal to sketch at 390 and 1280.
 *
 * Dragging a polyline point (one finger, or the right mouse button) leaves
 * the camera quaternion and position unchanged. A drag that starts off the
 * handle still orbits. Normal to sketch then aims along the sketch plane
 * and zoom-fits.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5279);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'return Manifold.cube([40, 30, 20], true);\n';
const CORNERS = [
  [-20, -15, -10], [20, -15, -10], [-20, 15, -10], [20, 15, -10],
  [-20, -15, 10], [20, -15, 10], [-20, 15, 10], [20, 15, 10],
];
const POINT = [6, -4, 10];

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

console.log('contour normal');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour normal: no system Chrome — set CHROME_PATH');
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

function dotView(cam, normal) {
  if (!cam?.position || !cam?.target) return null;
  const d = [
    cam.position[0] - cam.target[0],
    cam.position[1] - cam.target[1],
    cam.position[2] - cam.target[2],
  ];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (!(len > 1e-9)) return null;
  return (d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2]) / len;
}

function quatDelta(a, b) {
  if (!a?.quaternion || !b?.quaternion || a.quaternion.length < 4 || b.quaternion.length < 4) return Infinity;
  let d = 0;
  for (let i = 0; i < 4; i += 1) d = Math.max(d, Math.abs(a.quaternion[i] - b.quaternion[i]));
  return d;
}

function posDelta(a, b) {
  if (!a?.position || !b?.position) return Infinity;
  return Math.hypot(
    a.position[0] - b.position[0],
    a.position[1] - b.position[1],
    a.position[2] - b.position[2],
  );
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
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function projectHitsCanvas(page, world) {
  return page.evaluate((w) => {
    const p = window.__VIEWPORT__.stageProject(w);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas) return { ok: false, reason: 'no project' };
    const el = document.elementFromPoint(p.x, p.y);
    return { ok: el === canvas, x: p.x, y: p.y, tag: el ? el.tagName : '' };
  }, world);
}

async function ndcExtent(page, corners) {
  return page.evaluate((pts) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const rect = canvas.getBoundingClientRect();
    let extent = 0;
    for (const w of pts) {
      const p = window.__VIEWPORT__.stageProject(w);
      if (!p) return { ok: false, extent: null };
      const u = ((p.x - rect.left) / rect.width) * 2 - 1;
      const v = 1 - ((p.y - rect.top) / rect.height) * 2;
      extent = Math.max(extent, Math.abs(u), Math.abs(v));
    }
    return { ok: true, extent: +extent.toFixed(3) };
  }, corners);
}

async function sketchDot(page) {
  return page.evaluate(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    const dot = sketch?.dots?.[0];
    if (!dot) return null;
    return { x: dot.x, y: dot.y, points: sketch.points };
  });
}

async function emptyCanvasPoint(page, dot) {
  return page.evaluate((handle) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return null;
    const candidates = [
      [rect.left + rect.width * 0.28, rect.top + rect.height * 0.32],
      [rect.left + rect.width * 0.62, rect.top + rect.height * 0.58],
      [rect.left + rect.width * 0.45, rect.top + rect.height * 0.22],
    ];
    for (const [x, y] of candidates) {
      if (Math.hypot(x - handle.x, y - handle.y) < 56) continue;
      if (document.elementFromPoint(x, y) !== canvas) continue;
      return { x, y };
    }
    return null;
  }, dot);
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
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function mouseDrag(page, from, to, button) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up({ button });
}

async function drag(page, client, pointerType, from, to, button) {
  if (pointerType === 'touch') await touchDrag(client, from, to);
  else await mouseDrag(page, from, to, button);
  await page.waitForTimeout(80);
}

async function runSize(browser, label, contextOptions, pointerType) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const client = pointerType === 'touch' ? await context.newCDPSession(page) : null;
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

  check(`${label} Normal to is hidden outside contour mode`, await page.locator('[data-normal-to-sketch]').count() === 0);

  await page.locator('button[aria-label^="Insert Create contour"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  const duringCard = await page.evaluate(() => {
    const fit = document.querySelector('[data-zoom-to-fit]');
    const next = fit?.nextElementSibling;
    return {
      count: document.querySelectorAll('[data-normal-to-sketch]').length,
      label: next?.getAttribute('aria-label') || '',
      title: next?.getAttribute('title') || '',
      marked: !!next?.hasAttribute('data-normal-to-sketch'),
    };
  });
  check(`${label} Normal to sits under zoom-to-fit on the plane card`,
    duringCard.count === 1 && duringCard.marked && duringCard.label === 'Normal to sketch' && duringCard.title === 'Normal to sketch',
    JSON.stringify(duringCard));

  await page.locator('[data-contour-tool="polyline"]').click();
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  check(`${label} Normal to stays up after Start drawing`, await page.locator('[data-normal-to-sketch]').count() === 1);

  const pointHit = await projectHitsCanvas(page, POINT);
  check(`${label} polyline tap lands on the canvas`, !!pointHit?.ok, JSON.stringify(pointHit));
  if (pointHit?.ok) {
    if (pointerType === 'touch') await page.touchscreen.tap(pointHit.x, pointHit.y);
    else await page.mouse.click(pointHit.x, pointHit.y);
  }
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return sketch.points === 1 && (sketch.dots || []).length === 1;
  }, null, { timeout: 4000 });

  const beforeDot = await sketchDot(page);
  const beforeCam = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  const dragTo = beforeDot ? { x: beforeDot.x + 28, y: beforeDot.y + 64 } : null;
  if (beforeDot && dragTo) {
    await drag(page, client, pointerType, beforeDot, dragTo, 'right');
  }
  const afterDot = await sketchDot(page);
  const afterCam = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  const moved = beforeDot && afterDot
    ? Math.hypot(afterDot.x - beforeDot.x, afterDot.y - beforeDot.y)
    : 0;
  const qDrag = quatDelta(beforeCam, afterCam);
  const pDrag = posDelta(beforeCam, afterCam);
  console.log(`  ${label} point drag moved ${moved.toFixed(1)}px quat ${qDrag.toFixed(5)} pos ${pDrag.toFixed(4)}`);
  check(`${label} the point moved`, moved > 12, `moved ${moved}`);
  check(`${label} camera quaternion is unchanged`, qDrag < 1e-3, `Δq ${qDrag}`);
  check(`${label} camera position is unchanged`, pDrag < 0.05, `Δpos ${pDrag}`);

  const orbitFrom = afterDot ? await emptyCanvasPoint(page, afterDot) : null;
  check(`${label} empty-space drag starts on the canvas`, !!orbitFrom, JSON.stringify(orbitFrom));
  if (orbitFrom) {
    await drag(page, client, pointerType, orbitFrom, { x: orbitFrom.x + 110, y: orbitFrom.y + 16 }, 'left');
  }
  const orbited = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  const qOrbit = quatDelta(afterCam, orbited);
  const alignOrbit = dotView(orbited, [0, 0, 1]);
  console.log(`  ${label} orbit quat ${qOrbit.toFixed(4)} align ${alignOrbit?.toFixed?.(3)}`);
  check(`${label} empty-space drag orbits`, qOrbit > 0.02 && alignOrbit != null && alignOrbit < 0.98, `Δq ${qOrbit} align ${alignOrbit}`);

  await page.locator('[data-normal-to-sketch]').click();
  try {
    await page.waitForFunction(() => {
      const aim = document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim');
      if (aim !== 'done') return false;
      const cam = window.__VIEWPORT__.stageCamera();
      if (!cam?.position || !cam?.target) return false;
      const d = [
        cam.position[0] - cam.target[0],
        cam.position[1] - cam.target[1],
        cam.position[2] - cam.target[2],
      ];
      const len = Math.hypot(d[0], d[1], d[2]);
      return len > 1e-9 && d[2] / len > 0.98;
    }, null, { timeout: 5000 });
  } catch { /* reported below */ }
  const aimed = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  const align = dotView(aimed, [0, 0, 1]);
  const framed = await ndcExtent(page, CORNERS);
  const aimAttr = await page.evaluate(() => document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') || '');
  console.log(`  ${label} normal align ${align?.toFixed?.(3)} extent ${framed.extent} aim ${aimAttr}`);
  check(`${label} camera is normal to the sketch plane`, align != null && align > 0.98, String(align));
  check(`${label} Normal to zoom-fits`, framed.ok && framed.extent >= 0.4 && framed.extent <= 1.05, JSON.stringify(framed));
  check(`${label} face aim finished`, aimAttr === 'done', aimAttr);

  await page.locator('[data-contour-exit]').click();
  await page.waitForFunction(() => !document.querySelector('[data-contour-exit]'), null, { timeout: 4000 });
  check(`${label} Normal to hides when contour mode closes`, await page.locator('[data-normal-to-sketch]').count() === 0);
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: join(SHOT_DIR, `contour-normal-${label}.png`) });
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('contour normal: vite did not start');
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
  }, 'touch');
  await runSize(browser, '1280', {
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  }, 'mouse');
} catch (err) {
  failed += 1;
  console.log(`  ❌ run — ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`contour normal: ${failed} failed`);
  process.exit(1);
}
console.log('contour normal: ok');
