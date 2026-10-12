#!/usr/bin/env node
/**
 * Point distance at 390 and 1280, touch only.
 *
 * Two points take a distance. Both stay blue. Dragging one moves the other
 * and the distance holds. The camera does not orbit.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5293);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'return Manifold.cube([40, 30, 20], true);\n';
const BLUE = 0x22d3ee;

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

console.log('contour distance drag');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour distance drag: no system Chrome — set CHROME_PATH');
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

async function project(page, world) {
  return page.evaluate((w) => {
    const p = window.__VIEWPORT__.stageProject(w);
    if (!p) return { ok: false, reason: 'off screen' };
    const el = document.elementFromPoint(p.x, p.y);
    const blocked = el?.closest?.('[data-contour-card], [data-feature-sheet], [data-contour-tool], [data-cad-feature-strip], [data-part-row]');
    return {
      ok: !blocked && el?.tagName === 'CANVAS',
      x: p.x,
      y: p.y,
      blocked: blocked ? (blocked.getAttribute('data-contour-card') || blocked.getAttribute('data-contour-tool') || 'chrome') : '',
    };
  }, world);
}

async function tapAt(client, page, x, y) {
  const point = { x, y, id: 1 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point] });
  await page.waitForTimeout(100);
}

function quatDelta(a, b) {
  if (!a?.quaternion || !b?.quaternion) return Infinity;
  let d = 0;
  for (let i = 0; i < 4; i += 1) d = Math.max(d, Math.abs(a.quaternion[i] - b.quaternion[i]));
  return d;
}

async function tapWorld(client, page, world) {
  const hit = await project(page, world);
  if (!hit.ok) throw new Error(`tap blocked ${JSON.stringify(hit)} ${JSON.stringify(world)}`);
  await tapAt(client, page, hit.x, hit.y);
  return hit;
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

async function clickTool(page, id) {
  await page.locator(`[data-contour-tool="${id}"]`).click();
  await page.waitForTimeout(80);
}

async function waitCameraStill(page) {
  let prev = null;
  for (let i = 0; i < 25; i += 1) {
    const pos = await page.evaluate(() => window.__VIEWPORT__.stageCamera().position);
    const still = prev && Math.hypot(pos[0] - prev[0], pos[1] - prev[1], pos[2] - prev[2]) < 1e-3;
    if (still) return;
    prev = pos;
    await page.waitForTimeout(40);
  }
}

async function waitDotsStill(page) {
  let prev = '';
  for (let i = 0; i < 40; i += 1) {
    const dots = (await sketch(page)).dots || [];
    const key = dots.map((dot) => `${dot.id}:${Math.round(dot.x)}:${Math.round(dot.y)}`).join('|');
    if (key && key === prev) return;
    prev = key;
    await page.waitForTimeout(50);
  }
}

async function muteTags(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-contour-tag], [data-contour-tags] *')) {
      el.style.pointerEvents = 'none';
    }
  });
}

function uvOf(state, id) {
  return (state.uvs || []).find((p) => p.id === id);
}

function dist(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.u - b.u, a.v - b.v);
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
    await clickTool(page, 'polyline');
    await page.locator('[data-feature-card-confirm]').click();
    await page.waitForFunction(() => (
      document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
      && !document.querySelector('[data-contour-chip]')
    ), null, { timeout: 8000 });

    await tapWorld(client, page, [10, -2, 10]);
    await tapWorld(client, page, [4, 8, 10]);
    await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().uvs.length === 2, null, { timeout: 4000 });

    await clickTool(page, 'dimension');
    await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 8000 });
    await muteTags(page);
    await waitCameraStill(page);
    await waitDotsStill(page);
    for (const id of ['p0', 'p1']) {
      let pickedPoint = false;
      for (let attempt = 0; attempt < 3 && !pickedPoint; attempt += 1) {
        await waitDotsStill(page);
        const dot = (await sketch(page)).dots.find((item) => item.id === id);
        if (!dot) throw new Error(`missing ${id}`);
        const hit = await page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return { tag: el?.tagName || '', canvas: el?.tagName === 'CANVAS' };
        }, { x: dot.x, y: dot.y });
        if (!hit.canvas) throw new Error(`point ${id} is covered ${JSON.stringify({ dot, hit })}`);
        await tapAt(client, page, dot.x, dot.y);
        pickedPoint = await page.evaluate((pointId) => (
          window.__VIEWPORT__.stageContourSketch().picked.some((pick) => pick.kind === 'point' && pick.id === pointId)
        ), id);
        if (!pickedPoint) await page.waitForTimeout(200);
      }
      if (!pickedPoint) {
        const diag = await page.evaluate(() => {
          const state = window.__VIEWPORT__.stageContourSketch();
          return {
            picked: state.picked,
            dots: (state.dots || []).map((dot) => ({ id: dot.id, x: Math.round(dot.x), y: Math.round(dot.y) })),
            card: (document.querySelector('[data-contour-card="dimension"]')?.innerText || '').slice(0, 240),
          };
        });
        throw new Error(`${label} ${id} was not picked ${JSON.stringify(diag)}`);
      }
    }
    try {
      await page.waitForFunction(() => {
        const state = window.__VIEWPORT__.stageContourSketch();
        const points = (state.picked || []).filter((pick) => pick.kind === 'point');
        return points.length === 2
          && !!document.querySelector('[data-contour-card="dimension"] input[data-field-label="Distance"]');
      }, null, { timeout: 8000 });
    } catch (err) {
      const diag = await page.evaluate(() => {
        const state = window.__VIEWPORT__.stageContourSketch();
        return {
          picked: state.picked,
          uvs: state.uvs,
          card: (document.querySelector('[data-contour-card="dimension"]')?.innerText || '').slice(0, 240),
        };
      });
      throw new Error(`${err.message}\n${JSON.stringify(diag)}`);
    }
    await page.locator('[data-contour-card="dimension"] [data-feature-card-confirm]').click();
    await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().dimensions >= 1, null, { timeout: 4000 });

    await clickTool(page, 'polyline');
    await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().gesture === '', null, { timeout: 4000 });
    await muteTags(page);
    await waitDotsStill(page);

    const before = await sketch(page);
    const beforeA = uvOf(before, 'p0');
    const beforeB = uvOf(before, 'p1');
    const span = dist(beforeA, beforeB);
    const dim = (before.dims || []).find((item) => item.kind === 'distance');
    check(`${label} the distance is the gap between the two points`,
      !!dim && dim.value > 0 && Math.abs(dim.value - span) < 0.2,
      JSON.stringify({ dims: before.dims, span }));
    const colors = (before.dots || []).filter((dot) => dot.id === 'p0' || dot.id === 'p1').map((dot) => dot.color);
    check(`${label} both dimensioned points stay blue`,
      colors.length === 2 && colors.every((color) => color === BLUE),
      colors.map((color) => color?.toString(16)).join(','));

    let dragged = null;
    let other = null;
    let camDelta = Infinity;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const state = await sketch(page);
      const dot = (state.dots || []).find((item) => item.id === 'p0');
      const camBefore = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
      if (!dot) throw new Error('missing p0 for the drag');
      await touchDrag(client, dot, { x: dot.x + 70, y: dot.y - 50 });
      await page.waitForTimeout(180);
      const camAfter = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
      const after = await sketch(page);
      dragged = uvOf(after, 'p0');
      other = uvOf(after, 'p1');
      camDelta = quatDelta(camBefore, camAfter);
      if (camDelta < 1e-3 && dist(beforeA, dragged) > 1) break;
    }
    const draggedMove = dist(beforeA, dragged);
    const otherMove = dist(beforeB, other);
    const afterSpan = dist(dragged, other);
    check(`${label} dragging one point moves it`, draggedMove > 1, `Δ ${draggedMove}`);
    const afterState = await sketch(page);
    check(`${label} the other point follows`, otherMove > 0.5,
      `Δ ${otherMove} from ${JSON.stringify(beforeB)} to ${JSON.stringify(other)} dims ${JSON.stringify(afterState.dims)}`);
    check(`${label} the distance holds`, Math.abs(afterSpan - span) < 0.05,
      `${span} -> ${afterSpan} value ${JSON.stringify(afterState.dims)}`);
    check(`${label} the drag does not orbit`, camDelta < 1e-3, `cam ${camDelta}`);
    const afterColors = (await sketch(page)).dots
      .filter((dot) => dot.id === 'p0' || dot.id === 'p1')
      .map((dot) => dot.color);
    check(`${label} both points stay blue after the drag`,
      afterColors.length === 2 && afterColors.every((color) => color === BLUE),
      afterColors.map((color) => color?.toString(16)).join(','));

    await page.screenshot({ path: join(SHOT_DIR, `contour-distance-drag-${label}.png`) });
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
console.log('\ncontour distance drag golden passed');
