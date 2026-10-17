#!/usr/bin/env node
/**
 * Two cubes that share a face. The pair is frictional. Run the study and
 * the Contact tab is on the results. 390×844 and 1280×800.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* global document, indexedDB, localStorage, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { feaStudyBlock } from '../../src/fea/studyScript.js';

const PORT = Number(process.env.SMOKE_PORT || 4331);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PREVIEW = process.env.FEA_PREVIEW === '1';
const USER_ID = 'user-fea-friction';
const STUDY = feaStudyBlock({ mesh: { target: 12, refine: 'off' } });
const CUBE = `const part = Manifold.cube([16, 16, 16], false);\nreturn part;\n${STUDY}`;

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

console.log('FEA frictional contact');

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('FEA frictional contact: no system Chrome — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (String(SHOT_DIR).startsWith('/opt/cursor/artifacts')) {
  console.log(`  ❌ screenshots must not use /opt/cursor/artifacts (${SHOT_DIR})`);
  process.exit(1);
}

mkdirSync(SHOT_DIR, { recursive: true });

const serverArgs = PREVIEW
  ? ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort']
  : ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'];
const server = spawn('npx', serverArgs, {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(1); });

async function waitForServer() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function seed(page) {
  await page.evaluate(async ({ script, userId }) => {
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
        tx.objectStore('assembly').put({
          version: 1,
          source: 'git',
          name: 'Friction',
          activeId: 'fea-a',
          parts: [
            { id: 'fea-a', name: 'Left', visible: true, order: 0, position: [0, 0, 0] },
            { id: 'fea-b', name: 'Right', visible: true, order: 1, position: [16, 0, 0] },
          ],
        }, 'current');
        tx.objectStore('parts').put({ id: 'fea-a', script, savedAt: Date.now() }, 'fea-a');
        tx.objectStore('parts').put({ id: 'fea-b', script, savedAt: Date.now() }, 'fea-b');
        localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify({
          accessToken: 'ghu_fea',
          refreshToken: '',
          expiresAt: Date.now() + 86_400_000,
          refreshExpiresAt: 0,
        }));
        localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
          [userId]: {
            name: 'Friction',
            activeId: 'fea-a',
            source: 'git',
            savedAt: Date.now(),
          },
        }));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { script: CUBE, userId: USER_ID });
}

async function boot(page) {
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
      user: { id: USER_ID, email: 'fea@surfcad.test', vaultName: null },
    }),
  }));
  const marker = `${JSON.stringify({ kind: 'surfcad-vault', version: 1 }, null, 2)}\n`;
  await page.route('https://api.github.com/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (status, body) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    if (path === '/user') return send(200, { login: 'fea-user' });
    if (path === '/repos/fea-user/surfcad-vault') {
      return send(200, {
        name: 'surfcad-vault',
        private: true,
        size: 1,
        default_branch: 'main',
        owner: { login: 'fea-user' },
      });
    }
    if (path === '/repos/fea-user/surfcad-vault/branches/main') {
      return send(200, { name: 'main', commit: { sha: 'a'.repeat(40) } });
    }
    if (path.startsWith('/repos/fea-user/surfcad-vault/contents/surfcad.json')) {
      return send(200, { type: 'file', encoding: 'utf-8', content: marker, sha: 'b'.repeat(40) });
    }
    return send(404, { message: 'not found' });
  });
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 400)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text().slice(0, 400)}`);
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('canvas', { timeout: 40000 });
  return errors;
}

async function solidsReady(page) {
  await page.waitForFunction(() => {
    const spinner = document.querySelector('[data-assembly-open-spinner]');
    const solids = document.querySelector('[data-assembly-solids]')?.getAttribute('data-assembly-solids');
    const ctx = window.__MANIFOLD_CONTEXT__;
    const pending = ctx?.worker?.pendingRequests?.size || 0;
    const booted = !ctx || ctx.isReady === true;
    return !spinner && solids === '2' && pending === 0 && booted;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(400);
}

async function canvasSpots(page, fractions) {
  return page.evaluate((spots) => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!canvas) return [];
    const rect = canvas.getBoundingClientRect();
    const pts = [];
    for (const [fx, fy] of spots) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      if (document.elementFromPoint(x, y) === canvas) pts.push({ x, y });
    }
    return pts;
  }, fractions);
}

async function tap(page, touch, point) {
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function tapUntil(page, touch, fractions, attr, expected) {
  const points = await canvasSpots(page, fractions);
  for (const point of points) {
    await tap(page, touch, point);
    await page.waitForTimeout(400);
    const count = await page.locator(`[${attr}]`).getAttribute(attr).catch(() => null);
    if (count === expected) return true;
  }
  const notice = await page.locator('[data-fea-notice]').textContent().catch(() => '');
  return notice || `no ${attr}=${expected} (${points.length} points)`;
}

async function runCase(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.touch,
    isMobile: vp.touch,
    deviceScaleFactor: vp.touch ? 2 : 1,
    colorScheme: 'dark',
    userAgent: vp.touch
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const page = await context.newPage();
  const errors = await boot(page);
  await seed(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 40000 });
  await solidsReady(page);
  await page.locator('[data-analyze-chip]').click();
  await page.locator('[data-fea-sheet]').waitFor({ timeout: 8000 });
  await page.locator('[data-fea-scope-kind="assembly"]').click();
  await page.locator('[data-fea-contact]').first().waitFor({ timeout: 8000 });
  const kinds = page.locator('[data-fea-contact-kind]');
  const pairCount = await kinds.count();
  for (let i = 0; i < pairCount; i += 1) await kinds.nth(i).selectOption('frictional');
  const mu = await page.locator('[data-fea-contact-mu]').first().inputValue();
  check(`${vp.name} frictional pair`, pairCount >= 1 && mu === '0.2', `pairs=${pairCount} mu=${mu}`);
  await page.locator('[data-fea-target="fixture"]').click();
  const fixed = await tapUntil(page, vp.touch, [
    [0.22, 0.32], [0.28, 0.38], [0.18, 0.42], [0.32, 0.28], [0.25, 0.48],
  ], 'data-fea-fixture-count', '1');
  check(`${vp.name} fixture`, fixed === true, String(fixed));
  await page.locator('[data-fea-target="pressure"]').click();
  const loaded = await tapUntil(page, vp.touch, [
    [0.78, 0.32], [0.72, 0.38], [0.82, 0.42], [0.68, 0.28], [0.75, 0.48],
  ], 'data-fea-load-count', '1');
  check(`${vp.name} pressure`, loaded === true, String(loaded));
  await page.locator('[data-fea-run]').click();
  const contactTab = page.locator('[data-fea-plot="contact"]');
  const solveDeadline = Date.now() + 180000;
  while (Date.now() < solveDeadline) {
    if (await contactTab.count()) break;
    const sheet = await page.locator('[data-fea-sheet]').innerText().catch(() => '');
    if (/Stopped during|did not converge|not in this FEA build|no mesh faces/i.test(sheet)) {
      console.log('SHEET:\n', sheet.slice(0, 2500));
      console.log('PAGE ERRORS:', errors);
      check(`${vp.name} contact tab`, false, 'solve stopped before the Contact tab');
      await context.close();
      return;
    }
    await page.waitForTimeout(500);
  }
  if (!(await contactTab.count())) {
    const sheet = await page.locator('[data-fea-sheet]').innerText().catch(() => '');
    console.log('SHEET:\n', sheet.slice(0, 2500));
    console.log('PAGE ERRORS:', errors);
    check(`${vp.name} contact tab`, false, 'Contact tab did not appear');
    await context.close();
    return;
  }
  await page.locator('[data-fea-plot="contact"]').click();
  await page.locator('[data-fea-plot-legend="contact"]').waitFor({ timeout: 8000 });
  const status = await page.locator('[data-fea-contact-status]').innerText();
  check(`${vp.name} contact status`, /open/.test(status) && /stick/.test(status) && /slip/.test(status), status);
  const shot = join(SHOT_DIR, `fea-friction-${vp.name}.png`);
  await page.screenshot({ path: shot });
  check(`${vp.name} shot saved`, existsSync(shot), shot);
  console.log(`  shot ${shot}`);
  check(`${vp.name} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

const viewArg = process.env.FEA_VIEW || '';
const viewports = [
  { name: '390', width: 390, height: 844, touch: true },
  { name: '1280', width: 1280, height: 800, touch: false },
].filter((vp) => !viewArg || vp.name === viewArg || (viewArg === 'desktop' && vp.name === '1280'));

let browser;
try {
  if (!await waitForServer()) {
    check('server started', false, `no response on ${APP_URL}`);
    process.exit(1);
  }
  check('server started', true);
  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  for (const vp of viewports) {
    console.log(` ${vp.name}`);
    await runCase(browser, vp);
  }
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nFEA frictional contact: ok');
