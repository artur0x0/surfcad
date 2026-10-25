#!/usr/bin/env node
/**
 * Viewer title chips: spacing at 390 and 1280, part tap selects all bodies,
 * assembly tap enters assembly mode (no rename input), part rename on double-click.
 */
/* global document, indexedDB, localStorage, sessionStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5236);
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

console.log('viewer title chip actions');
mkdirSync(SHOT_DIR, { recursive: true });

{
  const view = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  check('part chip wires activate + double-click rename',
    /onTitlePartActivate/.test(view) && /renameOnDoubleClick/.test(view));
  check('assembly chip wires activate only',
    /onTitleAssemblyActivate/.test(view)
    && !/onRename=\{onRenameAssembly\}/.test(view));
  check('App handlers are passed to Viewport',
    /handleTitlePartActivate/.test(app) && /handleTitleAssemblyActivate/.test(app));
  const arch = read('docs/architecture.md');
  const map = read('docs/ui-map.md');
  check('docs mention golden:viewer-title-actions',
    /golden:viewer-title-actions/.test(arch) && /golden:viewer-title-actions/.test(map));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('viewer title chip actions: no system Chrome — set CHROME_PATH');
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

async function chipGap(page) {
  return page.evaluate(() => {
    const part = document.querySelector('[data-title-role="part"]');
    const assembly = document.querySelector('[data-title-role="assembly"]');
    const inn = document.querySelector('[data-title-in]');
    if (!part || !assembly) return { ok: false, reason: 'missing chip' };
    const pr = part.getBoundingClientRect();
    const ar = assembly.getBoundingClientRect();
    const boxesOverlap = (a, b) => (
      a.right > b.left + 0.5
      && a.left < b.right - 0.5
      && a.bottom > b.top + 0.5
      && a.top < b.bottom - 0.5
    );
    const stacked = pr.bottom <= ar.top + 1;
    if (stacked) {
      const innBox = inn ? inn.getBoundingClientRect() : null;
      const innMid = innBox ? innBox.top + innBox.height / 2 : null;
      const asmMid = ar.top + ar.height / 2;
      return {
        ok: true,
        stacked: true,
        gap: Math.round((ar.top - pr.bottom) * 10) / 10,
        overlap: boxesOverlap(pr, ar),
        innSameLine: innMid != null && Math.abs(innMid - asmMid) <= 2,
      };
    }
    const gap = ar.left - pr.right;
    return {
      ok: true,
      stacked: false,
      gap: Math.round(gap * 10) / 10,
      overlap: boxesOverlap(pr, ar),
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
  await page.waitForFunction((name) => {
    const text = document.querySelector('[data-viewer-title]')?.getAttribute('data-viewer-title-text') || '';
    return text.includes(name);
  }, ASM, { timeout: 25000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    return !!(canvas && canvas.clientWidth > 0 && (globalThis.__VIEWPORT__?.stageVerifyFraming?.().tris || 0) > 10);
  }, null, { timeout: 45000 });
  return { context, page };
}

async function tapPartInViewport(page) {
  const point = await page.evaluate(() => {
    const p = globalThis.__VIEWPORT__.stageProject([0, 0, 0]);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas) return { ok: false };
    return { ok: true, x: p.x, y: p.y };
  });
  if (!point.ok) return point;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(400);
  return point;
}

async function runView(browser, vp) {
  const { context, page } = await boot(browser, vp);
  await tapPartInViewport(page);
  await page.waitForSelector('[data-title-role="part"]', { timeout: 8000 });
  const gap0 = await chipGap(page);
  console.log(`  ${vp.name} gap ${JSON.stringify(gap0)}`);
  check(`${vp.name} part and assembly chips do not overlap`, gap0.ok && !gap0.overlap, JSON.stringify(gap0));
  if (gap0.stacked) {
    check(`${vp.name} title stacks with in on the assembly line`, gap0.innSameLine === true, JSON.stringify(gap0));
  } else {
    check(`${vp.name} chip gap is at least 8px`, gap0.ok && gap0.gap >= 8, String(gap0.gap));
  }

  await page.click('[data-title-role="part"]');
  await page.waitForTimeout(250);
  const partBody = await page.evaluate(() => globalThis.__VIEWPORT__?.cadBodySticky?.() === true);
  check(`${vp.name} part chip tap selects all bodies`, partBody === true);

  await page.dblclick('[data-title-role="part"]');
  await page.waitForSelector('[data-title-chip="input"]', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-title-chip="input"]'), null, { timeout: 5000 });

  await page.evaluate(() => {
    document.querySelector('[data-title-role="assembly"]')?.click();
  });
  await page.waitForTimeout(300);
  const asmMode = await page.evaluate(() => ({
    partChip: !!document.querySelector('[data-title-role="part"]'),
    input: !!document.querySelector('[data-title-chip="input"]'),
    joints: (document.querySelector('[data-assembly-joints]')?.textContent || '').replace(/\s+/g, ' ').trim(),
    sticky: globalThis.__VIEWPORT__?.cadBodySticky?.() === true,
    title: document.querySelector('[data-viewer-title]')?.getAttribute('data-viewer-title-text') || '',
  }));
  console.log(`  ${vp.name} assembly tap ${JSON.stringify(asmMode)}`);
  check(`${vp.name} assembly tap hides the part pill`, asmMode.partChip === false, JSON.stringify(asmMode));
  check(`${vp.name} assembly tap does not open rename`, asmMode.input === false);
  check(`${vp.name} assembly tap keeps body selection`, asmMode.sticky === true);
  check(`${vp.name} title is assembly only`, asmMode.title === ASM, asmMode.title);
  check(`${vp.name} joints strip is visible`, /assembly joints/i.test(asmMode.joints), asmMode.joints);

  const shot = join(SHOT_DIR, `viewer-title-chips-${vp.name}.png`);
  await page.screenshot({ path: shot });
  check(`${vp.name} shot saved`, existsSync(shot), shot);

  await context.close();
}

let browser;
try {
  if (!await waitForServer()) {
    check('dev server started', false, APP_URL);
    process.exit(1);
  }
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
  check('viewer title actions ran', false, String(err?.message || err));
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.log(`\nviewer title chip actions: ${failed} failed`);
  process.exit(1);
}
console.log('\nviewer title chip actions: ok');
