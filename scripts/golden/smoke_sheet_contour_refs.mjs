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
/* global document, window, WheelEvent, MouseEvent */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { shiftLocalPoint } from '../../src/utils/activePartOverlay.js';
import { projectReference } from '../../src/utils/contourRef.js';
import { chainSegments } from '../../src/utils/contourRefPick.js';
import { emitSolveContour, parseSolveContour } from '../../src/utils/contourScript.js';
import { emitNamedContourLine } from '../../src/utils/namedContour.js';
import { sheetContourEdges } from '../../src/utils/sheetMetal/sheetContourEdges.js';

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
async function touchWorld(page, client, world, nudge = 6) {
  const pt = await page.evaluate((w) => {
    const p = window.__VIEWPORT__.project(w[0], w[1], w[2]);
    if (!p || p.behind || p.x < 8 || p.y < 8 || p.x > window.innerWidth - 8 || p.y > window.innerHeight - 8) {
      return { error: `off screen ${JSON.stringify(w)}` };
    }
    const el = document.elementFromPoint(p.x, p.y);
    const blocked = el?.closest('[data-contour-card], [data-feature-sheet], [data-contour-tool], [data-cad-feature-strip], [data-part-row], [data-rail-pair], [data-feature-card], [data-contour-tag]');
    return {
      ...p,
      vw: window.innerWidth,
      vh: window.innerHeight,
      top: el ? `${el.tagName}` : 'none',
      blocked: blocked ? (blocked.getAttribute('data-contour-card') || blocked.getAttribute('data-contour-tool') || blocked.getAttribute('data-rail-pair') || 'chrome') : '',
    };
  }, world);
  if (pt.error) throw new Error(pt.error);
  if (pt.blocked) throw new Error(`tap covered by ${pt.blocked} at ${Math.round(pt.x)},${Math.round(pt.y)} ${pt.top || ''}`);
  // Nudge stays on the canvas. A nudge into the right rail drops the pointerup.
  const nx = Math.min(6, Math.max(2, nudge));
  const ny = Math.min(4, Math.max(2, nudge));
  let dx = pt.x < 24 ? 0 : nx;
  let dy = pt.y < 24 ? 0 : ny;
  if (pt.x > pt.vw - 36) dx = -nx;
  if (pt.y > pt.vh - 36) dy = -ny;
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

/** Touch a world point on the canvas, walking the look target off the edit bar and dimension tags. */
async function tapOnCanvas(page, client, world) {
  let last = 'untried';
  for (const dz of [0, 10, -10, 22, -22, 36, -36]) {
    await page.evaluate(({ w, dz }) => {
      window.__VIEWPORT__.stageRetarget?.([w[0], w[1], w[2] + dz], 1);
    }, { w: world, dz });
    await page.waitForTimeout(40);
    const spot = await page.evaluate((w) => {
      const p = window.__VIEWPORT__.project(w[0], w[1], w[2]);
      const canvas = document.querySelector('.viewport-shell > canvas');
      if (!p || p.behind || !canvas) return { error: 'off screen' };
      const rect = canvas.getBoundingClientRect();
      for (const [dx, dy] of [[0, 0], [0, 10], [0, -10], [10, 0], [-10, 0], [8, 8], [-8, 8]]) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < rect.left + 12 || y < rect.top + 12 || x > rect.right - 12 || y > rect.bottom - 12) continue;
        const el = document.elementFromPoint(x, y);
        if (!el || (el !== canvas && !canvas.contains(el))) continue;
        return { x, y };
      }
      const el = document.elementFromPoint(p.x, p.y);
      return {
        error: 'covered',
        at: [Math.round(p.x), Math.round(p.y)],
        top: el ? `${el.tagName}.${String(el.className).slice(0, 48)}` : 'none',
      };
    }, world);
    last = JSON.stringify(spot);
    if (!spot || spot.error) continue;
    const nudged = await page.evaluate((s) => {
      const canvas = document.querySelector('.viewport-shell > canvas');
      for (const [dx, dy] of [[2, 2], [2, 0], [0, 2], [-2, 2], [2, -2], [-2, 0], [0, -2]]) {
        const x = s.x + dx;
        const y = s.y + dy;
        const el = document.elementFromPoint(x, y);
        if (el && canvas && (el === canvas || canvas.contains(el))) return { x, y };
      }
      return null;
    }, spot);
    if (!nudged) continue;
    const start = { x: spot.x, y: spot.y, id: 1 };
    const moved = { x: nudged.x, y: nudged.y, id: 1 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await page.waitForTimeout(40);
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved] });
    await page.waitForTimeout(70);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(40);
    return spot;
  }
  throw new Error(`no clear canvas tap ${last}`);
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

function classTargets() {
  const topo = sheetContourEdges(SPEC);
  const want = [
    ['wall:base:v-:w0', [40, 0, -30]],
    ['bend:b1:base:w0', null],
    ['wall:b2:v-:w0', null],
    ['hole:h1:w0', [-23.93 - 2.5, 0, 1.91]],
  ];
  return want.map(([key, at]) => {
    const edge = topo.edges.find((item) => item.refKey === key);
    const chain = chainSegments(edge.segments)[0];
    return {
      key,
      world: at || edge.mid.slice(),
      geom: projectReference(FRAME, chain).geom,
    };
  });
}

function geomClose(actual, expected) {
  if (!actual || actual.kind !== expected.kind) return false;
  const d = (p, q) => Math.hypot((p?.[0] || 0) - (q?.[0] || 0), (p?.[1] || 0) - (q?.[1] || 0));
  if (actual.kind === 'line') {
    const direct = d(actual.a, expected.a) <= 0.05 && d(actual.b, expected.b) <= 0.05;
    const flip = d(actual.a, expected.b) <= 0.05 && d(actual.b, expected.a) <= 0.05;
    return direct || flip;
  }
  if (actual.kind === 'arc') {
    return d(actual.center, expected.center) <= 0.05 && Math.abs(actual.radius - expected.radius) <= 0.05;
  }
  const a0 = actual.points[0];
  const a1 = actual.points[actual.points.length - 1];
  const b0 = expected.points[0];
  const b1 = expected.points[expected.points.length - 1];
  return (d(a0, b0) <= 0.05 && d(a1, b1) <= 0.05) || (d(a0, b1) <= 0.05 && d(a1, b0) <= 0.05);
}

async function wheelZoomOut(page, delta = 480) {
  await page.evaluate((deltaY) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent('wheel', {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaY,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
    }));
  }, delta);
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

    // Each edge class while the sketch corner is still where the first tap landed.
    // The lower edge used to bind the hole. Zoom toward the edge so the 12 px
    // sketch stroke does not win.
    const targets = classTargets();
    const pointIds = ['p1', 'p2', 'p3', 'p1'];
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const open = await page.locator('[data-contour-card="dimension"]').count();
      if (!open) {
        await clickSel(page, '[data-contour-tool="dimension"]');
        await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 8000 });
      }
      await page.waitForTimeout(300);
      const sketchAt = await page.evaluate((id) => {
        const points = window.__VIEWPORT__.sketchPoints?.() || [];
        const point = points.find((item) => item.id === id) || points[0];
        return point?.world || [-20, 0, 15];
      }, pointIds[index]);
      await tapOnCanvas(page, client, sketchAt);
      const pose = await page.evaluate(() => window.__VIEWPORT__.stageActivePose?.() || null);
      const edgeWorld = pose ? shiftLocalPoint(target.world, pose.t, pose.q) : target.world;
      await page.evaluate(({ w, dolly }) => window.__VIEWPORT__.stageRetarget?.(w, dolly), {
        w: edgeWorld,
        dolly: target.key.startsWith('hole:') ? 0.22 : 0.55,
      });
      await page.waitForTimeout(40);
      let framed = null;
      try {
        framed = await tapOnCanvas(page, client, edgeWorld);
      } catch (err) {
        framed = null;
      }
      const distanceReady = () => page.evaluate(() => {
        const card = document.querySelector('[data-contour-card="dimension"]');
        return !!(card && card.innerText.includes('Distance'));
      });
      await page.waitForTimeout(200);
      if (!(await distanceReady())) {
        // The finger landed on the edit bar or a dimension tag. The canvas
        // still owns the pick, at the same pixel.
        await page.evaluate((w) => {
          const p = window.__VIEWPORT__.project(w[0], w[1], w[2]);
          const canvas = document.querySelector('.viewport-shell > canvas');
          if (!p || p.behind || !canvas) return;
          canvas.dispatchEvent(new MouseEvent('mouseup', {
            clientX: p.x,
            clientY: p.y,
            button: 0,
            bubbles: true,
            cancelable: true,
          }));
        }, edgeWorld);
        await page.waitForTimeout(200);
      }
      try {
        await page.waitForFunction(() => {
          const card = document.querySelector('[data-contour-card="dimension"]');
          return card && card.innerText.includes('Distance');
        }, null, { timeout: 4000 });
      } catch (err) {
        const text = await page.locator('[data-contour-card="dimension"]').innerText().catch(() => 'no card');
        const picked = await page.evaluate(() => {
          const el = document.querySelector('[data-contour-tool="dimension"]');
          const key = el && Object.keys(el).find((name) => name.startsWith('__reactFiber'));
          let fiber = key ? el[key] : null;
          const seen = new Set();
          const stack = fiber ? [fiber] : [];
          while (stack.length) {
            const node = stack.pop();
            if (!node || seen.has(node)) continue;
            seen.add(node);
            let hook = node.memoizedState;
            while (hook) {
              const state = hook.memoizedState;
              const refs = state?.params?.contour?.refs;
              if (Array.isArray(refs) && refs.length) {
                return refs.map((ref) => ({
                  id: ref.id,
                  refKey: ref.refKey || '',
                  kind: ref.geom?.kind || ref.kind,
                }));
              }
              hook = hook.next;
            }
            if (node.return) stack.push(node.return);
            if (node.child) stack.push(node.child);
          }
          return null;
        });
        const aim = await viewAlign(page);
        const diag = await page.evaluate((key) => {
          const cam = window.__VIEWPORT__.stageCamera?.();
          const note = document.querySelector('[data-contour-card="dimension"]')?.innerText || '';
          return {
            note: note.replace(/\s+/g, ' ').slice(0, 240),
            cam: cam ? { position: cam.position, target: cam.target, near: cam.near } : null,
            key,
          };
        }, target.key);
        throw new Error(`${target.key} did not offer Distance aim ${aim} frame ${JSON.stringify(framed)} refs ${JSON.stringify(picked)} diag ${JSON.stringify(diag)} (${text.replace(/\s+/g, ' ').slice(0, 160)})`);
      }
      await clickSel(page, '[data-contour-card="dimension"] [data-feature-card-confirm]');
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: join(SHOT_DIR, `sheet-contour-refs-${label}.png`) });

    await clickSel(page, '[data-contour-confirm]');
    await page.waitForFunction(() => !document.querySelector('[data-contour-edit]'), null, { timeout: 15000 });
    await idle(page);
    const saved = await editorScript(page);
    const before = lineUs(saved).filter((u) => u < -80);
    check(`${label} the statement stores the sheet edge`, /refs:/.test(saved) && /kind: 'edge'/.test(saved) && before.length > 0, saved.slice(0, 400));
    const refAt = saved.indexOf('refs:');
    check(`${label} the lip is the return flange, not a mesh face id`, /refKey: 'wall:b2:u\+:w0'/.test(saved), saved.slice(refAt, refAt + 500));
    check(`${label} the dimension is a distance to that reference`, /kind: 'distance'/.test(saved) && /b: 'r0'/.test(saved));
    check(`${label} the constraint is parallel to that reference`, /kind: 'parallel'/.test(saved) && /'e3'/.test(saved) && /'r0'/.test(saved));

    check(`${label} the flange length can change`, saved.includes(B2));
    const edited = saved.replace(B2, B2_LONG);
    await page.evaluate((src) => window.monaco.editor.getModels()[0].setValue(src), edited);
    const movedRun = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), edited);
    check(`${label} the flange edit keeps the solid`, !movedRun?.error, movedRun?.error || '');
    await idle(page);
    const afterScript = await editorScript(page);
    const after = lineUs(afterScript).filter((u) => u < -80);
    const shifted = before.length > 0 && after.length === before.length
      && after.every((u, i) => before[i] - u > 8);
    check(`${label} the flange edit rewrites the reference`, shifted, JSON.stringify({ before, after }));
    check(`${label} the reference is not marked broken`, !/broken: true/.test(afterScript));

    await clickSel(page, '[data-cad-feature-strip] [data-contour-id="c1"]');
    await page.locator('[data-contour-edit]').waitFor({ timeout: 8000 });
    await page.waitForFunction(() => (
      document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    ), null, { timeout: 8000 });
    const liveBroken = await page.locator('[data-contour-ref-broken]').count();
    check(`${label} reopening the contour shows the reference live`, liveBroken === 0, String(liveBroken));
    const refs = parseSolveContour(saved).refs;
    for (const target of targets) {
      const ref = refs.find((item) => item.refKey === target.key);
      const ok = ref && geomClose(ref.geom, target.geom);
      check(`${label} tap ${target.key} binds that edge`, !!ok, ref ? JSON.stringify(ref.geom) : 'missing');
    }
    const lowerRef = refs.find((item) => item.refKey === 'wall:base:v-:w0');
    check(`${label} the lower edge is not the hole circle`, lowerRef?.geom?.kind === 'line' && Math.abs(lowerRef.geom.a[1]) > 20);
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
attachConsentPresetToBrowser(browser);
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
