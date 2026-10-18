#!/usr/bin/env node
/**
 * Does the app actually render? The one check every other golden cannot make.
 *
 * Text-matching goldens and `npm run build` both passed on the change that
 * shipped a white page (a hook dependency array reading a `const` from the
 * temporal dead zone — see golden:hook-dep-tdz). Nothing here parsed the source;
 * it needs a real browser executing the real bundle.
 *
 * Runs `vite preview` over a production build and drives it with playwright-core
 * against the SYSTEM Chrome, so CI/dev machines download no browser. Set
 * CHROME_PATH to override the executable.
 *
 * Fails on: a blank root, any uncaught page error, or a console error. The app
 * boots WebGL and a Manifold wasm worker, so genuinely-optional noise is
 * allowlisted below rather than ignored wholesale — keep that list short and
 * specific, or this test stops meaning anything.
 */
/* The `page.evaluate` callbacks below are serialised and run INSIDE the
   browser, where `document` exists — eslint lints this file as Node. */
/* global document, getComputedStyle, sessionStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();

const PORT = Number(process.env.SMOKE_PORT || 4317);
const APP_URL = `http://localhost:${PORT}/`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

/** Noise the app legitimately produces; anything else fails the run. */
const ALLOWED = [
  /favicon/i,
  /Failed to load resource.*404.*favicon/i,
  /WebGL|WEBGL|GPU stall|Automatic fallback to software WebGL/i,
  /\[APP\]|\[App\]/,
];

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
  console.log('app loads: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

console.log('app loads in a real browser');

if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('  ❌ dist/ missing — run `npm run build` first');
  process.exit(1);
}

// `detached` puts vite in its own process GROUP. Killing the npx wrapper alone
// leaves the real server holding the port, which then fails every later run
// with "Port already in use" — so signal the whole group instead.
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
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

async function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let browser;
try {
  if (!await waitForServer()) {
    check('preview server started', false, `no response on ${APP_URL}`);
    process.exit(1);
  }

  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  attachConsentPresetToBrowser(browser);

  const pageErrors = [];
  const consoleErrors = [];

  const captureLoading = async (hour, shotName) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript((h) => { globalThis.__SURFCAD_LOADING_HOUR__ = h; }, hour);
    const loadingPage = await context.newPage();
    loadingPage.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
    await loadingPage.route('**/api/auth/me', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: false }),
    }));
    await loadingPage.route('**/api/config', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    }));
    await loadingPage.route('**/*.wasm', async (route) => {
      await new Promise((r) => setTimeout(r, 20000));
      try { await route.continue(); } catch { /* closed */ }
    });
    const nav = loadingPage.goto(APP_URL, { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
    await loadingPage.waitForSelector('[data-app-loading]', { timeout: 15000 });
    const loading = await loadingPage.evaluate(() => {
      const gate = document.querySelector('[data-app-loading]');
      return {
        theme: gate?.getAttribute('data-app-loading-theme') || '',
        htmlTheme: document.documentElement.getAttribute('data-loading-theme') || '',
        privacy: !!gate?.querySelector('[data-privacy-choices-link]'),
        footer: !!gate?.querySelector('[data-site-footer]'),
        bg: gate ? getComputedStyle(gate).backgroundColor : '',
      };
    });
    mkdirSync(SHOT_DIR, { recursive: true });
    await loadingPage.screenshot({ path: join(SHOT_DIR, shotName) });
    await context.close();
    await nav;
    return loading;
  }

  const lightSplash = await captureLoading(12, 'app-loads-splash-light.png');
  check('loading screen has no Privacy choices link (light)',
    lightSplash.privacy === false && lightSplash.footer === false,
    JSON.stringify(lightSplash));
  check('loading screen light theme from hour hook',
    lightSplash.theme === 'light' && lightSplash.htmlTheme === 'light'
    && lightSplash.bg === 'rgb(250, 250, 249)',
    JSON.stringify(lightSplash));

  const darkSplash = await captureLoading(19, 'app-loads-splash-dark.png');
  check('loading screen has no Privacy choices link (dark)',
    darkSplash.privacy === false && darkSplash.footer === false,
    JSON.stringify(darkSplash));
  check('loading screen dark theme from hour hook',
    darkSplash.theme === 'dark' && darkSplash.htmlTheme === 'dark'
    && darkSplash.bg === 'rgb(15, 23, 42)',
    JSON.stringify(darkSplash));

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (ALLOWED.some((re) => re.test(text))) return;
    consoleErrors.push(text);
  });

  // `vite preview` reuses the dev proxy, so /api hits :3000. This smoke does
  // not start that backend, and a proxy 500 is a Chrome console error even
  // when the app catches it. Answer the two boot probes (signed-out, no
  // GitHub app config) so the run is hermetic; every other console error
  // still fails the test.
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }));

  await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });

  // The blank screen was React bailing out: #root existed but stayed empty.
  await page.waitForFunction(
    () => document.querySelector('#root')?.children.length > 0,
    null,
    { timeout: 20000 },
  ).catch(() => {});

  const rootChildren = await page.evaluate(
    () => document.querySelector('#root')?.children.length ?? 0,
  );
  check('#root has rendered children (not a blank screen)', rootChildren > 0,
    `#root child count = ${rootChildren}`);

  // Real chrome, not just any DOM: the editor pane and the viewport canvas.
  const canvas = await page.locator('canvas').count();
  check('the 3D canvas mounted', canvas > 0);
  const strip = await page.locator('[data-toolbar-variant="strip"]').count();
  check('the CAD toolbar strip mounted', strip > 0);
  const run = await page.locator('[data-cad-run]').count();
  check('the Run button is present', run > 0);

  // 390px: the bottom pill is CAD and Parts. A saved Script stage opens Parts.
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  phone.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  phone.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (ALLOWED.some((re) => re.test(text))) return;
    consoleErrors.push(text);
  });
  await phone.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await phone.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }));
  await phone.addInitScript(() => {
    sessionStorage.setItem('3dculos.mobileStage', 'script');
  });
  await phone.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
  await phone.waitForSelector('[data-mobile-stage-toggle]', { timeout: 20000 });
  const stageButtons = await phone.locator('[data-stage-btn]').count();
  const scriptButtons = await phone.locator('[data-stage-btn="script"]').count();
  const cadButtons = await phone.locator('[data-stage-btn="cad"]').count();
  const partsButtons = await phone.locator('[data-stage-btn="parts"]').count();
  const stage = await phone.locator('[data-mobile-stage]').getAttribute('data-mobile-stage');
  const stored = await phone.evaluate(() => sessionStorage.getItem('3dculos.mobileStage'));
  check('phone toggle has CAD and Parts only', stageButtons === 2 && cadButtons === 1 && partsButtons === 1 && scriptButtons === 0,
    `buttons=${stageButtons} cad=${cadButtons} parts=${partsButtons} script=${scriptButtons}`);
  check('a saved script stage opens Parts', stage === 'parts' && stored === 'parts',
    `stage=${stage} stored=${stored}`);
  mkdirSync(SHOT_DIR, { recursive: true });
  await phone.screenshot({ path: join(SHOT_DIR, 'cad-mobile-toggle-390.png') });

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  check('no unexpected console errors', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('the page loaded', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nApp renders.');
