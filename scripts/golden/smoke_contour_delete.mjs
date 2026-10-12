#!/usr/bin/env node
/**
 * Delete and orphan rules for named contours.
 *
 * Removing the extrude that alone names a contour leaves that contour, and
 * its strip chip and the picker mark unused with a dot. Deleting a contour named by an
 * Extrude and a Loft asks "Delete along with 2 features", then removes the
 * contour and both blocks. Undo restores that step. An unused contour then
 * deletes with no confirm.
 *
 * Screenshots at 390 and 1280 go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import {
  composeContourExtrude,
  composeContourLoft,
  composeContourProfile,
} from '../../src/utils/contourMode.js';
import { deleteFeatureBlock, listFeatureSheetTargets } from '../../src/utils/featureSheetWriteback.js';

const PORT = Number(process.env.SMOKE_PORT || 5257);
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

function step(result) {
  if (!result.ok) throw new Error(result.message);
  return result.buffer;
}

function sharedScript() {
  // c1 stays the root solid. c2 is named only by Extrude 2. c3 is named by
  // Extrude 3 and the Loft, so deleting it offers both features.
  let buf = '';
  buf = step(composeContourProfile(buf, {
    face: FACE,
    tool: 'circle',
    params: { radius: 5, segments: 16 },
  }));
  buf = step(composeContourExtrude(buf, {
    face: FACE,
    tool: 'circle',
    params: { radius: 5, segments: 16 },
    contourId: 'c1',
    contourName: 'c1',
    extrude: { distance: 8, direction: 'normal', sense: 'positive' },
  }));
  buf = step(composeContourProfile(buf, {
    face: FACE,
    tool: 'circle',
    params: { radius: 3, segments: 12 },
  }));
  buf = step(composeContourExtrude(buf, {
    face: FACE,
    tool: 'circle',
    params: { radius: 3, segments: 12 },
    contourId: 'c2',
    contourName: 'c2',
    extrude: { distance: 4, direction: 'normal', sense: 'positive' },
  }));
  buf = step(composeContourProfile(buf, {
    face: FACE,
    tool: 'circle',
    params: { radius: 6, segments: 20 },
  }));
  buf = step(composeContourExtrude(buf, {
    face: FACE,
    tool: 'circle',
    params: { radius: 6, segments: 20 },
    contourId: 'c3',
    contourName: 'c3',
    extrude: { distance: 6, direction: 'normal', sense: 'positive' },
  }));
  buf = step(composeContourProfile(buf, {
    face: FACE,
    tool: 'circle',
    params: { radius: 2, segments: 12 },
  }));
  buf = step(composeContourLoft(buf, {
    loft: {
      profiles: [
        { contourId: 'c3', contourName: 'c3', offset: 0, tool: 'circle', params: { radius: 6, segments: 20 } },
        { contourId: 'c4', contourName: 'c4', offset: 20, tool: 'circle', params: { radius: 2, segments: 12 } },
      ],
    },
  }));
  return buf;
}

const SCRIPT = sharedScript();

function scriptWithoutExtrude2(src) {
  const feature = listFeatureSheetTargets(src).find((item) => item.id === 'extrude2');
  if (!feature) throw new Error('extrude2 missing');
  const deleted = deleteFeatureBlock(src, feature);
  if (!deleted.ok) throw new Error(deleted.message || 'could not remove extrude2');
  return deleted.buffer;
}

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

console.log('contour delete and orphan (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour delete: no system Chrome — set CHROME_PATH');
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

async function clickDom(page, selector) {
  const clicked = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`missing ${selector}`);
}

async function revealChip(page, selector) {
  await page.evaluate((sel) => {
    const chip = document.querySelector(sel);
    const scroller = chip?.closest('[data-feature-bar-scroller]');
    if (!chip || !scroller) return;
    const left = chip.offsetLeft - (scroller.clientWidth - chip.offsetWidth) / 2;
    scroller.scrollLeft = Math.max(0, left);
  }, selector);
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
    return !!model && model.getValue().includes('@contour id=c2') && model.getValue().includes('id=extrude2');
  }, null, { timeout: 8000 });
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
  await page.waitForFunction(() => {
    const model = window.monaco?.editor?.getModels?.()?.[0];
    return !!model && model.getValue().includes('id=loft1');
  }, null, { timeout: 8000 });
  const again = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
  if (again?.error) throw new Error(again.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.locator('[data-cad-feature-strip] [data-contour-id="c1"]').waitFor({ timeout: 8000 });
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

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
  await boot(page);

  // Reopening an extrude chip opens the slot card, which has no delete
  // control. Drop Extrude 2 with the same block delete the sheet uses.
  const withoutExtrude2 = scriptWithoutExtrude2(await editorScript(page));
  await page.evaluate((src) => {
    window.monaco.editor.getModels()[0].setValue(src);
  }, withoutExtrude2);
  const removed = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), withoutExtrude2);
  if (removed?.error) throw new Error(removed.error);
  await page.waitForFunction(() => {
    const strip = document.querySelector('[data-cad-feature-strip] [data-feature-strip]');
    const chip = document.querySelector('[data-cad-feature-strip] [data-contour-id="c2"]');
    if (!strip || strip.hasAttribute('hidden') || !chip) return false;
    return chip.hasAttribute('data-contour-unused')
      && !/unused/i.test(chip.textContent || '')
      && !!chip.querySelector('[data-contour-unused-dot]');
  }, null, { timeout: 15000 });
  const afterExtrude = await editorScript(page);
  check(`${label} deleting the extrude leaves c2`, /@contour id=c2/.test(afterExtrude));
  check(`${label} Extrude 2 is gone`, !/id=extrude2/.test(afterExtrude));
  check(`${label} the root extrude and the loft stay`,
    /id=extrude1/.test(afterExtrude) && /id=loft1/.test(afterExtrude) && /id=extrude3/.test(afterExtrude));
  const chip = page.locator('[data-cad-feature-strip] [data-contour-id="c2"]');
  check(`${label} the strip chip marks unused with a dot`,
    (await chip.getAttribute('data-contour-unused')) === ''
    && !/unused/i.test((await chip.innerText()).trim())
    && await chip.locator('[data-contour-unused-dot]').count() === 1);
  await revealChip(page, '[data-cad-feature-strip] [data-contour-id="c2"]');
  await page.screenshot({ path: join(SHOT_DIR, `contour-delete-unused-${label}.png`) });

  const button = page.locator('button[aria-label^="Insert Extrude"]');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const card = page.locator('[data-feature-slot-card="makeExtrude"]');
  await card.waitFor({ timeout: 8000 });
  const pick = page.locator('[data-slot-pick="c2"]');
  await pick.waitFor({ timeout: 8000 });
  check(`${label} the picker marks c2 unused with a dot`,
    await pick.getAttribute('data-contour-unused') === ''
    && !/unused/i.test((await pick.innerText()).trim())
    && await pick.locator('[data-contour-unused-dot]').count() === 1);
  check(`${label} a used contour has no unused tag`,
    await page.locator('[data-slot-pick="c1"]').getAttribute('data-contour-unused') === null);
  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForFunction(() => !document.querySelector('[data-feature-slot-card]'), null, { timeout: 8000 });

  await page.waitForFunction(() => {
    const strip = document.querySelector('[data-cad-feature-strip] [data-feature-strip]');
    return !!strip && !strip.hasAttribute('hidden');
  }, null, { timeout: 8000 });
  await clickDom(page, '[data-cad-feature-strip] [data-contour-id="c3"]');
  await page.locator('[data-contour-delete]').waitFor({ timeout: 8000 });
  check(`${label} the shared contour lists both features`,
    (await page.locator('[data-contour-used-by]').innerText()).trim() === 'Used by Extrude 3, Loft 1');
  await page.locator('[data-contour-delete]').click();
  const dialog = page.locator('[data-contour-delete-dialog]');
  await dialog.waitFor({ timeout: 8000 });
  const confirm = page.locator('[data-contour-delete-confirm]');
  const confirmText = (await confirm.innerText()).trim();
  const confirmClass = await confirm.getAttribute('class');
  check(`${label} confirm reads Delete along with 2 features`,
    confirmText === 'Delete along with 2 features', confirmText);
  check(`${label} the confirm button is red`, /bg-red-600/.test(confirmClass || ''), confirmClass || '');
  check(`${label} Cancel sits beside the confirm`,
    await page.locator('[data-contour-delete-cancel]').innerText() === 'Cancel');
  await page.screenshot({ path: join(SHOT_DIR, `contour-delete-confirm-${label}.png`) });
  await page.locator('[data-contour-delete-cancel]').click();
  await page.waitForFunction(() => !document.querySelector('[data-contour-delete-dialog]'), null, { timeout: 8000 });
  const kept = await editorScript(page);
  check(`${label} Cancel leaves the contour and both features`,
    /@contour id=c3/.test(kept) && /id=extrude3/.test(kept) && /id=loft1/.test(kept));
  check(`${label} Cancel leaves the editor open`,
    await page.locator('[data-contour-edit]').count() === 1);

  await page.locator('[data-contour-delete]').click();
  await dialog.waitFor({ timeout: 8000 });
  await confirm.click();
  await page.waitForFunction(() => {
    const text = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
    return !document.querySelector('[data-contour-edit]')
      && !/@contour id=c3/.test(text)
      && !/id=extrude3/.test(text)
      && !/id=loft1/.test(text)
      && /@contour id=c4/.test(text)
      && /id=extrude1/.test(text);
  }, null, { timeout: 15000 });
  check(`${label} confirm removes the contour and both features`, true);

  const undo = page.locator('[data-cad-feature-strip] [data-feature-bar-undo]');
  await undo.waitFor({ timeout: 8000 });
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-cad-feature-strip] [data-feature-bar-undo]');
    return !!btn && !btn.disabled;
  }, null, { timeout: 8000 });
  await undo.click();
  await page.waitForFunction(() => {
    const text = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
    const chip = document.querySelector('[data-cad-feature-strip] [data-contour-id="c2"]');
    return /@contour id=c3/.test(text)
      && /id=extrude3/.test(text)
      && /id=loft1/.test(text)
      && /@contour id=c2/.test(text)
      && !/id=extrude2/.test(text)
      && !!chip
      && chip.hasAttribute('data-contour-unused');
  }, null, { timeout: 15000 });
  check(`${label} undo restores the contour and both features`, true);
  check(`${label} c2 stays unused after that undo`,
    (await chip.getAttribute('data-contour-unused')) === ''
    && !/unused/i.test((await chip.innerText()).trim())
    && await chip.locator('[data-contour-unused-dot]').count() === 1);

  await clickDom(page, '[data-cad-feature-strip] [data-contour-id="c2"]');
  await page.locator('[data-contour-delete]').waitFor({ timeout: 8000 });
  check(`${label} the orphaned contour banner reads Unused`,
    (await page.locator('[data-contour-used-by]').innerText()).trim() === 'Unused');
  await page.locator('[data-contour-delete]').click();
  await page.waitForFunction(() => {
    const text = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
    return !document.querySelector('[data-contour-delete-dialog]')
      && !document.querySelector('[data-contour-edit]')
      && !/@contour id=c2/.test(text)
      && /id=extrude1/.test(text)
      && /id=loft1/.test(text);
  }, null, { timeout: 15000 });
  check(`${label} an unused contour deletes with no confirm`, true);
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('contour delete: vite did not start');
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
  console.log(`contour delete: ${failed} failed`);
  process.exit(1);
}
console.log('contour delete: ok');
