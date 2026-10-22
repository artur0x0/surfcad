#!/usr/bin/env node
/**
 * Dimension and Constrain feedback at 390px and 1280px.
 *
 * Extension lines start on both picked dots. Arrow tips meet the extension
 * lines. Add keeps the card open and a second dimension can be placed.
 * Reopening a tag shows red Delete and Confirm. The dimension card slides
 * the part up. The sketch-plane square is absent. A Constrain tap on a
 * line and on a point both register.
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

const PORT = Number(process.env.SMOKE_PORT || 5245);
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

console.log('dimension feedback');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('dimension feedback: no system Chrome — set CHROME_PATH');
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

async function chooseTriangle(page) {
  const sets = [];
  for (const x of [-14, -6, 2, 10]) {
    for (const y of [-11, -4, 3]) {
      sets.push([[x, y, 10], [x + 7, y, 10], [x + 3.5, y + 6, 10]]);
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
  // A short wide viewport lifts the part by about a third of the height
  // when the dimension card opens. Vertices that start in the upper half
  // leave the canvas. A phone lifts less, and the card covers the bottom,
  // so the triangle stays in the middle.
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
  const chosen = pool[0];
  const ys = chosen.projected.map((p) => ((p.y - view.top) / view.height).toFixed(2));
  console.log(`  triangle screen-y ${ys.join(',')} wide ${wide}`);
  return chosen.pts;
}

async function addPoint(page, world, n) {
  const at = await page.evaluate((p) => window.__VIEWPORT__.stageProject(p), world);
  if (!at) throw new Error(`point off screen ${world.join(',')}`);
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction((count) => window.__VIEWPORT__.stageContourSketch().points >= count, n, { timeout: 4000 });
}

async function anchorProbe(page) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < 4000) {
    last = await page.evaluate(() => {
      const sketch = window.__VIEWPORT__.stageContourSketch();
      const picked = (sketch.picked || []).filter((p) => p.kind === 'point');
      const dots = (sketch.dots || []).filter((d) => picked.some((p) => p.id === d.id));
      const exts = [...document.querySelectorAll('[data-contour-dim-ext]')].map((el) => ({
        x1: Number(el.getAttribute('x1')),
        y1: Number(el.getAttribute('y1')),
        x2: Number(el.getAttribute('x2')),
        y2: Number(el.getAttribute('y2')),
      }));
      const gaps = dots.map((dot) => {
        let best = Infinity;
        for (const ext of exts) {
          best = Math.min(best, Math.hypot(dot.x - ext.x1, dot.y - ext.y1));
        }
        return best;
      });
      const tips = [...document.querySelectorAll('[data-contour-dim-arrow]')].map((el) => {
        const pair = (el.getAttribute('points') || '').trim().split(/\s+/)[0] || '0,0';
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      });
      const tipGaps = tips.map((tip) => {
        let best = Infinity;
        for (const ext of exts) {
          const dx = ext.x2 - ext.x1;
          const dy = ext.y2 - ext.y1;
          const L2 = dx * dx + dy * dy;
          let t = L2 > 1e-6 ? ((tip.x - ext.x1) * dx + (tip.y - ext.y1) * dy) / L2 : 0;
          t = Math.max(0, Math.min(1, t));
          best = Math.min(best, Math.hypot(tip.x - (ext.x1 + t * dx), tip.y - (ext.y1 + t * dy)));
        }
        return best;
      });
      return {
        gaps,
        tipGaps,
        picked: sketch.picked,
        highlights: sketch.pickHighlights,
        planeSquare: sketch.planeSquare,
        dimensions: sketch.dimensions,
        dots: dots.length,
        exts: exts.length,
      };
    });
    const tipsOk = last && last.tipGaps.length >= 2 && last.tipGaps.every((n) => n < 2);
    const anchored = last && last.gaps.length === 2 && last.gaps.every((n) => n < 3);
    if (anchored && tipsOk) return last;
    await page.waitForTimeout(40);
  }
  return last;
}

async function waitSettled(page) {
  // Adding a dimension rebuilds the solid. The sheet camera slides again
  // with the new bounds, and a tap during that tween misses the dot.
  await page.waitForFunction(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    const cam = window.__VIEWPORT__.stageCamera();
    const stamp = [
      ...dots.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`),
      ...(cam?.position || []).map((n) => Number(n).toFixed(2)),
    ].join('|');
    const now = Date.now();
    const prev = window.__dimSettle;
    if (!prev || prev.stamp !== stamp) {
      window.__dimSettle = { stamp, at: now };
      return false;
    }
    return now - prev.at >= 180;
  }, null, { timeout: 5000 });
}

async function clickDot(page, index) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitSettled(page);
    const at = await page.evaluate((i) => {
      const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
      const open = dots.filter((d) => {
        const el = document.elementFromPoint(d.x, d.y);
        return el && (el.tagName === 'CANVAS' || el.closest?.('canvas'));
      });
      const dot = open[i] || null;
      return dot ? { ...dot, open: open.length, all: dots.length } : { open: open.length, all: dots.length };
    }, index);
    last = at;
    if (!at?.x) break;
    await page.mouse.click(at.x, at.y);
    const stuck = await page.waitForFunction((id) => (
      window.__VIEWPORT__.stageContourSketch().picked || []
    ).some((p) => p.id === id), at.id, { timeout: 800 }).then(() => true).catch(() => false);
    if (stuck) return;
  }
  throw new Error(`no clickable dot ${index} ${JSON.stringify(last)}`);
}

async function runViewport(page, width) {
  console.log(`\nviewport ${width}`);
  await boot(page);
  await page.locator('button[aria-label^="Insert Create contour"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  const planeSquare = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch().planeSquare);
  check(`${width} no sketch-plane square on the plane card`, planeSquare === false, String(planeSquare));
  await page.locator('[data-contour-tool="polyline"]').click();
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  const afterAim = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch().planeSquare);
  check(`${width} no sketch-plane square after Select plane`, afterAim === false, String(afterAim));

  const pts = await chooseTriangle(page);
  check(`${width} triangle is on the upper canvas`, Array.isArray(pts) && pts.length === 3, JSON.stringify(pts));
  if (!pts) return;
  await addPoint(page, pts[0], 1);
  await addPoint(page, pts[1], 2);
  await addPoint(page, pts[2], 3);

  const before = await lowestNdc(page);
  const beforeCam = await page.evaluate(() => window.__VIEWPORT__.stageCamera());
  await page.locator('[data-contour-tool="dimension"]').click();
  await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 4000 });
  await waitSettled(page);
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
  console.log(`  ${width} slide before ${before?.toFixed?.(3)} after ${after?.toFixed?.(3)} lifted ${lifted?.toFixed?.(3)} moved ${moved?.toFixed?.(3)}`);
  if (width === 390) {
    check(`${width} dimension card slides the part up`, lifted != null && lifted >= 0.04 && moved > 0.5, `lifted ${lifted} moved ${moved}`);
  } else {
    // Desktop: the card never moves the camera (the slide is phone-only).
    check(`${width} dimension card leaves the camera alone`,
      moved != null && moved < 1e-3 && !afterCam?.view?.enabled,
      `lifted ${lifted} moved ${moved} view ${JSON.stringify(afterCam?.view)}`);
  }

  await clickDot(page, 0);
  await clickDot(page, 1);
  const anchored = await anchorProbe(page);
  const highlightIds = anchored?.highlights?.points || [];
  const pickedIds = (anchored?.picked || []).filter((p) => p.kind === 'point').map((p) => p.id);
  check(`${width} both picks stay highlighted`, pickedIds.length === 2 && pickedIds.every((id) => highlightIds.includes(id)), JSON.stringify(anchored));
  check(`${width} extension lines sit on both dots`, anchored?.gaps?.length === 2 && anchored.gaps.every((n) => n < 3), JSON.stringify(anchored?.gaps));
  check(`${width} arrow tips land on the extension lines`, anchored?.tipGaps?.length >= 2 && anchored.tipGaps.every((n) => n < 2), JSON.stringify(anchored?.tipGaps));
  await page.screenshot({ path: join(SHOT_DIR, `dimension-feedback-${width}.png`) });

  const add = page.locator('[data-feature-card-confirm]');
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-feature-card-confirm]');
    return btn && !btn.disabled && /Add/.test(btn.textContent || '');
  }, null, { timeout: 4000 });
  await add.click();
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    const card = document.querySelector('[data-contour-card="dimension"]');
    return sketch.dimensions === 1 && sketch.picked.length === 0 && card?.getAttribute('data-contour-dimension-mode') === 'add';
  }, null, { timeout: 4000 });
  const afterAdd = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check(`${width} Add keeps the card open`, afterAdd.dimensions === 1 && afterAdd.picked.length === 0 && afterAdd.gesture === 'dimension', JSON.stringify({
    dimensions: afterAdd.dimensions,
    picked: afterAdd.picked,
    gesture: afterAdd.gesture,
  }));
  check(`${width} highlights clear when the dimension is accepted`, (afterAdd.pickHighlights?.points || []).length === 0, JSON.stringify(afterAdd.pickHighlights));

  await waitSettled(page);
  const openCount = await page.evaluate(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    return dots.filter((d) => {
      const el = document.elementFromPoint(d.x, d.y);
      return el && (el.tagName === 'CANVAS' || el.closest?.('canvas'));
    }).length;
  });
  if (openCount >= 3) {
    await clickDot(page, 1);
    await clickDot(page, 2);
  } else if (openCount >= 2) {
    // The upward slide hid one vertex. A length on a visible edge is the
    // second dimension.
    const edge = await page.evaluate(() => {
      const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
      const open = dots.filter((d) => {
        const el = document.elementFromPoint(d.x, d.y);
        return el && (el.tagName === 'CANVAS' || el.closest?.('canvas'));
      });
      let best = null;
      for (let i = 0; i < open.length; i += 1) {
        for (let j = i + 1; j < open.length; j += 1) {
          const span = Math.hypot(open[j].x - open[i].x, open[j].y - open[i].y);
          if (!best || span > best.span) best = { a: open[i], b: open[j], span };
        }
      }
      if (!best) return null;
      for (let s = 1; s < 12; s += 1) {
        const t = s / 12;
        const x = best.a.x + (best.b.x - best.a.x) * t;
        const y = best.a.y + (best.b.y - best.a.y) * t;
        const nearDot = dots.some((d) => Math.hypot(d.x - x, d.y - y) < 16);
        const el = document.elementFromPoint(x, y);
        const canvas = el && (el.tagName === 'CANVAS' || el.closest?.('canvas'));
        if (!nearDot && canvas) return { x, y };
      }
      return null;
    });
    if (!edge) throw new Error(`second dimension has no visible edge (${openCount} dots)`);
    await page.mouse.click(edge.x, edge.y);
  } else {
    throw new Error(`second dimension has ${openCount} open dots`);
  }
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().picked.length >= 1, null, { timeout: 4000 });
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-feature-card-confirm]');
    return btn && !btn.disabled && /Add/.test(btn.textContent || '');
  }, null, { timeout: 4000 });
  await add.click();
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return sketch.dimensions === 2 && !!document.querySelector('[data-contour-card="dimension"]');
  }, null, { timeout: 4000 });
  check(`${width} a second Add stays on the card`, (await page.evaluate(() => window.__VIEWPORT__.stageContourSketch().dimensions)) === 2);

  await waitSettled(page);
  // Two chips can sit on the same spot. Dispatch on one the pointer can reach.
  await page.evaluate(() => {
    const tags = [...document.querySelectorAll('[data-contour-tag]')];
    const open = tags.find((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit === el || el.contains(hit);
    });
    (open || tags[0])?.click();
  });
  await page.waitForFunction(() => (
    document.querySelector('[data-contour-card="dimension"]')?.getAttribute('data-contour-dimension-mode') === 'edit'
  ), null, { timeout: 4000 });
  const edit = await page.evaluate(() => {
    const del = document.querySelector('[data-contour-dimension-delete]');
    const confirm = document.querySelector('[data-feature-card-confirm]');
    return {
      mode: document.querySelector('[data-contour-card="dimension"]')?.getAttribute('data-contour-dimension-mode') || '',
      delete: !!del,
      label: (confirm?.textContent || '').trim(),
      red: !!del && String(del.className).includes('text-red-200') && String(del.className).includes('bg-red-950'),
    };
  });
  check(`${width} reopen is Delete and Confirm`, edit.mode === 'edit' && edit.delete && edit.label === 'Confirm' && edit.red && !/Add/.test(edit.label), JSON.stringify(edit));

  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForFunction(() => !document.querySelector('[data-contour-card="dimension"]'), null, { timeout: 4000 });

  await page.locator('[data-contour-tool="constraints"]').click();
  await page.locator('[data-contour-card="constraint"]').waitFor({ timeout: 4000 });
  await waitSettled(page);
  const edge = await page.evaluate(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    let best = null;
    for (let i = 0; i < dots.length; i += 1) {
      for (let j = i + 1; j < dots.length; j += 1) {
        const span = Math.hypot(dots[j].x - dots[i].x, dots[j].y - dots[i].y);
        if (!best || span > best.span) best = { i, j, span, a: dots[i], b: dots[j] };
      }
    }
    if (!best) return null;
    for (let s = 1; s < 12; s += 1) {
      const t = s / 12;
      const x = best.a.x + (best.b.x - best.a.x) * t;
      const y = best.a.y + (best.b.y - best.a.y) * t;
      const nearDot = dots.some((d) => Math.hypot(d.x - x, d.y - y) < 16);
      const el = document.elementFromPoint(x, y);
      const canvas = el && (el.tagName === 'CANVAS' || el.closest?.('canvas'));
      if (!nearDot && canvas) return { x, y, span: best.span };
    }
    return { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2, span: best.span, fallback: true };
  });
  if (edge) await page.mouse.click(edge.x, edge.y);
  try {
    await page.waitForFunction(() => (
      window.__VIEWPORT__.stageContourSketch().picked.some((p) => p.kind === 'line')
    ), null, { timeout: 4000 });
  } catch (err) {
    const diag = await page.evaluate(() => ({
      sketch: window.__VIEWPORT__.stageContourSketch(),
      card: document.querySelector('[data-contour-card]')?.getAttribute('data-contour-card') || '',
    }));
    throw new Error(`${err.message} edge ${JSON.stringify(edge)} diag ${JSON.stringify(diag)}`);
  }
  const pointIndex = await page.evaluate(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    const open = dots.filter((d) => {
      const el = document.elementFromPoint(d.x, d.y);
      return el && (el.tagName === 'CANVAS' || el.closest?.('canvas'));
    });
    return Math.max(0, open.length - 1);
  });
  await clickDot(page, pointIndex);
  await page.waitForFunction(() => {
    const picked = window.__VIEWPORT__.stageContourSketch().picked || [];
    return picked.some((p) => p.kind === 'line') && picked.some((p) => p.kind === 'point');
  }, null, { timeout: 4000 });
  const constrain = await page.evaluate(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return {
      picked: sketch.picked,
      lines: sketch.pickHighlights?.lines || [],
      points: sketch.pickHighlights?.points || [],
      mode: document.querySelector('[data-contour-card="constraint"]')?.getAttribute('data-contour-constraint-mode') || '',
      label: (document.querySelector('[data-feature-card-confirm]')?.textContent || '').trim(),
    };
  });
  const linePick = (constrain.picked || []).find((p) => p.kind === 'line');
  const pointPick = (constrain.picked || []).find((p) => p.kind === 'point');
  check(`${width} Constrain tap picks a line and a point`, !!linePick && !!pointPick, JSON.stringify(constrain));
  check(`${width} Constrain picks stay highlighted`, !!linePick && constrain.lines.includes(linePick.id) && !!pointPick && constrain.points.includes(pointPick.id), JSON.stringify(constrain));
  check(`${width} Constrain create says Add`, constrain.mode === 'add' && constrain.label === 'Add', JSON.stringify(constrain));
}

const up = await waitForServer();
if (!up) {
  console.log('dimension feedback: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, headless: true });
attachConsentPresetToBrowser(browser);
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 800 } });
    await page.addInitScript(() => { window.__SURFCAD_NO_TUTORIAL = true; });
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
    await runViewport(page, width);
    check(`${width} no page error`, errors.length === 0, errors.join(' | '));
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\ndimension feedback ok');
