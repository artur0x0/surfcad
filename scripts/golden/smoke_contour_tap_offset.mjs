#!/usr/bin/env node
/**
 * Contour tap offset at 390 and 1280.
 *
 * A touch tap places a polyline point within 2px of the finger. The spots
 * are the center and four corners, with the plane card closed and open, and
 * again after the part is translated in the sketch plane. The camera looks
 * along the picked face normal with the top-view up hint.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5288);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = `let host = Manifold.cube([40, 30, 20], true);
let boss = Manifold.cube([10, 10, 8], true).translate([0, 0, 14]);
return host.add(boss);
`;
const FACE = [0, 0, 18];
const POSE = [8, 0, 0];
const LIMIT_PX = 2;
const CLOSED = [
  ['center', 0.50, 0.40],
  ['tl', 0.28, 0.18],
  ['tr', 0.76, 0.18],
  ['bl', 0.28, 0.58],
  ['br', 0.76, 0.58],
];
const OPEN = [
  ['center', 0.50, 0.30],
  ['tl', 0.28, 0.14],
  ['tr', 0.76, 0.14],
  ['bl', 0.28, 0.42],
  ['br', 0.76, 0.42],
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

console.log('contour tap offset');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour tap offset: no system Chrome — set CHROME_PATH');
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
    window.__VIEWPORT__.executeScript(src, { partId: 'boss' })
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 25, el: 62, margin: 1.8 }));
  await page.waitForTimeout(250);
}

async function projectHitsCanvas(page, world) {
  return page.evaluate((w) => {
    const p = window.__VIEWPORT__.stageProject(w);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas) return { ok: false, reason: 'no project' };
    const el = document.elementFromPoint(p.x, p.y);
    return {
      ok: el === canvas,
      x: p.x,
      y: p.y,
      tag: el ? el.tagName : '',
    };
  }, world);
}

async function enterSketch(page, label) {
  await page.locator('button[aria-label^="Insert Create contour"]').click();
  await page.locator('[data-contour-exit]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 18, el: 68, margin: 1.7 }));
  await page.waitForTimeout(200);

  let hit = await projectHitsCanvas(page, FACE);
  if (!hit?.ok) {
    await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 8, el: 74, margin: 2.1 }));
    await page.waitForTimeout(200);
    hit = await projectHitsCanvas(page, FACE);
  }
  check(`${label} face center lands on the canvas`, !!hit?.ok, JSON.stringify(hit));
  if (!hit?.ok) return false;
  const canvas = page.locator('.viewport-shell > canvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: hit.x - box.x, y: hit.y - box.y } });
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().planePreset === 'face', null, { timeout: 4000 });
  const start = page.locator('[data-feature-card-confirm]');
  await start.waitFor({ timeout: 4000 });
  await start.click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
  ), null, { timeout: 8000 });
  await page.locator('[data-contour-tool="polyline"]').click();
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().tool === 'polyline', null, { timeout: 4000 });
  const cam = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  const align = dotView(cam, [0, 0, 1]);
  const up = cam?.up || [];
  check(`${label} camera looks along +Z`, align != null && align > 0.98, String(align));
  check(`${label} sketch up is the top view`, Math.hypot(up[0] || 0, (up[1] || 0) + 1, up[2] || 0) < 0.05, JSON.stringify(up));
  return true;
}

async function canvasSpot(page, fx, fy) {
  return page.evaluate(({ fx, fy }) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!canvas) return { ok: false, reason: 'no canvas' };
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + fx * rect.width;
    const y = rect.top + fy * rect.height;
    const el = document.elementFromPoint(x, y);
    const card = document.querySelector('[data-feature-card]');
    const cardTop = card ? card.getBoundingClientRect().top : null;
    return {
      ok: el === canvas && (cardTop == null || y < cardTop - 4),
      x,
      y,
      tag: el ? el.tagName : '',
      cardTop,
    };
  }, { fx, fy });
}

async function placeTap(page, label, name, fx, fy) {
  const at = await canvasSpot(page, fx, fy);
  check(`${label} ${name} hits the canvas`, !!at.ok, JSON.stringify(at));
  if (!at.ok) return;
  const before = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch().points);
  await page.touchscreen.tap(at.x, at.y);
  try {
    await page.waitForFunction((n) => window.__VIEWPORT__.stageContourSketch().points === n + 1, before, { timeout: 4000 });
  } catch { /* reported below */ }
  const sketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  const dot = sketch.dots?.[sketch.dots.length - 1];
  const dx = dot ? dot.x - at.x : null;
  const dy = dot ? dot.y - at.y : null;
  const dist = dx == null ? null : Math.hypot(dx, dy);
  console.log(`  ${label} ${name} tap ${at.x.toFixed(1)},${at.y.toFixed(1)} dot ${dot ? `${dot.x.toFixed(1)},${dot.y.toFixed(1)}` : 'none'} d ${dist == null ? 'none' : dist.toFixed(2)}`);
  check(
    `${label} ${name} lands within ${LIMIT_PX}px`,
    sketch.points === before + 1 && dist != null && dist <= LIMIT_PX,
    `d=${dist} dx=${dx} dy=${dy} points=${sketch.points} tool=${sketch.tool}`,
  );
}

async function placeSet(page, label, spots) {
  for (const [name, fx, fy] of spots) {
    await placeTap(page, label, name, fx, fy);
  }
}

async function ensurePolyline(page) {
  const sketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  if (sketch.tool === 'polyline') return sketch;
  await page.locator('[data-contour-tool="polyline"]').click();
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().tool === 'polyline', null, { timeout: 4000 });
  return page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
}

async function undoToEmpty(page, label) {
  for (let i = 0; i < 20; i += 1) {
    const sketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
    // Stop on an empty polyline. One more Back restores the circle baseline
    // that Start drawing seeded, and the taps after that would not place points.
    if ((sketch.points || 0) === 0 && sketch.tool === 'polyline' && !sketch.planeCard) break;
    if (sketch.planeCard) {
      check(`${label} points cleared`, false, 'plane card opened early');
      return false;
    }
    if ((sketch.points || 0) === 0) break;
    const before = sketch.points;
    await page.locator('[data-contour-back]').click();
    await page.waitForFunction((n) => window.__VIEWPORT__.stageContourSketch().points < n, before, { timeout: 4000 });
  }
  const sketch = await ensurePolyline(page);
  check(`${label} points cleared`, sketch.points === 0 && sketch.tool === 'polyline' && !sketch.planeCard, JSON.stringify(sketch));
  return sketch.points === 0 && sketch.tool === 'polyline' && !sketch.planeCard;
}

async function openPlaneCard(page, label) {
  for (let i = 0; i < 8; i += 1) {
    const sketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
    if (sketch.planeCard) break;
    if ((sketch.points || 0) > 0) {
      check(`${label} plane card is open`, false, `points still placed ${JSON.stringify(sketch)}`);
      return;
    }
    const before = { depth: sketch.undoDepth || 0, tool: sketch.tool || '' };
    await page.locator('[data-contour-back]').click();
    await page.waitForFunction((prev) => {
      const next = window.__VIEWPORT__.stageContourSketch();
      return next.planeCard || next.undoDepth < prev.depth || next.tool !== prev.tool;
    }, before, { timeout: 4000 });
  }
  await page.locator('[data-feature-card]').waitFor({ timeout: 4000 });
  await page.waitForTimeout(900);
  const open = await ensurePolyline(page);
  check(`${label} plane card is open`, !!open.planeCard && open.tool === 'polyline' && open.points === 0, JSON.stringify(open));
}

async function clearWithTool(page, label) {
  await page.locator('[data-contour-tool="circle"]').click();
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().tool === 'circle', null, { timeout: 4000 });
  await page.locator('[data-contour-tool="polyline"]').click();
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return sketch.tool === 'polyline' && sketch.points === 0;
  }, null, { timeout: 4000 });
  const sketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check(`${label} tool switch cleared the points`, sketch.points === 0 && sketch.tool === 'polyline', JSON.stringify(sketch));
}

async function setPose(page, t) {
  const ok = await page.evaluate((pose) => window.__VIEWPORT__.stageSetActivePose(pose), t);
  const got = await page.evaluate(() => window.__VIEWPORT__.stageActivePose());
  return ok && got && Math.hypot(got.t[0] - t[0], got.t[1] - t[1], got.t[2] - t[2]) < 1e-6;
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);
  const aimed = await enterSketch(page, label);
  if (!aimed) {
    check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
    await context.close();
    return;
  }

  await placeSet(page, `${label} closed`, CLOSED);
  await page.screenshot({ path: join(SHOT_DIR, `contour-tap-${label}-closed.png`) });
  await undoToEmpty(page, `${label} closed`);

  check(`${label} posed the part`, await setPose(page, POSE));
  await placeSet(page, `${label} closed posed`, CLOSED);
  await undoToEmpty(page, `${label} closed posed`);
  check(`${label} pose restored`, await setPose(page, [0, 0, 0]));

  await openPlaneCard(page, label);
  await placeSet(page, `${label} open`, OPEN);
  await page.screenshot({ path: join(SHOT_DIR, `contour-tap-${label}-open.png`) });
  await clearWithTool(page, `${label} open`);
  check(`${label} posed the part under the card`, await setPose(page, POSE));
  await placeSet(page, `${label} open posed`, OPEN);

  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('contour tap offset: vite did not start');
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
    hasTouch: true,
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
  console.log(`contour tap offset: ${failed} failed`);
  process.exit(1);
}
console.log('contour tap offset: ok');
