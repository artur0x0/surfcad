#!/usr/bin/env node
/**
 * Sketch-on-face at 390px.
 *
 * Select plane aims along the picked face's outward normal and frames the
 * face. The highlight is off when the aim ends. Back undoes one polyline
 * point. X exits contour mode.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5237);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = `let host = Manifold.cube([40, 30, 20], true);
let boss = Manifold.cube([10, 10, 8], true).translate([0, 0, 14]);
return host.add(boss);
`;
const FACE = [0, 0, 18];
const FACE_CORNERS = [[-5, -5, 18], [5, -5, 18], [5, 5, 18], [-5, 5, 18]];
const HOST_CORNERS = [
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

console.log('sketch face camera');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('sketch face camera: no system Chrome — set CHROME_PATH');
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
  // A face pick is ignored until the viewport has a part id. The hook run
  // does not go through assembly seeding, so name one here.
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

async function ndcExtent(page, corners) {
  return page.evaluate((pts) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const rect = canvas.getBoundingClientRect();
    let extent = 0;
    const mapped = [];
    for (const w of pts) {
      const p = window.__VIEWPORT__.stageProject(w);
      if (!p) return { ok: false, extent: null, mapped };
      const u = ((p.x - rect.left) / rect.width) * 2 - 1;
      const v = 1 - ((p.y - rect.top) / rect.height) * 2;
      extent = Math.max(extent, Math.abs(u), Math.abs(v));
      mapped.push([+u.toFixed(3), +v.toFixed(3)]);
    }
    return { ok: true, extent: +extent.toFixed(3), mapped };
  }, corners);
}

async function runPhone(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

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
  check('390 face center lands on the canvas', !!hit?.ok, JSON.stringify(hit));
  if (hit?.ok) {
    const canvas = page.locator('.viewport-shell > canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: hit.x - box.x, y: hit.y - box.y } });
    // Face clicks wait out the multi-click delay before the plane updates.
    await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().planePreset === 'face', null, { timeout: 4000 });
  }
  const start = page.locator('[data-feature-card-confirm]');
  await start.waitFor({ timeout: 4000 });
  check('390 Select plane is the plane card action', (await start.innerText()).includes('Select plane'));
  await start.click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
  ), null, { timeout: 8000 });
  // A callback-identity re-render used to start a second aim after this one
  // finished, and that aim framed the whole part. Stay past that tween.
  await page.waitForTimeout(500);

  const sketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  const cam = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  const align = dotView(cam, [0, 0, 1]);
  const centerNdc = await ndcExtent(page, [FACE]);
  console.log(`  390 aim ${JSON.stringify(sketch)} align ${align?.toFixed?.(3)} target ${JSON.stringify(cam?.target)} center ${JSON.stringify(centerNdc.mapped)}`);
  check('390 camera looks along +Z', align != null && align > 0.98, String(align));
  check('390 face center is in frame', centerNdc.ok && centerNdc.extent < 0.35, JSON.stringify(centerNdc));
  check('390 highlight is off', sketch?.highlights === 0, JSON.stringify(sketch));
  check('390 sketch plane is the face', sketch?.planePreset === 'face', JSON.stringify(sketch));

  const faceNdc = await ndcExtent(page, FACE_CORNERS);
  const hostNdc = await ndcExtent(page, HOST_CORNERS);
  console.log(`  390 face extent ${faceNdc.extent} host extent ${hostNdc.extent}`);
  check('390 face is framed', faceNdc.ok && faceNdc.extent >= 0.55 && faceNdc.extent <= 1.02, JSON.stringify(faceNdc));
  check('390 host sticks outside the frame', hostNdc.ok && hostNdc.extent > 1.05, JSON.stringify(hostNdc));

  const back = page.locator('[data-contour-back]');
  await back.waitFor({ timeout: 4000 });
  check('390 Back is on the rail', await back.count() === 1 && !(await back.isDisabled()));
  check('390 plane card closed after Select plane', await page.locator('[data-contour-chip]').count() === 0);
  check('390 rail stayed in contour mode', await page.locator('[data-contour-tool="circle"]').count() === 1);

  await page.locator('[data-contour-tool="polyline"]').click();
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().tool === 'polyline', null, { timeout: 4000 });
  const pointHit = await projectHitsCanvas(page, [1.5, -1.2, 18]);
  check('390 polyline tap lands on the canvas', !!pointHit?.ok, JSON.stringify(pointHit));
  if (pointHit?.ok) await page.mouse.click(pointHit.x, pointHit.y);
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().points === 1, null, { timeout: 4000 });
  const withPoint = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check('390 one polyline point', withPoint.points === 1 && withPoint.undoDepth >= 1, JSON.stringify(withPoint));
  check('390 Back is enabled', !(await back.isDisabled()));

  await back.click();
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().points === 0, null, { timeout: 4000 });
  const undone = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check('390 Back undoes one point', undone.points === 0 && undone.tool === 'polyline' && undone.open, JSON.stringify(undone));
  check('390 rail stays after Back', await page.locator('[data-contour-exit]').count() === 1);

  await page.screenshot({ path: join(SHOT_DIR, 'sketch-face-camera-390.png') });
  await page.locator('[data-contour-exit]').click();
  await page.waitForFunction(() => !document.querySelector('[data-contour-exit]'), null, { timeout: 4000 });
  check('390 X exits contour mode', await page.locator('[data-contour-exit]').count() === 0);
  check('390 no page errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('sketch face camera: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  await runPhone(browser);
} catch (err) {
  failed += 1;
  console.log(`  ❌ run — ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`sketch face camera failed (${failed})`);
  process.exit(1);
}
console.log('sketch face camera passed');
