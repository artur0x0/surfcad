#!/usr/bin/env node
/**
 * Sketch strip at 390 and 1280, touch only.
 *
 * The plane card keeps the part strip hidden and draws no circle. After
 * Select plane the pressed tool is Cursor and the strip reads No sketch
 * entities. Choosing Circle adds that chip. An empty polyline reads No
 * sketch entities. A dimension chip and a constraint chip open
 * their edit cards. A canvas tap selects the same line the chip does. A
 * two-pick dimension gesture clears the chip. Cursor keeps the drawn chips.
 * Double-tap removal of a polyline dot leaves a broken constraint chip.
 * A geometry chip deletes at once when nothing names it, and confirms
 * Delete along with N when dimensions or constraints do. That undo is
 * one sketch step. The script stays unchanged.
 * Undo follows sketch history.
 * Redo stays disabled. Leaving contour mode brings the part strip back.
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

const PORT = Number(process.env.SMOKE_PORT || 5293);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'return Manifold.cube([40, 30, 20], true);\n';

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

console.log('contour strip');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour strip: no system Chrome — set CHROME_PATH');
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

async function tapAt(client, page, x, y) {
  const point = { x, y, id: 1 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point] });
  await page.waitForTimeout(120);
}

async function doubleTap(page, x, y) {
  await page.evaluate(async ({ x: px, y: py }) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const fire = (type) => {
      canvas.dispatchEvent(new window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: px,
        clientY: py,
        button: 0,
        buttons: type === 'pointerdown' ? 1 : 0,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
      }));
      canvas.dispatchEvent(new window.MouseEvent(type === 'pointerdown' ? 'mousedown' : type === 'pointerup' ? 'mouseup' : 'mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: px,
        clientY: py,
        button: 0,
        buttons: type === 'pointerdown' ? 1 : 0,
      }));
    };
    const tap = () => {
      fire('pointerdown');
      fire('pointerup');
    };
    tap();
    await new Promise((resolve) => setTimeout(resolve, 80));
    tap();
  }, { x, y });
}

async function tapSelector(client, page, selector) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ timeout: 8000 });
  await loc.evaluate((el) => el.scrollIntoView({ inline: 'center', block: 'nearest' }));
  const box = await loc.boundingBox();
  if (!box) throw new Error(`missing ${selector}`);
  await tapAt(client, page, box.x + box.width / 2, box.y + box.height / 2);
}

async function fitSketchDots(page) {
  const canvas = page.locator('.viewport-shell > canvas');
  for (let n = 0; n < 8; n += 1) {
    const box = await canvas.boundingBox();
    const dots = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch().dots || []);
    const inside = box && dots.length >= 4 && dots.every((dot) => (
      dot.x > box.x + 28 && dot.x < box.x + box.width - 28
      && dot.y > box.y + 88 && dot.y < box.y + box.height - 180
    ));
    if (inside) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.35);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(70);
  }
  await waitCameraStill(page);
}

async function tapSegment(client, page, pointA, pointB) {
  await muteTags(page);
  const mid = await page.evaluate((ids) => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    const a = dots.find((dot) => dot.id === ids[0]);
    const b = dots.find((dot) => dot.id === ids[1]);
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dots: dots.map((dot) => dot.id) };
  }, [pointA, pointB]);
  if (!mid) throw new Error(`no handles for ${pointA} ${pointB}`);
  const el = await page.evaluate((p) => {
    const node = document.elementFromPoint(p.x, p.y);
    return {
      ok: node?.tagName === 'CANVAS',
      tag: node ? node.tagName : '',
      cls: typeof node?.className === 'string' ? node.className.slice(0, 80) : '',
    };
  }, mid);
  if (!el.ok) throw new Error(`segment blocked ${JSON.stringify(el)} ${JSON.stringify(mid)}`);
  await tapAt(client, page, mid.x, mid.y);
}

async function waitCameraStill(page) {
  let prev = null;
  for (let i = 0; i < 25; i += 1) {
    const pos = await page.evaluate(() => window.__VIEWPORT__.stageCamera().position);
    const still = prev && Math.hypot(pos[0] - prev[0], pos[1] - prev[1], pos[2] - prev[2]) < 1e-3;
    if (still) return;
    prev = pos;
    await page.waitForTimeout(40);
  }
}

function strip(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-cad-feature-strip] [data-feature-strip]');
    const chips = [...document.querySelectorAll('[data-cad-feature-strip] [data-sketch-id]')].map((el) => ({
      id: el.getAttribute('data-sketch-id'),
      kind: el.getAttribute('data-sketch-kind'),
      label: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      pressed: el.getAttribute('aria-pressed') === 'true',
      broken: el.hasAttribute('data-sketch-broken'),
      index: el.querySelector('[data-feature-type-badge]')?.textContent || '',
    }));
    const undo = document.querySelector('[data-cad-feature-strip] [data-feature-bar-undo]');
    const redo = document.querySelector('[data-cad-feature-strip] [data-feature-bar-redo]');
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return {
      label: root?.getAttribute('aria-label') || '',
      hidden: root?.getAttribute('data-feature-strip-hidden') || '',
      empty: document.querySelector('[data-cad-feature-strip] [data-sketch-entities-empty]')?.textContent?.trim() || '',
      sketch: root?.hasAttribute('data-sketch-entities') ? 1 : 0,
      partChips: document.querySelectorAll('[data-cad-feature-strip] [data-feature-chip]').length,
      chips,
      pressed: chips.filter((chip) => chip.pressed).map((chip) => chip.id),
      undo: undo ? !undo.disabled : null,
      redo: redo ? !redo.disabled : null,
      points: Array.isArray(sketch?.uvs) ? sketch.uvs.length : (sketch?.points || 0),
      tool: sketch?.tool || '',
      picked: sketch?.picked || [],
      highlights: sketch?.pickHighlights || null,
      card: document.querySelector('[data-contour-card]')?.getAttribute('data-contour-card') || '',
      dimMode: document.querySelector('[data-contour-dimension-mode]')?.getAttribute('data-contour-dimension-mode') || '',
      conMode: document.querySelector('[data-contour-constraint-mode]')?.getAttribute('data-contour-constraint-mode') || '',
      field: document.querySelector('[data-contour-card] input[data-field-label]')?.getAttribute('data-field-label') || '',
      confirmDisabled: (() => {
        const button = document.querySelector('[data-feature-card-confirm]');
        return button ? button.disabled : null;
      })(),
    };
  });
}

async function muteTags(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-contour-tags], [data-contour-tags] *').forEach((el) => {
      el.style.pointerEvents = 'none';
    });
  });
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext({ ...contextOptions, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);
  const client = await context.newCDPSession(page);

  await tapSelector(client, page, 'button[aria-label^="Insert Create contour"]');
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  const plane = await strip(page);
  const confirm = (await page.locator('[data-feature-card-confirm]').innerText()).trim();
  check(`${label} plane card says Select plane`, confirm.includes('Select plane'), confirm);
  const planePreview = await page.evaluate(() => window.__VIEWPORT__.stageContourOverlays().preview);
  check(`${label} plane card draws no circle`, planePreview === 0, String(planePreview));
  check(`${label} plane card hides the part strip`,
    plane.hidden === 'feature' && plane.sketch === 0 && plane.empty === '' && plane.chips.length === 0,
    JSON.stringify(plane));
  await page.screenshot({ path: join(SHOT_DIR, `contour-strip-${label}-plane.png`) });

  await tapSelector(client, page, '[data-feature-card-confirm]');
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && document.querySelector('[data-cad-feature-strip] [data-sketch-entities-empty]')?.textContent?.includes('No sketch entities')
  ), null, { timeout: 8000 });
  const fresh = await strip(page);
  const freshPreview = await page.evaluate(() => window.__VIEWPORT__.stageContourOverlays().preview);
  const freshSketch = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  const entered = await page.evaluate(() => ({
    tool: window.__VIEWPORT__.stageContourSketch().tool,
    cursor: document.querySelector('[data-contour-tool="cursor"]')?.getAttribute('aria-pressed'),
    polyline: document.querySelector('[data-contour-tool="polyline"]')?.getAttribute('aria-pressed'),
  }));
  check(`${label} fresh sketch has no circle chip`,
    fresh.label === 'Sketch' && fresh.empty === 'No sketch entities' && fresh.chips.length === 0
    && fresh.undo === false && fresh.redo === false && freshPreview === 0
    && freshSketch.tool === 'cursor' && freshSketch.radius == null && freshSketch.points === 0,
    JSON.stringify({ fresh, freshPreview, radius: freshSketch.radius }));
  check(`${label} Select plane starts on Cursor`,
    entered.tool === 'cursor' && entered.cursor === 'true' && entered.polyline === 'false',
    JSON.stringify(entered));

  await tapSelector(client, page, '[data-contour-tool="circle"]');
  await page.waitForFunction(() => (
    document.querySelector('[data-cad-feature-strip] [data-sketch-kind="circle"]')
  ), null, { timeout: 4000 });
  const circle = await strip(page);
  check(`${label} circle chip is the sketch`,
    circle.label === 'Sketch' && circle.hidden === '' && circle.partChips === 0
    && circle.pressed.join(',') === 'shape' && circle.chips[0]?.label === 'Circle'
    && circle.card === '' && circle.undo === true && circle.redo === false,
    JSON.stringify(circle));

  await tapSelector(client, page, '[data-cad-feature-strip] [data-sketch-id="shape"]');
  await page.waitForFunction(() => document.querySelector('[data-contour-card="entity"] [data-contour-entity-delete]'), null, { timeout: 4000 });
  await tapSelector(client, page, '[data-contour-card="entity"] [data-feature-card-cancel]');
  await page.waitForFunction(() => (
    !document.querySelector('[data-contour-card="entity"]')
    && document.querySelector('[data-cad-feature-strip] [data-sketch-id="shape"]')?.getAttribute('aria-pressed') === 'true'
  ), null, { timeout: 4000 });
  const closed = await strip(page);
  check(`${label} closing the delete card keeps the circle`,
    closed.card === '' && closed.pressed.join(',') === 'shape' && closed.undo === true,
    JSON.stringify(closed));

  await tapSelector(client, page, '[data-cad-feature-strip] [data-sketch-id="shape"]');
  await page.waitForFunction(() => document.querySelector('[data-contour-entity-delete]'), null, { timeout: 4000 });
  await tapSelector(client, page, '[data-contour-entity-delete]');
  await page.waitForFunction(() => {
    const undo = document.querySelector('[data-sketch-delete-toast] [data-error-undo]');
    const empty = document.querySelector('[data-cad-feature-strip] [data-sketch-entities-empty]');
    return undo && !undo.disabled && empty?.textContent?.includes('No sketch entities')
      && !document.querySelector('[data-sketch-entity-delete-dialog]');
  }, null, { timeout: 4000 });
  const droppedShape = await strip(page);
  const shapeScript = await page.evaluate(() => (
    (window.monaco?.editor?.getModels?.() || []).map((model) => model.getValue()).join('\n')
  ));
  check(`${label} unused shape deletes at once`,
    droppedShape.chips.length === 0 && droppedShape.empty === 'No sketch entities'
    && droppedShape.undo === true && !shapeScript.includes('solveContour'),
    JSON.stringify(droppedShape));

  await tapSelector(client, page, '[data-sketch-delete-toast] [data-error-undo]');
  await page.waitForFunction(() => (
    document.querySelector('[data-cad-feature-strip] [data-sketch-kind="circle"]')
    && document.querySelector('[data-cad-feature-strip] [data-feature-bar-undo]')?.disabled === false
    && !document.querySelector('[data-sketch-delete-toast]')
  ), null, { timeout: 4000 });
  const shapeBack = await strip(page);
  check(`${label} toast Undo restores the circle`,
    shapeBack.pressed.join(',') === 'shape' && shapeBack.undo === true && shapeBack.chips[0]?.label === 'Circle',
    JSON.stringify(shapeBack));

  await tapSelector(client, page, '[data-contour-tool="circle"]');
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().tool === 'circle', null, { timeout: 4000 });
  await tapSelector(client, page, '[data-contour-tool="cursor"]');
  await page.waitForFunction(() => (
    window.__VIEWPORT__.stageContourSketch().tool === 'cursor'
    && document.querySelector('[data-cad-feature-strip] [data-sketch-kind="circle"]')?.getAttribute('aria-pressed') === 'true'
  ), null, { timeout: 4000 });
  const cursorKept = await strip(page);
  check(`${label} cursor keeps the circle chip`,
    cursorKept.tool === 'cursor' && cursorKept.pressed.join(',') === 'shape'
    && cursorKept.chips[0]?.label === 'Circle' && cursorKept.undo === true && cursorKept.redo === false,
    JSON.stringify(cursorKept));

  await tapSelector(client, page, '[data-cad-feature-strip] [data-feature-bar-undo]');
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().tool === 'circle', null, { timeout: 4000 });
  await tapSelector(client, page, '[data-cad-feature-strip] [data-feature-bar-undo]');
  await page.waitForFunction(() => (
    window.__VIEWPORT__.stageContourSketch().tool === 'cursor'
    && document.querySelector('[data-cad-feature-strip] [data-sketch-entities-empty]')?.textContent?.includes('No sketch entities')
    && !document.querySelector('[data-cad-feature-strip] [data-sketch-kind="circle"]')
    && document.querySelector('[data-cad-feature-strip] [data-feature-bar-undo]')?.disabled
  ), null, { timeout: 4000 });

  await tapSelector(client, page, '[data-contour-tool="polyline"]');
  await page.waitForFunction(() => (
    document.querySelector('[data-cad-feature-strip] [data-sketch-entities-empty]')?.textContent?.includes('No sketch entities')
  ), null, { timeout: 4000 });
  const empty = await strip(page);
  check(`${label} empty polyline reads No sketch entities`,
    empty.empty === 'No sketch entities' && empty.chips.length === 0 && empty.label === 'Sketch'
    && empty.undo === true && empty.redo === false && empty.partChips === 0,
    JSON.stringify(empty));
  await page.screenshot({ path: join(SHOT_DIR, `contour-strip-${label}-empty.png`) });

  await tapSelector(client, page, '[data-cad-feature-strip] [data-feature-bar-undo]');
  await page.waitForFunction(() => (
    window.__VIEWPORT__.stageContourSketch().tool === 'cursor'
    && document.querySelector('[data-cad-feature-strip] [data-sketch-entities-empty]')?.textContent?.includes('No sketch entities')
    && document.querySelector('[data-cad-feature-strip] [data-feature-bar-undo]')?.disabled
    && document.querySelector('[data-cad-feature-strip] [data-feature-bar-redo]')?.disabled
  ), null, { timeout: 4000 });
  const undone = await strip(page);
  check(`${label} strip Undo restores the empty sketch`,
    undone.empty === 'No sketch entities' && undone.chips.length === 0
    && undone.tool === 'cursor' && undone.undo === false && undone.redo === false,
    JSON.stringify(undone));

  await tapSelector(client, page, '[data-contour-tool="rectangle"]');
  await page.waitForFunction(() => (
    document.querySelector('[data-cad-feature-strip] [data-sketch-kind="rectangle"]')?.getAttribute('aria-pressed') === 'true'
  ), null, { timeout: 4000 });

  await tapSelector(client, page, '[data-contour-tool="dimension"]');
  await page.waitForFunction(() => document.querySelector('[data-cad-feature-strip] [data-sketch-id="d0"]'), null, { timeout: 4000 });
  const promoted = await strip(page);
  const length = promoted.chips.find((chip) => chip.id === 'd0');
  const line = promoted.chips.find((chip) => chip.id === 'e0');
  check(`${label} promotion lists lines before the length`,
    promoted.pressed.length === 0 && length?.label === 'Length' && length.title === 'Length 20'
    && line?.index === '1' && promoted.chips.some((chip) => chip.kind === 'constraint'),
    JSON.stringify(promoted.chips));

  await tapSelector(client, page, '[data-cad-feature-strip] [data-sketch-id="d0"]');
  await page.waitForFunction(() => (
    document.querySelector('[data-contour-card="dimension"][data-contour-dimension-mode="edit"] input[data-field-label="Length"]')
    && document.querySelector('[data-cad-feature-strip] [data-sketch-id="d0"]')?.getAttribute('aria-pressed') === 'true'
  ), null, { timeout: 4000 });
  const dimCard = await strip(page);
  check(`${label} length chip opens the dimension card`,
    dimCard.card === 'dimension' && dimCard.dimMode === 'edit' && dimCard.field === 'Length'
    && dimCard.pressed.join(',') === 'd0',
    JSON.stringify(dimCard));

  await tapSelector(client, page, '[data-cad-feature-strip] [data-sketch-id="k0"]');
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-contour-card="constraint"][data-contour-constraint-mode="edit"]');
    const confirmBtn = document.querySelector('[data-feature-card-confirm]');
    const chip = document.querySelector('[data-cad-feature-strip] [data-sketch-id="k0"]');
    return card && confirmBtn && !confirmBtn.disabled && chip?.getAttribute('aria-pressed') === 'true'
      && !document.querySelector('[data-contour-card="dimension"]');
  }, null, { timeout: 4000 });
  const conCard = await strip(page);
  check(`${label} constraint chip opens its edit card`,
    conCard.card === 'constraint' && conCard.conMode === 'edit' && conCard.confirmDisabled === false
    && conCard.pressed.join(',') === 'k0',
    JSON.stringify(conCard));

  await tapSelector(client, page, '[data-cad-feature-strip] [data-sketch-id="e0"]');
  await page.waitForFunction(() => (
    document.querySelector('[data-contour-card="entity"][data-contour-entity-id="e0"] [data-contour-entity-delete]')
    && document.querySelector('[data-cad-feature-strip] [data-sketch-id="e0"]')?.getAttribute('aria-pressed') === 'true'
  ), null, { timeout: 4000 });
  const selected = await strip(page);
  check(`${label} line chip selects that edge`,
    selected.pressed.join(',') === 'e0' && selected.card === 'entity'
    && (selected.highlights?.lines || []).includes('e0'),
    JSON.stringify(selected));
  await page.screenshot({ path: join(SHOT_DIR, `contour-strip-${label}-line.png`) });

  const dismissLineDelete = async (how) => {
    await tapSelector(client, page, '[data-contour-entity-delete]');
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[data-sketch-entity-delete-dialog]');
      const button = document.querySelector('[data-sketch-entity-delete-confirm]');
      const cancel = document.querySelector('[data-sketch-entity-delete-cancel]');
      return dialog && button?.textContent?.includes('Delete along with 2 items')
        && document.activeElement === cancel;
    }, null, { timeout: 4000 });
    if (how === 'cancel') {
      await tapSelector(client, page, '[data-sketch-entity-delete-cancel]');
    } else if (how === 'escape') {
      await page.keyboard.press('Escape');
    } else {
      const point = await page.evaluate(() => {
        const scrim = document.querySelector('[data-sketch-entity-delete-dialog]');
        const x = 16;
        const y = 72;
        return { x, y, ok: document.elementFromPoint(x, y) === scrim };
      });
      if (!point.ok) throw new Error(`scrim miss ${JSON.stringify(point)}`);
      await tapAt(client, page, point.x, point.y);
    }
    await page.waitForFunction(() => (
      !document.querySelector('[data-sketch-entity-delete-dialog]')
      && document.querySelector('[data-contour-card="entity"][data-contour-entity-id="e0"]')
      && document.querySelector('[data-cad-feature-strip] [data-sketch-id="e0"]')?.getAttribute('aria-pressed') === 'true'
    ), null, { timeout: 4000 });
  };
  await dismissLineDelete('cancel');
  await dismissLineDelete('escape');
  await dismissLineDelete('scrim');
  const kept = await strip(page);
  check(`${label} cancel, Escape, and the scrim keep the line`,
    kept.pressed.join(',') === 'e0' && kept.chips.some((chip) => chip.id === 'd0')
    && kept.chips.some((chip) => chip.id === 'k0'),
    JSON.stringify(kept.chips.map((chip) => chip.id)));

  await tapSelector(client, page, '[data-contour-entity-delete]');
  await page.waitForFunction(() => (
    document.querySelector('[data-sketch-entity-delete-confirm]')?.textContent?.includes('Delete along with 2 items')
  ), null, { timeout: 4000 });
  await page.screenshot({ path: join(SHOT_DIR, `contour-strip-${label}-delete.png`) });
  await tapSelector(client, page, '[data-sketch-entity-delete-confirm]');
  await page.waitForFunction(() => {
    const ids = [...document.querySelectorAll('[data-cad-feature-strip] [data-sketch-id]')].map((el) => el.getAttribute('data-sketch-id'));
    const toast = document.querySelector('[data-sketch-delete-toast]');
    return !ids.includes('e0') && !ids.includes('d0') && !ids.includes('k0')
      && ids.includes('e1') && ids.includes('d1') && toast
      && (window.__VIEWPORT__.stageContourSketch().uvs || []).length === 4;
  }, null, { timeout: 4000 });
  const removed = await strip(page);
  const removedScript = await page.evaluate(() => (
    (window.monaco?.editor?.getModels?.() || []).map((model) => model.getValue()).join('\n')
  ));
  check(`${label} confirm deletes the line and what names it`,
    removed.points === 4 && !removed.chips.some((chip) => chip.id === 'e0' || chip.id === 'd0' || chip.id === 'k0')
    && removed.chips.some((chip) => chip.id === 'e1') && !removedScript.includes('solveContour'),
    JSON.stringify({ points: removed.points, ids: removed.chips.map((chip) => chip.id) }));

  await tapSelector(client, page, '[data-cad-feature-strip] [data-feature-bar-undo]');
  await page.waitForFunction(() => {
    const ids = [...document.querySelectorAll('[data-cad-feature-strip] [data-sketch-id]')].map((el) => el.getAttribute('data-sketch-id'));
    return ids.includes('e0') && ids.includes('d0') && ids.includes('k0')
      && document.querySelector('[data-cad-feature-strip] [data-sketch-id="e0"]')?.getAttribute('aria-pressed') === 'true';
  }, null, { timeout: 4000 });
  const lineBack = await strip(page);
  check(`${label} one sketch undo restores the line and its dependents`,
    lineBack.pressed.join(',') === 'e0'
    && lineBack.chips.some((chip) => chip.id === 'd0')
    && lineBack.chips.some((chip) => chip.id === 'k0'),
    JSON.stringify(lineBack.chips.map((chip) => chip.id)));

  await waitCameraStill(page);
  await fitSketchDots(page);
  await waitCameraStill(page);
  await tapSegment(client, page, 'p1', 'p2');
  await page.waitForFunction(() => (
    document.querySelector('[data-cad-feature-strip] [data-sketch-id="e1"]')?.getAttribute('aria-pressed') === 'true'
  ), null, { timeout: 4000 });
  const canvasPick = await strip(page);
  check(`${label} canvas tap selects the same line`,
    canvasPick.pressed.join(',') === 'e1' && (canvasPick.highlights?.lines || []).includes('e1'),
    JSON.stringify(canvasPick));

  await tapSelector(client, page, '[data-contour-tool="dimension"]');
  await page.waitForFunction(() => (
    document.querySelectorAll('[data-cad-feature-strip] [data-sketch-id][aria-pressed="true"]').length === 0
  ), null, { timeout: 4000 });
  await waitCameraStill(page);
  await fitSketchDots(page);
  await waitCameraStill(page);
  await tapSegment(client, page, 'p1', 'p2');
  await tapSegment(client, page, 'p3', 'p0');
  await page.waitForFunction(() => (window.__VIEWPORT__.stageContourSketch().picked || []).length === 2, null, { timeout: 4000 });
  const two = await strip(page);
  check(`${label} two dimension picks clear the chip`,
    two.pressed.length === 0 && two.picked.length === 2 && two.redo === false && two.undo === true,
    JSON.stringify(two));

  await tapSelector(client, page, '[data-contour-tool="cursor"]');
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    return sketch.tool === 'cursor' && !sketch.gesture;
  }, null, { timeout: 4000 });
  await waitCameraStill(page);
  await fitSketchDots(page);
  await waitCameraStill(page);
  await muteTags(page);
  const fixDot = await page.evaluate(() => {
    const dots = window.__VIEWPORT__.stageContourSketch().dots || [];
    return dots.find((dot) => dot.id === 'p0') || null;
  });
  if (fixDot) await doubleTap(page, fixDot.x, fixDot.y);
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    const chip = document.querySelector('[data-cad-feature-strip] [data-sketch-id="k4"]');
    return (sketch.uvs || []).length === 3 && chip?.hasAttribute('data-sketch-broken');
  }, null, { timeout: 4000 });
  const trimmed = await strip(page);
  const broken = trimmed.chips.find((chip) => chip.id === 'k4');
  check(`${label} double-tap leaves a broken constraint chip`,
    !!fixDot && trimmed.points === 3 && broken?.kind === 'constraint' && broken.broken === true,
    JSON.stringify({ dot: fixDot, points: trimmed.points, k4: broken }));
  await page.screenshot({ path: join(SHOT_DIR, `contour-strip-${label}-broken.png`) });

  await tapSelector(client, page, '[data-cad-feature-strip] [data-feature-bar-undo]');
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    const chip = document.querySelector('[data-cad-feature-strip] [data-sketch-id="k4"]');
    return (sketch.uvs || []).length === 4 && chip && !chip.hasAttribute('data-sketch-broken');
  }, null, { timeout: 4000 });
  const restored = await strip(page);
  check(`${label} strip Undo restores the fixed point`,
    restored.points === 4 && restored.chips.some((chip) => chip.id === 'k4' && chip.broken === false),
    JSON.stringify(restored));

  await tapSelector(client, page, '[data-contour-exit]');
  await page.waitForFunction(() => !document.querySelector('[data-contour-exit]'), null, { timeout: 8000 });
  const back = await strip(page);
  check(`${label} part strip returns`,
    back.sketch === 0 && back.hidden === '' && back.chips.length === 0
    && (back.label === 'Modeling features' || back.label === 'Assembly joints'),
    JSON.stringify(back));
  check(`${label} page stays quiet`, errors.length === 0, errors.join(' | '));
  await context.close();
}

if (!(await waitForServer())) {
  console.log('contour strip: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, headless: true });
attachConsentPresetToBrowser(browser);
try {
  await runSize(browser, '390', { viewport: { width: 390, height: 844 } });
  await runSize(browser, '1280', { viewport: { width: 1280, height: 800 } });
} catch (err) {
  failed += 1;
  console.log(`  ❌ contour strip threw — ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`contour strip: ${failed} failed`);
  process.exit(1);
}
console.log('contour strip: ok');
