#!/usr/bin/env node
/**
 * Joints card playtest.
 * The open card slides the camera. Two face picks stay highlighted.
 * Add writes the joint, shows the chip, clears the picks, and stays open.
 * The empty strip matches a strip with chips. No floating joint tag.
 *
 * 390 and 1280. Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, indexedDB, localStorage, sessionStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5243);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const ASM = 'JointsCard';
const SURF_A = '2026-10-10-14-30-00-0001-a1b2';
const SURF_B = '2026-10-10-14-30-00-0002-c3d4';
const DOC = {
  version: 1,
  source: 'git',
  name: ASM,
  activeId: 'shaft.js',
  parts: [
    { id: 'shaft.js', name: 'Shaft', visible: true, order: 0, surfId: SURF_A, position: [0, 0, 0] },
    {
      id: 'housing.js',
      name: 'Housing',
      visible: true,
      order: 1,
      surfId: SURF_B,
      position: [80, 0, 0],
      placement: { t: [80, 0, 0], q: [0, 0, 0, 1] },
    },
  ],
};
const scriptFor = (id) => `// @surf-id ${id}\nlet part = Manifold.cube([30, 30, 30], true);\nreturn part;\n`;

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

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

console.log('joints card');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);
{
  const card = read('src/components/JointCard.jsx');
  const view = read('src/components/Viewport.jsx');
  check('Add is the joint apply label', card.includes("editing ? 'Confirm' : 'Add'"));
  check('the joint card owns the sheet camera', view.includes("? 'joint'"));
  check('floating joint tags are not mounted', !view.includes('JointTags') && !existsSync(new URL('../../src/components/JointTags.jsx', import.meta.url)));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('joints card: no system Chrome — set CHROME_PATH');
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

async function seedAssembly(page) {
  await page.evaluate(async ({ doc, shaft, housing }) => {
    localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify({
      accessToken: '',
      refreshToken: 'ghr_staging',
      expiresAt: 1,
      refreshExpiresAt: Date.now() + 86_400_000,
    }));
    localStorage.removeItem('surfcad.github.token');
    sessionStorage.removeItem('surfcad.github.token');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-ar': { name: doc.name, activeId: doc.activeId, source: 'git', savedAt: Date.now() },
    }));
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('surfcad-assembly');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('surfcad-assembly', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('assembly')) db.createObjectStore('assembly');
        if (!db.objectStoreNames.contains('parts')) db.createObjectStore('parts');
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['assembly', 'parts'], 'readwrite');
        tx.objectStore('assembly').put(doc, 'current');
        tx.objectStore('parts').put({ id: 'shaft.js', script: shaft, savedAt: Date.now() }, 'shaft.js');
        tx.objectStore('parts').put({ id: 'housing.js', script: housing, savedAt: Date.now() }, 'housing.js');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: DOC, shaft: scriptFor(SURF_A), housing: scriptFor(SURF_B) });
}

async function boot(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.touch,
    isMobile: vp.touch,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    userAgent: vp.touch
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  await context.addInitScript(() => { globalThis.open = () => null; });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 240)));
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      authenticated: true,
      user: { id: 'user-ar', firstName: 'Artur', lastName: 'Ross', email: 'artur@example.com', vaultName: null },
    }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ githubAppClientId: 'Iv1.golden' }),
  }));
  await page.route('**/api/github/oauth/refresh', (route) => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'not found' }),
  }));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await seedAssembly(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-viewer-title]', { timeout: 40000 });
  await page.waitForFunction((name) => {
    const text = document.querySelector('[data-viewer-title]')?.getAttribute('data-viewer-title-text') || '';
    return text.includes(name);
  }, ASM, { timeout: 20000 });
  await page.waitForSelector('[data-joints-button]', { state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => {
    const framed = globalThis.__VIEWPORT__?.stageVisibleFraming?.();
    return !!(framed && framed.parts && framed.parts.length >= 2);
  }, null, { timeout: 60000 });
  await page.evaluate(() => globalThis.__VIEWPORT__?.stageZoomToFit?.());
  await page.waitForTimeout(300);
  return { context, page, errors };
}

function dist(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function camera(page) {
  return page.evaluate(() => {
    const shot = globalThis.__VIEWPORT__?.stageCamera?.();
    if (!shot) return null;
    return { position: shot.position, target: shot.target };
  });
}

async function stripBox(page) {
  return page.evaluate(() => {
    const strip = document.querySelector('[data-assembly-joints]');
    if (!strip) return null;
    const box = strip.getBoundingClientRect();
    return {
      height: box.height,
      empty: strip.hasAttribute('data-joints-row-empty'),
      chips: strip.querySelectorAll('[data-joint-id]').length,
    };
  });
}

async function cardState(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-joint-card]');
    const picks = card?.querySelector('[data-sticky-picks]');
    const apply = card?.querySelector('[data-feature-card-confirm]');
    return {
      open: !!card,
      n: Number(picks?.getAttribute('data-sticky-picks') || 0),
      subtitle: (card?.querySelector('[data-feature-card-subtitle]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      type: card?.getAttribute('data-joint-type') || '',
      apply: (apply?.textContent || '').replace(/\s+/g, ' ').trim(),
      disabled: !!apply?.disabled,
      highlights: globalThis.__VIEWPORT__?.jointHighlightCount?.() ?? -1,
      tags: document.querySelectorAll('[data-joint-tag]').length,
      note: (card?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    };
  });
}

async function clickCanvas(page, world) {
  const point = await page.evaluate((w) => {
    const p = globalThis.__VIEWPORT__?.stageProject?.(w);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas) return { ok: false };
    const el = document.elementFromPoint(p.x, p.y);
    return { ok: el === canvas, x: p.x, y: p.y };
  }, world);
  if (!point.ok) return point;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);
  return point;
}

async function press(page, selector) {
  const hit = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.disabled) return { ok: false, reason: el ? 'disabled' : 'missing' };
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const top = document.elementFromPoint(x, y);
    return { ok: box.width > 2, x, y, direct: !!(top && (top === el || el.contains(top))) };
  }, selector);
  if (!hit.ok) return hit;
  if (hit.direct) await page.mouse.click(hit.x, hit.y);
  else await page.evaluate((sel) => document.querySelector(sel).click(), selector);
  await page.waitForTimeout(250);
  return hit;
}

async function pickFace(page, worlds, partName, { keep = false } = {}) {
  const want = keep ? 2 : 1;
  for (const world of worlds) {
    const state = await cardState(page);
    if (!state.open) return { ok: false, reason: 'card closed', state };
    if (!keep && state.n > 0 && state.subtitle && !state.subtitle.includes(partName) && !state.subtitle.includes('→')) {
      await page.evaluate(() => document.querySelector('[data-sticky-pick]')?.click());
      await page.waitForTimeout(200);
    }
    const click = await clickCanvas(page, world);
    const next = await cardState(page);
    if (next.open && next.subtitle.includes(partName) && next.n >= want) return { ok: true, click, state: next };
  }
  return { ok: false, reason: 'miss', state: await cardState(page) };
}

async function runView(browser, vp) {
  const { context, page, errors } = await boot(browser, vp);
  const empty = await stripBox(page);
  console.log(`  ${vp.name} empty ${JSON.stringify(empty)}`);
  check(`${vp.name} the empty joints strip is up`, empty && empty.empty && empty.chips === 0, JSON.stringify(empty));

  const before = await camera(page);
  await page.locator('[data-joints-button]').click();
  await page.waitForSelector('[data-joint-card]', { timeout: 8000 });
  if (vp.touch) {
    await page.waitForFunction((shot) => {
      const now = globalThis.__VIEWPORT__?.stageCamera?.();
      if (!now || !shot) return false;
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      return d(now.position, shot.position) > 0.2 || d(now.target, shot.target) > 0.2;
    }, before, { timeout: 4000 }).catch(() => {});
  } else {
    await page.waitForTimeout(600);
  }
  const after = await camera(page);
  const slid = dist(before?.position, after?.position) > 0.2 || dist(before?.target, after?.target) > 0.2;
  console.log(`  ${vp.name} camera before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
  if (vp.touch) {
    check(`${vp.name} the open card slides the camera`, slid, JSON.stringify({ before, after }));
  } else {
    // Desktop: the card never moves the camera (the slide is phone-only).
    const still = dist(before?.position, after?.position) < 1e-3 && dist(before?.target, after?.target) < 1e-3;
    check(`${vp.name} the open card leaves the camera alone`, still, JSON.stringify({ before, after }));
  }

  const opened = await cardState(page);
  check(`${vp.name} the apply button says Add`, opened.apply === 'Add', JSON.stringify(opened));

  const shaft = await pickFace(page, [[0, 0, 0], [0, 0, 12], [0, 12, 0], [12, 0, 0]], 'Shaft');
  console.log(`  ${vp.name} shaft ${JSON.stringify(shaft.state || shaft)}`);
  check(`${vp.name} the first face stays highlighted`, shaft.ok && shaft.state.highlights === 1, JSON.stringify(shaft));
  const housing = await pickFace(page, [[80, 0, 0], [80, 0, 12], [80, 12, 0], [68, 0, 0], [92, 0, 0]], 'Housing', { keep: true });
  console.log(`  ${vp.name} housing ${JSON.stringify(housing.state || housing)}`);
  check(`${vp.name} the second face keeps the first highlight`, housing.ok && housing.state.highlights === 2 && housing.state.n === 2, JSON.stringify(housing));
  check(`${vp.name} there is no floating joint tag`, housing.state && housing.state.tags === 0, JSON.stringify(housing.state));

  const added = await press(page, '[data-feature-card-confirm]');
  await page.waitForTimeout(400);
  const stayed = await cardState(page);
  const chips = await stripBox(page);
  console.log(`  ${vp.name} add ${JSON.stringify({ added, stayed, chips })}`);
  check(`${vp.name} Add leaves the card open`, stayed.open === true && stayed.n === 0 && stayed.highlights === 0, JSON.stringify(stayed));
  check(`${vp.name} the joint appears on the strip`, chips && chips.chips >= 1 && chips.empty === false, JSON.stringify(chips));
  check(`${vp.name} the empty strip matches a strip with chips`,
    empty && chips && Math.abs(empty.height - chips.height) <= 1,
    JSON.stringify({ empty: empty?.height, chips: chips?.height }));

  const chipType = await page.evaluate(() => document.querySelector('[data-assembly-joints] [data-joint-id]')?.getAttribute('data-joint-type') || '');
  await page.evaluate(() => document.querySelector('[data-assembly-joints] [data-joint-id]')?.click());
  await page.waitForSelector('[data-joint-delete]', { timeout: 4000 }).catch(() => {});
  const reopened = await page.evaluate(() => ({
    card: !!document.querySelector('[data-joint-card]'),
    type: document.querySelector('[data-joint-card]')?.getAttribute('data-joint-type') || '',
    del: !!document.querySelector('[data-joint-delete]'),
    close: !!document.querySelector('[data-feature-card-cancel]'),
    popup: !!document.querySelector('[data-joint-chip-popup]'),
    tags: document.querySelectorAll('[data-joint-tag]').length,
  }));
  check(`${vp.name} the chip reopens that joint in the card`,
    reopened.card && reopened.del && reopened.close && reopened.type === chipType && !reopened.popup && reopened.tags === 0,
    JSON.stringify({ chipType, reopened }));

  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForSelector('[data-joint-card]', { state: 'detached', timeout: 8000 }).catch(() => {});
  const closed = await cardState(page);
  check(`${vp.name} X exits the card`, closed.open === false && closed.highlights === 0, JSON.stringify(closed));

  const shot = join(SHOT_DIR, `joints-card-${vp.name}.png`);
  await page.screenshot({ path: shot });
  check(`${vp.name} shot saved outside artifacts`, existsSync(shot) && !shot.startsWith('/opt/cursor/artifacts'), shot);
  check(`${vp.name} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

let browser;
try {
  if (!await waitForServer()) {
    check('dev server started', false, APP_URL);
    process.exit(1);
  }
  check('dev server started', true);
  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  for (const vp of [
    { name: '390', width: 390, height: 844, touch: true },
    { name: '1280', width: 1280, height: 800, touch: false },
  ]) {
    await runView(browser, vp);
  }
} catch (err) {
  check('joints card browser pass', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.error(`\n${failed} joints-card check(s) failed`);
  process.exit(1);
}
console.log('\njoints card golden passed');
