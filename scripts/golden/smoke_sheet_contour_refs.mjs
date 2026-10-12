#!/usr/bin/env node
/**
 * Sheet Metallica: dimension a sketch point to a flange edge, constrain a
 * sketch line parallel to that edge, then lengthen the flange.
 *
 * The fillet boundary catalog is empty on this part, so a tap used to miss.
 * Face ids also restart on each flange, so a later edit used to break the
 * reference. Touch taps at 390 and 1280.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window, WheelEvent */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { emitSolveContour } from '../../src/utils/contourScript.js';
import { emitNamedContourLine } from '../../src/utils/namedContour.js';

const PORT = Number(process.env.SMOKE_PORT || 5274);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();

const SPEC = {
  v: 1,
  sku: 'SST316-125',
  material: 'Stainless Steel (316 Series)',
  t: 3.175,
  r: 3.81,
  k: 0.38,
  plane: 'XZ',
  width: 100,
  height: 60,
  bends: [
    { id: 'b1', panel: 'base', edge: 'u-', angle: 90, length: 28.2, flip: true },
    { id: 'b2', panel: 'b1', edge: 'u+', angle: 90, length: 28.2, flip: false },
    { id: 'b3', panel: 'base', edge: 'u+', angle: 90, length: 28.2, flip: true },
    { id: 'b4', panel: 'b3', edge: 'u+', angle: 90, length: 28.2, flip: false },
  ],
  tabs: [{ id: 't1', panel: 'base', edge: 'v+', width: 25, depth: 10, centered: true, offset: 37.5 }],
  holes: [{ id: 'h1', panel: 'base', u: -23.93, v: 1.91, d: 5, type: 'hole' }],
};

const FRAME = { center: [0, 0, 0], normal: [0, 1, 0], x: [1, 0, 0], y: [0, 0, -1] };
const RECT = {
  points: [
    { id: 'p0', at: [-20, -15] },
    { id: 'p1', at: [20, -15] },
    { id: 'p2', at: [20, 15] },
    { id: 'p3', at: [-20, 15] },
  ],
  lines: [
    { id: 'e0', a: 'p0', b: 'p1' },
    { id: 'e1', a: 'p1', b: 'p2' },
    { id: 'e2', a: 'p2', b: 'p3' },
    { id: 'e3', a: 'p3', b: 'p0' },
  ],
  arcs: [],
  dimensions: [],
  constraints: [],
};

const B2 = '{"id":"b2","panel":"b1","edge":"u+","angle":90,"length":28.2,"flip":false}';
const B2_LONG = '{"id":"b2","panel":"b1","edge":"u+","angle":90,"length":40,"flip":false}';

function sheetScript() {
  const line = emitNamedContourLine({
    name: 'c1',
    id: 'c1',
    frame: FRAME,
    profileExpr: emitSolveContour(RECT),
  });
  return `${line}\nconst sheetSpec = ${JSON.stringify(SPEC)};\nlet part = sheetMetalSolid(sheetSpec);\nreturn part;\n`;
}

const SCRIPT = sheetScript();

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

console.log('sheet contour references (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('sheet contour refs: no system Chrome — set CHROME_PATH');
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

async function editorScript(page) {
  return page.evaluate(() => (
    (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n')
  ));
}

async function clickSel(page, selector) {
  const clicked = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`missing ${selector}`);
}

async function viewAlign(page) {
  const cam = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  if (!cam?.position || !cam?.target) return null;
  const d = [
    cam.position[0] - cam.target[0],
    cam.position[1] - cam.target[1],
    cam.position[2] - cam.target[2],
  ];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (!(len > 1e-9)) return null;
  return d[1] / len;
}

/** Finger tap. Moves a few pixels so a rotate-on-pointerdown cannot hide. */
async function touchWorld(page, client, world) {
  const pt = await page.evaluate((w) => {
    const p = window.__VIEWPORT__.project(w[0], w[1], w[2]);
    if (!p || p.behind) return { error: `off screen ${JSON.stringify(w)}` };
    const el = document.elementFromPoint(p.x, p.y);
    const blocked = el?.closest('[data-contour-card], [data-feature-sheet], [data-contour-tool], [data-cad-feature-strip], [data-part-row], [data-rail-pair], [data-feature-card]');
    return {
      ...p,
      top: el ? `${el.tagName}` : 'none',
      blocked: blocked ? (blocked.getAttribute('data-contour-card') || blocked.getAttribute('data-contour-tool') || blocked.getAttribute('data-rail-pair') || 'chrome') : '',
    };
  }, world);
  if (pt.error) throw new Error(pt.error);
  if (pt.blocked) throw new Error(`tap covered by ${pt.blocked} at ${Math.round(pt.x)},${Math.round(pt.y)}`);
  const dx = pt.x < 24 ? 0 : 6;
  const dy = pt.y < 24 ? 0 : 4;
  const start = { x: pt.x, y: pt.y, id: 1 };
  const moved = { x: pt.x + dx, y: pt.y + dy, id: 1 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await page.waitForTimeout(40);
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved] });
  await page.waitForTimeout(70);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(40);
  return pt;
}

/** Mid-span of the return-flange lip. The ends are vertices, and parallel needs the edge. */
function lipCandidates() {
  const out = [];
  for (const z of [0, 4, -4, 8, -8, 12, -12]) {
    out.push([-89, 39, z]);
    out.push([-89, 36, z]);
  }
  return out;
}

async function wheelZoomOut(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent('wheel', {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaY: 480,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
    }));
  });
  await page.waitForTimeout(160);
}

/** The framed lip can sit under the phone rail. Zoom out along the same view until a point is clear. */
async function revealLip(page) {
  for (let i = 0; i < 8; i += 1) {
    const lip = await firstClearLip(page);
    if (lip) return lip;
    await wheelZoomOut(page);
  }
  return null;
}

async function firstClearLip(page) {
  return page.evaluate((candidates) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    let best = null;
    let bestAbs = Infinity;
    for (const world of candidates) {
      const p = window.__VIEWPORT__.project(world[0], world[1], world[2]);
      if (!p || p.behind) continue;
      if (p.x < 16 || p.y < 16) continue;
      const el = document.elementFromPoint(p.x, p.y);
      if (!el || (el !== canvas && !canvas?.contains(el))) continue;
      const blocked = el.closest('[data-contour-card], [data-feature-sheet], [data-contour-tool], [data-cad-feature-strip], [data-part-row], [data-rail-pair], [data-feature-card]');
      if (blocked) continue;
      const abs = Math.abs(world[2]);
      if (abs < bestAbs) {
        bestAbs = abs;
        best = world;
      }
    }
    return best;
  }, lipCandidates());
}

function lineUs(script) {
  const out = [];
  const re = /kind: 'line', a: \[([^,]+),/g;
  let match = re.exec(script);
  while (match) {
    out.push(Number(match[1]));
    match = re.exec(script);
  }
  return out;
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
  await page.waitForFunction(() => (window.monaco?.editor?.getModels?.() || []).length > 0, null, { timeout: 30000 });
  await page.evaluate((src) => {
    window.monaco.editor.getModels()[0].setValue(src);
  }, SCRIPT);
  const ran = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  if (await page.locator('[data-part-row]').count() === 0) {
    await clickSel(page, '[data-cad-run]');
    await page.waitForFunction(() => document.querySelectorAll('[data-part-row]').length > 0, null, { timeout: 20000 });
  }
  const partsBtn = page.locator('[data-stage-btn="parts"]');
  const phone = await partsBtn.isVisible().catch(() => false);
  if (phone) {
    await partsBtn.click();
    await page.waitForFunction(() => (
      document.querySelector('[data-mobile-stage]')?.getAttribute('data-mobile-stage') === 'parts'
    ), null, { timeout: 8000 });
  }
  await page.evaluate(() => document.querySelector('[data-part-row]')?.click());
  await page.waitForFunction(() => (
    document.querySelector('[data-part-row]')?.getAttribute('data-part-selected') === 'true'
  ), null, { timeout: 8000 });
  if (phone) await page.locator('[data-stage-btn="cad"]').click();
  await page.evaluate((src) => window.monaco.editor.getModels()[0].setValue(src), SCRIPT);
  const again = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
  if (again?.error) throw new Error(again.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.locator('[data-cad-feature-strip] [data-contour-id="c1"]').waitFor({ timeout: 8000 });
}

async function idle(page) {
  await page.waitForFunction(() => {
    const run = document.querySelector('[data-cad-run]');
    return !run || run.getAttribute('data-cad-run') === 'idle';
  }, null, { timeout: 20000 });
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext({
    ...contextOptions,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
  let client = null;
  try {
    await boot(page);
    await clickSel(page, '[data-cad-feature-strip] [data-contour-id="c1"]');
    await page.locator('[data-contour-edit]').waitFor({ timeout: 8000 });
    await page.waitForFunction(() => (
      document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    ), null, { timeout: 8000 });
    const aimed = await viewAlign(page);
    check(`${label} sketch-normal camera looks along +Y`, aimed != null && aimed > 0.98, String(aimed));
    await clickSel(page, '[data-contour-tool="dimension"]');
    await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 8000 });
    await page.waitForTimeout(700);
    client = await context.newCDPSession(page);

    // Sketch corner, then a clear point on the return-flange lip.
    // On a 390px phone the lower end of that lip sits under the right rail.
    await touchWorld(page, client, [-20, 0, 15]);
    const lip = await revealLip(page);
    check(`${label} the flange lip has a clear tap`, !!lip, 'covered');
    if (!lip) throw new Error('flange lip covered');
    await touchWorld(page, client, lip);
    const still = await viewAlign(page);
    check(`${label} the tap leaves the sketch-normal camera`, still != null && still > 0.98, String(still));
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-contour-card="dimension"]');
      return card && card.innerText.includes('Distance');
    }, null, { timeout: 8000 });
    check(`${label} a sketch point and a sheet edge offer distance`, true);
    await clickSel(page, '[data-contour-card="dimension"] [data-feature-card-confirm]');
    await page.waitForFunction(() => document.querySelector('[data-contour-tag]'), null, { timeout: 8000 });

    await clickSel(page, '[data-contour-tool="constraints"]');
    await page.locator('[data-contour-card="constraint"]').waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    await touchWorld(page, client, [-20, 0, 0]);
    const lipAgain = await revealLip(page);
    check(`${label} the flange lip stays tappable`, !!lipAgain, 'covered');
    if (!lipAgain) throw new Error('flange lip covered');
    await touchWorld(page, client, lipAgain);
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-contour-card="constraint"]');
      return card && /Parallel/i.test(card.innerText);
    }, null, { timeout: 8000 });
    check(`${label} a sketch line and a sheet edge offer parallel`, true);
    await clickSel(page, '[data-contour-card="constraint"] [data-feature-card-confirm]');
    await page.waitForFunction(() => document.querySelector('[data-contour-tag]'), null, { timeout: 8000 });
    await page.screenshot({ path: join(SHOT_DIR, `sheet-contour-refs-${label}.png`) });

    await clickSel(page, '[data-contour-confirm]');
    await page.waitForFunction(() => !document.querySelector('[data-contour-edit]'), null, { timeout: 15000 });
    await idle(page);
    const saved = await editorScript(page);
    const before = lineUs(saved);
    check(`${label} the statement stores the sheet edge`, /refs:/.test(saved) && /kind: 'edge'/.test(saved) && before.some((u) => u < -80), saved.slice(0, 400));
    check(`${label} the face id keeps the manifold run`, /faceA: 2\d{6}|faceB: 2\d{6}/.test(saved), saved.slice(0, 400));
    check(`${label} the dimension is a distance to that reference`, /kind: 'distance'/.test(saved) && /b: 'r0'/.test(saved));
    check(`${label} the constraint is parallel to that reference`, /kind: 'parallel'/.test(saved) && /'e3'/.test(saved) && /'r0'/.test(saved));

    check(`${label} the flange length can change`, saved.includes(B2));
    const edited = saved.replace(B2, B2_LONG);
    await page.evaluate((src) => window.monaco.editor.getModels()[0].setValue(src), edited);
    const movedRun = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), edited);
    check(`${label} the flange edit keeps the solid`, !movedRun?.error, movedRun?.error || '');
    await idle(page);
    const afterScript = await editorScript(page);
    const after = lineUs(afterScript);
    const shifted = before.length > 0 && after.length === before.length
      && after.every((u, i) => before[i] - u > 8);
    check(`${label} the flange edit rewrites the reference`, shifted, JSON.stringify({ before, after }));
    check(`${label} the reference is not marked broken`, !/broken: true/.test(afterScript));

    await clickSel(page, '[data-cad-feature-strip] [data-contour-id="c1"]');
    await page.locator('[data-contour-edit]').waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    const liveBroken = await page.locator('[data-contour-ref-broken]').count();
    check(`${label} reopening the contour shows the reference live`, liveBroken === 0, String(liveBroken));
    check(`${label} no page error`, errors.length === 0, errors.join(' | '));
  } finally {
    if (client) await client.detach().catch(() => {});
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
  await runSize(browser, '390', { viewport: { width: 390, height: 844 } });
  await runSize(browser, '1280', { viewport: { width: 1280, height: 800 } });
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
console.log('\nsheet contour refs golden passed');
