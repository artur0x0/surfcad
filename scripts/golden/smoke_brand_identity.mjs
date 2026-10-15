#!/usr/bin/env node
/**
 * Identity assets. Header wordmark at 390 and 1280 is under 24px and CAD
 * is Ink, not orange. The loading gate is Paper, with orange CAD only
 * because that wordmark is at least 24px. golden:brand-identity
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the artifacts folder.
 */
/* global document, getComputedStyle, indexedDB, localStorage, sessionStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 5241);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const INK = 'rgb(22, 23, 29)';
const ORANGE = 'rgb(255, 90, 31)';
const PAPER = 'rgb(250, 250, 249)';
const GREY = 'rgb(107, 110, 120)';
const ASM = 'Metallll';
const DOC = {
  version: 1,
  source: 'git',
  name: ASM,
  activeId: 'bracket',
  parts: [{ id: 'bracket', name: 'Bracket', visible: true, order: 0 }],
};
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

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

console.log('brand identity');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

{
  const html = read('index.html');
  const manifest = JSON.parse(read('public/site.webmanifest'));
  const ink = read('src/assets/brand/wordmark-ink.svg');
  const word = read('src/components/brand/BrandWordmark.jsx');
  const app = read('src/App.jsx');
  const feed = read('src/components/PartFeed.jsx');
  const editor = read('src/components/CodeEditor.jsx');
  const view = read('src/components/Viewport.jsx');
  const arch = read('docs/architecture.md');
  const map = read('docs/UI_MAP.md');
  const loading = app.slice(app.indexOf('if (!manifoldReady || editorInitialScript === null)'), app.indexOf('Phone shell:'));

  check('title, theme-color, and tagline description',
    /<title>SurfCAD<\/title>/.test(html)
    && /name="theme-color" content="#16171D"/.test(html)
    && /name="description" content="Don't do CAD\. SurfCAD\."/.test(html)
    && /apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png"/.test(html)
    && /href="\/favicon\.ico"/.test(html));
  check('manifest is SurfCAD on Ink, with any and maskable icons',
    manifest.name === 'SurfCAD'
    && manifest.short_name === 'SurfCAD'
    && manifest.description === "Don't do CAD. SurfCAD."
    && manifest.theme_color === '#16171D'
    && manifest.background_color === '#16171D'
    && manifest.icons.some((icon) => icon.src === '/icon-192.png' && icon.purpose === 'any')
    && manifest.icons.some((icon) => icon.src === '/icon-512.png' && icon.purpose === 'any')
    && manifest.icons.some((icon) => icon.src === '/icon-maskable-192.png' && icon.purpose === 'maskable')
    && manifest.icons.some((icon) => icon.src === '/icon-maskable-512.png' && icon.purpose === 'maskable'));
  for (const file of [
    'public/favicon.ico',
    'public/favicon.svg',
    'public/apple-touch-icon.png',
    'public/icon-192.png',
    'public/icon-512.png',
    'public/icon-maskable-192.png',
    'public/icon-maskable-512.png',
  ]) {
    check(`${file} exists`, existsSync(new URL(`../../${file}`, import.meta.url)));
  }
  check('ink wordmark has no orange', !/#FF5A1F/i.test(ink) && /#16171D/.test(ink));
  check('orange CAD only when the splash wordmark is at least 24px',
    /tone === 'splash' && size >= 24/.test(word)
    && /cad: '#FF5A1F'/.test(word)
    && /tone === 'on-light'/.test(word)
    && /cad: '#16171D'/.test(word));
  check('header mark is 16px ink on a paper chip',
    /tone="on-light" size=\{16\}/.test(word)
    && /background: '#FAFAF9'/.test(word)
    && /data-brand-header/.test(word));
  check('splash is paper, mark, 40px wordmark, grey tagline',
    /data-app-loading/.test(loading)
    && /background: '#FAFAF9'/.test(loading)
    && /<BrandMark /.test(loading)
    && /tone="splash" size=\{40\}/.test(loading)
    && /Don't do CAD\. SurfCAD\./.test(loading)
    && /color: '#6B6E78'/.test(loading)
    && !/#FF5A1F/.test(loading)
    && !/FF5A1F/i.test(loading));
  const ribbon = feed.slice(feed.indexOf('data-parts-feed-ribbon'), feed.indexOf('data-parts-rows'));
  check('parts ribbon leads with the header mark, toolbar order unchanged',
    ribbon.indexOf('<BrandHeaderMark />') >= 0
    && ribbon.indexOf('<BrandHeaderMark />') < ribbon.indexOf('data-parts-feed-toolbar')
    && ribbon.indexOf('data-parts-feed-toolbar') < ribbon.indexOf('data-parts-ribbon-center')
    && ribbon.indexOf('data-parts-ribbon-center') < ribbon.indexOf('data-parts-ribbon-end'));
  check('script ribbon leads with the header mark',
    /data-editor-ribbon[\s\S]{0,400}<BrandHeaderMark \/>/.test(editor));
  check('phone CAD header is beside the puzzle target',
    /brandHeader &&/.test(view)
    && /left-12 top-1/.test(view)
    && /<BrandHeaderMark \/>/.test(view)
    && /<PuzzleUnlock enabled=\{mode !== 'game'\} onUnlock=\{onStartGame\} \/>/.test(view));
  check('docs name the identity golden',
    /golden:brand-identity/.test(arch) && /golden:brand-identity/.test(map));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('brand identity: no system Chrome — set CHROME_PATH');
  process.exit(failed ? 1 : 1);
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
        tx.objectStore('parts').put({ id: 'bracket', script, savedAt: Date.now() }, 'bracket');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: DOC, script: SCRIPT });
}

async function readMark(page, selector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const mark = root?.querySelector('[data-brand-wordmark]');
    if (!mark) return null;
    const box = mark.getBoundingClientRect();
    const fill = (word) => {
      const path = mark.querySelector(`[data-brand-word="${word}"]`);
      return path ? getComputedStyle(path).fill : '';
    };
    const chip = root.querySelector('[data-brand-header]');
    return {
      h: Math.round(box.height),
      cad: mark.getAttribute('data-brand-cad'),
      size: mark.getAttribute('data-brand-wordmark-size'),
      surf: fill('surf'),
      cadFill: fill('cad'),
      chip: chip ? getComputedStyle(chip).backgroundColor : '',
    };
  }, selector);
}

async function boot(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.touch,
    isMobile: vp.touch,
    deviceScaleFactor: 1,
    userAgent: vp.touch
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  await context.addInitScript(() => { globalThis.open = () => null; });
  const page = await context.newPage();
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
  await page.waitForSelector('[data-viewer-title]', { timeout: 45000 });
  return { context, page };
}

let browser;
try {
  if (!await waitForServer()) {
    check('preview server started', false, APP_URL);
    process.exit(1);
  }
  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.route('**/*.wasm', async (route) => {
      await new Promise((r) => setTimeout(r, 20000));
      try { await route.continue(); } catch { /* closed */ }
    });
    const nav = page.goto(APP_URL, { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
    await page.waitForSelector('[data-app-loading]', { timeout: 15000 });
    const splash = await page.evaluate(() => {
      const gate = document.querySelector('[data-app-loading]');
      const mark = gate?.querySelector('[data-brand-wordmark]');
      const cad = mark?.querySelector('[data-brand-word="cad"]');
      const surf = mark?.querySelector('[data-brand-word="surf"]');
      const tag = gate?.querySelector('[data-brand-tagline]');
      const status = gate?.querySelector('[data-app-loading-status]');
      const box = mark?.getBoundingClientRect();
      const paint = (el) => (el ? getComputedStyle(el).color : '');
      const orangeNodes = [...(gate?.querySelectorAll('*') || [])].filter((el) => {
        const style = getComputedStyle(el);
        return [style.color, style.backgroundColor, style.fill, style.borderTopColor].includes('rgb(255, 90, 31)');
      }).map((el) => el.getAttribute('data-brand-word') || el.tagName);
      return {
        bg: gate ? getComputedStyle(gate).backgroundColor : '',
        h: box ? Math.round(box.height) : 0,
        cad: mark?.getAttribute('data-brand-cad') || '',
        cadFill: cad ? getComputedStyle(cad).fill : '',
        surfFill: surf ? getComputedStyle(surf).fill : '',
        tag: (tag?.textContent || '').trim(),
        tagColor: paint(tag),
        statusColor: paint(status),
        hasMark: !!gate?.querySelector('[data-brand-mark="ink"]'),
        orangeNodes,
      };
    });
    check('splash background is Paper', splash.bg === PAPER, splash.bg);
    check('splash wordmark is at least 24px with orange CAD',
      splash.h >= 24 && splash.cad === 'orange' && splash.cadFill === ORANGE && splash.surfFill === INK,
      JSON.stringify(splash));
    check('splash tagline is the brand line in Grey',
      splash.tag === "Don't do CAD. SurfCAD." && splash.tagColor === GREY && splash.statusColor === GREY && splash.hasMark,
      JSON.stringify(splash));
    check('splash orange is only the CAD path',
      splash.orangeNodes.length === 1 && splash.orangeNodes[0] === 'cad',
      JSON.stringify(splash.orangeNodes));
    await page.screenshot({ path: join(SHOT_DIR, 'brand-splash.png') });
    await context.close();
    await nav;
  }

  const deskPage = await boot(browser, { width: 1280, height: 800, touch: false });
  const at1280 = await readMark(deskPage.page, '[data-parts-feed-ribbon]');
  const host1280 = await deskPage.page.locator('[data-brand-header-host]').count();
  check('1280 header CAD is Ink and under 24px',
    at1280 && at1280.h < 24 && at1280.h >= 14
    && at1280.cad === 'ink' && at1280.size === '16'
    && at1280.surf === INK && at1280.cadFill === INK
    && at1280.chip === PAPER
    && host1280 === 0,
    JSON.stringify(at1280));
  await deskPage.page.screenshot({ path: join(SHOT_DIR, 'brand-header-1280.png') });
  await deskPage.context.close();

  const phone = await boot(browser, { width: 390, height: 844, touch: true });
  const at390 = await readMark(phone.page, '[data-brand-header-host]');
  check('390 CAD header CAD is Ink and under 24px',
    at390 && at390.h < 24 && at390.h >= 14
    && at390.cad === 'ink' && at390.cadFill === INK && at390.surf === INK,
    JSON.stringify(at390));
  await phone.page.locator('[data-stage-btn="parts"]').click();
  await phone.page.waitForTimeout(300);
  const parts390 = await readMark(phone.page, '[data-stage-pane="parts"] [data-parts-feed-ribbon]');
  check('390 parts header CAD is Ink and under 24px',
    parts390 && parts390.h < 24 && parts390.cad === 'ink' && parts390.cadFill === INK,
    JSON.stringify(parts390));
  await phone.page.screenshot({ path: join(SHOT_DIR, 'brand-header-390.png') });
  await phone.context.close();
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.log(`brand identity: ${failed} failed`);
  process.exit(1);
}
console.log('brand identity: ok');
