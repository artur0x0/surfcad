#!/usr/bin/env node
/* global window, document */
/**
 * Whole-shape drag at 390 and 1280.
 *
 * The shot draws a free quad, a locked rectangle, and a fixed point with a
 * length. The app then drags a hexagon, a circle, a rectangle, and a
 * polyline by an edge or the interior. Free shapes translate. A fully
 * locked rectangle does not. Each move is one undo, and Back restores it.
 *
 * Shots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';

const PORT = Number(process.env.SMOKE_PORT || 5304);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
const SCRIPT = 'return Manifold.cube([40, 30, 20], true);\n';
const CORNERS = [
  [-6, -4, 10],
  [6, -4, 10],
  [6, 4, 10],
  [-6, 4, 10],
];

mkdirSync(SHOT_DIR, { recursive: true });
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!exe) {
  console.log('contour shape drag: no system Chrome — set CHROME_PATH');
  process.exit(1);
}

const html = `<!doctype html><meta charset="utf-8">
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
import { renderContourShapeDragShot } from '/scripts/golden/contour_shape_drag_shot.js';
renderContourShapeDragShot(document.getElementById('root'));
</script>`;

console.log('contour shape drag (390 / 1280)');

const vite = await createVite({
  root: new URL('../..', import.meta.url).pathname,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
const shotServer = createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url.startsWith('/?')) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end('no');
  });
});
await new Promise((resolve) => shotServer.listen(0, '127.0.0.1', resolve));
const shotPort = shotServer.address().port;

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

async function runShot(label, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${shotPort}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30000 });
  await page.evaluate((phone) => window.__SET_COMPACT__?.(phone), width < 700);
  await page.waitForTimeout(80);
  const cases = await page.evaluate(() => window.__SHAPE_CASES__);
  check(`${label} free shape moved`, cases?.free?.moved === true, JSON.stringify(cases?.free));
  check(`${label} locked shape stayed`, cases?.locked?.moved === false, JSON.stringify(cases?.locked));
  check(`${label} partial shape slid on its length`,
    cases?.partial?.moved === true && cases.partial.p0Still === true && Math.abs(cases.partial.gap - 28) < 0.05,
    JSON.stringify(cases?.partial));
  const figures = await page.locator('[data-shape-figure]').count();
  check(`${label} three solver figures`, figures === 3, String(figures));
  await page.screenshot({ path: join(SHOT_DIR, `contour-shape-drag-shot-${label}.png`) });
  check(`${label} shot has no page errors`, errors.length === 0, errors.join(' | '));
  await page.close();
}

try {
  await runShot('390', 390, 844);
  await runShot('1280', 1280, 800);
} catch (err) {
  failed += 1;
  console.log(`  ❌ shot — ${err?.stack || err}`);
}
await new Promise((resolve) => shotServer.close(resolve));
await vite.close();

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../..', import.meta.url).pathname,
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
  const ran = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function sketch(page) {
  return page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
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

async function useTool(page, tool) {
  await page.locator(`[data-contour-tool="${tool}"]`).click();
  await page.waitForFunction((id) => window.__VIEWPORT__.stageContourSketch().tool === id, tool, { timeout: 4000 });
}

async function zoomWhile(page, gapOf) {
  const canvas = page.locator('.viewport-shell > canvas');
  for (let n = 0; n < 8; n += 1) {
    const gap = await gapOf();
    if (gap > 56) return gap;
    const box = await canvas.boundingBox();
    if (!box) return gap;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.42);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(80);
  }
  return gapOf();
}

async function gapFromWorld(page, world) {
  return page.evaluate((w) => {
    const p = window.__VIEWPORT__.stageProject(w);
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    if (!p || !dots.length) return 0;
    return Math.min(...dots.map((dot) => Math.hypot(dot.x - p.x, dot.y - p.y)));
  }, world);
}

async function dragPointer(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(220);
}

async function enterSketch(page) {
  await page.locator('button[aria-label^="Insert Create contour"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  await page.locator('[data-normal-to-sketch]').click();
  await page.waitForTimeout(450);
}

function sameShift(before, after) {
  const deltas = (before || []).map((point) => {
    const next = (after || []).find((item) => item.id === point.id);
    if (!next) return null;
    return [next.u - point.u, next.v - point.v];
  });
  if (!deltas.length || deltas.some((d) => !d)) return false;
  return deltas.every((d) => Math.hypot(d[0], d[1]) > 0.4)
    && deltas.every((d) => Math.hypot(d[0] - deltas[0][0], d[1] - deltas[0][1]) < 0.25);
}

async function runApp(label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);
  await enterSketch(page);

  await useTool(page, 'polygon');
  await useTool(page, 'cursor');
  const hexGap = await zoomWhile(page, () => gapFromWorld(page, [0, 0, 10]));
  const hexBefore = await sketch(page);
  const hexAt = await project(page, [0, 0, 10]);
  check(`${label} hexagon interior is clear of its vertices`, hexGap > 48 && !!hexAt?.canvas,
    JSON.stringify({ hexGap, hexAt }));
  if (hexAt?.canvas) await dragPointer(page, hexAt, { x: hexAt.x + 36, y: hexAt.y - 28 });
  const hex = await sketch(page);
  check(`${label} hexagon drag translates and keeps the radius`,
    Math.hypot(hex.origin[0], hex.origin[1]) > 0.4
    && Math.abs(hex.radius - 8) < 1e-6
    && hex.undoDepth === hexBefore.undoDepth + 1,
    JSON.stringify({ before: hexBefore.origin, after: hex.origin, radius: hex.radius, depth: hex.undoDepth }));
  await page.screenshot({ path: join(SHOT_DIR, `contour-shape-drag-${label}.png`) });
  await page.locator('[data-contour-back]').click();
  await page.waitForFunction((depth) => window.__VIEWPORT__.stageContourSketch().undoDepth === depth,
    hexBefore.undoDepth, { timeout: 4000 });
  const hexBack = await sketch(page);
  check(`${label} Back restores the hexagon`,
    Math.hypot(hexBack.origin[0], hexBack.origin[1]) < 0.05 && Math.abs(hexBack.radius - 8) < 1e-6,
    JSON.stringify(hexBack.origin));

  await useTool(page, 'circle');
  await useTool(page, 'cursor');
  const circleGap = await zoomWhile(page, () => gapFromWorld(page, [0, 0, 10]));
  const circleBefore = await sketch(page);
  const circleAt = await project(page, [0, 0, 10]);
  check(`${label} circle interior is clear of the rim`, circleGap > 48 && !!circleAt?.canvas,
    JSON.stringify({ circleGap, circleAt }));
  if (circleAt?.canvas) await dragPointer(page, circleAt, { x: circleAt.x + 40, y: circleAt.y + 16 });
  const circle = await sketch(page);
  check(`${label} circle drag translates and keeps the radius`,
    Math.hypot(circle.origin[0], circle.origin[1]) > 0.4
    && Math.abs(circle.radius - circleBefore.radius) < 1e-6
    && circle.undoDepth === circleBefore.undoDepth + 1,
    JSON.stringify({ origin: circle.origin, radius: circle.radius, before: circleBefore.radius, depth: circle.undoDepth }));
  await page.locator('[data-contour-back]').click();
  await page.waitForFunction((depth) => window.__VIEWPORT__.stageContourSketch().undoDepth === depth,
    circleBefore.undoDepth, { timeout: 4000 });

  await useTool(page, 'rectangle');
  await useTool(page, 'cursor');
  const edgeGap = await zoomWhile(page, () => page.evaluate(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    const a = dots.find((dot) => dot.id === 'p0');
    const b = dots.find((dot) => dot.id === 'p1');
    if (!a || !b) return 0;
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    return Math.min(Math.hypot(x - a.x, y - a.y), Math.hypot(x - b.x, y - b.y));
  }));
  const rectBefore = await sketch(page);
  const edge = await page.evaluate(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    const a = dots.find((dot) => dot.id === 'p0');
    const b = dots.find((dot) => dot.id === 'p1');
    if (!a || !b) return null;
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    const node = document.elementFromPoint(x, y);
    return { x, y, canvas: node?.tagName === 'CANVAS' };
  });
  check(`${label} rectangle edge is clear of its corners`, edgeGap > 48 && !!edge?.canvas,
    JSON.stringify({ edgeGap, edge }));
  if (edge?.canvas) await dragPointer(page, edge, { x: edge.x + 28, y: edge.y - 36 });
  const rect = await sketch(page);
  check(`${label} rectangle edge drag keeps width and height`,
    Math.hypot(rect.origin[0], rect.origin[1]) > 0.4
    && Math.abs(rect.width - 20) < 1e-6
    && Math.abs(rect.height - 12) < 1e-6
    && rect.undoDepth === rectBefore.undoDepth + 1,
    JSON.stringify({ origin: rect.origin, width: rect.width, height: rect.height, depth: rect.undoDepth }));
  await page.locator('[data-contour-back]').click();
  await page.waitForFunction((depth) => window.__VIEWPORT__.stageContourSketch().undoDepth === depth,
    rectBefore.undoDepth, { timeout: 4000 });

  await page.locator('[data-contour-tool="dimension"]').click();
  await page.waitForFunction(() => {
    const state = window.__VIEWPORT__.stageContourSketch();
    return state.gesture === 'dimension' && (state.uvs || []).length === 4;
  }, null, { timeout: 4000 });
  await useTool(page, 'cursor');
  const lockGap = await zoomWhile(page, () => gapFromWorld(page, [0, 0, 10]));
  const lockBefore = await sketch(page);
  const lockAt = await project(page, [0, 0, 10]);
  check(`${label} locked rectangle interior is clear of its corners`, lockGap > 48 && !!lockAt?.canvas,
    JSON.stringify({ lockGap, lockAt }));
  if (lockAt?.canvas) await dragPointer(page, lockAt, { x: lockAt.x + 42, y: lockAt.y - 24 });
  const lock = await sketch(page);
  const lockStill = (lockBefore.uvs || []).every((point) => {
    const next = (lock.uvs || []).find((item) => item.id === point.id);
    return next && Math.hypot(next.u - point.u, next.v - point.v) < 0.05;
  });
  check(`${label} a fully locked rectangle does not move`,
    lock.uvs.length === 4 && lockStill && lock.undoDepth === lockBefore.undoDepth,
    JSON.stringify({ before: lockBefore.uvs, after: lock.uvs, depth: [lockBefore.undoDepth, lock.undoDepth] }));

  await page.locator('[data-contour-exit]').click();
  await page.waitForFunction(() => !window.__VIEWPORT__.stageContourSketch().open, null, { timeout: 4000 });
  await enterSketch(page);
  await useTool(page, 'polyline');
  for (let i = 0; i < CORNERS.length; i += 1) {
    const hit = await project(page, CORNERS[i]);
    check(`${label} polyline point ${i + 1} is on the canvas`, !!hit?.canvas, JSON.stringify(hit));
    if (!hit?.canvas) continue;
    await page.mouse.click(hit.x, hit.y);
    await page.waitForFunction((n) => window.__VIEWPORT__.stageContourSketch().points === n, i + 1, { timeout: 4000 });
  }
  await useTool(page, 'cursor');
  const lineGap = await zoomWhile(page, () => page.evaluate(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    const a = dots.find((dot) => dot.id === 'p0');
    const b = dots.find((dot) => dot.id === 'p1');
    if (!a || !b) return 0;
    return Math.hypot((a.x + b.x) / 2 - a.x, (a.y + b.y) / 2 - a.y);
  }));
  const lineBefore = await sketch(page);
  const lineAt = await page.evaluate(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    const a = dots.find((dot) => dot.id === 'p0');
    const b = dots.find((dot) => dot.id === 'p1');
    if (!a || !b) return null;
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    const node = document.elementFromPoint(x, y);
    return { x, y, canvas: node?.tagName === 'CANVAS' };
  });
  check(`${label} polyline edge is clear of its points`, lineGap > 48 && !!lineAt?.canvas,
    JSON.stringify({ lineGap, lineAt }));
  if (lineAt?.canvas) await dragPointer(page, lineAt, { x: lineAt.x + 34, y: lineAt.y - 22 });
  const line = await sketch(page);
  check(`${label} polyline drag translates every point`,
    line.points === 4 && sameShift(lineBefore.uvs, line.uvs) && line.undoDepth === lineBefore.undoDepth + 1,
    JSON.stringify({ before: lineBefore.uvs, after: line.uvs, depth: line.undoDepth }));
  await page.locator('[data-contour-back]').click();
  await page.waitForFunction((depth) => window.__VIEWPORT__.stageContourSketch().undoDepth === depth,
    lineBefore.undoDepth, { timeout: 4000 });
  const lineBack = await sketch(page);
  const restored = (lineBefore.uvs || []).every((point) => {
    const next = (lineBack.uvs || []).find((item) => item.id === point.id);
    return next && Math.hypot(next.u - point.u, next.v - point.v) < 0.2;
  });
  check(`${label} Back restores the polyline`, lineBack.points === 4 && restored, JSON.stringify(lineBack.uvs));
  check(`${label} app has no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('contour shape drag: vite did not start');
  stop();
  await browser.close();
  process.exit(1);
}

try {
  await runApp('390', {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await runApp('1280', {
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
} catch (err) {
  failed += 1;
  console.log(`  ❌ app — ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`contour shape drag: ${failed} failed`);
  process.exit(1);
}
console.log('contour shape drag: ok');
