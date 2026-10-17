#!/usr/bin/env node
/**
 * Phone Dimension Done. 390px. A reduced visualViewport stands in for the
 * keyboard. Done in the compact field Adds a dimension, clears the picks,
 * and leaves the card open. Blur only commits. Reopening and pressing Done
 * Confirms. Perpendicular plus tags do not cover a dimension chip, and two
 * pluses on one anchor collapse to one.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window, navigator, getComputedStyle, requestAnimationFrame */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.SMOKE_PORT || 5257);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'return Manifold.cube([40, 30, 20], true);\n';
const PHONE = { width: 390, height: 844 };
const KEYBOARD = { height: 300, offsetTop: 44 };

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

console.log('dimension done — source');
{
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const shell = read('src/components/FeatureSheet.jsx');
  const card = read('src/components/ContourGestureCard.jsx');
  const tags = read('src/components/ContourTags.jsx');
  const arch = read('docs/architecture.md');
  const map = read('docs/UI_MAP.md');
  check('Done and Enter apply; blur only commits',
    /onCommit\('done'\)/.test(shell)
    && /onCommit\('enter'\)/.test(shell)
    && /onCommit\('blur'\)/.test(shell)
    && /reason === 'done' \|\| reason === 'enter'/.test(shell)
    && /onKeyboardDone/.test(shell));
  check('dimension and constrain wire Done to Add or Confirm; arc does not',
    /onKeyboardDone=\{isArc \? undefined : apply\}/.test(card));
  check('a plus that covers a dimension chip is hidden',
    /plusTagsToHide/.test(tags)
    && /icon === 'perpendicular'/.test(tags)
    && /contourTagSuppressed/.test(tags));
  check('docs describe phone Done and the plus bubble',
    /On Dimension and Constrain, Done and Enter then Add/.test(arch)
    && /perpendicular constraint is a plus bubble/.test(arch)
    && /Blur only commits/.test(map)
    && /plus bubble/.test(map));
}

if (String(SHOT_DIR).startsWith('/opt/cursor/artifacts')) {
  console.log(`  ❌ screenshots must not use /opt/cursor/artifacts (${SHOT_DIR})`);
  process.exit(1);
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('  ❌ system Chrome is required');
  process.exit(1);
}

mkdirSync(SHOT_DIR, { recursive: true });

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
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
      scored: candidates.map((pts) => ({ pts, projected: pts.map(project) })),
    };
  }, sets);
  const yMin = 0.34;
  const yMax = 0.72;
  const inBand = (p) => {
    if (!p) return false;
    const nx = (p.x - view.left) / view.width;
    const ny = (p.y - view.top) / view.height;
    return nx > 0.12 && nx < 0.88 && ny > yMin && ny < yMax;
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
  const usable = view.scored.filter((row) => row.projected.every(Boolean) && minEdge(row) >= 36 && row.projected.every(inBand));
  if (!usable.length) return null;
  usable.sort((a, b) => minEdge(b) - minEdge(a));
  return usable[0].pts;
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
      return dot ? { ...dot, open: open.length } : { open: open.length };
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

async function setKeyboard(page, height, offsetTop) {
  await page.evaluate(({ height: h, offsetTop: top }) => {
    window.__setVisualViewport(h, top);
  }, { height, offsetTop });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function openCompact(page) {
  await page.locator('[data-contour-card="dimension"] input[type="number"]').focus();
  await page.waitForSelector('[data-feature-field-edit]', { timeout: 4000 });
  await setKeyboard(page, KEYBOARD.height, KEYBOARD.offsetTop);
  const ready = await page.waitForFunction(() => {
    const done = document.querySelector('[data-feature-field-done]');
    const body = document.querySelector('[data-feature-sheet-body]');
    const card = document.querySelector('[data-feature-card]');
    if (!done || !card?.hasAttribute('data-feature-field-edit')) return false;
    const box = done.getBoundingClientRect();
    const vv = window.visualViewport;
    const hidden = !body || !!body.closest('[hidden]') || getComputedStyle(body).display === 'none';
    return hidden && box.width > 2 && box.bottom <= vv.offsetTop + vv.height + 2 && box.top >= vv.offsetTop - 1;
  }, null, { timeout: 4000 }).then(() => true).catch(() => false);
  if (ready) return;
  const diag = await page.evaluate(() => {
    const done = document.querySelector('[data-feature-field-done]');
    const card = document.querySelector('[data-feature-card]');
    const body = document.querySelector('[data-feature-sheet-body]');
    const vv = window.visualViewport;
    const box = done ? done.getBoundingClientRect() : null;
    const cardBox = card ? card.getBoundingClientRect() : null;
    return {
      editing: !!card?.hasAttribute('data-feature-field-edit'),
      vv: vv ? { h: vv.height, top: vv.offsetTop, w: vv.width } : null,
      inner: { w: window.innerWidth, h: window.innerHeight },
      done: box ? { top: box.top, bottom: box.bottom, width: box.width, height: box.height } : null,
      card: cardBox ? { top: cardBox.top, bottom: cardBox.bottom, height: cardBox.height, bottomStyle: card.style.bottom } : null,
      bodyHidden: body ? !!body.closest('[hidden]') : null,
      bodyDisplay: body ? getComputedStyle(body).display : null,
    };
  });
  throw new Error(`compact view missed the keyboard ${JSON.stringify(diag)}`);
}

async function sketchCard(page) {
  return page.evaluate(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    const card = document.querySelector('[data-contour-card="dimension"]');
    const input = document.querySelector('[data-contour-card="dimension"] input[type="number"]');
    return {
      dimensions: sketch.dimensions,
      constraints: sketch.constraints,
      picked: sketch.picked.length,
      gesture: sketch.gesture,
      mode: card?.getAttribute('data-contour-dimension-mode') || '',
      open: !!card,
      editing: !!document.querySelector('[data-feature-field-edit]'),
      value: input?.value || '',
      confirm: (document.querySelector('[data-feature-card-confirm]')?.textContent || '').trim(),
    };
  });
}

function overlaps(a, b) {
  const slop = 0.5;
  return a.left < b.right - slop
    && b.left < a.right - slop
    && a.top < b.bottom - slop
    && b.top < a.bottom - slop;
}

async function tagLayout(page) {
  return page.evaluate(() => {
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const visibleWrap = (el) => {
      const wrap = el.parentElement;
      if (!wrap || wrap.dataset.contourTagVisible !== '1') return false;
      if (getComputedStyle(wrap).display === 'none') return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    };
    const chips = [...document.querySelectorAll('[data-contour-tag]')]
      .filter((el) => !el.hasAttribute('data-contour-icon') && visibleWrap(el))
      .map((el) => ({ text: (el.textContent || '').trim(), box: rectOf(el) }));
    const pluses = [...document.querySelectorAll('[data-contour-icon="perpendicular"]')]
      .filter((el) => visibleWrap(el))
      .map((el) => rectOf(el));
    return {
      chips,
      pluses,
      suppressed: document.querySelectorAll('[data-contour-tag-suppressed="plus"]').length,
      constraints: window.__VIEWPORT__.stageContourSketch().constraints,
    };
  });
}

async function clickEdge(page) {
  const edge = await page.evaluate(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    let best = null;
    for (let i = 0; i < dots.length; i += 1) {
      for (let j = i + 1; j < dots.length; j += 1) {
        const span = Math.hypot(dots[j].x - dots[i].x, dots[j].y - dots[i].y);
        if (!best || span > best.span) best = { span, a: dots[i], b: dots[j] };
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
  if (!edge) throw new Error('no visible edge for Enter');
  await page.mouse.click(edge.x, edge.y);
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().picked.length >= 1, null, { timeout: 4000 });
}

async function lineSpots(page) {
  return page.evaluate(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    const pairs = [];
    for (let i = 0; i < dots.length; i += 1) {
      for (let j = i + 1; j < dots.length; j += 1) {
        const a = dots[i];
        const b = dots[j];
        const span = Math.hypot(b.x - a.x, b.y - a.y);
        if (span < 28) continue;
        for (let s = 1; s < 16; s += 1) {
          const t = s / 16;
          const x = a.x + (b.x - a.x) * t;
          const y = a.y + (b.y - a.y) * t;
          const nearDot = dots.some((d) => Math.hypot(d.x - x, d.y - y) < 18);
          const el = document.elementFromPoint(x, y);
          const canvas = el && (el.tagName === 'CANVAS' || el.closest?.('canvas'));
          if (!nearDot && canvas) {
            pairs.push({ x, y, span });
            break;
          }
        }
      }
    }
    pairs.sort((p, q) => q.span - p.span);
    return pairs;
  });
}

async function clickTwoLines(page) {
  for (let n = 0; n < 2; n += 1) {
    const before = await page.evaluate(() => (
      window.__VIEWPORT__.stageContourSketch().picked.filter((p) => p.kind === 'line').map((p) => p.id)
    ));
    const spots = await lineSpots(page);
    let hit = false;
    for (const spot of spots) {
      await page.mouse.click(spot.x, spot.y);
      const after = await page.evaluate(() => (
        window.__VIEWPORT__.stageContourSketch().picked.filter((p) => p.kind === 'line').map((p) => p.id)
      ));
      if (after.length === before.length + 1) {
        hit = true;
        break;
      }
      if (after.length < before.length) await page.mouse.click(spot.x, spot.y);
    }
    if (!hit) {
      const picked = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch().picked);
      throw new Error(`line ${n + 1} not picked from ${spots.length} spots ${JSON.stringify(picked)}`);
    }
  }
}

const up = await waitForServer();
if (!up) {
  console.log('dimension done: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
attachConsentPresetToBrowser(browser);

try {
  const context = await browser.newContext({
    viewport: PHONE,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    window.__SURFCAD_NO_TUTORIAL = true;
    const listeners = { resize: new Set(), scroll: new Set() };
    let height = window.innerHeight;
    let offsetTop = 0;
    const vv = {
      get height() { return height; },
      get offsetTop() { return offsetTop; },
      get width() { return window.innerWidth; },
      get offsetLeft() { return 0; },
      get pageTop() { return offsetTop; },
      get pageLeft() { return 0; },
      get scale() { return 1; },
      addEventListener(type, fn) { (listeners[type] || (listeners[type] = new Set())).add(fn); },
      removeEventListener(type, fn) { listeners[type] && listeners[type].delete(fn); },
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get() { return vv; } });
    window.__setVisualViewport = (h, top) => {
      height = h;
      offsetTop = top || 0;
      (listeners.resize || []).forEach((fn) => fn());
      (listeners.scroll || []).forEach((fn) => fn());
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);
  const touch = await page.evaluate(() => ({
    points: navigator.maxTouchPoints,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    stub: typeof window.__setVisualViewport === 'function',
  }));
  check('the phone context is a touch device', (touch.points > 0 || touch.coarse) && touch.stub, JSON.stringify(touch));

  await page.locator('button[aria-label^="Insert Create contour"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  await page.locator('[data-contour-tool="polyline"]').click();
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });

  const pts = await chooseTriangle(page);
  check('triangle is on the canvas', Array.isArray(pts) && pts.length === 3, JSON.stringify(pts));
  if (!pts) throw new Error('no triangle');
  await addPoint(page, pts[0], 1);
  await addPoint(page, pts[1], 2);
  await addPoint(page, pts[2], 3);

  await page.locator('[data-contour-tool="dimension"]').click();
  await page.locator('[data-contour-card="dimension"]').waitFor({ timeout: 4000 });
  await waitSettled(page);
  await clickDot(page, 0);
  await clickDot(page, 1);
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-feature-card-confirm]');
    return btn && !btn.disabled && /Add/.test(btn.textContent || '');
  }, null, { timeout: 4000 });

  const typed = await page.evaluate(() => {
    const input = document.querySelector('[data-contour-card="dimension"] input[type="number"]');
    const n = Number(input?.value);
    const next = Number.isFinite(n) && n > 0 ? Math.round(n) + 1 : 30;
    return String(next);
  });
  const label = `${Number(typed).toFixed(2)} mm`;

  await openCompact(page);
  await page.locator('[data-feature-field-edit-input]').fill(typed);
  await page.waitForFunction((value) => {
    const real = document.querySelector('[data-contour-card="dimension"] input[type="number"]');
    return real?.value === value;
  }, typed, { timeout: 4000 });
  await page.locator('[data-feature-card-title]').click();
  await page.waitForFunction(() => !document.querySelector('[data-feature-field-edit]'), null, { timeout: 4000 });
  await setKeyboard(page, PHONE.height, 0);
  const blurred = await sketchCard(page);
  check('blur commits the value and does not Add',
    blurred.open
    && blurred.mode === 'add'
    && blurred.picked === 2
    && blurred.gesture === 'dimension'
    && blurred.value === typed
    && blurred.editing === false,
    JSON.stringify(blurred));

  await openCompact(page);
  await page.locator('[data-feature-field-done]').click();
  await setKeyboard(page, PHONE.height, 0);
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    const card = document.querySelector('[data-contour-card="dimension"]');
    return sketch.dimensions >= 1
      && sketch.picked.length === 0
      && card?.getAttribute('data-contour-dimension-mode') === 'add'
      && !document.querySelector('[data-feature-field-edit]');
  }, null, { timeout: 4000 });
  const added = await sketchCard(page);
  check('Done adds the dimension, clears the picks, and leaves the card open',
    added.dimensions >= 1 && added.picked === 0 && added.mode === 'add' && added.open && added.gesture === 'dimension',
    JSON.stringify(added));
  await page.waitForFunction((text) => (
    [...document.querySelectorAll('[data-contour-tag]')]
      .filter((el) => !el.hasAttribute('data-contour-icon'))
      .some((el) => (el.textContent || '').includes(text))
  ), label, { timeout: 4000 });
  await page.screenshot({ path: join(SHOT_DIR, 'dimension-done-390-added.png') });

  await waitSettled(page);
  await clickEdge(page);
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-feature-card-confirm]');
    return btn && !btn.disabled && /Add/.test(btn.textContent || '');
  }, null, { timeout: 4000 });
  await openCompact(page);
  await page.locator('[data-feature-field-edit-input]').press('Enter');
  await setKeyboard(page, PHONE.height, 0);
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    const card = document.querySelector('[data-contour-card="dimension"]');
    return sketch.dimensions >= 2
      && sketch.picked.length === 0
      && card?.getAttribute('data-contour-dimension-mode') === 'add'
      && !document.querySelector('[data-feature-field-edit]');
  }, null, { timeout: 4000 });
  const entered = await sketchCard(page);
  check('Enter adds the next dimension, clears the picks, and leaves the card open',
    entered.dimensions >= 2 && entered.picked === 0 && entered.mode === 'add' && entered.open,
    JSON.stringify(entered));

  await waitSettled(page);
  await page.evaluate(() => {
    const tags = [...document.querySelectorAll('[data-contour-tag]')]
      .filter((el) => !el.hasAttribute('data-contour-icon'));
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
  const edited = await sketchCard(page);
  check('reopen is edit Confirm', edited.mode === 'edit' && edited.confirm === 'Confirm', JSON.stringify(edited));

  const revised = String(Number(typed) + 2);
  const revisedLabel = `${Number(revised).toFixed(2)} mm`;
  await openCompact(page);
  await page.locator('[data-feature-field-edit-input]').fill(revised);
  await page.locator('[data-feature-card-title]').click();
  await page.waitForFunction(() => !document.querySelector('[data-feature-field-edit]'), null, { timeout: 4000 });
  await setKeyboard(page, PHONE.height, 0);
  const editBlur = await sketchCard(page);
  check('edit blur commits and does not Confirm',
    editBlur.open && editBlur.mode === 'edit' && editBlur.value === revised && editBlur.gesture === 'dimension',
    JSON.stringify(editBlur));

  await openCompact(page);
  await page.locator('[data-feature-field-done]').click();
  await setKeyboard(page, PHONE.height, 0);
  await page.waitForFunction(() => (
    !document.querySelector('[data-contour-card="dimension"]')
    && !window.__VIEWPORT__.stageContourSketch().gesture
  ), null, { timeout: 4000 });
  const confirmed = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  check('edit Done Confirms and closes the card',
    !confirmed.gesture && confirmed.dimensions >= 1,
    JSON.stringify({ gesture: confirmed.gesture, dimensions: confirmed.dimensions }));
  await page.waitForFunction((text) => (
    [...document.querySelectorAll('[data-contour-tag]')]
      .filter((el) => !el.hasAttribute('data-contour-icon'))
      .some((el) => (el.textContent || '').includes(text))
  ), revisedLabel, { timeout: 4000 });

  await page.locator('[data-contour-tool="constraints"]').click();
  await page.locator('[data-contour-card="constraint"]').waitFor({ timeout: 4000 });
  await waitSettled(page);
  for (let n = 1; n <= 2; n += 1) {
    await clickTwoLines(page);
    await page.locator('[data-sticky-property="perpendicular"]').click();
    await page.waitForFunction(() => {
      const btn = document.querySelector('[data-feature-card-confirm]');
      return btn && !btn.disabled && /Add/.test(btn.textContent || '');
    }, null, { timeout: 4000 });
    await page.locator('[data-feature-card-confirm]').click();
    await page.waitForFunction((count) => (
      window.__VIEWPORT__.stageContourSketch().constraints >= count
      && window.__VIEWPORT__.stageContourSketch().picked.length === 0
    ), n, { timeout: 4000 });
  }
  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForFunction(() => !document.querySelector('[data-contour-card="constraint"]'), null, { timeout: 4000 });
  await waitSettled(page);

  let layout = null;
  let framed = false;
  const started = Date.now();
  while (Date.now() - started < 4000) {
    layout = await tagLayout(page);
    if (!framed && Date.now() - started > 700 && (layout.chips.length === 0 || layout.suppressed === 0)) {
      framed = true;
      await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 24, el: 58, margin: 1.6 }));
      await page.waitForTimeout(200);
      continue;
    }
    const chipHit = layout.chips.some((chip) => layout.pluses.some((plus) => overlaps(chip.box, plus)));
    let plusHit = false;
    for (let i = 0; i < layout.pluses.length; i += 1) {
      for (let j = i + 1; j < layout.pluses.length; j += 1) {
        if (overlaps(layout.pluses[i], layout.pluses[j])) plusHit = true;
      }
    }
    const ready = layout.constraints >= 2
      && layout.chips.length >= 1
      && layout.suppressed >= 1
      && !chipHit
      && !plusHit;
    if (ready) break;
    await page.waitForTimeout(40);
  }
  const chipHit = layout.chips.some((chip) => layout.pluses.some((plus) => overlaps(chip.box, plus)));
  let plusHit = false;
  for (let i = 0; i < layout.pluses.length; i += 1) {
    for (let j = i + 1; j < layout.pluses.length; j += 1) {
      if (overlaps(layout.pluses[i], layout.pluses[j])) plusHit = true;
    }
  }
  check('plus tags do not cover a dimension chip or each other',
    layout.constraints >= 2
    && layout.chips.length >= 1
    && layout.suppressed >= 1
    && layout.pluses.length < layout.constraints
    && !chipHit
    && !plusHit,
    JSON.stringify({
      constraints: layout.constraints,
      chips: layout.chips.length,
      pluses: layout.pluses.length,
      suppressed: layout.suppressed,
      chipHit,
      plusHit,
    }));
  await page.screenshot({ path: join(SHOT_DIR, 'dimension-done-390-tags.png') });
  check('no page error', errors.length === 0, errors.join(' | '));
  await context.close();
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\ndimension done ok');
