#!/usr/bin/env node
/**
 * Before/after layout + viewport aspect checks for desktop layout tweaks.
 * Usage: GOLDEN_SHOT_DIR=/path LABEL=before|after node scripts/golden/shoot_desktop_layout_tweaks.mjs
 * Requires production build and system Chrome.
 */
/* global document, indexedDB, window, Event */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { serializeAssembly } from '../../src/utils/assembly.js';

const PORT = Number(process.env.SMOKE_PORT || 4329);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const LABEL = process.env.LABEL || 'shot';
const OUT = process.env.GOLDEN_SHOT_DIR || join('/opt/cursor/artifacts', 'desktop-layout-tweaks');
const CHROME = [
  process.env.CHROME_PATH,
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

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
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
        const tx = db.transaction(['assembly', 'parts'], 'readwrite');
        tx.objectStore('assembly').delete('current');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

async function waitViewportReady(page) {
  await page.waitForFunction(() => window.__VIEWPORT__?.ready?.(), { timeout: 120000 });
}

async function togglePartsColumn(page, visible) {
  await page.evaluate((show) => {
    const col = document.querySelector('[data-parts-feed-placement="desktop-left"]');
    if (col) col.style.display = show ? '' : 'none';
    window.dispatchEvent(new Event('resize'));
  }, visible);
  await page.waitForTimeout(400);
}

async function measureBoxAspect(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-agent-viewport] canvas');
    const mesh = window.__MANIFOLD_CONTEXT__?.lastResult?.mesh;
    if (!canvas || !mesh) return null;
    const vp = window.__VIEWPORT__;
    const project = vp?.stageProject?.([25, 15, 10]);
    const project2 = vp?.stageProject?.([25, -15, 10]);
    const project3 = vp?.stageProject?.([-25, 15, 10]);
    if (!project || !project2 || !project3) return null;
    const w = Math.hypot(project2.x - project.x, project2.y - project.y);
    const h = Math.hypot(project3.x - project.x, project3.y - project.y);
    const canvasRect = canvas.getBoundingClientRect();
    return {
      screenAspect: w / h,
      canvasCss: { w: canvasRect.width, h: canvasRect.height },
      buffer: { w: canvas.width, h: canvas.height },
    };
  });
}

async function capture(browser, width, height, tag) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

  const prefix = `${LABEL}-${width}x${height}`;

  // Fresh load: no assembly (desktop parts panel visibility).
  await clearAssembly(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `${prefix}-no-assembly.png`), fullPage: false });

  await seedAssembly(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitViewportReady(page);
  await page.waitForTimeout(800);

  await page.screenshot({ path: join(OUT, `${prefix}-with-assembly.png`), fullPage: false });

  const beforeAspect = await measureBoxAspect(page);
  await page.screenshot({ path: join(OUT, `${prefix}-viewport-box-parts-visible.png`), fullPage: false });

  await togglePartsColumn(page, false);
  const afterAspect = await measureBoxAspect(page);
  await page.screenshot({ path: join(OUT, `${prefix}-viewport-box-parts-hidden.png`), fullPage: false });
  await togglePartsColumn(page, true);

  const aspectDrift = beforeAspect && afterAspect
    ? Math.abs(beforeAspect.screenAspect - afterAspect.screenAspect) / beforeAspect.screenAspect
    : null;

  console.log(JSON.stringify({
    tag,
    width,
    height,
    beforeAspect,
    afterAspect,
    aspectDrift,
  }, null, 2));

  await context.close();
}

try {
  if (!(await waitForServer())) throw new Error('preview server timeout');
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  await capture(browser, 1440, 900, 'desktop');
  await capture(browser, 390, 844, 'mobile');
  await browser.close();
  console.log(`layout shots written to ${OUT} (${LABEL})`);
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  stop();
}
