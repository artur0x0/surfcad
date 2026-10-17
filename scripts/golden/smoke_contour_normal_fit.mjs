#!/usr/bin/env node
/**
 * Editing c1 (used by Extrude 1) at 390 and 1280.
 *
 * The part is placed off the origin. Normal to sketch turns the camera to
 * face the sketch plane and frames that part's world box, so the bbox stays
 * centred and inside the frame. A local-bounds fit leaves the solid off the
 * left in the top view.
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

const PORT = Number(process.env.SMOKE_PORT || 5284);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = `let part = Manifold.cube([40, 30, 20], true);
const c1 = makeCrossSection({ center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileRectangle(16, 10, true)); // @contour id=c1
// --- contour-mode extrude begin id=extrude1 ---
part = part.add(placeInFrame(c1.plane, makeExtrude(c1.contours, 8), [0, 0, 0]));
// --- contour-mode extrude end id=extrude1 ---
return part;
`;
const POSE = [60, 0, 0];

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

console.log('contour normal fit');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('contour normal fit: no system Chrome — set CHROME_PATH');
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
  await page.waitForFunction(() => (window.monaco?.editor?.getModels?.() || []).length > 0, null, { timeout: 30000 });
  await page.evaluate((src) => {
    window.monaco.editor.getModels()[0].setValue(src);
  }, SCRIPT);
  const ran = await page.evaluate(async (src) => window.__VIEWPORT__.executeScript(src), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
  await ensurePartSelected(page);
  await page.evaluate((src) => {
    window.monaco.editor.getModels()[0].setValue(src);
  }, SCRIPT);
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
  await page.locator('[data-part-row]').first().waitFor({ state: 'visible', timeout: 8000 });
  await page.evaluate(() => document.querySelector('[data-part-row]')?.click());
  await page.waitForFunction(() => (
    document.querySelector('[data-part-row]')?.getAttribute('data-part-selected') === 'true'
  ), null, { timeout: 8000 });
  if (phone) await page.locator('[data-stage-btn="cad"]').click();
}

async function partFrame(page) {
  return page.evaluate(() => {
    const cam = window.__VIEWPORT__.stageCamera();
    const pose = window.__VIEWPORT__.stageActivePose();
    const box = cam?.bbox;
    const canvas = document.querySelector('.viewport-shell > canvas');
    const rect = canvas?.getBoundingClientRect();
    const t = pose?.t || [0, 0, 0];
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    let extent = 0;
    let mapped = 0;
    if (box && rect && rect.width > 0 && rect.height > 0) {
      for (const x of [box.min[0], box.max[0]]) {
        for (const y of [box.min[1], box.max[1]]) {
          for (const z of [box.min[2], box.max[2]]) {
            const p = window.__VIEWPORT__.stageProject([x + t[0], y + t[1], z + t[2]]);
            if (!p) continue;
            const u = ((p.x - rect.left) / rect.width) * 2 - 1;
            const v = 1 - ((p.y - rect.top) / rect.height) * 2;
            mapped += 1;
            minU = Math.min(minU, u);
            maxU = Math.max(maxU, u);
            minV = Math.min(minV, v);
            maxV = Math.max(maxV, v);
            extent = Math.max(extent, Math.abs(u), Math.abs(v));
          }
        }
      }
    }
    const d = cam?.position && cam?.target ? [
      cam.position[0] - cam.target[0],
      cam.position[1] - cam.target[1],
      cam.position[2] - cam.target[2],
    ] : null;
    const len = d ? Math.hypot(d[0], d[1], d[2]) : 0;
    return {
      ok: mapped === 8,
      cx: mapped ? +((minU + maxU) / 2).toFixed(3) : null,
      cy: mapped ? +((minV + maxV) / 2).toFixed(3) : null,
      extent: mapped ? +extent.toFixed(3) : null,
      align: len > 1e-9 ? d[2] / len : null,
      aim: document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') || '',
      used: (document.querySelector('[data-contour-used-by]')?.textContent || '').trim(),
      pose: t,
    };
  });
}

async function touchDrag(client, from, to) {
  const steps = 8;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, id: 1 }],
  });
  for (let i = 1; i <= steps; i += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
        id: 1,
      }],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function orbit(page, client, pointerType) {
  const from = await page.evaluate(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width * 0.48;
    const y = rect.top + rect.height * 0.58;
    return { x, y, onCanvas: document.elementFromPoint(x, y) === canvas };
  });
  const to = { x: from.x + 130, y: from.y - 24 };
  if (pointerType === 'touch') await touchDrag(client, from, to);
  else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(180);
  return from;
}

async function runSize(browser, label, contextOptions, pointerType) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const client = pointerType === 'touch' ? await context.newCDPSession(page) : null;
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

  await page.locator('[data-cad-feature-strip] [data-contour-id="c1"]').click();
  await page.locator('[data-contour-edit]').waitFor({ timeout: 8000 });
  try {
    await page.waitForFunction(() => (
      document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    ), null, { timeout: 5000 });
  } catch { /* reported by the banner and the later frame */ }

  const banner = (await page.locator('[data-contour-used-by]').innerText()).trim();
  check(`${label} banner says Used by Extrude 1`, banner === 'Used by Extrude 1', banner);

  const posed = await page.evaluate((t) => window.__VIEWPORT__.stageSetActivePose(t, [0, 0, 0, 1]), POSE);
  check(`${label} part is placed off the origin`, posed === true);
  await page.waitForTimeout(80);
  const before = await partFrame(page);
  console.log(`  ${label} before ${JSON.stringify(before)}`);
  check(`${label} placed part starts off the left`, before.ok && before.cx < -1, JSON.stringify(before));

  const from = await orbit(page, client, pointerType);
  check(`${label} orbit starts on the canvas`, !!from?.onCanvas, JSON.stringify(from));
  const oblique = await partFrame(page);
  console.log(`  ${label} oblique align ${oblique.align?.toFixed?.(3)}`);
  check(`${label} empty-space drag leaves the normal view`, oblique.align != null && oblique.align < 0.98, String(oblique.align));

  await page.locator('[data-normal-to-sketch]').click();
  try {
    await page.waitForFunction(() => {
      const aim = document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim');
      if (aim !== 'done') return false;
      const cam = window.__VIEWPORT__.stageCamera();
      const pose = window.__VIEWPORT__.stageActivePose();
      const box = cam?.bbox;
      const canvas = document.querySelector('.viewport-shell > canvas');
      const rect = canvas?.getBoundingClientRect();
      if (!cam?.position || !cam?.target || !box || !rect?.width) return false;
      const d = [
        cam.position[0] - cam.target[0],
        cam.position[1] - cam.target[1],
        cam.position[2] - cam.target[2],
      ];
      const len = Math.hypot(d[0], d[1], d[2]);
      if (!(len > 1e-9) || d[2] / len <= 0.98) return false;
      const t = pose?.t || [0, 0, 0];
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (const x of [box.min[0], box.max[0]]) {
        for (const y of [box.min[1], box.max[1]]) {
          for (const z of [box.min[2], box.max[2]]) {
            const p = window.__VIEWPORT__.stageProject([x + t[0], y + t[1], z + t[2]]);
            if (!p) return false;
            const u = ((p.x - rect.left) / rect.width) * 2 - 1;
            const v = 1 - ((p.y - rect.top) / rect.height) * 2;
            minU = Math.min(minU, u);
            maxU = Math.max(maxU, u);
            minV = Math.min(minV, v);
            maxV = Math.max(maxV, v);
          }
        }
      }
      const cx = (minU + maxU) / 2;
      const cy = (minV + maxV) / 2;
      return Math.abs(cx) < 0.12 && Math.abs(cy) < 0.12;
    }, null, { timeout: 5000 });
  } catch { /* reported below */ }

  const after = await partFrame(page);
  console.log(`  ${label} after ${JSON.stringify(after)}`);
  check(`${label} camera is normal to the sketch plane`, after.align != null && after.align > 0.98, String(after.align));
  check(`${label} part bbox is centred`, after.ok && Math.abs(after.cx) < 0.12 && Math.abs(after.cy) < 0.12, JSON.stringify(after));
  check(`${label} part bbox is in frame`, after.ok && after.extent >= 0.4 && after.extent <= 1.05, JSON.stringify(after));
  check(`${label} face aim finished`, after.aim === 'done', after.aim);
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: join(SHOT_DIR, `contour-normal-fit-${label}.png`) });
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('contour normal fit: vite did not start');
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
  }, 'touch');
  await runSize(browser, '1280', {
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  }, 'mouse');
} catch (err) {
  failed += 1;
  console.log(`  ❌ run — ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`contour normal fit: ${failed} failed`);
  process.exit(1);
}
console.log('contour normal fit: ok');
