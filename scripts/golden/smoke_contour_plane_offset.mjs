#!/usr/bin/env node
/**
 * Contour plane offset at 390 and 1280.
 *
 * The plane card shows Offset, the same length field as Workplane. A value
 * moves the live frame along Z and, after the X plane, along X. Confirm
 * bakes that shift into the frame center and stores offset= on the contour
 * comment. Reopening the plane card shows the same value, and a second edit
 * moves from the original plane. The hole plane card shows the same field
 * and previews the same shift. Leaving it writes nothing.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts dir.
 */
/* global document, window, Event */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5268);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

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

function near(a, b, eps = 0.05) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;
}

console.log('contour plane offset');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour plane offset: no system Chrome — set CHROME_PATH');
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
  await page.waitForFunction(() => (window.monaco?.editor?.getModels?.() || []).length > 0, null, { timeout: 30000 });
  await page.evaluate((src) => {
    window.monaco.editor.getModels()[0].setValue(src);
  }, SCRIPT);
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function editorScript(page) {
  return page.evaluate(() => (
    (window.monaco?.editor?.getModels?.() || []).map((model) => model.getValue()).join('\n')
  ));
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
  await page.locator('[data-part-row]').first().waitFor({ state: 'visible', timeout: 8000 });
  await page.evaluate(() => {
    document.querySelector('[data-part-row]')?.click();
  });
  await page.waitForFunction(() => (
    document.querySelector('[data-part-row]')?.getAttribute('data-part-selected') === 'true'
  ), null, { timeout: 8000 });
  if (phone) await page.locator('[data-stage-btn="cad"]').click();
}

async function setOffset(page, value) {
  await page.evaluate((next) => {
    const input = document.querySelector('[data-popup-number="workplane-offset"]');
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    const tracker = input._valueTracker;
    if (tracker) tracker.setValue(String(input.value));
    proto.set.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function planeCenter(page) {
  return page.evaluate(() => window.__VIEWPORT__.stageContourSketch().planeCenter);
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

  await page.locator('button[aria-label^="Insert Create contour"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  const title = (await page.locator('[data-feature-card-title]').innerText()).trim();
  check(`${label} plane card title is Contour`, title === 'Contour', title);
  const offset = page.locator('[data-popup-number="workplane-offset"]');
  await offset.scrollIntoViewIfNeeded();
  check(`${label} Offset field is on the plane card`, await offset.count() === 1);
  const caption = await page.locator('[data-plane-editor]').innerText();
  check(`${label} Offset caption is on the card`, /offset\s+mm/i.test(caption), caption.slice(0, 240));
  await page.screenshot({ path: join(SHOT_DIR, `contour-plane-offset-${label}-card.png`) });

  await setOffset(page, 12);
  await page.waitForFunction(() => {
    const c = window.__VIEWPORT__.stageContourSketch().planeCenter;
    return Array.isArray(c) && Math.abs(c[2] - 22) < 0.05;
  }, null, { timeout: 4000 });
  const raised = await planeCenter(page);
  // Centered 20 mm cube: the default plane sits on the top face, z = 10.
  const base = [0, 0, 10];
  check(`${label} offset 12 moves the live center along Z`,
    near(raised[0], 0) && near(raised[1], 0) && near(raised[2], 22),
    JSON.stringify(raised));

  await page.locator('[data-plane-editor] button[title="World X plane"]').click();
  await page.waitForFunction((origin) => {
    const c = window.__VIEWPORT__.stageContourSketch().planeCenter;
    return c && Math.abs(c[0] - (origin[0] + 12)) < 0.05 && Math.abs(c[2] - origin[2]) < 0.05;
  }, base, { timeout: 4000 });
  const alongX = await planeCenter(page);
  check(`${label} X plane keeps Offset and moves along X`,
    near(alongX[0], base[0] + 12) && near(alongX[2], base[2]),
    JSON.stringify({ base, alongX }));

  await page.locator('[data-plane-editor] button[title="World Z plane"]').click();
  await page.waitForFunction((origin) => {
    const c = window.__VIEWPORT__.stageContourSketch().planeCenter;
    return c && Math.abs(c[2] - (origin[2] + 12)) < 0.05;
  }, base, { timeout: 4000 });

  await page.locator('[data-contour-tool="circle"]').click();
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  await page.locator('[data-contour-confirm]').click();
  try {
    await page.waitForFunction(() => {
      const text = (window.monaco?.editor?.getModels?.() || []).map((model) => model.getValue()).join('\n');
      return text.includes('offset=12') && text.includes('return part');
    }, null, { timeout: 8000 });
  } catch { /* reported by the check below */ }
  const written = await editorScript(page);
  const sketchNow = await page.evaluate(() => window.__VIEWPORT__.stageContourSketch());
  const line = written.split('\n').find((row) => row.includes('@contour id=c1')) || '';
  const center = line.match(/center:\s*\[\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*\]/);
  const z = center ? Number(center[3]) : NaN;
  check(`${label} Confirm bakes the center and offset=12`,
    /offset=12/.test(line) && near(z, base[2] + 12),
    `${line.slice(0, 240)} sketch=${JSON.stringify(sketchNow)} script=${written.slice(0, 360)}`);
  check(`${label} the contour is before return part`,
    written.indexOf('@contour id=c1') >= 0 && written.indexOf('@contour id=c1') < written.indexOf('return part'));

  await ensurePartSelected(page);
  const strip = page.locator('[data-cad-feature-strip] [data-contour-id="c1"]');
  await strip.waitFor({ timeout: 8000 });
  await strip.click();
  await page.locator('[data-contour-exit]').waitFor({ timeout: 8000 });
  check(`${label} reopen starts the contour editor`, await page.locator('[data-contour-edit]').count() === 1);
  await page.locator('[data-contour-back]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 4000 });
  const reopened = page.locator('[data-popup-number="workplane-offset"]');
  await reopened.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-popup-number="workplane-offset"]');
    return input && Math.abs(Number(input.value) - 12) < 0.001;
  }, null, { timeout: 4000 });
  const shown = Number(await reopened.inputValue());
  const reopenedCenter = await planeCenter(page);
  check(`${label} reopen shows offset 12 on the shifted plane`,
    near(shown, 12, 0.001) && near(reopenedCenter?.[2], base[2] + 12),
    JSON.stringify({ shown, reopenedCenter }));
  await page.screenshot({ path: join(SHOT_DIR, `contour-plane-offset-${label}-reopen.png`) });

  await setOffset(page, 4);
  await page.waitForFunction((origin) => {
    const c = window.__VIEWPORT__.stageContourSketch().planeCenter;
    return c && Math.abs(c[2] - (origin[2] + 4)) < 0.05;
  }, base, { timeout: 4000 });
  await page.locator('[data-contour-confirm]').click();
  await page.waitForFunction(() => {
    const text = (window.monaco?.editor?.getModels?.() || []).map((model) => model.getValue()).join('\n');
    return text.includes('offset=4') && !text.includes('offset=12');
  }, null, { timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('[data-contour-exit]'), null, { timeout: 8000 });
  const edited = await editorScript(page);
  const editedLine = edited.split('\n').find((row) => row.includes('@contour id=c1')) || '';
  const editedCenter = editedLine.match(/center:\s*\[\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*\]/);
  const editedZ = editedCenter ? Number(editedCenter[3]) : NaN;
  check(`${label} a second edit moves from the original plane`,
    near(editedZ, base[2] + 4) && !near(editedZ, base[2] + 16),
    editedLine.slice(0, 220));

  await page.locator('button[aria-label^="Insert Hole"]').click();
  await page.locator('[data-hole-card]').waitFor({ timeout: 8000 });
  await page.locator('[data-hole-card] [data-feature-card-confirm]').click();
  await page.locator('[data-plane-editor]').waitFor({ timeout: 8000 });
  const holeOffset = page.locator('[data-popup-number="workplane-offset"]');
  await holeOffset.scrollIntoViewIfNeeded();
  check(`${label} hole plane card shows Offset`, await holeOffset.count() === 1);
  await setOffset(page, 8);
  await page.waitForFunction(() => {
    const c = window.__VIEWPORT__.stageContourSketch().planeCenter;
    return Array.isArray(c) && Math.abs(c[2] - 18) < 0.05;
  }, null, { timeout: 4000 });
  const holeRaised = await planeCenter(page);
  check(`${label} hole offset previews along the normal`,
    near(holeRaised[0], 0) && near(holeRaised[1], 0) && near(holeRaised[2], 18),
    JSON.stringify(holeRaised));
  await page.screenshot({ path: join(SHOT_DIR, `contour-plane-offset-${label}-hole.png`) });
  const beforeExit = await editorScript(page);
  await page.locator('[data-contour-exit]').click();
  await page.waitForFunction(() => !document.querySelector('[data-contour-exit]'), null, { timeout: 4000 });
  const afterExit = await editorScript(page);
  check(`${label} leaving the hole plane card writes nothing`, afterExit === beforeExit);

  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('contour plane offset: vite did not start');
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
  console.log(`contour plane offset: ${failed} failed`);
  process.exit(1);
}
console.log('contour plane offset: ok');
