#!/usr/bin/env node
/**
 * Polyline perpendicular at 390 and 1280, touch only.
 *
 * Two segments of a polyline take a perpendicular. After Add the lines are
 * neither amber nor red, the repeated note is absent, and the angle is 90°.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5297);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'return Manifold.cube([40, 30, 20], true);\n';
const AMBER = 0xfbbf24;
const RED = 0xf87171;
const POINTS = [
  [10, -8, 10],
  [-8, -4, 10],
  [-2, 8, 10],
  [6, 5, 10],
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

console.log('contour perpendicular');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour perpendicular: no system Chrome — set CHROME_PATH');
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
  await page.waitForTimeout(120);
}

async function tapWorld(client, page, world) {
  const hit = await project(page, world);
  if (!hit.ok) throw new Error(`tap blocked ${JSON.stringify(hit)} ${JSON.stringify(world)}`);
  await tapAt(client, page, hit.x, hit.y);
  return hit;
}

function angleOf(uvs) {
  const at = Object.fromEntries((uvs || []).map((p) => [p.id, p]));
  const d1 = [at.p1.u - at.p0.u, at.p1.v - at.p0.v];
  const d2 = [at.p2.u - at.p1.u, at.p2.v - at.p1.v];
  const dot = d1[0] * d2[0] + d1[1] * d2[1];
  const n = Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]);
  return Math.acos(Math.max(-1, Math.min(1, dot / n))) * 180 / Math.PI;
}

async function tapSegment(client, page, aId, bId) {
  const state = await sketch(page);
  const dots = Object.fromEntries((state.dots || []).map((dot) => [dot.id, dot]));
  const a = dots[aId];
  const b = dots[bId];
  if (!a || !b) throw new Error(`missing dots ${aId} ${bId}`);
  for (const t of [0.5, 0.35, 0.65, 0.42]) {
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const hit = await page.evaluate(({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      const blocked = el?.closest?.('[data-contour-card], [data-feature-sheet], [data-contour-tool], [data-cad-feature-strip]');
      return { canvas: el?.tagName === 'CANVAS' && !blocked, tag: el?.tagName || '' };
    }, { px: x, py: y });
    if (!hit.canvas) continue;
    await tapAt(client, page, x, y);
    return { x, y };
  }
  throw new Error(`segment ${aId}-${bId} is covered`);
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
    await page.locator('[data-contour-tool="polyline"]').click();
    await page.locator('[data-feature-card-confirm]').click();
    await page.waitForFunction(() => (
      document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
      && !document.querySelector('[data-contour-chip]')
    ), null, { timeout: 8000 });

    for (const world of POINTS) await tapWorld(client, page, world);
    await page.waitForFunction(
      (n) => window.__VIEWPORT__.stageContourSketch().uvs.length === n,
      POINTS.length,
      { timeout: 4000 },
    );

    await page.locator('[data-contour-tool="constraints"]').click();
    await page.locator('[data-contour-card="constraint"]').waitFor({ timeout: 8000 });
    await page.waitForFunction(() => (
      (window.__VIEWPORT__.stageContourSketch().dots || []).length >= 4
    ), null, { timeout: 4000 });

    const before = angleOf((await sketch(page)).uvs);
    check(`${label} the corner starts away from 90°`, Math.abs(before - 90) > 5, String(before));

    await tapSegment(client, page, 'p0', 'p1');
    await tapSegment(client, page, 'p1', 'p2');
    await page.waitForFunction(() => {
      const picked = window.__VIEWPORT__.stageContourSketch().picked || [];
      const lines = picked.filter((pick) => pick.kind === 'line').map((pick) => pick.id);
      return lines.includes('e0') && lines.includes('e1');
    }, null, { timeout: 4000 });

    await page.locator('[data-contour-card="constraint"] [data-sticky-property="perpendicular"]').click();
    await page.locator('[data-contour-card="constraint"] [data-feature-card-confirm]').click();
    await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().constraints >= 1, null, { timeout: 4000 });
    await page.waitForTimeout(200);

    const after = await sketch(page);
    const turn = angleOf(after.uvs);
    const segmentLines = (after.lines || []).filter((line) => line.id === 'e0' || line.id === 'e1');
    const repeated = await page.locator('[data-contour-repeated]').count();
    const conflict = await page.locator('[data-contour-conflict]').count();
    check(`${label} perpendicular is stored`, after.constraints === 1, String(after.constraints));
    check(`${label} picks clear after Add`, (after.picked || []).length === 0, JSON.stringify(after.picked));
    check(`${label} the angle is 90°`, Math.abs(turn - 90) < 0.5, String(turn));
    check(`${label} both segments are painted`, segmentLines.length >= 2, JSON.stringify(after.lines));
    check(`${label} the segments are not amber or red`,
      segmentLines.length >= 2 && segmentLines.every((line) => line.color !== AMBER && line.color !== RED),
      segmentLines.map((line) => `${line.id}:${(line.color ?? 0).toString(16)}`).join(','));
    check(`${label} no repeated note`, repeated === 0);
    check(`${label} no conflict note`, conflict === 0);
    check(`${label} no page error`, errors.length === 0, errors.join(' | '));

    const shot = join(SHOT_DIR, `contour-perpendicular-${viewport.width}.png`);
    await page.screenshot({ path: shot });
    check(`${label} screenshot`, existsSync(shot), shot);
  } finally {
    await context.close();
  }
}

const up = await waitForServer();
if (!up) {
  stop();
  console.log('contour perpendicular: vite did not start');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
try {
  await runSize(browser, '390', { width: 390, height: 844 });
  await runSize(browser, '1280', { width: 1280, height: 800 });
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`contour perpendicular: ${failed} failed`);
  process.exit(1);
}
console.log('contour perpendicular ok');
