#!/usr/bin/env node
/**
 * Identity assets. Header wordmark at 360, 390, and 1280 is under 24px and CAD
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
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5241);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const HEADER_ROW_H = 36;
const MUTED = 'rgb(156, 163, 175)';
const INK = 'rgb(22, 23, 29)';
const ORANGE = 'rgb(255, 90, 31)';
const PAPER = 'rgb(250, 250, 249)';
const GREY = 'rgb(107, 110, 120)';
const NAVY = 'rgb(15, 23, 42)';
const GREY_ON_NAVY = 'rgb(163, 166, 174)';
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
  const splashDark = read('src/assets/brand/wordmark-splash-dark.svg');
  const paperTile = read('src/assets/brand/brandmark-dark-paper-tile.svg');
  const word = read('src/components/brand/BrandWordmark.jsx');
  const app = read('src/App.jsx');
  const boot = read('public/loading-theme.js');
  const feed = read('src/components/PartFeed.jsx');
  const editor = read('src/components/CodeEditor.jsx');
  const view = read('src/components/Viewport.jsx');
  const arch = read('docs/architecture.md');
  const map = read('docs/ui-map.md');
  const loading = app.slice(app.indexOf('Show loading state while Manifold initializes'), app.indexOf('Phone shell:'));

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
  check('splash-dark wordmark is Paper Surf and orange CAD',
    /#FAFAF9/.test(splashDark) && /#FF5A1F/.test(splashDark) && !/#16171D/.test(splashDark));
  check('dark paper-tile mark is paper tile, ink board, white stringer',
    /fill="#FAFAF9"/.test(paperTile) && /fill="#16171D"/.test(paperTile) && /stroke="#FFFFFF"/.test(paperTile));
  check('orange CAD only when the splash wordmark is at least 24px',
    /\(tone === 'splash' \|\| tone === 'splash-dark'\) && size >= 24/.test(word)
    && /cad: '#FF5A1F'/.test(word)
    && /tone === 'splash-dark'/.test(word)
    && /tone === 'on-light'/.test(word)
    && /cad: '#16171D'/.test(word));
  check('loading theme is decided before first paint',
    /src="\/loading-theme\.js"/.test(html)
    && /data-loading-theme/.test(html)
    && /hour >= 19 \|\| hour < 7/.test(boot)
    && /__SURFCAD_LOADING_HOUR__/.test(boot));
  const headerMark = word.slice(word.indexOf('export function BrandHeaderMark'), word.indexOf('/** Ink tile'));
  check('header mark is 16px Paper wordmark on transparent chrome with the paper tile',
    /tone="on-dark" size=\{16\}/.test(headerMark)
    && /<BrandTileMark size=\{16\} \/>/.test(headerMark)
    && /data-brand-mark="paper"/.test(word)
    && !/background:/.test(headerMark)
    && /data-brand-header/.test(headerMark));
  check('header beta tag is a muted lowercase label that does not take hits',
    /data-brand-beta/.test(headerMark)
    && /aria-hidden="true"/.test(headerMark)
    && />\s*beta\s*</.test(headerMark)
    && /text-muted-on-dark/.test(headerMark)
    && /text-ui-xs/.test(headerMark)
    && /pointer-events-none/.test(headerMark)
    && /flex-nowrap/.test(headerMark)
    && /whitespace-nowrap/.test(headerMark));
  check('splash is paper or navy, mark, 40px wordmark, grey tagline, no privacy link',
    /data-app-loading/.test(loading)
    && /surface-light/.test(loading)
    && /surface-splash-dark/.test(loading)
    && /<BrandMark /.test(loading)
    && /tone=\{loadingDark \? 'paper-tile' : 'ink'\}/.test(loading)
    && /tone=\{loadingDark \? 'splash-dark' : 'splash'\} size=\{40\}/.test(loading)
    && /Don't do CAD\. SurfCAD\./.test(loading)
    && /text-muted-on-light/.test(loading)
    && /text-muted-on-splash-dark/.test(loading)
    && !/SiteFooter/.test(loading)
    && !/Privacy choices/.test(loading)
    && !/#FF5A1F/.test(loading)
    && !/FF5A1F/i.test(loading));
  const ribbon = feed.slice(feed.indexOf('data-parts-feed-ribbon'), feed.indexOf('data-parts-rows'));
  check('parts ribbon has no header mark, toolbar order unchanged',
    !ribbon.includes('<BrandHeaderMark />')
    && ribbon.indexOf('data-parts-feed-toolbar') < ribbon.indexOf('data-parts-ribbon-center')
    && ribbon.indexOf('data-parts-ribbon-center') < ribbon.indexOf('data-parts-ribbon-end'));
  check('script ribbon has no header mark',
    !/data-editor-ribbon[\s\S]{0,400}<BrandHeaderMark \/>/.test(editor));
  check('CAD viewport header row carries the brand beside the title',
    /data-viewer-header-row/.test(view)
    && /flex min-h-9 items-center/.test(view)
    && /left-2 right-2 lg:left-4 lg:right-4/.test(view)
    && /data-brand-header-host/.test(view)
    && /shrink-0 items-center self-center pointer-events-auto"\s+data-brand-header-host=""/.test(view)
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

async function readHeaderAlign(page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-viewer-header-row]');
    const rail = document.querySelector('[data-rail-pair="left"]');
    if (!row || !rail) return null;
    const rowBox = row.getBoundingClientRect();
    const host = row.querySelector('[data-brand-header-host]');
    const tile = host?.querySelector('[data-brand-mark="paper"]');
    const title = row.querySelector('[data-viewer-title]');
    const chips = row.querySelector('[data-viewer-title-chips]');
    const profile = document.querySelector('[data-profile-chip-variant="viewport"]');
    const tileBox = tile?.getBoundingClientRect();
    const railBox = rail.getBoundingClientRect();
    const titleBox = title?.getBoundingClientRect();
    const chipsBox = chips?.getBoundingClientRect();
    const profileBox = profile?.getBoundingClientRect();
    const brandBox = host?.getBoundingClientRect();
    return {
      tileLeft: tileBox ? Math.round(tileBox.left) : null,
      railLeft: Math.round(railBox.left),
      titleMid: titleBox ? Math.round(titleBox.left + titleBox.width / 2) : null,
      viewportMid: Math.round(rowBox.left + rowBox.width / 2),
      brandRight: brandBox ? Math.round(brandBox.right) : null,
      profileLeft: profileBox ? Math.round(profileBox.left) : null,
      brandMidY: brandBox ? Math.round(brandBox.top + brandBox.height / 2) : null,
      chipsMidY: chipsBox ? Math.round(chipsBox.top + chipsBox.height / 2) : null,
      profileMidY: profileBox ? Math.round(profileBox.top + profileBox.height / 2) : null,
    };
  });
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
    const tile = root.querySelector('[data-brand-mark="paper"]');
    return {
      h: Math.round(box.height),
      cad: mark.getAttribute('data-brand-cad'),
      size: mark.getAttribute('data-brand-wordmark-size'),
      surf: fill('surf'),
      cadFill: fill('cad'),
      chip: chip ? getComputedStyle(chip).backgroundColor : '',
      hasTile: !!tile,
    };
  }, selector);
}

async function readHeaderFit(page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-viewer-header-row]');
    const host = row?.querySelector('[data-brand-header-host]');
    const beta = host?.querySelector('[data-brand-beta]');
    const word = host?.querySelector('[data-brand-wordmark]');
    const trigger = host?.querySelector('[data-brand-about-trigger]');
    const chips = row?.querySelector('[data-viewer-title-chips]');
    if (!row || !host || !beta || !word || !trigger) return null;
    const box = (el) => el.getBoundingClientRect();
    const rowBox = box(row);
    const hostBox = box(host);
    const betaBox = box(beta);
    const wordBox = box(word);
    const chipsBox = chips ? box(chips) : null;
    const mid = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const wordMid = mid(wordBox);
    const betaMid = mid(betaBox);
    const hit = (point) => document.elementFromPoint(point.x, point.y);
    const logoOwns = (el) => !!el && (el === trigger || trigger.contains(el));
    const overlaps = chipsBox
      && betaBox.right > chipsBox.left + 1
      && betaBox.bottom > chipsBox.top + 1
      && betaBox.top < chipsBox.bottom - 1;
    return {
      rowH: Math.round(rowBox.height),
      hostH: Math.round(hostBox.height),
      betaText: (beta.textContent || '').trim(),
      betaColor: getComputedStyle(beta).color,
      ariaHidden: beta.getAttribute('aria-hidden'),
      sameLine: Math.abs(betaMid.y - mid(wordBox).y) <= 2,
      stacked: betaBox.top >= wordBox.bottom - 1,
      betaH: Math.round(betaBox.height),
      gap: Math.round(betaBox.left - wordBox.right),
      overlapsChips: !!overlaps,
      chipsLeft: chipsBox ? Math.round(chipsBox.left) : null,
      betaRight: Math.round(betaBox.right),
      logoHit: logoOwns(hit(wordMid)),
      betaThroughLogo: logoOwns(hit(betaMid)),
    };
  });
}

function checkHeaderFit(label, fit) {
  check(`${label} header row stays ${HEADER_ROW_H}px`,
    fit && fit.rowH === HEADER_ROW_H && fit.hostH <= 24,
    JSON.stringify(fit));
  check(`${label} beta tag sits on the wordmark line and does not wrap`,
    fit && fit.betaText === 'beta' && fit.sameLine && !fit.stacked
    && fit.betaH > 0 && fit.betaH <= 16 && fit.gap >= 2 && fit.gap <= 12
    && !fit.overlapsChips,
    JSON.stringify(fit));
  check(`${label} beta tag is muted, hidden from AT, and does not cover the logo`,
    fit && fit.betaColor === MUTED && fit.ariaHidden === 'true'
    && fit.logoHit && fit.betaThroughLogo,
    JSON.stringify(fit));
}

async function readSplash(page) {
  return page.evaluate(() => {
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
      tone: mark?.getAttribute('data-brand-wordmark-tone') || '',
      cadFill: cad ? getComputedStyle(cad).fill : '',
      surfFill: surf ? getComputedStyle(surf).fill : '',
      tag: (tag?.textContent || '').trim(),
      tagColor: paint(tag),
      statusColor: paint(status),
      markKind: gate?.querySelector('[data-brand-mark]')?.getAttribute('data-brand-mark') || '',
      hasPrivacy: !!gate?.querySelector('[data-privacy-choices-link]'),
      theme: gate?.getAttribute('data-app-loading-theme') || '',
      htmlTheme: document.documentElement.getAttribute('data-loading-theme') || '',
      orangeNodes,
    };
  });
}

async function captureSplash(browser, hour) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await context.addInitScript((h) => { globalThis.__SURFCAD_LOADING_HOUR__ = h; }, hour);
  const page = await context.newPage();
  await page.route('**/*.wasm', async (route) => {
    await new Promise((r) => setTimeout(r, 20000));
    try { await route.continue(); } catch { /* closed */ }
  });
  const nav = page.goto(APP_URL, { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
  await page.waitForSelector('[data-app-loading]', { timeout: 15000 });
  const splash = await readSplash(page);
  const dark = hour >= 19 || hour < 7;
  await page.screenshot({ path: join(SHOT_DIR, dark ? 'brand-splash-dark.png' : 'brand-splash.png') });
  await context.close();
  await nav;
  return splash;
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
attachConsentPresetToBrowser(browser);

  {
    const splash = await captureSplash(browser, 12);
    check('light splash background is Paper', splash.bg === PAPER, splash.bg);
    check('light splash wordmark is at least 24px with orange CAD on Ink Surf',
      splash.h >= 24 && splash.cad === 'orange' && splash.tone === 'splash'
      && splash.cadFill === ORANGE && splash.surfFill === INK,
      JSON.stringify(splash));
    check('light splash tagline is the brand line in Grey with the ink mark',
      splash.tag === "Don't do CAD. SurfCAD."
      && splash.tagColor === GREY && splash.statusColor === GREY
      && splash.markKind === 'ink',
      JSON.stringify(splash));
    check('light splash orange is only the CAD path',
      splash.orangeNodes.length === 1 && splash.orangeNodes[0] === 'cad',
      JSON.stringify(splash.orangeNodes));
    check('light splash has no Privacy choices link',
      splash.hasPrivacy === false && splash.theme === 'light' && splash.htmlTheme === 'light',
      JSON.stringify(splash));
  }

  {
    const splash = await captureSplash(browser, 19);
    check('dark splash background is navy', splash.bg === NAVY, splash.bg);
    check('dark splash wordmark is at least 24px with orange CAD on Paper Surf',
      splash.h >= 24 && splash.cad === 'orange' && splash.tone === 'splash-dark'
      && splash.cadFill === ORANGE && splash.surfFill === PAPER,
      JSON.stringify(splash));
    check('dark splash tagline is the brand line in grey-on-navy with the paper-tile mark',
      splash.tag === "Don't do CAD. SurfCAD."
      && splash.tagColor === GREY_ON_NAVY && splash.statusColor === GREY_ON_NAVY
      && splash.markKind === 'paper-tile',
      JSON.stringify(splash));
    check('dark splash orange is only the CAD path',
      splash.orangeNodes.length === 1 && splash.orangeNodes[0] === 'cad',
      JSON.stringify(splash.orangeNodes));
    check('dark splash has no Privacy choices link',
      splash.hasPrivacy === false && splash.theme === 'dark' && splash.htmlTheme === 'dark',
      JSON.stringify(splash));
  }

  const deskPage = await boot(browser, { width: 1280, height: 800, touch: false });
  const at1280 = await readMark(deskPage.page, '[data-brand-header-host]');
  const host1280 = await deskPage.page.locator('[data-brand-header-host]').count();
  const rowAlign1280 = await readHeaderAlign(deskPage.page);
  const transparentChip = at1280?.chip === 'rgba(0, 0, 0, 0)' || at1280?.chip === 'transparent';
  check('1280 header wordmark is Paper on transparent chrome with paper tile in the viewport row',
    at1280 && at1280.h < 24 && at1280.h >= 14
    && at1280.cad === 'paper' && at1280.size === '16'
    && at1280.surf === PAPER && at1280.cadFill === PAPER
    && transparentChip
    && at1280.hasTile
    && host1280 === 1,
    JSON.stringify(at1280));
  check('1280 brand left edge lines up with the helper rail',
    rowAlign1280 && Math.abs(rowAlign1280.tileLeft - rowAlign1280.railLeft) <= 2,
    JSON.stringify(rowAlign1280));
  check('1280 title stays centred and clear of the profile chip',
    rowAlign1280
    && rowAlign1280.titleMid != null
    && Math.abs(rowAlign1280.titleMid - rowAlign1280.viewportMid) <= 2
    && rowAlign1280.brandRight != null
    && rowAlign1280.profileLeft != null
    && rowAlign1280.brandRight < rowAlign1280.profileLeft - 4,
    JSON.stringify(rowAlign1280));
  check('1280 brand is vertically centred with the assembly chips',
    rowAlign1280
    && rowAlign1280.brandMidY != null
    && rowAlign1280.chipsMidY != null
    && Math.abs(rowAlign1280.brandMidY - rowAlign1280.chipsMidY) <= 1,
    JSON.stringify(rowAlign1280));
  check('1280 profile chip is vertically centred with the header row',
    rowAlign1280
    && rowAlign1280.profileMidY != null
    && rowAlign1280.chipsMidY != null
    && Math.abs(rowAlign1280.profileMidY - rowAlign1280.chipsMidY) <= 1,
    JSON.stringify(rowAlign1280));
  checkHeaderFit('1280', await readHeaderFit(deskPage.page));
  await deskPage.page.screenshot({ path: join(SHOT_DIR, 'brand-header-1280.png') });
  await deskPage.context.close();

  const phone = await boot(browser, { width: 390, height: 844, touch: true });
  const at390 = await readMark(phone.page, '[data-brand-header-host]');
  const transparent390 = at390?.chip === 'rgba(0, 0, 0, 0)' || at390?.chip === 'transparent';
  check('390 CAD header wordmark is Paper on transparent chrome with paper tile',
    at390 && at390.h < 24 && at390.h >= 14
    && at390.cad === 'paper' && at390.cadFill === PAPER && at390.surf === PAPER
    && transparent390
    && at390.hasTile,
    JSON.stringify(at390));
  const rowAlign390 = await readHeaderAlign(phone.page);
  check('390 brand left edge lines up with the helper rail',
    rowAlign390 && Math.abs(rowAlign390.tileLeft - rowAlign390.railLeft) <= 2,
    JSON.stringify(rowAlign390));
  check('390 brand is vertically centred with the assembly chips',
    rowAlign390
    && rowAlign390.brandMidY != null
    && rowAlign390.chipsMidY != null
    && Math.abs(rowAlign390.brandMidY - rowAlign390.chipsMidY) <= 1,
    JSON.stringify(rowAlign390));
  checkHeaderFit('390', await readHeaderFit(phone.page));
  await phone.page.screenshot({ path: join(SHOT_DIR, 'brand-header-390.png') });
  await phone.page.setViewportSize({ width: 360, height: 844 });
  await phone.page.waitForTimeout(200);
  checkHeaderFit('360', await readHeaderFit(phone.page));
  await phone.page.screenshot({ path: join(SHOT_DIR, 'brand-header-360.png') });
  await phone.page.setViewportSize({ width: 390, height: 844 });
  await phone.page.locator('[data-stage-btn="parts"]').click();
  await phone.page.waitForTimeout(300);
  const partsBrandCount = await phone.page.locator('[data-stage-pane="parts"] [data-brand-header]').count();
  check('390 parts stage has no brand header',
    partsBrandCount === 0,
    String(partsBrandCount));
  await phone.page.locator('[data-part-edit-script]').first().click();
  await phone.page.waitForSelector('[data-script-editor-open="true"]', { timeout: 15000 });
  const scriptBrandCount = await phone.page.locator('[data-script-editor-open="true"] [data-brand-header]').count();
  check('390 script stage has no brand header',
    scriptBrandCount === 0,
    String(scriptBrandCount));
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
