#!/usr/bin/env node
/**
 * Edit one contour from the CAD strip.
 *
 * The contour is named by an Extrude and a Loft. Opening it from the strip
 * shows Used by Extrude 1, Loft 1. X discards. The rail checkmark rewrites
 * that contour, and both solids change. A feature-card chip returns to the
 * card on save.
 *
 * Screenshots at 390 and 1280 go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window, Event */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import {
  composeContourExtrude,
  composeContourLoft,
  composeContourProfile,
} from '../../src/utils/contourMode.js';

const PORT = Number(process.env.SMOKE_PORT || 5256);
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
  const c2 = composeContourProfile(ext.buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 3, segments: 16 },
  });
  if (!c2.ok) throw new Error(c2.message);
  const loft = composeContourLoft(c2.buffer, {
    loft: {
      profiles: [
        { contourId: 'c1', contourName: 'c1', offset: 0, tool: 'circle', params: { radius: 6, segments: 24 } },
        { contourId: 'c2', contourName: 'c2', offset: 20, tool: 'circle', params: { radius: 3, segments: 16 } },
      ],
    },
  });
  if (!loft.ok) throw new Error(loft.message);
  return loft.buffer;
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

console.log('contour edit banner (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour edit: no system Chrome — set CHROME_PATH');
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

async function meshSpan(page) {
  return page.evaluate(() => {
    const result = window.__MANIFOLD_CONTEXT__?.lastResult;
    const box = result?.boundingBox;
    if (!box?.min || !box?.max) return null;
    return {
      dx: box.max[0] - box.min[0],
      dy: box.max[1] - box.min[1],
      dz: box.max[2] - box.min[2],
      volume: result.volume,
    };
  });
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
  await page.waitForFunction(() => {
    const model = window.monaco?.editor?.getModels?.()?.[0];
    return !!model && model.getValue().includes('@contour id=c1') && model.getValue().includes('makeLoft');
  }, null, { timeout: 8000 });
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
  // The CAD strip lists features only after a part is selected. A fresh
  // session lists joints until that row is clicked.
  await ensurePartSelected(page);
  await page.evaluate((src) => {
    const model = window.monaco.editor.getModels()[0];
    model.setValue(src);
  }, SCRIPT);
  await page.waitForFunction(() => {
    const model = window.monaco?.editor?.getModels?.()?.[0];
    return !!model && model.getValue().includes('makeLoft(');
  }, null, { timeout: 8000 });
  const again = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
  if (again?.error) throw new Error(again.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.locator('[data-cad-feature-strip] [data-contour-id="c1"]').waitFor({ timeout: 8000 });
}

async function ensurePartSelected(page) {
  // Signed-out boot has no assembly, so the strip lists joints. Run seeds
  // Part (1) from the editor. Clicking that row selects it, and the strip
  // then lists this part's features.
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
  // The row's center is the thumbnail. Dispatch the click on the row so the
  // select handler runs on desktop and on the phone.
  await page.evaluate(() => {
    document.querySelector('[data-part-row]')?.click();
  });
  await page.waitForFunction(() => (
    document.querySelector('[data-part-row]')?.getAttribute('data-part-selected') === 'true'
  ), null, { timeout: 8000 });
  if (phone) await page.locator('[data-stage-btn="cad"]').click();
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
  await boot(page);

  const before = await meshSpan(page);
  check(`${label} mesh is up before the edit`, !!before && before.dx > 1, JSON.stringify(before));
  const strip = page.locator('[data-cad-feature-strip] [data-contour-id="c1"]');
  await strip.click();
  const banner = page.locator('[data-contour-used-by]');
  await banner.waitFor({ timeout: 8000 });
  const bannerText = (await banner.innerText()).trim();
  check(`${label} banner lists Extrude 1 and Loft 1`, bannerText === 'Used by Extrude 1, Loft 1', bannerText);
  check(`${label} the editor is the contour rail, not a feature card`,
    await page.locator('[data-contour-edit]').count() === 1
    && await page.locator('[data-contour-confirm]').count() === 1
    && await page.locator('[data-feature-slot-card]').count() === 0);
  check(`${label} the name field opens on c1`,
    await page.locator('[data-contour-name]').inputValue() === 'c1');

  const radius = '[data-contour-edit] [data-popup-number="radius"]';
  await setNumber(page, radius, '18');
  await page.waitForFunction(() => (
    document.querySelector('[data-contour-edit] [data-popup-number="radius"]')?.value === '18'
  ), null, { timeout: 4000 });
  await page.locator('[data-contour-exit]').click();
  await page.waitForFunction(() => !document.querySelector('[data-contour-edit]'), null, { timeout: 8000 });
  const discarded = await editorScript(page);
  check(`${label} X keeps the contour radius`, /profileCircle\(6, 24\)/.test(discarded));
  check(`${label} X leaves both feature references`,
    /makeExtrude\(c1\.contours, 8\)/.test(discarded) && /makeLoft\(\[c1,/.test(discarded));
  const afterX = await meshSpan(page);
  check(`${label} X leaves the mesh`,
    !!afterX && Math.abs(afterX.dx - before.dx) < 0.5,
    JSON.stringify(afterX));

  await page.locator('[data-cad-feature-strip] [data-contour-id="c1"]').click();
  await banner.waitFor({ timeout: 8000 });
  check(`${label} reopening the strip lists both users`,
    (await banner.innerText()).trim() === 'Used by Extrude 1, Loft 1');
  await setNumber(page, radius, '18');
  await page.waitForFunction(() => (
    document.querySelector('[data-contour-edit] [data-popup-number="radius"]')?.value === '18'
  ), null, { timeout: 4000 });
  await page.screenshot({ path: join(SHOT_DIR, `contour-edit-${label}.png`) });
  await page.locator('[data-contour-confirm]').click();
  await page.waitForFunction(() => !document.querySelector('[data-contour-edit]'), null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const text = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
    return /profileCircle\(18, 24\)/.test(text);
  }, null, { timeout: 8000 });
  const saved = await editorScript(page);
  check(`${label} checkmark rewrites the contour by id`,
    /const c1 = makeCrossSection\([\s\S]*profileCircle\(18, 24\)/.test(saved)
    && /@contour id=c1/.test(saved));
  check(`${label} Extrude and Loft still name c1`,
    /makeExtrude\(c1\.contours, 8\)/.test(saved) && /makeLoft\(\[c1,/.test(saved));
  check(`${label} the other contour stays`, /profileCircle\(3, 16\)/.test(saved));
  await page.evaluate((dx) => { window.__PREV_DX = dx; }, before.dx);
  await page.waitForFunction(() => {
    const box = window.__MANIFOLD_CONTEXT__?.lastResult?.boundingBox;
    if (!box?.min || !box?.max) return false;
    return (box.max[0] - box.min[0]) > window.__PREV_DX + 8;
  }, null, { timeout: 30000 });
  const after = await meshSpan(page);
  check(`${label} both solids change the mesh`, !!after && after.dx > before.dx + 8,
    `before ${before.dx.toFixed(2)} after ${after ? after.dx.toFixed(2) : 'none'}`);

  const button = page.locator('button[aria-label^="Insert Extrude"]');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const card = page.locator('[data-feature-slot-card="makeExtrude"]');
  await card.waitFor({ timeout: 8000 });
  await setNumber(page, '[data-popup-number="extrude-distance"]', '25');
  await page.waitForFunction(() => (
    document.querySelector('[data-popup-number="extrude-distance"]')?.value === '25'
  ), null, { timeout: 4000 });
  await page.locator('[data-slot-role="profile"] [data-slot-pick="c1"]').click();
  await page.waitForFunction(() => (
    document.querySelector('[data-slot-role="profile"] [data-slot-chip]')?.getAttribute('data-slot-chip') === 'c1'
  ), null, { timeout: 4000 });
  await page.locator('[data-slot-role="profile"] [data-slot-edit]').click();
  await banner.waitFor({ timeout: 8000 });
  check(`${label} the chip opens the same banner`,
    (await banner.innerText()).trim() === 'Used by Extrude 1, Loft 1');
  await page.locator('[data-contour-exit]').click();
  await card.waitFor({ timeout: 8000 });
  check(`${label} X from the chip returns to the card`,
    await page.locator('[data-slot-role="profile"] [data-slot-chip]').getAttribute('data-slot-chip') === 'c1');
  check(`${label} X from the chip keeps the distance`,
    await page.locator('[data-popup-number="extrude-distance"]').inputValue() === '25');

  await page.locator('[data-slot-role="profile"] [data-slot-edit]').click();
  await banner.waitFor({ timeout: 8000 });
  await setNumber(page, radius, '22');
  await page.waitForFunction(() => (
    document.querySelector('[data-contour-edit] [data-popup-number="radius"]')?.value === '22'
  ), null, { timeout: 4000 });
  await page.locator('[data-contour-confirm]').click();
  await card.waitFor({ timeout: 15000 });
  check(`${label} saving from the chip returns to the card`,
    (await page.locator('[data-feature-card-title]').innerText()).trim() === 'Extrude');
  check(`${label} the card keeps the distance after the save`,
    await page.locator('[data-popup-number="extrude-distance"]').inputValue() === '25');
  const renamedSlot = await page.locator('[data-slot-role="profile"] [data-slot-chip]').getAttribute('data-slot-chip');
  check(`${label} the chip still names c1`, renamedSlot === 'c1', renamedSlot || '');
  await page.waitForFunction(() => {
    const text = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
    return /profileCircle\(22, 24\)/.test(text)
      && /makeExtrude\(c1\.contours, 8\)/.test(text)
      && /makeLoft\(\[c1,/.test(text);
  }, null, { timeout: 8000 });
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('contour edit: vite did not start');
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
  console.log(`contour edit: ${failed} failed`);
  process.exit(1);
}
console.log('contour edit: ok');
