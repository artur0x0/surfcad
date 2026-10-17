#!/usr/bin/env node
/**
 * Contour entry at 390px and 1280px.
 *
 * The plane card slides the part up and is titled Contour. Select plane
 * aims the camera along the sketch-plane normal, zoom-fits, and closes the
 * card while the rail stays in contour tools. Back undoes one polyline
 * point, and the next Back reopens the plane card. Confirm finishes.
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

const PORT = Number(process.env.SMOKE_PORT || 5241);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'return Manifold.cube([40, 30, 20], true);\n';
const CORNERS = [
  [-20, -15, -10], [20, -15, -10], [-20, 15, -10], [20, 15, -10],
  [-20, -15, 10], [20, -15, 10], [-20, 15, 10], [20, 15, 10],
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

console.log('contour entry');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour entry: no system Chrome — set CHROME_PATH');
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
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  // Fit before the card opens. A fit while the card is open disarms the slide.
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function lowestNdc(page) {
  return page.evaluate((pts) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return null;
    let low = Infinity;
    for (const w of pts) {
      const p = window.__VIEWPORT__.stageProject(w);
      if (!p) return null;
      const v = 1 - ((p.y - rect.top) / rect.height) * 2;
      if (v < low) low = v;
    }
    return Number.isFinite(low) ? low : null;
  }, CORNERS);
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

async function projectHitsCanvas(page, world) {
  return page.evaluate((w) => {
    const p = window.__VIEWPORT__.stageProject(w);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas) return { ok: false, reason: 'no project' };
    const el = document.elementFromPoint(p.x, p.y);
    return { ok: el === canvas, x: p.x, y: p.y, tag: el ? el.tagName : '' };
  }, world);
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

  const before = await lowestNdc(page);
  const beforeCam = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  await page.locator('button[aria-label^="Insert Create contour"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  const title = (await page.locator('[data-feature-card-title]').innerText()).trim();
  check(`${label} plane card title is Contour`, title === 'Contour', title);
  const start = page.locator('[data-feature-card-confirm]');
  check(`${label} Select plane is the plane action`, (await start.innerText()).includes('Select plane'));
  await page.waitForTimeout(500);
  const after = await lowestNdc(page);
  const afterCam = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  const lifted = after != null && before != null ? after - before : null;
  const moved = beforeCam && afterCam
    ? Math.hypot(
      afterCam.position[0] - beforeCam.position[0],
      afterCam.position[1] - beforeCam.position[1],
      afterCam.position[2] - beforeCam.position[2],
    )
    : null;
  console.log(`  ${label} slide before ${before?.toFixed?.(3)} after ${after?.toFixed?.(3)} lifted ${lifted?.toFixed?.(3)} moved ${moved?.toFixed?.(3)}`);
  check(`${label} plane card slides the part up`, lifted != null && lifted >= 0.08 && moved > 0.5, `lifted ${lifted} moved ${moved}`);
  await page.screenshot({ path: join(SHOT_DIR, `contour-entry-${label}-plane.png`) });

  await page.locator('[data-contour-tool="polyline"]').click();
  await start.click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  const cam = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  const align = dotView(cam, [0, 0, 1]);
  const framed = await ndcExtent(page, CORNERS);
  const sketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  console.log(`  ${label} aim align ${align?.toFixed?.(3)} extent ${framed.extent} ${JSON.stringify(sketch)}`);
  check(`${label} camera looks along +Z`, align != null && align > 0.98, String(align));
  check(`${label} part is zoom-fitted`, framed.ok && framed.extent >= 0.4 && framed.extent <= 1.05, JSON.stringify(framed));
  check(`${label} plane card is dismissed`, await page.locator('[data-contour-chip]').count() === 0);
  check(`${label} rail stays in contour mode`,
    await page.locator('[data-contour-exit]').count() === 1
    && await page.locator('[data-contour-tool="polyline"]').count() === 1
    && await page.locator('[data-contour-back]').count() === 1
    && await page.locator('[data-contour-confirm]').count() === 1);

  const pointHit = await projectHitsCanvas(page, [4, -3, 10]);
  check(`${label} polyline tap lands on the canvas`, !!pointHit?.ok, JSON.stringify(pointHit));
  if (pointHit?.ok) await page.mouse.click(pointHit.x, pointHit.y);
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().points === 1, null, { timeout: 4000 });
  const withPoint = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check(`${label} one polyline point is one undo step`, withPoint.points === 1 && withPoint.undoDepth >= 1, JSON.stringify(withPoint));

  await page.locator('[data-contour-back]').click();
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().points === 0, null, { timeout: 4000 });
  const undone = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check(`${label} Back undoes the point`,
    undone.points === 0 && undone.tool === 'polyline' && undone.undoDepth === 0 && undone.open && !undone.planeCard,
    JSON.stringify(undone));
  check(`${label} rail stays after the undo`, await page.locator('[data-contour-chip]').count() === 0);

  await page.locator('[data-contour-back]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 4000 });
  const reopened = (await page.locator('[data-feature-card-title]').innerText()).trim();
  const reopenedSketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check(`${label} Back reopens the plane card`, reopened === 'Contour' && reopenedSketch.planeCard && reopenedSketch.open, `${reopened} ${JSON.stringify(reopenedSketch)}`);
  check(`${label} rail stays with the plane card`, await page.locator('[data-contour-tool="circle"]').count() === 1);

  await page.locator('[data-contour-tool="circle"]').click();
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  await page.locator('[data-contour-confirm]').click();
  try {
    await page.waitForFunction(() => !document.querySelector('[data-contour-exit]'), null, { timeout: 8000 });
  } catch { /* reported below */ }
  const still = await page.locator('[data-contour-exit]').count();
  const toast = still
    ? await page.evaluate(() => (document.body.innerText || '').slice(0, 400))
    : '';
  check(`${label} Confirm finishes the contour`, still === 0, toast);
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: join(SHOT_DIR, `contour-entry-${label}-done.png`) });
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('contour entry: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
attachConsentPresetToBrowser(browser);
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
  console.log(`contour entry: ${failed} failed`);
  process.exit(1);
}
console.log('contour entry: ok');
