#!/usr/bin/env node
/**
 * A dimension re-solve must not leave the previous preview or highlight.
 *
 * c1 is used by an extrude. c2 is an unused polyline with one length.
 * The unused chip matches the used chip (a dot, not the word "unused").
 * Changing that length three times, dragging a point, and undoing leave
 * no selected-contour highlight and no duplicate preview meshes.
 *
 * Screenshots at 390 and 1280 go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window, Event */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import {
  armContourGesture,
  composeContourExtrude,
  composeContourProfile,
  enterContourState,
  saveContourDimension,
} from '../../src/utils/contourMode.js';
import { writeContourProfileBlock } from '../../src/utils/contourProfileWrite.js';

const PORT = Number(process.env.SMOKE_PORT || 5268);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();

const FACE = {
  type: 'planar',
  center: [0, 0, 0],
  normal: [0, 0, 1],
  planeFrame: {
    center: [0, 0, 0],
    normal: [0, 0, 1],
    x: [1, 0, 0],
    y: [0, 1, 0],
  },
};

function sharedScript() {
  const c1 = composeContourProfile('', {
    face: FACE,
    tool: 'circle',
    params: { radius: 6, segments: 24 },
    contourId: 'c1',
    contourName: 'c1',
  });
  if (!c1.ok) throw new Error(c1.message);
  const ext = composeContourExtrude(c1.buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 6, segments: 24 },
    contourId: 'c1',
    contourName: 'c1',
    extrude: { distance: 8, direction: 'normal', sense: 'positive' },
  });
  if (!ext.ok) throw new Error(ext.message);
  const drawn = armContourGesture({
    ...enterContourState('crossSection', FACE),
    tool: 'polyline',
    params: { points: [[-12, -8], [12, -8], [12, 8], [-12, 8]] },
  }, 'dimension');
  const picked = { ...drawn, picks: [{ id: 'e0', kind: 'line', label: 'e0' }] };
  const saved = saveContourDimension(picked, {
    kind: 'length',
    valueMm: 24,
    name: 'width',
    side: 1,
    sense: 1,
  });
  if (saved.error || !saved.state?.params?.contour) throw new Error(saved.error || 'dimension did not save');
  const block = writeContourProfileBlock(ext.buffer, {
    face: FACE,
    tool: 'polyline',
    params: saved.state.params,
    contourId: 'c2',
    contourName: 'c2',
  });
  if (!block.ok) throw new Error(block.message);
  return block.buffer;
}

const SCRIPT = sharedScript();

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

console.log('contour stale preview (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour stale preview: no system Chrome — set CHROME_PATH');
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

async function setNumber(page, selector, value) {
  await page.evaluate((arg) => {
    const input = document.querySelector(arg.selector);
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    const tracker = input._valueTracker;
    if (tracker) tracker.setValue(String(input.value));
    proto.set.call(input, arg.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, { selector, value });
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
    const model = window.monaco.editor.getModels()[0];
    model.setValue(src);
  }, SCRIPT);
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
  await ensurePartSelected(page);
  await page.evaluate((src) => {
    const model = window.monaco.editor.getModels()[0];
    model.setValue(src);
  }, SCRIPT);
  const again = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
  if (again?.error) throw new Error(again.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.locator('[data-cad-feature-strip] [data-contour-id="c1"]').first().waitFor({ timeout: 8000 });
  await page.locator('[data-cad-feature-strip] [data-contour-id="c2"]').first().waitFor({ timeout: 8000 });
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

async function visibleChips(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-cad-feature-strip] [data-contour-id]')) {
      const box = el.getBoundingClientRect();
      if (box.width <= 2 || box.height <= 2) continue;
      out.push({
        id: el.getAttribute('data-contour-id'),
        w: box.width,
        h: box.height,
        unused: el.hasAttribute('data-contour-unused'),
        dot: !!el.querySelector('[data-contour-unused-dot]'),
        text: el.textContent || '',
      });
    }
    return out;
  });
}

function overlayProblems(counts) {
  const names = counts?.names || [];
  const selected = names.filter((name) => name === 'contourSelected');
  const previews = names.filter((name) => /Preview|crossSectionPreview/.test(name));
  const dup = previews.filter((name, index) => previews.indexOf(name) !== index);
  const stray = names.filter((name) => (
    name === 'highlight'
    || name === 'edgeHover'
    || name === 'edgeSelection'
    || name === 'edgeSelectionOtherPart'
  ));
  return { names, selected, dup, stray };
}

function assertClean(label, counts, baselineNames = null) {
  const { names, selected, dup, stray } = overlayProblems(counts);
  check(`${label} no selected-contour highlight`, selected.length === 0, names.join(','));
  check(`${label} no duplicate previews`, dup.length === 0, names.join(','));
  check(`${label} no leftover highlight`, stray.length === 0, names.join(','));
  if (baselineNames) {
    const same = [...names].sort().join('|') === [...baselineNames].sort().join('|');
    check(`${label} overlay names stay put`, same, `${names.join(',')} vs ${baselineNames.join(',')}`);
  }
  return names;
}

async function openContour(page, id) {
  await page.evaluate((contourId) => {
    const nodes = [...document.querySelectorAll(`[data-cad-feature-strip] [data-contour-id="${contourId}"]`)];
    const el = nodes.find((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 2 && box.height > 2;
    }) || nodes[0];
    el?.click();
  }, id);
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
  await boot(page);

  const chips = await visibleChips(page);
  const used = chips.filter((chip) => chip.id === 'c1');
  const unused = chips.filter((chip) => chip.id === 'c2');
  check(`${label} a used chip and an unused chip are on screen`,
    used.length > 0 && used.length === unused.length, JSON.stringify(chips));
  for (let i = 0; i < Math.min(used.length, unused.length); i += 1) {
    const same = Math.abs(used[i].w - unused[i].w) <= 1 && Math.abs(used[i].h - unused[i].h) <= 1;
    check(`${label} unused chip matches the used chip`, same, JSON.stringify({ used: used[i], unused: unused[i] }));
    check(`${label} unused chip is a dot`,
      unused[i].unused && unused[i].dot && !/unused/i.test(unused[i].text),
      JSON.stringify(unused[i]));
    check(`${label} used chip has no unused mark`, !used[i].unused && !used[i].dot, JSON.stringify(used[i]));
  }
  await page.screenshot({ path: join(SHOT_DIR, `contour-stale-chips-${label}.png`) });

  await openContour(page, 'c2');
  const banner = page.locator('[data-contour-used-by]');
  await banner.waitFor({ timeout: 8000 });
  const bannerText = (await banner.innerText()).trim();
  check(`${label} the editor banner still reads Unused`, bannerText === 'Unused', bannerText);
  await page.waitForFunction(() => {
    const aim = document.querySelector('[data-contour-face-aim]')?.getAttribute('data-contour-face-aim');
    return !aim || aim === 'done';
  }, null, { timeout: 8000 });
  await page.locator('[data-contour-tag]').first().waitFor({ timeout: 8000 });
  await page.locator('[data-contour-tag]').first().click();
  await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 8000 });

  const solves = [30, 36, 18];
  let baseline = null;
  for (const mm of solves) {
    await setNumber(page, '[data-contour-card="dimension"] input[type="number"]', String(mm));
    await page.waitForFunction((target) => {
      const values = window.__VIEWPORT__?.stageContourSketch?.().dimensionValues || [];
      return values.some((value) => Math.abs(Number(value) - target) < 0.05);
    }, mm, { timeout: 8000 });
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const counts = await page.evaluate(() => window.__VIEWPORT__.stageContourOverlays());
    baseline = assertClean(`${label} solve ${mm}`, counts, baseline);
  }
  await page.screenshot({ path: join(SHOT_DIR, `contour-stale-solve-${label}.png`) });

  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => !document.querySelector('[data-contour-card="dimension"]'), null, { timeout: 8000 });
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const afterConfirm = await page.evaluate(() => window.__VIEWPORT__.stageContourOverlays());
  const confirmedNames = assertClean(`${label} after confirm`, afterConfirm);

  const beforeUvs = await page.evaluate(() => JSON.stringify(window.__VIEWPORT__.stageContourSketch().uvs));
  const dot = await page.evaluate(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    const canvas = document.querySelector('.viewport-shell > canvas');
    const rect = canvas?.getBoundingClientRect();
    if (!rect || !dots.length) return null;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let best = null;
    let bestD = Infinity;
    for (const item of dots) {
      const dist = Math.hypot(item.x - cx, item.y - cy);
      if (dist < bestD) {
        best = item;
        bestD = dist;
      }
    }
    return best;
  });
  check(`${label} a sketch dot is on screen`, !!dot && Number.isFinite(dot?.x), JSON.stringify(dot));
  if (dot) {
    await page.mouse.move(dot.x, dot.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(dot.x + 48, dot.y + 16, { steps: 10 });
    await page.mouse.up({ button: 'right' });
    await page.waitForFunction((prev) => (
      JSON.stringify(window.__VIEWPORT__.stageContourSketch().uvs) !== prev
    ), beforeUvs, { timeout: 2000 }).catch(() => {});
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
  }
  const afterDrag = await page.evaluate(() => window.__VIEWPORT__.stageContourOverlays());
  const draggedNames = assertClean(`${label} after drag`, afterDrag);
  check(`${label} drag does not add overlays`,
    draggedNames.length <= confirmedNames.length,
    `${draggedNames.length} > ${confirmedNames.length}`);
  await page.screenshot({ path: join(SHOT_DIR, `contour-stale-drag-${label}.png`) });

  const depth = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch().undoDepth);
  check(`${label} undo has a sketch step`, depth > 0, String(depth));
  if (depth > 0) {
    await page.locator('[data-contour-back]').click();
    await page.waitForFunction((prev) => (
      window.__VIEWPORT__.stageContourSketch().undoDepth < prev
    ), depth, { timeout: 8000 });
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
  }
  const afterUndo = await page.evaluate(() => window.__VIEWPORT__.stageContourOverlays());
  const undoneNames = assertClean(`${label} after undo`, afterUndo);
  check(`${label} undo does not add overlays`,
    undoneNames.length <= Math.max(confirmedNames.length, draggedNames.length),
    undoneNames.join(','));

  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('contour stale preview: vite did not start');
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
  console.log(`contour stale preview: ${failed} failed`);
  process.exit(1);
}
console.log('contour stale preview: ok');
