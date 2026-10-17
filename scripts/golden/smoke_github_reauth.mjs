#!/usr/bin/env node
/**
 * iPhone 390 and desktop: signed-in session, GitHub token gone, refresh 404.
 * The chip is grey with an exclamation, a tap spins, then Reconnect.
 * The cached assembly reopens read-only. Part (1) is not seeded.
 * Open shows the reconnect dialog, not the local file input.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* global indexedDB, localStorage, sessionStorage, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5199);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const GEARBOX = {
  version: 1,
  source: 'git',
  name: 'Gearbox',
  activeId: 'bracket',
  parts: [{ id: 'bracket', name: 'Bracket', visible: true, order: 0 }],
};
const SCRIPT = 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;\n';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('github reauth: no system Chrome — set CHROME_PATH. Skipping.');
  process.exit(0);
}

mkdirSync(SHOT_DIR, { recursive: true });
console.log('github reauth chip');

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
  await page.evaluate(async ({ doc, script }) => {
    localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify({
      accessToken: '',
      refreshToken: 'ghr_staging',
      expiresAt: 1,
      refreshExpiresAt: Date.now() + 86_400_000,
    }));
    localStorage.removeItem('surfcad.github.token');
    sessionStorage.removeItem('surfcad.github.token');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-ar': {
        name: doc.name,
        activeId: doc.activeId,
        source: 'git',
        savedAt: Date.now(),
      },
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
        tx.objectStore('parts').put({ id: 'bracket', script, savedAt: Date.now() }, 'bracket');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: GEARBOX, script: SCRIPT });
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

  const viewports = [
    { name: '390', width: 390, height: 844, touch: true },
    { name: 'desktop', width: 1280, height: 900, touch: false },
  ];

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
      isMobile: vp.touch,
      userAgent: vp.touch
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : undefined,
    });
    await context.addInitScript(() => {
      window.open = () => null;
    });
    const page = await context.newPage();
    let holdRefresh = false;
    let releaseHold = () => {};
    let held = new Promise((resolve) => { releaseHold = resolve; });
    // Playwright matches the last registered route. The catch-all goes first
    // so /me, config, and refresh keep their own bodies.
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
        user: {
          id: 'user-ar',
          firstName: 'Artur',
          lastName: 'Ross',
          email: 'artur@example.com',
          vaultName: null,
        },
      }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ githubAppClientId: 'Iv1.golden' }),
    }));
    await page.route('**/api/github/oauth/refresh', async (route) => {
      if (holdRefresh) await held;
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'not found' }),
      });
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await seedAssembly(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-profile-auth="reauth"]', { timeout: 40000 });
    const chip = page.locator('[data-profile-chip-variant="viewport"]');
    const auth = await chip.getAttribute('data-profile-auth');
    const badge = await page.locator('[data-profile-badge="reauth"]').count();
    const openTarget = await page.locator('[data-parts-feed]').first().getAttribute('data-parts-open-target');
    const title = (await page.locator('[data-viewer-title]').textContent().catch(() => '')) || '';
    check(`${vp.name} chip is reauth`, auth === 'reauth', auth || '');
    check(`${vp.name} exclamation badge`, badge > 0);
    check(`${vp.name} chip is not the green signed-in look`, auth !== 'signed-in');
    check(`${vp.name} Open target is reconnect`, openTarget === 'reconnect', openTarget || '');
    check(`${vp.name} did not seed Part (1)`, !/Part \(1\)/.test(title), title);
    check(`${vp.name} reopened the cached assembly`, /Gearbox/.test(title), title);

    const greyShot = join(SHOT_DIR, `reauth-grey-${vp.name}.png`);
    await page.screenshot({ path: greyShot });
    check(`${vp.name} grey shot`, existsSync(greyShot), greyShot);

    holdRefresh = true;
    held = new Promise((resolve) => { releaseHold = resolve; });
    await chip.click();
    await page.waitForSelector('[data-profile-chip-variant="viewport"][data-profile-chip-state="spinning"]', { timeout: 8000 });
    const spinShot = join(SHOT_DIR, `reauth-spinner-${vp.name}.png`);
    await page.screenshot({ path: spinShot });
    check(`${vp.name} spinner shot`, existsSync(spinShot), spinShot);

    releaseHold();
    await page.waitForSelector('[data-profile-panel-mode="reauth"] [data-profile-reconnect]', { timeout: 8000 });
    const reconnectShot = join(SHOT_DIR, `reauth-reconnect-${vp.name}.png`);
    await page.screenshot({ path: reconnectShot });
    check(`${vp.name} reconnect shot`, existsSync(reconnectShot), reconnectShot);
    const label = await page.locator('[data-profile-panel-mode="reauth"] [data-profile-reconnect]').innerText();
    check(`${vp.name} Reconnect label`, /Reconnect/.test(label), label);

    await page.locator('[data-profile-panel-mode="reauth"] [data-profile-reconnect]').click({ trial: true }).catch(() => {});
    await page.keyboard.press('Escape');
    if (vp.touch) {
      await page.locator('[data-stage-btn="parts"]').click();
      await page.waitForSelector('[data-stage-pane="parts"]:not(.invisible)', { timeout: 8000 });
    }
    const feed = page.locator('[data-parts-feed]').first();
    await feed.locator('[data-assembly-load]').click();
    await feed.locator('[data-part-open-action="assembly"]').click();
    await page.waitForSelector('[data-git-dialog="reconnect"]', { timeout: 8000 });
    check(`${vp.name} Open shows reconnect, not the local file browser`, true);
    const fileInputs = await page.locator('[data-assembly-file]').count();
    check(`${vp.name} file input stays hidden`, fileInputs === 1);

    await context.close();
  }
} catch (err) {
  check('reauth golden', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ngithub reauth chip: ok');
