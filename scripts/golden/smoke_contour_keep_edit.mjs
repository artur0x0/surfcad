#!/usr/bin/env node
/**
 * Contour edit at 390 and 1280, touch only.
 *
 * The plane card says Select plane. Circle, rectangle, and polygon handles
 * edit their sizes. A polyline stays draggable after a dimension and a tool
 * change. A fixed point does not move. A distance on the negative side of a
 * reference edge displays a positive value, and typing a positive number
 * keeps that side.
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

const PORT = Number(process.env.SMOKE_PORT || 5281);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'return Manifold.cube([40, 30, 20], true);\n';

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

console.log('contour keep edit');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour keep edit: no system Chrome — set CHROME_PATH');
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
  // Send start and end in order. Playwright's touchscreen.tap fires both
  // at once, and the end can win, so the tap never reaches the canvas.
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

// The fitted sketch can sit high, so the negative side of the far edge
// starts above the canvas. Dolly out until that point and its edge are
// both in the upper half, clear of the feature card.
async function zoomOut(page) {
  const origin = await project(page, [0, 0, 10]);
  const box = await page.locator('.viewport-shell > canvas').boundingBox();
  if (!box) return;
  const x = origin?.ok ? origin.x : box.x + box.width / 2;
  const y = origin?.ok ? origin.y : box.y + box.height * 0.35;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(60);
  let prev = null;
  for (let i = 0; i < 25; i += 1) {
    const pos = await page.evaluate(() => window.__VIEWPORT__.stageCamera().position);
    const still = prev && Math.hypot(pos[0] - prev[0], pos[1] - prev[1], pos[2] - prev[2]) < 1e-3;
    if (still) return;
    prev = pos;
    await page.waitForTimeout(40);
  }
}

async function upperCanvasPoint(page, world, viewport) {
  const hit = await project(page, world);
  if (!hit?.ok) return null;
  const inset = 36;
  if (hit.x < inset || hit.y < inset) return null;
  if (hit.x > viewport.width - inset) return null;
  if (hit.y > viewport.height * 0.5) return null;
  return hit;
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
    const planeLabel = await page.locator('[data-feature-card-confirm]').innerText();
    check(`${label} the plane card says Select plane`, planeLabel.includes('Select plane'), planeLabel);

    await clickTool(page, 'circle');
    await page.locator('[data-feature-card-confirm]').click();
    await page.waitForFunction(() => (
      document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
      && !document.querySelector('[data-contour-chip]')
    ), null, { timeout: 8000 });

    await page.waitForFunction(() => (window.__VIEWPORT__.stageContourSketch().dots || []).length === 1, null, { timeout: 4000 });
    const rimSketch = await sketch(page);
    const rim = rimSketch.dots[0];
    const rimOrigin = await project(page, [0, 0, 10]);
    const rimAway = Math.hypot(rim.x - rimOrigin.x, rim.y - rimOrigin.y) || 1;
    const radiusBefore = rimSketch.radius;
    await touchDrag(client, rim, {
      x: rim.x + ((rim.x - rimOrigin.x) / rimAway) * 48,
      y: rim.y + ((rim.y - rimOrigin.y) / rimAway) * 48,
    });
    await page.waitForTimeout(120);
    const radiusAfter = (await sketch(page)).radius;
    check(`${label} a circle handle edits the radius`, radiusAfter > radiusBefore + 0.5, `${radiusBefore} -> ${radiusAfter}`);

    await clickTool(page, 'rectangle');
    await page.waitForFunction(() => (window.__VIEWPORT__.stageContourSketch().dots || []).length === 4, null, { timeout: 4000 });
    const rect = await sketch(page);
    const corner = rect.dots.slice().sort((a, b) => b.x - a.x)[0];
    const widthBefore = rect.width;
    await touchDrag(client, corner, { x: corner.x + 28, y: corner.y });
    await page.waitForTimeout(120);
    const widthAfter = (await sketch(page)).width;
    check(`${label} a rectangle handle edits the width`, widthAfter > widthBefore + 0.5, `${widthBefore} -> ${widthAfter}`);

    await clickTool(page, 'polygon');
    await page.waitForFunction(() => (window.__VIEWPORT__.stageContourSketch().dots || []).length === 6, null, { timeout: 4000 });
    const poly = await sketch(page);
    const origin = await project(page, [0, 0, 10]);
    const vertex = poly.dots.slice().sort((a, b) => (
      Math.hypot(b.x - origin.x, b.y - origin.y) - Math.hypot(a.x - origin.x, a.y - origin.y)
    ))[0];
    const away = Math.hypot(vertex.x - origin.x, vertex.y - origin.y) || 1;
    const radiusPoly = poly.radius;
    await touchDrag(client, vertex, {
      x: vertex.x + ((vertex.x - origin.x) / away) * 24,
      y: vertex.y + ((vertex.y - origin.y) / away) * 24,
    });
    await page.waitForTimeout(120);
    const radiusPolyAfter = (await sketch(page)).radius;
    check(`${label} a polygon handle edits the radius`, radiusPolyAfter > radiusPoly + 0.4, `${radiusPoly} -> ${radiusPolyAfter}`);

    await clickTool(page, 'polyline');
    await page.waitForFunction(() => (window.__VIEWPORT__.stageContourSketch().dots || []).length === 0, null, { timeout: 4000 });
    // World +X is screen-left on this sketch camera. Stay off the right rail.
    const A = [10, -2, 10];
    const B = [4, -2, 10];
    const C = [7, 6, 10];
    await tapWorld(client, page, A);
    await tapWorld(client, page, B);
    await tapWorld(client, page, C);
    const placed = await sketch(page);
    check(`${label} three polyline taps land`, placed.points === 3, JSON.stringify({
      points: placed.points,
      tool: placed.tool,
      gesture: placed.gesture,
    }));
    if (placed.points !== 3) throw new Error(`polyline taps did not land ${JSON.stringify(placed.uvs)}`);

    await clickTool(page, 'dimension');
    await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 8000 });
    const span = await sketch(page);
    const dots = span.dots || [];
    let lengthTap = null;
    for (let i = 0; i < dots.length; i += 1) {
      for (let j = i + 1; j < dots.length; j += 1) {
        const mid = { x: (dots[i].x + dots[j].x) / 2, y: (dots[i].y + dots[j].y) / 2 };
        const spanPx = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y);
        const inset = Math.min(mid.x, mid.y, 4000);
        const score = spanPx + inset * 2;
        if (!lengthTap || score > lengthTap.score) lengthTap = { ...mid, score };
      }
    }
    await tapAt(client, page, lengthTap.x, lengthTap.y);
    try {
      await page.waitForFunction(() => {
        const card = document.querySelector('[data-contour-card="dimension"]');
        return !!card?.querySelector('input[data-field-label="Length"]');
      }, null, { timeout: 8000 });
    } catch (err) {
      const diag = await page.evaluate(() => {
        const sketch = window.__VIEWPORT__.stageContourSketch();
        return {
          picked: sketch.picked,
          uvs: sketch.uvs,
          dots: (sketch.dots || []).map((d) => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y) })),
          card: (document.querySelector('[data-contour-card="dimension"]')?.innerText || '').slice(0, 200),
        };
      });
      throw new Error(`${err.message}\n${JSON.stringify(diag)}`);
    }
    const lengthField = page.locator('[data-contour-card="dimension"] input[data-field-label="Length"]');
    const lengthText = await lengthField.inputValue();
    check(`${label} a length displays positive`, Number(lengthText) > 0 && !String(lengthText).includes('-'), lengthText);
    await page.locator('[data-contour-card="dimension"] [data-feature-card-confirm]').click();
    await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().dimensions >= 1, null, { timeout: 4000 });

    await clickTool(page, 'circle');
    await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().gesture === '', null, { timeout: 4000 });
    await page.waitForTimeout(300);
    const beforeFree = await sketch(page);
    check(`${label} switching tools keeps the polyline`, beforeFree.tool === 'circle' && beforeFree.uvs.length === 3, JSON.stringify({
      tool: beforeFree.tool,
      n: beforeFree.uvs.length,
    }));
    const free = beforeFree.dots.find((dot) => dot.id === 'p2') || beforeFree.dots[2];
    const freeUv = beforeFree.uvs.find((p) => p.id === 'p2');
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-contour-tag]')) el.style.pointerEvents = 'none';
    });
    await touchDrag(client, free, { x: free.x + 80, y: free.y - 50 });
    await page.waitForTimeout(150);
    const afterFree = await sketch(page);
    const freeMoved = afterFree.uvs.find((p) => p.id === 'p2');
    const freeDelta = freeUv && freeMoved
      ? Math.hypot(freeMoved.u - freeUv.u, freeMoved.v - freeUv.v)
      : 0;
    check(`${label} a free point still drags after the tool change`, freeDelta > 1, `Δ ${freeDelta}`);

    await clickTool(page, 'constraints');
    await page.locator('[data-contour-card="constraint"]').waitFor({ timeout: 8000 });
    await waitCameraStill(page);
    const fixDot = (await sketch(page)).dots.find((dot) => dot.id === 'p2');
    if (!fixDot) throw new Error('missing p2');
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-contour-tag]')) el.style.pointerEvents = 'none';
    });
    await tapAt(client, page, fixDot.x, fixDot.y);
    try {
      await page.waitForFunction(() => {
        const card = document.querySelector('[data-contour-card="constraint"]');
        const confirm = card?.querySelector('[data-feature-card-confirm]');
        return card && /Fix/i.test(card.innerText || '') && confirm && !confirm.disabled;
      }, null, { timeout: 4000 });
    } catch (err) {
      const diag = await page.evaluate(() => ({
        picked: window.__VIEWPORT__.stageContourSketch().picked,
        card: (document.querySelector('[data-contour-card="constraint"]')?.innerText || '').slice(0, 240),
      }));
      throw new Error(`${err.message}\n${JSON.stringify(diag)}`);
    }
    await page.locator('[data-contour-card="constraint"] [data-feature-card-confirm]').click();
    await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().constraints >= 1, null, { timeout: 4000 });
    await clickTool(page, 'rectangle');
    await waitCameraStill(page);
    const lockedSketch = await sketch(page);
    const lockedDot = lockedSketch.dots.find((dot) => dot.id === 'p2');
    const lockedUv = lockedSketch.uvs.find((p) => p.id === 'p2');
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-contour-tag], [data-contour-tags] *')) {
        el.style.pointerEvents = 'none';
      }
    });
    let lockedDelta = Infinity;
    let camDelta = Infinity;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const dot = (await sketch(page)).dots.find((item) => item.id === 'p2') || lockedDot;
      const uv = (await sketch(page)).uvs.find((item) => item.id === 'p2') || lockedUv;
      const camBefore = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
      if (dot) await touchDrag(client, dot, { x: dot.x + 36, y: dot.y + 20 });
      await page.waitForTimeout(150);
      const camAfter = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
      const lockedAfter = (await sketch(page)).uvs.find((item) => item.id === 'p2');
      lockedDelta = uv && lockedAfter
        ? Math.hypot(lockedAfter.u - uv.u, lockedAfter.v - uv.v)
        : Infinity;
      camDelta = quatDelta(camBefore, camAfter);
      if (camDelta < 1e-3) break;
    }
    check(`${label} a solver-locked point stays fixed`, lockedDelta < 0.5 && camDelta < 1e-3, `Δ ${lockedDelta} cam ${camDelta}`);

    await page.evaluate(() => document.querySelector('[data-contour-tag="d0"]')?.click());
    await page.locator('[data-contour-dimension-delete]').click();
    await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().dimensions === 0, null, { timeout: 4000 });
    await clickTool(page, 'polyline');
    // Horizontal edges run +X, so the left normal is +Y and v < -15 is the
    // negative side. Vertical edges run +Y, so u > 20 is the negative side.
    const outsideSpots = [
      { world: [0, -22, 10], edge: [8, -15, 10], sideOf: (p) => Math.sign(p.v + 15) },
      { world: [26, 0, 10], edge: [20, 4, 10], sideOf: (p) => Math.sign(20 - p.u) },
    ];
    let spot = null;
    for (let attempt = 0; attempt < 6 && !spot; attempt += 1) {
      for (const cand of outsideSpots) {
        const hit = await upperCanvasPoint(page, cand.world, viewport);
        const edgeHit = await upperCanvasPoint(page, cand.edge, viewport);
        if (hit && edgeHit) {
          spot = cand;
          break;
        }
      }
      if (!spot) await zoomOut(page);
    }
    if (!spot) throw new Error('the outside point is off screen');
    const outsideHit = await upperCanvasPoint(page, spot.world, viewport);
    await tapAt(client, page, outsideHit.x, outsideHit.y);
    await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().uvs.length === 4, null, { timeout: 4000 });
    await clickTool(page, 'dimension');
    await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 8000 });
    // A touch coast can still be moving the sketch. Let it stop, then tap the handle.
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-contour-tag]')) el.style.pointerEvents = 'none';
    });
    const outside = (await sketch(page)).uvs.find((p) => p.id === 'p3');
    let outsideDot = (await sketch(page)).dots.find((dot) => dot.id === outside?.id);
    if (!outside || !outsideDot) throw new Error('missing outside point');
    await tapAt(client, page, outsideDot.x, outsideDot.y);
    const pointPicked = async () => page.evaluate(() => (
      window.__VIEWPORT__.stageContourSketch().picked.some((p) => p.kind === 'point' && p.id === 'p3')
    ));
    if (!await pointPicked()) {
      await page.waitForTimeout(200);
      outsideDot = (await sketch(page)).dots.find((dot) => dot.id === 'p3');
      if (outsideDot) await tapAt(client, page, outsideDot.x, outsideDot.y);
    }
    try {
      await page.waitForFunction(() => (
        window.__VIEWPORT__.stageContourSketch().picked.some((p) => p.kind === 'point' && p.id === 'p3')
      ), null, { timeout: 3000 });
    } catch (err) {
      const diag = await page.evaluate(() => {
        const sketch = window.__VIEWPORT__.stageContourSketch();
        return {
          picked: sketch.picked,
          uvs: sketch.uvs,
          dots: (sketch.dots || []).map((d) => {
            const el = document.elementFromPoint(d.x, d.y);
            return { id: d.id, x: Math.round(d.x), y: Math.round(d.y), el: el?.tagName || '' };
          }),
        };
      });
      throw new Error(`outside point was not picked ${JSON.stringify(diag)}`);
    }
    const edgeHit = await project(page, spot.edge);
    if (!edgeHit?.ok) throw new Error(`reference edge is off screen ${JSON.stringify(edgeHit)}`);
    await tapAt(client, page, edgeHit.x, edgeHit.y);
    try {
      await page.waitForFunction(() => !!document.querySelector('[data-contour-card="dimension"] input[data-field-label="Distance"]'), null, { timeout: 4000 });
    } catch (err) {
      const diag = await page.evaluate(() => ({
        picked: window.__VIEWPORT__.stageContourSketch().picked,
        uvs: window.__VIEWPORT__.stageContourSketch().uvs,
        card: (document.querySelector('[data-contour-card="dimension"]')?.innerText || '').slice(0, 240),
      }));
      throw new Error(`${err.message}\n${JSON.stringify(diag)}`);
    }
    const distField = page.locator('[data-contour-card="dimension"] input[data-field-label="Distance"]');
    const stored = (await sketch(page)).dims.find((dim) => dim.kind === 'distance');
    const shown = await distField.inputValue();
    const sideBefore = Math.sign(stored?.value || 0);
    const gapBefore = (await sketch(page)).uvs.find((p) => p.id === outside.id);
    check(`${label} a negative-side distance displays positive`,
      stored && stored.value < 0 && Number(shown) > 0 && !String(shown).includes('-'),
      `shown ${shown} stored ${stored?.value}`);
    const bigger = String(Math.round((Math.abs(Number(shown)) + 4) * 100) / 100);
    await distField.fill(bigger);
    await page.waitForTimeout(250);
    const afterDim = (await sketch(page)).dims.find((dim) => dim.kind === 'distance');
    const gapAfter = (await sketch(page)).uvs.find((p) => p.id === outside.id);
    const sameSide = gapBefore && gapAfter
      && spot.sideOf(gapBefore) < 0
      && spot.sideOf(gapAfter) === spot.sideOf(gapBefore);
    check(`${label} typing a positive value keeps the side`,
      afterDim && Math.sign(afterDim.value) === sideBefore && sideBefore < 0 && Math.abs(afterDim.value) > Math.abs(stored.value) - 0.2 && sameSide,
      `stored ${stored?.value} -> ${afterDim?.value} v ${gapBefore?.v} -> ${gapAfter?.v}`);

    await page.screenshot({ path: join(SHOT_DIR, `contour-keep-edit-${label}.png`) });
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
console.log('\ncontour keep edit golden passed');
