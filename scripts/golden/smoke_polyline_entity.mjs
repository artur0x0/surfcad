#!/usr/bin/env node
/**
 * A polyline stays one strip chip. Touch at 390, mouse at 1280.
 *
 * A segment tap inserts a point. A fast double-tap removes one. A drag
 * moves that point. Cursor does not translate a line. Dimension promotion
 * keeps the one Polyline chip. The chip's Delete card removes the chain.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5298);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'return Manifold.cube([40, 30, 20], true);\n';
const CORNERS = [
  [-8, -6, 10],
  [8, -6, 10],
  [8, 6, 10],
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

console.log('polyline entity (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('polyline entity: no system Chrome — set CHROME_PATH');
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

async function tapAt(client, page, x, y, touch) {
  if (touch) {
    const point = { x, y, id: 1 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(140);
    return;
  }
  await page.mouse.click(x, y);
  await page.waitForTimeout(80);
}

async function dragAt(client, page, x0, y0, x1, y1, touch) {
  if (touch) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: x0, y: y0, id: 1 }],
    });
    for (let i = 1; i <= 6; i += 1) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{
          x: x0 + ((x1 - x0) * i) / 6,
          y: y0 + ((y1 - y0) * i) / 6,
          id: 1,
        }],
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(160);
    return;
  }
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(160);
}

async function tapSelector(client, page, selector, touch) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ timeout: 8000 });
  await loc.evaluate((el) => el.scrollIntoView({ inline: 'center', block: 'nearest' }));
  const box = await loc.boundingBox();
  if (!box) throw new Error(`missing ${selector}`);
  await tapAt(client, page, box.x + box.width / 2, box.y + box.height / 2, touch);
}

async function doubleTap(page, x, y) {
  await page.evaluate(async ({ x: px, y: py }) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const fire = (type) => {
      canvas.dispatchEvent(new window.PointerEvent(type, {
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
      canvas.dispatchEvent(new window.MouseEvent(type === 'pointerdown' ? 'mousedown' : type === 'pointerup' ? 'mouseup' : 'mousemove', {
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
    await new Promise((resolve) => setTimeout(resolve, 80));
    tap();
  }, { x, y });
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

async function chips(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('[data-cad-feature-strip] [data-sketch-id]')].map((el) => ({
      id: el.getAttribute('data-sketch-id'),
      kind: el.getAttribute('data-sketch-kind'),
      label: el.getAttribute('aria-label') || '',
    }))
  ));
}

function onePolyline(list) {
  return list.filter((chip) => chip.kind === 'line').length === 0
    && list.filter((chip) => chip.kind === 'polyline').length === 1;
}

function uvOf(state, id) {
  return (state?.uvs || []).find((point) => point.id === id);
}

async function dotOf(page, id) {
  return page.evaluate((pointId) => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    return dots.find((dot) => dot.id === pointId) || null;
  }, id);
}

async function segmentMid(page, idA, idB) {
  const a = await dotOf(page, idA);
  const b = await dotOf(page, idB);
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Zoom until the segment midpoint is outside the finger slop of both ends. */
async function clearSegment(page, idA, idB) {
  const canvas = page.locator('.viewport-shell > canvas');
  for (let n = 0; n < 7; n += 1) {
    const mid = await segmentMid(page, idA, idB);
    const a = await dotOf(page, idA);
    const b = await dotOf(page, idB);
    const gap = mid && a && b
      ? Math.min(Math.hypot(mid.x - a.x, mid.y - a.y), Math.hypot(mid.x - b.x, mid.y - b.y))
      : 0;
    if (gap > 56) return mid;
    const box = await canvas.boundingBox();
    if (!box) return mid;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.42);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(80);
  }
  return segmentMid(page, idA, idB);
}

async function reaim(page, touch, client) {
  await tapSelector(client, page, '[data-normal-to-sketch]', touch);
  await page.waitForTimeout(450);
}

async function runSize(browser, label, contextOptions, touch) {
  const context = await browser.newContext({ ...contextOptions, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);
  const client = await context.newCDPSession(page);

  await tapSelector(client, page, 'button[aria-label^="Insert Create contour"]', touch);
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  await tapSelector(client, page, '[data-contour-tool="polyline"]', touch);
  await tapSelector(client, page, '[data-feature-card-confirm]', touch);
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });

  for (let i = 0; i < CORNERS.length; i += 1) {
    const hit = await project(page, CORNERS[i]);
    check(`${label} point ${i + 1} is on the canvas`, !!hit?.canvas, JSON.stringify(hit));
    if (!hit?.canvas) continue;
    await tapAt(client, page, hit.x, hit.y, touch);
    await page.waitForFunction((n) => window.__VIEWPORT__.stageContourSketch().points === n, i + 1, { timeout: 4000 });
  }
  let drawn = await chips(page);
  check(`${label} drawn polyline is one chip`, (await sketch(page)).points === 3 && onePolyline(drawn) && drawn[0].id === 'shape',
    JSON.stringify(drawn));
  await page.screenshot({ path: join(SHOT_DIR, `polyline-entity-${label}-drawn.png`) });

  const mid = await segmentMid(page, 'p0', 'p1');
  check(`${label} segment insert has a midpoint`, !!mid, JSON.stringify(mid));
  if (mid) await tapAt(client, page, mid.x, mid.y, touch);
  await page.waitForTimeout(250);
  drawn = await chips(page);
  check(`${label} segment tap inserts a point and stays one chip`,
    (await sketch(page)).points === 4 && onePolyline(drawn) && drawn[0].id === 'shape',
    JSON.stringify({ points: (await sketch(page)).points, drawn }));

  await tapSelector(client, page, '[data-contour-tool="cursor"]', touch);
  await page.waitForTimeout(200);
  drawn = await chips(page);
  check(`${label} cursor keeps one polyline chip`,
    (await sketch(page)).tool === 'cursor' && (await sketch(page)).points === 4 && onePolyline(drawn) && drawn.some((chip) => chip.kind === 'line') === false,
    JSON.stringify(drawn));

  const beforeLine = await sketch(page);
  const lineMid = await clearSegment(page, 'p2', 'p3');
  if (lineMid) await dragAt(client, page, lineMid.x, lineMid.y, lineMid.x + 48, lineMid.y, touch);
  const afterLine = await sketch(page);
  const lineHeld = (beforeLine.uvs || []).every((point) => {
    const next = uvOf(afterLine, point.id);
    return next && Math.hypot(next.u - point.u, next.v - point.v) < 0.25;
  });
  check(`${label} cursor line drag does not translate the line`, afterLine.points === 4 && lineHeld,
    JSON.stringify({ before: beforeLine.uvs, after: afterLine.uvs }));
  await reaim(page, touch, client);

  const beforePoint = await sketch(page);
  const handle = await dotOf(page, 'p2');
  if (handle) await dragAt(client, page, handle.x, handle.y, handle.x + 42, handle.y - 30, touch);
  const afterPoint = await sketch(page);
  const start = uvOf(beforePoint, 'p2');
  const next = uvOf(afterPoint, 'p2');
  const other = uvOf(beforePoint, 'p0');
  const otherNext = uvOf(afterPoint, 'p0');
  const movedOne = start && next && other && otherNext
    && Math.hypot(next.u - start.u, next.v - start.v) > 1
    && Math.hypot(otherNext.u - other.u, otherNext.v - other.v) < 0.25;
  check(`${label} cursor point drag moves one point`, afterPoint.points === 4 && movedOne,
    JSON.stringify({ before: beforePoint.uvs, after: afterPoint.uvs }));
  await page.screenshot({ path: join(SHOT_DIR, `polyline-entity-${label}-cursor.png`) });

  await tapSelector(client, page, '[data-contour-tool="dimension"]', touch);
  await page.waitForTimeout(250);
  drawn = await chips(page);
  check(`${label} dimension promotion stays one polyline chip`,
    onePolyline(drawn) && drawn.some((chip) => chip.id === 'polyline') && drawn.every((chip) => chip.kind !== 'line'),
    JSON.stringify(drawn));

  await tapSelector(client, page, '[data-contour-tool="polyline"]', touch);
  await page.waitForTimeout(200);
  const beforeInsert = (await sketch(page)).points;
  const again = await clearSegment(page, 'p2', 'p3');
  if (again) await tapAt(client, page, again.x, again.y, touch);
  await page.waitForTimeout(250);
  drawn = await chips(page);
  const inserted = await sketch(page);
  check(`${label} promoted segment tap inserts and stays one chip`,
    inserted.points === beforeInsert + 1 && onePolyline(drawn) && drawn.some((chip) => chip.id === 'polyline'),
    JSON.stringify({ points: inserted.points, drawn }));

  const victim = await dotOf(page, 'p3');
  if (victim) {
    if (touch) await doubleTap(page, victim.x, victim.y);
    else {
      await page.mouse.click(victim.x, victim.y);
      await page.waitForTimeout(80);
      await page.mouse.click(victim.x, victim.y);
    }
  }
  await page.waitForTimeout(250);
  const trimmed = await sketch(page);
  drawn = await chips(page);
  check(`${label} double-tap removes one point`,
    trimmed.points === inserted.points - 1 && onePolyline(drawn),
    JSON.stringify({ points: trimmed.points, drawn }));

  const dragDot = await dotOf(page, 'p1');
  const beforeDrag = await sketch(page);
  if (dragDot) await dragAt(client, page, dragDot.x, dragDot.y, dragDot.x - 36, dragDot.y + 28, touch);
  const afterDrag = await sketch(page);
  const a = uvOf(beforeDrag, 'p1');
  const b = uvOf(afterDrag, 'p1');
  const c = uvOf(beforeDrag, 'p0');
  const d = uvOf(afterDrag, 'p0');
  check(`${label} polyline drag moves one point`,
    afterDrag.tool === 'polyline' && a && b && c && d
    && Math.hypot(b.u - a.u, b.v - a.v) > 1
    && Math.hypot(d.u - c.u, d.v - c.v) < 0.25,
    JSON.stringify({ before: beforeDrag.uvs, after: afterDrag.uvs }));
  await page.screenshot({ path: join(SHOT_DIR, `polyline-entity-${label}-edit.png`) });

  await tapSelector(client, page, '[data-sketch-id="polyline"]', touch);
  await page.waitForFunction(() => document.querySelector('[data-contour-card="entity"][data-contour-entity-id="polyline"]'), null, { timeout: 4000 })
    .then(() => check(`${label} polyline chip opens the delete card`, true))
    .catch(() => check(`${label} polyline chip opens the delete card`, false));
  await page.screenshot({ path: join(SHOT_DIR, `polyline-entity-${label}-card.png`) });
  await tapSelector(client, page, '[data-contour-entity-delete]', touch);
  await page.waitForTimeout(200);
  if (await page.locator('[data-sketch-entity-delete-confirm]').count()) {
    await tapSelector(client, page, '[data-sketch-entity-delete-confirm]', touch);
  }
  await page.waitForTimeout(250);
  const empty = await page.evaluate(() => (
    document.querySelector('[data-cad-feature-strip] [data-sketch-entities-empty]')?.textContent?.trim() || ''
  ));
  drawn = await chips(page);
  check(`${label} delete clears the polyline`, empty === 'No sketch entities' && drawn.length === 0 && (await sketch(page)).points === 0,
    JSON.stringify({ empty, drawn, points: (await sketch(page)).points }));
  await page.screenshot({ path: join(SHOT_DIR, `polyline-entity-${label}-deleted.png`) });
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('polyline entity: vite did not start');
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
    isMobile: true,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  }, true);
  await runSize(browser, '1280', {
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  }, false);
} catch (err) {
  failed += 1;
  console.log(`  ❌ run — ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`polyline entity: ${failed} failed`);
  process.exit(1);
}
console.log('polyline entity: ok');
