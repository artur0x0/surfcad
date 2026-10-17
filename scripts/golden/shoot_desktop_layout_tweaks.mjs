#!/usr/bin/env node
/**
 * Layout + canvas aspect screenshots for desktop layout tweaks.
 * LABEL=before|after GOLDEN_SHOT_DIR=... node scripts/golden/shoot_desktop_layout_tweaks.mjs
 */
/* global document, indexedDB, window, Event */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { serializeAssembly } from '../../src/utils/assembly.js';

const PORT = Number(process.env.SMOKE_PORT || 4329);
const APP_URL = `http://localhost:${PORT}/`;
const LABEL = process.env.LABEL || 'shot';
const OUT = process.env.GOLDEN_SHOT_DIR || join('/opt/cursor/artifacts', 'desktop-layout-tweaks');
const CHROME = [
  process.env.CHROME_PATH,
  '/usr/local/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean).find((path) => existsSync(path));

const SCRIPT = 'let part = Manifold.cube([50, 30, 20], true);\nreturn part;\n';
const DOC = serializeAssembly({
  version: 1,
  source: 'local',
  name: 'Layout Demo',
  activeId: 'part-a',
  parts: [{ id: 'part-a', name: 'Box', visible: true, order: 0 }],
});

if (!CHROME) {
  console.log('layout shots: no Chrome — skip');
  process.exit(0);
}
if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.error('layout shots: run npm run build first');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
  try { server.kill('SIGKILL'); } catch { /* gone */ }
};
process.on('exit', stop);

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function wirePage(page) {
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
}

async function seedAssembly(page) {
  await page.evaluate(async ({ doc, script }) => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('surfcad-assembly', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('assembly')) db.createObjectStore('assembly');
        if (!db.objectStoreNames.contains('parts')) db.createObjectStore('parts');
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['assembly', 'parts'], 'readwrite');
        tx.objectStore('assembly').put(doc, 'current');
        tx.objectStore('parts').put({ id: 'part-a', script, savedAt: Date.now() }, 'part-a');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: DOC, script: SCRIPT });
}

async function clearAssembly(page) {
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('surfcad-assembly', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['assembly'], 'readwrite');
        tx.objectStore('assembly').delete('current');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

async function canvasAspectMetrics(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-agent-viewport] canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cssAspect = rect.width / rect.height;
    const bufAspect = canvas.width / canvas.height;
    return {
      cssAspect,
      bufAspect,
      drift: Math.abs(bufAspect - cssAspect) / cssAspect,
      buffer: { w: canvas.width, h: canvas.height },
      css: { w: rect.width, h: rect.height },
    };
  });
}

async function togglePartsColumn(page, visible) {
  await page.evaluate((show) => {
    const col = document.querySelector('[data-parts-feed-placement="desktop-left"]');
    if (col) col.style.display = show ? '' : 'none';
    window.dispatchEvent(new Event('resize'));
  }, visible);
  await page.waitForTimeout(600);
}

async function capture(browser, width, height) {
  console.log(`layout shots: capture ${width}x${height}`);
  const prefix = `${LABEL}-${width}x${height}`;
  const mobile = width < 500;
  const context = await browser.newContext({
    viewport: { width, height },
    ...(mobile ? {
      hasTouch: true,
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    } : {}),
  });
  const page = await context.newPage();
  await wirePage(page);
  await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 20000 }).catch(() => {});

  await clearAssembly(page);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, `${prefix}-no-assembly.png`) });

  await seedAssembly(page);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: join(OUT, `${prefix}-with-assembly.png`) });

  const partsVisible = await canvasAspectMetrics(page);
  await page.screenshot({ path: join(OUT, `${prefix}-canvas-parts-visible.png`) });

  if (!mobile) {
    await togglePartsColumn(page, false);
    const partsHidden = await canvasAspectMetrics(page);
    await page.screenshot({ path: join(OUT, `${prefix}-canvas-parts-hidden.png`) });
    await togglePartsColumn(page, true);
    console.log(JSON.stringify({ width, height, partsVisible, partsHidden }, null, 2));
  } else {
    console.log(JSON.stringify({ width, height, partsVisible }, null, 2));
  }

  await context.close();
}

try {
  console.log('layout shots: waiting for preview…');
  if (!(await waitForServer())) throw new Error('preview server timeout');
  console.log('layout shots: launching Chrome…');
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  await capture(browser, 1440, 900);
  await capture(browser, 390, 844);
  await browser.close();
  console.log(`layout shots written to ${OUT} (${LABEL})`);
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  stop();
}
