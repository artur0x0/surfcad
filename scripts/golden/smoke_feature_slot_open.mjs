#!/usr/bin/env node
/**
 * Extrude, Revolve, Loft, and Sweep open the slot card from the shape rail
 * and from a strip chip. Touch taps at 390 and 1280.
 *
 * The card's button is Confirm. There is no Start drawing, no plane editor,
 * and no No contour row. An empty slot is a Pick a contour chip. The picker
 * lists the saved contour and New contour.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5273);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = `const c1 = makeCrossSection({ center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileCircle(6, 24)); // @contour id=c1
let part = Manifold.cube([40, 30, 20], true);
// --- contour-mode extrude begin id=extrude1 ---
// makeExtrude(profileCircle(4, 16).contours, 12)
// --- contour-mode extrude end id=extrude1 ---
// --- contour-mode revolve begin id=revolve1 ---
// makeRevolve(profileCircle(4, 16).contours, 24, 90)
// --- contour-mode revolve end id=revolve1 ---
// --- contour-mode loft begin id=loft1 ---
// makeLoft([profileCircle(5, 16), profileCircle(3, 16)])
// --- contour-mode loft end id=loft1 ---
// --- contour-mode sweep begin id=sweep1 ---
// sweepPoints(new CrossSection(profileCircle(3, 12).contours), [[0, 0, 0], [0, 0, 20]])
// --- contour-mode sweep end id=sweep1 ---
return part;
`;

const FEATURES = [
  { kind: 'extrude', entry: 'makeExtrude', label: 'Extrude' },
  { kind: 'revolve', entry: 'makeRevolve', label: 'Revolve' },
  { kind: 'loft', entry: 'makeLoft', label: 'Loft' },
  { kind: 'sweep', entry: 'makeSweep', label: 'Sweep' },
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

console.log('feature slot open (390 / 1280, touch)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('feature slot open: no system Chrome — set CHROME_PATH');
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

async function tap(page, selector) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
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
  const phone = await page.locator('[data-mobile-stage]').count() > 0;
  if (phone) {
    await tap(page, '[data-stage-btn="parts"]');
    await page.waitForFunction(() => (
      document.querySelector('[data-mobile-stage]')?.getAttribute('data-mobile-stage') === 'parts'
    ), null, { timeout: 8000 });
  }
  await page.locator('[data-part-row]').first().waitFor({ state: 'visible', timeout: 8000 });
  const selected = await page.evaluate(() => {
    const row = document.querySelector('[data-part-row]');
    if (!row) return false;
    row.click();
    return true;
  });
  if (!selected) throw new Error('no part row');
  await page.waitForFunction(() => (
    document.querySelector('[data-part-row]')?.getAttribute('data-part-selected') === 'true'
  ), null, { timeout: 8000 });
  if (phone) await tap(page, '[data-stage-btn="cad"]');
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
    return !!model && model.getValue().includes('id=sweep1');
  }, null, { timeout: 8000 });
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await ensurePartSelected(page);
  await page.waitForTimeout(200);
}

async function assertSlotCard(page, label, feature, via) {
  const card = page.locator(`[data-feature-slot-card="${feature.entry}"]`);
  await card.waitFor({ timeout: 8000 });
  const title = (await page.locator('[data-feature-card-title]').innerText()).trim();
  const confirm = (await page.locator('[data-feature-card-confirm]').innerText()).trim();
  const text = await page.locator('[data-feature-card]').innerText();
  const empty = page.locator('[data-slot-empty]');
  const emptyCount = await empty.count();
  const emptyText = emptyCount
    ? (await empty.first().innerText()).trim()
    : '';
  check(`${label} ${feature.label} from ${via} is the slot card`, title === feature.label, title);
  check(`${label} ${feature.label} from ${via} confirms`, confirm === 'Confirm', confirm);
  check(`${label} ${feature.label} from ${via} has no Start drawing`, !text.includes('Start drawing')
    && await page.locator('[data-contour-chip]').count() === 0);
  check(`${label} ${feature.label} from ${via} has no plane fields`,
    await page.locator('[data-plane-editor]').count() === 0
    && await page.locator('[id^="plane-angle-"]').count() === 0
    && !/plane angle/i.test(text));
  check(`${label} ${feature.label} from ${via} has a Pick a contour chip`,
    emptyCount >= 1 && emptyText === 'Pick a contour', emptyText || `count ${emptyCount}`);
  check(`${label} ${feature.label} from ${via} has no No contour row`, !text.includes('No contour'));
  check(`${label} ${feature.label} from ${via} lists the saved contour and New contour`,
    await page.locator('[data-slot-pick="c1"]').count() >= 1
    && await page.locator('[data-new-contour]').count() >= 1);
  check(`${label} ${feature.label} from ${via} leaves the contour rail down`,
    await page.locator('[data-contour-tool]').count() === 0);
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);
  const strip = label === '390'
    ? '[data-cad-feature-strip=""]'
    : '[data-desktop-feature-strip]';
  await page.locator(`${strip} [data-feature-chip="extrude"]`).waitFor({ timeout: 8000 });

  for (const feature of FEATURES) {
    await tap(page, `button[aria-label^="Insert ${feature.label}"]`);
    await assertSlotCard(page, label, feature, 'the rail');
    await page.screenshot({ path: join(SHOT_DIR, `feature-slot-open-${label}-${feature.kind}-rail.png`) });
    await tap(page, '[data-feature-card-cancel]');
    await page.waitForFunction(() => !document.querySelector('[data-feature-slot-card]'), null, { timeout: 8000 });

    await tap(page, `${strip} [data-feature-chip="${feature.kind}"]`);
    await assertSlotCard(page, label, feature, 'the strip');
    await page.screenshot({ path: join(SHOT_DIR, `feature-slot-open-${label}-${feature.kind}-strip.png`) });
    await tap(page, '[data-feature-card-cancel]');
    await page.waitForFunction(() => !document.querySelector('[data-feature-slot-card]'), null, { timeout: 8000 });
  }

  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('feature slot open: vite did not start');
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
    hasTouch: true,
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
  console.log(`feature slot open: ${failed} failed`);
  process.exit(1);
}
console.log('feature slot open: ok');
