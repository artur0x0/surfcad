#!/usr/bin/env node
/**
 * Plane preview and dimension placement at 390 and 1280.
 *
 * Workplane quads show on the plane card and hide after Start drawing.
 * Back shows them again. A chip move under 6px opens edit. Dragging a
 * length chip and an angle chip stores placement, and reopen keeps both
 * with the preview still hidden.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window, PointerEvent */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5262);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = `const cap = { center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
return Manifold.cube([40, 30, 20], true);
`;
const CYAN = 0x67e8f9;

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

console.log('contour plane preview and dimension placement');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour plane dim: no system Chrome — set CHROME_PATH');
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

async function chooseTriangle(page) {
  const sets = [];
  for (const x of [-8, -3, 2]) {
    for (const y of [-6, -1, 4]) {
      sets.push([[x, y, 10], [x + 10, y, 10], [x + 5, y + 8, 10]]);
    }
  }
  const view = await page.evaluate((candidates) => {
    const canvas = document.querySelector('canvas');
    const box = canvas.getBoundingClientRect();
    const project = (p) => {
      const q = window.__VIEWPORT__.stageProject(p);
      if (!q) return null;
      const el = document.elementFromPoint(q.x, q.y);
      const open = el && (el === canvas || el.closest?.('canvas'));
      return open ? q : null;
    };
    return {
      top: box.top,
      left: box.left,
      width: box.width,
      height: box.height,
      scored: candidates.map((pts) => ({
        pts,
        projected: pts.map(project),
      })),
    };
  }, sets);
  const wide = view.width >= 1000 && view.height <= 860;
  const yMin = wide ? 0.50 : 0.34;
  const yMax = wide ? 0.88 : 0.78;
  const inBand = (p) => {
    if (!p) return false;
    const nx = (p.x - view.left) / view.width;
    const ny = (p.y - view.top) / view.height;
    return nx > 0.08 && nx < 0.92 && ny > yMin && ny < yMax;
  };
  const onScreen = (p) => {
    if (!p) return false;
    const nx = (p.x - view.left) / view.width;
    const ny = (p.y - view.top) / view.height;
    return nx > 0.06 && nx < 0.94 && ny > 0.08 && ny < 0.92;
  };
  const minEdge = (row) => {
    const pts = row.projected;
    let best = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const j = (i + 1) % pts.length;
      best = Math.min(best, Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y));
    }
    return best;
  };
  const usable = view.scored.filter((row) => row.projected.every(Boolean) && minEdge(row) >= 36);
  const band = usable.filter((row) => row.projected.every(inBand));
  const pool = band.length ? band : usable.filter((row) => row.projected.every(onScreen));
  if (!pool.length) return null;
  pool.sort((a, b) => {
    const low = (row) => Math.min(...row.projected.map((p) => p.y));
    if (wide) return low(b) - low(a);
    return minEdge(b) - minEdge(a);
  });
  return pool[0].pts;
}

async function addPoint(page, world, n) {
  const at = await page.evaluate((p) => window.__VIEWPORT__.stageProject(p), world);
  if (!at) throw new Error(`point off screen ${world.join(',')}`);
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction((count) => window.__VIEWPORT__.stageContourSketch().points >= count, n, { timeout: 4000 });
}

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    const cam = window.__VIEWPORT__.stageCamera();
    const stamp = [
      ...dots.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`),
      ...(cam?.position || []).map((n) => Number(n).toFixed(2)),
    ].join('|');
    const now = Date.now();
    const prev = window.__planeDimSettle;
    if (!prev || prev.stamp !== stamp) {
      window.__planeDimSettle = { stamp, at: now };
      return false;
    }
    return now - prev.at >= 180;
  }, null, { timeout: 5000 });
}

async function openEdges(page) {
  return page.evaluate(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    const chips = [...document.querySelectorAll('[data-contour-tag]')].map((el) => {
      const box = el.getBoundingClientRect();
      return {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        r: Math.max(box.width, box.height) / 2 + 6,
      };
    });
    const covered = (x, y) => chips.some((chip) => Math.hypot(chip.x - x, chip.y - y) < chip.r);
    return [[0, 1], [1, 2], [2, 0]].map(([i, j]) => {
      const a = dots[i];
      const b = dots[j];
      if (!a || !b) return null;
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      if (span < 24) return null;
      for (const t of [0.5, 0.4, 0.6]) {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const el = document.elementFromPoint(x, y);
        const canvas = !!(el && (el.tagName === 'CANVAS' || el.closest?.('canvas')));
        if (canvas && !covered(x, y)) return { i, j, x, y, span };
      }
      return null;
    }).filter(Boolean);
  });
}

async function waitAdd(page) {
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-feature-card-confirm]');
    return btn && !btn.disabled && /Add/.test(btn.textContent || '');
  }, null, { timeout: 4000 });
  await page.locator('[data-feature-card-confirm]').click();
}

async function chipOf(page, kind) {
  return page.evaluate((want) => {
    const group = document.querySelector(`[data-contour-dim-kind="${want}"]`);
    if (!group) return null;
    const id = group.getAttribute('data-contour-dim');
    const chip = document.querySelector(`[data-contour-tag="${id}"]`);
    if (!chip) return null;
    const box = chip.getBoundingClientRect();
    const exts = [...group.querySelectorAll('[data-contour-dim-ext]')];
    const ax = exts.reduce((sum, el) => sum + Number(el.getAttribute('x1')), 0) / (exts.length || 1);
    const ay = exts.reduce((sum, el) => sum + Number(el.getAttribute('y1')), 0) / (exts.length || 1);
    return {
      id,
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      label: {
        x: Number(group.getAttribute('data-contour-dim-label-x')),
        y: Number(group.getAttribute('data-contour-dim-label-y')),
      },
      anchor: { x: ax, y: ay },
      visible: chip.parentElement?.dataset?.contourTagVisible === '1',
    };
  }, kind);
}

async function dispatchPointers(page, points, pointerType) {
  return page.evaluate(({ points: seq, pointerType: kind }) => {
    const fire = (target, type, x, y, buttons) => {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: kind,
        isPrimary: true,
        button: 0,
        buttons,
      }));
    };
    const first = seq[0];
    const el = document.elementFromPoint(first.x, first.y);
    const tag = el?.getAttribute?.('data-contour-tag') || '';
    if (!el || !tag) return { ok: false, tag: el?.tagName || 'none' };
    fire(el, 'pointerdown', first.x, first.y, 1);
    for (let i = 1; i < seq.length - 1; i += 1) {
      fire(window, 'pointermove', seq[i].x, seq[i].y, 1);
    }
    const last = seq[seq.length - 1];
    fire(window, 'pointerup', last.x, last.y, 0);
    return { ok: true, tag };
  }, { points, pointerType });
}

async function ensurePartSelected(page) {
  if (await page.locator('[data-part-row]').count() === 0) {
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('[data-cad-run]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!clicked) throw new Error('Run is not in the page, so no part can be selected');
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
  const row = page.locator('[data-part-row]').first();
  await row.waitFor({ state: 'visible', timeout: 8000 });
  await page.evaluate(() => {
    document.querySelector('[data-part-row]')?.click();
  });
  await page.waitForFunction(() => (
    document.querySelector('[data-part-row]')?.getAttribute('data-part-selected') === 'true'
  ), null, { timeout: 8000 });
  if (phone) await page.locator('[data-stage-btn="cad"]').click();
}

async function runViewport(page, width, pointerType) {
  console.log(`\nviewport ${width}`);
  await boot(page);
  await page.locator('button[aria-label^="Insert Create contour"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  await page.waitForFunction(() => (window.monaco?.editor?.getModels?.() || []).length > 0, null, { timeout: 8000 });
  await page.evaluate((src) => {
    window.monaco.editor.getModels()[0].setValue(src);
  }, SCRIPT);
  await page.waitForFunction((cyan) => {
    const preview = window.__VIEWPORT__.stageContourSketch().planePreview || [];
    return preview.includes(cyan) && preview.length >= 1;
  }, CYAN, { timeout: 4000 });
  const openPreview = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch().planePreview);
  check(`${width} plane card shows the workplane quads`, openPreview.includes(CYAN) && openPreview.length >= 1, JSON.stringify(openPreview));
  await page.screenshot({ path: join(SHOT_DIR, `contour-plane-dim-card-${width}.png`) });

  await page.locator('[aria-label="Pick a saved workplane"]').selectOption({ label: 'cap' });
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().planePreset === 'workplane');
  const picked = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch().planePreview || []);
  check(`${width} picked plane keeps the preview`, picked.length >= 1, JSON.stringify(picked));

  await page.locator('[data-contour-tool="polyline"]').click();
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    const pressed = document.querySelector('[data-overlay-toggle="plane"]')?.getAttribute('aria-pressed');
    return sketch.aim === 'done'
      && !sketch.planeCard
      && sketch.planePreview.length === 0
      && pressed === 'false';
  }, null, { timeout: 8000 });
  check(`${width} Start drawing hides the plane preview`, true);
  await page.screenshot({ path: join(SHOT_DIR, `contour-plane-dim-hidden-${width}.png`) });

  await page.locator('[data-contour-back]').click();
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return sketch.planeCard && (sketch.planePreview || []).length >= 1;
  }, null, { timeout: 4000 });
  check(`${width} Back to the plane card shows the preview`, true);
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return sketch.aim === 'done' && !sketch.planeCard && sketch.planePreview.length === 0;
  }, null, { timeout: 8000 });

  const pts = await chooseTriangle(page);
  check(`${width} triangle is on the canvas`, Array.isArray(pts) && pts.length === 3, JSON.stringify(pts));
  if (!pts) return;
  await addPoint(page, pts[0], 1);
  await addPoint(page, pts[1], 2);
  await addPoint(page, pts[2], 3);

  await page.locator('[data-contour-tool="dimension"]').click();
  await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 4000 });
  await waitSettled(page);
  const lengthEdges = await openEdges(page);
  check(`${width} two sketch edges are clickable`, lengthEdges.length >= 2, JSON.stringify(lengthEdges));
  if (lengthEdges.length < 2) return;
  await page.mouse.click(lengthEdges[0].x, lengthEdges[0].y);
  await page.waitForFunction(() => document.querySelector('[data-contour-dim-kind="length"]'));
  await waitAdd(page);
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().dimensions >= 1, null, { timeout: 4000 });
  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().gesture === '', null, { timeout: 4000 });
  await waitSettled(page);
  await page.locator('[data-contour-tool="dimension"]').click();
  await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 4000 });
  await waitSettled(page);
  const angleEdges = await openEdges(page);
  check(`${width} angle edges stay clickable`, angleEdges.length >= 2, JSON.stringify(angleEdges));
  if (angleEdges.length < 2) return;
  await page.mouse.click(angleEdges[0].x, angleEdges[0].y);
  await page.waitForTimeout(150);
  await page.mouse.click(angleEdges[1].x, angleEdges[1].y);
  await page.waitForFunction(() => document.querySelector('[data-contour-dim-kind="angle"]'), null, { timeout: 4000 });
  await waitAdd(page);
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().dimensions >= 2, null, { timeout: 4000 });
  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().gesture === '', null, { timeout: 4000 });
  await waitSettled(page);

  const lengthChip = await chipOf(page, 'length');
  check(`${width} length chip is on screen`, !!lengthChip?.visible, JSON.stringify(lengthChip));
  if (!lengthChip) return;
  const tap = await dispatchPointers(page, [
    { x: lengthChip.x, y: lengthChip.y },
    { x: lengthChip.x + 3, y: lengthChip.y },
  ], pointerType);
  check(`${width} tap hits the chip`, tap.ok, JSON.stringify(tap));
  await page.waitForFunction(() => (
    document.querySelector('[data-contour-card="dimension"]')?.getAttribute('data-contour-dimension-mode') === 'edit'
  ), null, { timeout: 4000 });
  const tapped = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch().placements);
  const tappedLength = (tapped || []).find((item) => item.kind === 'length');
  check(`${width} a short tap opens edit and keeps placement empty`, tappedLength?.placement == null, JSON.stringify(tapped));
  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForFunction(() => !document.querySelector('[data-contour-card="dimension"]'), null, { timeout: 4000 });
  await waitSettled(page);

  const lengthBefore = await chipOf(page, 'length');
  const ldx = lengthBefore.x - lengthBefore.anchor.x;
  const ldy = lengthBefore.y - lengthBefore.anchor.y;
  const llen = Math.hypot(ldx, ldy) || 1;
  const lengthTo = {
    x: lengthBefore.x + (ldx / llen) * 52,
    y: lengthBefore.y + (ldy / llen) * 52,
  };
  const lengthDrag = await dispatchPointers(page, [
    { x: lengthBefore.x, y: lengthBefore.y },
    { x: lengthBefore.x + (ldx / llen) * 16, y: lengthBefore.y + (ldy / llen) * 16 },
    { x: lengthBefore.x + (ldx / llen) * 32, y: lengthBefore.y + (ldy / llen) * 32 },
    lengthTo,
  ], pointerType);
  check(`${width} length drag starts on the chip`, lengthDrag.ok, JSON.stringify(lengthDrag));
  await page.waitForFunction((id) => {
    const row = (window.__VIEWPORT__.stageContourSketch().placements || []).find((item) => item.id === id);
    return row && Number.isFinite(row.placement);
  }, lengthBefore.id, { timeout: 4000 });
  const lengthAfter = await chipOf(page, 'length');
  const lengthMoved = Math.hypot(lengthAfter.label.x - lengthBefore.label.x, lengthAfter.label.y - lengthBefore.label.y);
  check(`${width} length chip drag moves the dimension`, lengthMoved > 20, `moved ${lengthMoved}`);

  const angleBefore = await chipOf(page, 'angle');
  check(`${width} angle chip is on screen`, !!angleBefore?.visible, JSON.stringify(angleBefore));
  if (!angleBefore) return;
  const adx = angleBefore.x - angleBefore.anchor.x;
  const ady = angleBefore.y - angleBefore.anchor.y;
  const alen = Math.hypot(adx, ady) || 1;
  const angleTo = {
    x: angleBefore.x + (adx / alen) * 48,
    y: angleBefore.y + (ady / alen) * 48,
  };
  const angleDrag = await dispatchPointers(page, [
    { x: angleBefore.x, y: angleBefore.y },
    { x: angleBefore.x + (adx / alen) * 16, y: angleBefore.y + (ady / alen) * 16 },
    { x: angleBefore.x + (adx / alen) * 32, y: angleBefore.y + (ady / alen) * 32 },
    angleTo,
  ], pointerType);
  check(`${width} angle drag starts on the chip`, angleDrag.ok, JSON.stringify(angleDrag));
  await page.waitForFunction((id) => {
    const row = (window.__VIEWPORT__.stageContourSketch().placements || []).find((item) => item.id === id);
    return row && Number.isFinite(row.placement) && row.placement > 0;
  }, angleBefore.id, { timeout: 4000 });
  const angleAfter = await chipOf(page, 'angle');
  const beforeR = Math.hypot(angleBefore.label.x - angleBefore.anchor.x, angleBefore.label.y - angleBefore.anchor.y);
  const afterR = Math.hypot(angleAfter.label.x - angleAfter.anchor.x, angleAfter.label.y - angleAfter.anchor.y);
  check(`${width} angle chip drag moves the arc out`, afterR > beforeR + 15, `radius ${beforeR} -> ${afterR}`);
  await page.screenshot({ path: join(SHOT_DIR, `contour-plane-dim-drag-${width}.png`) });

  await page.waitForFunction(() => {
    const text = window.monaco?.editor?.getModels?.()?.[0]?.getValue?.() || '';
    return (text.match(/placement:\s*-?\d/g) || []).length >= 2;
  }, null, { timeout: 4000 });
  check(`${width} both placements are in the contour statement`, true);

  await page.locator('[data-contour-exit]').click();
  await page.waitForFunction(() => !window.__VIEWPORT__.stageContourSketch().open, null, { timeout: 4000 });
  await ensurePartSelected(page);
  await page.locator('[data-cad-feature-strip] [data-contour-id="c1"]').click();
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    const placed = (sketch.placements || []).filter((item) => Number.isFinite(item.placement));
    return sketch.open && !sketch.planeCard && sketch.planePreview.length === 0 && placed.length >= 2;
  }, null, { timeout: 8000 });
  const reopened = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check(`${width} reopen keeps placements and hides the preview`, (
    reopened.planePreview.length === 0
    && (reopened.placements || []).filter((item) => Number.isFinite(item.placement)).length >= 2
  ), JSON.stringify({ preview: reopened.planePreview, placements: reopened.placements }));
}

const up = await waitForServer();
if (!up) {
  console.log('contour plane dim: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const sizes = [
    {
      width: 390,
      pointerType: 'touch',
      context: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 1,
      },
    },
    {
      width: 1280,
      pointerType: 'mouse',
      context: {
        viewport: { width: 1280, height: 800 },
        hasTouch: false,
        isMobile: false,
        deviceScaleFactor: 1,
      },
    },
  ];
  for (const size of sizes) {
    const context = await browser.newContext(size.context);
    const page = await context.newPage();
    await page.addInitScript(() => { window.__SURFCAD_NO_TUTORIAL = true; });
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
    await runViewport(page, size.width, size.pointerType);
    check(`${size.width} page has no errors`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\ncontour plane dim ok');
