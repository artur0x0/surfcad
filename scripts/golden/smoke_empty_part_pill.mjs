#!/usr/bin/env node
/**
 * No part selected: the CAD title is the assembly name only.
 * The part-name pill is not drawn. An empty name does not leave a blank chip.
 *
 * Desktop and 390. Selecting the part shows the pill. An empty canvas click
 * hides it again. Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, indexedDB, localStorage, sessionStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { formatViewerTitle } from '../../src/utils/assembly.js';

const PORT = Number(process.env.SMOKE_PORT || 5235);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
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

console.log('empty part-name pill');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

{
  const hidden = formatViewerTitle('Bracket', ASM, { partSelected: false });
  const shown = formatViewerTitle('Bracket', ASM, { partSelected: true });
  const blank = formatViewerTitle('', ASM, { partSelected: true });
  check('no part selected drops the part name', hidden.part === '' && hidden.connector === '' && hidden.text === ASM);
  check('a selected part keeps part in assembly', shown.part === 'Bracket' && shown.connector === 'in' && shown.text === `Bracket in ${ASM}`);
  check('a selected part with no name still has a label', blank.part === 'Untitled');
  const view = read('src/components/Viewport.jsx');
  const titleStart = view.indexOf('data-viewer-title');
  const title = view.slice(titleStart, view.indexOf("mode === 'game' && gameSuccess", titleStart));
  check('the part pill renders only when there is a part name',
    /titleParts\.part \? \(/.test(title)
    && /onTitlePartActivate/.test(title)
    && /value=\{currentFilename\}/.test(title)
    && title.indexOf('titleParts.part ?') < title.indexOf('onTitlePartActivate'));
  const arch = read('docs/architecture.md');
  const map = read('docs/UI_MAP.md');
  check('architecture and UI map mention the omitted pill',
    /golden:empty-part-pill/.test(arch) && /data-title-role="part"/.test(map));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('empty part-name pill: no system Chrome — set CHROME_PATH');
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
  }, { doc: DOC, script: SCRIPT });
}

async function titleState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-viewer-title]');
    const part = document.querySelector('[data-title-role="part"]');
    const assembly = document.querySelector('[data-title-role="assembly"]');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim() };
    };
    return {
      text: root?.getAttribute('data-viewer-title-text') || '',
      shown: (root?.textContent || '').replace(/\s+/g, ' ').trim(),
      part: box(part),
      assembly: box(assembly),
      connector: !!document.querySelector('[data-title-in]'),
    };
  });
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
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-viewer-title]')?.getAttribute('data-viewer-title-text') || '';
    return text.includes('Metallll');
  }, null, { timeout: 20000 });
  return { context, page, errors };
}

async function selectPart(page, touch) {
  if (touch) {
    await page.locator('[data-stage-btn="parts"]').click();
    await page.waitForTimeout(200);
  }
  const row = page.locator('[data-part-row="bracket"]');
  await row.waitFor({ state: 'visible', timeout: 15000 });
  // The row's center is a button (eye / pencil). The grip selects the part.
  await row.click({ position: { x: 12, y: 12 } });
  if (touch) {
    await page.locator('[data-stage-btn="cad"]').click();
    await page.waitForTimeout(200);
  }
}

async function emptyClick(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    return !!(canvas && canvas.clientWidth > 0 && globalThis.__VIEWPORT__?.ready?.());
  }, null, { timeout: 90000 });
  const point = await page.evaluate(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const r = canvas.getBoundingClientRect();
    return { x: r.left + 8, y: r.top + r.height * 0.45 };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(400);
}

async function runView(browser, vp) {
  const { context, page, errors } = await boot(browser, vp);
  const idle = await titleState(page);
  console.log(`  ${vp.name} idle ${JSON.stringify(idle)}`);
  check(`${vp.name} title is the assembly name only`, idle.text === ASM && idle.shown === ASM, idle.text);
  check(`${vp.name} part pill is absent`, idle.part == null, JSON.stringify(idle.part));
  check(`${vp.name} assembly chip shows the name`, idle.assembly?.text === ASM && idle.assembly.w > 8, JSON.stringify(idle.assembly));
  check(`${vp.name} no "in" connector`, idle.connector === false);
  const idleShot = join(SHOT_DIR, `empty-part-pill-${vp.name}.png`);
  await page.screenshot({ path: idleShot });
  check(`${vp.name} idle shot saved outside artifacts`, existsSync(idleShot) && !idleShot.startsWith('/opt/cursor/artifacts'), idleShot);

  await selectPart(page, vp.touch);
  await page.waitForFunction(() => {
    const part = document.querySelector('[data-title-role="part"]');
    return (part?.textContent || '').trim() === 'Bracket';
  }, null, { timeout: 10000 });
  const picked = await titleState(page);
  console.log(`  ${vp.name} picked ${JSON.stringify(picked)}`);
  check(`${vp.name} selecting the part shows its pill`,
    picked.part?.text === 'Bracket' && picked.part.w > 8 && picked.connector && picked.text === `Bracket in ${ASM}`,
    JSON.stringify(picked));

  await emptyClick(page);
  await page.waitForFunction(() => !document.querySelector('[data-title-role="part"]'), null, { timeout: 8000 });
  const cleared = await titleState(page);
  console.log(`  ${vp.name} cleared ${JSON.stringify(cleared)}`);
  check(`${vp.name} empty click hides the part pill`, cleared.part == null && cleared.text === ASM && cleared.assembly?.text === ASM, JSON.stringify(cleared));
  check(`${vp.name} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

const up = await waitForServer();
check('dev server started', up, APP_URL);
if (!up) {
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
attachConsentPresetToBrowser(browser);
try {
  await runView(browser, { name: '390', width: 390, height: 844, touch: true });
  await runView(browser, { name: 'desktop', width: 1280, height: 800, touch: false });
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`\nempty part-name pill: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nempty part-name pill passed');
