#!/usr/bin/env node
/**
 * Narrow CAD header: a long part name and a long assembly name stack
 * (part, then "in <assembly>") at 320, 390, and 430, truncate with an
 * ellipsis, and stay clear of the wordmark, the beta tag, and the profile
 * chip. At 1280 the same names stay on one row. golden:viewer-title-narrow
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, getComputedStyle, indexedDB, localStorage, sessionStorage, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5302);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PART = 'Testing Long Part Name That Keeps Going Past The Header';
const ASM = 'Metallll Assembly Name That Keeps Going Past The Header';
const NARROW = [320, 390, 430];
const DOC = {
  version: 1,
  source: 'git',
  name: ASM,
  activeId: 'bracket',
  parts: [{ id: 'bracket', name: PART, visible: true, order: 0 }],
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

console.log('viewer title narrow');
mkdirSync(SHOT_DIR, { recursive: true });

{
  const view = read('src/components/Viewport.jsx');
  const css = read('src/index.css');
  const map = read('docs/ui-map.md');
  const arch = read('docs/architecture.md');
  check('narrow title uses the shared slot and stacks under 769px',
    /viewer-title-slot/.test(view)
    && /data-viewer-title-line="part"/.test(view)
    && /data-viewer-title-line="assembly"/.test(view)
    && /@media \(min-width: 769px\)/.test(css)
    && /flex-direction: column/.test(css)
    && /text-overflow: ellipsis/.test(css));
  check('docs name golden:viewer-title-narrow',
    /golden:viewer-title-narrow/.test(map) && /golden:viewer-title-narrow/.test(arch));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('viewer title narrow: no system Chrome — set CHROME_PATH');
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

function overlaps(a, b) {
  if (!a || !b || a.width < 1 || b.width < 1 || a.height < 1 || b.height < 1) return false;
  return a.right > b.left + 0.5
    && a.left < b.right - 0.5
    && a.bottom > b.top + 0.5
    && a.top < b.bottom - 0.5;
}

async function readLayout(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    };
    const part = document.querySelector('[data-title-role="part"]');
    const assembly = document.querySelector('[data-title-role="assembly"]');
    const inn = document.querySelector('[data-title-in]');
    const partLine = document.querySelector('[data-viewer-title-line="part"]');
    const asmLine = document.querySelector('[data-viewer-title-line="assembly"]');
    return {
      width: window.innerWidth,
      title: document.querySelector('[data-viewer-title]')?.getAttribute('data-viewer-title-text') || '',
      part: box(part),
      assembly: box(assembly),
      inn: box(inn),
      partLine: box(partLine),
      asmLine: box(asmLine),
      header: box(document.querySelector('[data-viewer-header-row]')),
      beta: box(document.querySelector('[data-brand-beta]')),
      word: box(document.querySelector('[data-brand-wordmark]')),
      tile: box(document.querySelector('[data-brand-mark="paper"]')),
      profile: box(document.querySelector('[data-profile-chip-variant="viewport"]')),
      strip: box(document.querySelector('[data-cad-feature-strip]')),
    };
  });
}

function truncated(node) {
  return !!(node
    && node.textOverflow === 'ellipsis'
    && (node.overflow === 'hidden' || node.overflow === 'clip')
    && node.whiteSpace === 'nowrap'
    && node.scrollWidth > node.clientWidth + 1);
}

function inside(node, width, height) {
  return !!(node
    && node.left >= -0.5
    && node.top >= -0.5
    && node.right <= width + 0.5
    && node.bottom <= height + 0.5
    && node.width > 1
    && node.height > 1);
}

async function selectPart(page, mobile) {
  if (mobile) {
    await page.locator('[data-stage-btn="parts"]').click();
    await page.waitForTimeout(250);
  }
  const row = page.locator('[data-part-row="bracket"]');
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.click({ position: { x: 12, y: 12 } });
  if (mobile) {
    await page.locator('[data-stage-btn="cad"]').click();
    await page.waitForTimeout(250);
  }
  await page.waitForSelector('[data-title-role="part"]', { timeout: 8000 });
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
  await page.waitForFunction((name) => {
    const text = document.querySelector('[data-viewer-title]')?.getAttribute('data-viewer-title-text') || '';
    return text.includes(name);
  }, ASM, { timeout: 25000 });
  return { context, page };
}

function checkClear(label, layout, width, height) {
  const titleBits = [layout.part, layout.assembly, layout.inn].filter(Boolean);
  const chrome = [
    ['beta', layout.beta],
    ['wordmark', layout.word],
    ['logo tile', layout.tile],
    ['avatar', layout.profile],
  ];
  for (const [name, node] of chrome) {
    check(`${label} ${name} stays inside the viewport`, inside(node, width, height), JSON.stringify(node));
  }
  check(`${label} beta sits on the wordmark line`,
    layout.beta && layout.word
    && layout.beta.text === 'beta'
    && Math.abs((layout.beta.top + layout.beta.height / 2) - (layout.word.top + layout.word.height / 2)) <= 2
    && layout.beta.left >= layout.word.right - 1
    && layout.beta.left - layout.word.right <= 16,
    JSON.stringify({ beta: layout.beta, word: layout.word }));
  check(`${label} avatar stays in the top-right corner`,
    layout.profile && layout.profile.right >= width - 24 && layout.profile.left > width * 0.5,
    JSON.stringify(layout.profile));
  check(`${label} wordmark stays at the left of the header`,
    layout.header && layout.tile && layout.word
    && layout.tile.left - layout.header.left <= 8
    && layout.word.left >= layout.tile.right - 1,
    JSON.stringify({ header: layout.header, tile: layout.tile, word: layout.word }));
  for (const bit of titleBits) {
    for (const [name, node] of chrome) {
      check(`${label} title does not overlap ${name}`, !overlaps(bit, node),
        JSON.stringify({ title: bit, [name]: node }));
    }
    check(`${label} title stays inside the viewport`, inside(bit, width, height), JSON.stringify(bit));
  }
  check(`${label} part and assembly pills do not overlap`, !overlaps(layout.part, layout.assembly),
    JSON.stringify({ part: layout.part, assembly: layout.assembly }));
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

  const { context, page } = await boot(browser, { width: 320, height: 720, touch: true });
  await selectPart(page, true);

  for (const width of [...NARROW, 1280]) {
    await page.setViewportSize({ width, height: width >= 769 ? 800 : 720 });
    await page.waitForTimeout(300);
    const layout = await readLayout(page);
    const label = String(width);
    console.log(`  ${label} layout ${JSON.stringify({
      title: layout.title,
      part: layout.part && { w: Math.round(layout.part.width), sw: layout.part.scrollWidth, cw: layout.part.clientWidth, t: layout.part.text.slice(0, 24) },
      assembly: layout.assembly && { w: Math.round(layout.assembly.width), sw: layout.assembly.scrollWidth, cw: layout.assembly.clientWidth },
      inn: layout.inn && layout.inn.text,
      stacked: !!(layout.part && layout.assembly && layout.part.bottom <= layout.assembly.top + 1),
    })}`);
    check(`${label} title text is part in assembly`, layout.title === `${PART} in ${ASM}`, layout.title);
    check(`${label} part pill keeps the full name`, layout.part && layout.part.text === PART, layout.part?.text);
    check(`${label} assembly pill keeps the full name`, layout.assembly && layout.assembly.text === ASM, layout.assembly?.text);
    checkClear(label, layout, width, width >= 769 ? 800 : 720);

    if (NARROW.includes(width)) {
      const partMid = layout.part.top + layout.part.height / 2;
      const asmMid = layout.assembly.top + layout.assembly.height / 2;
      const innMid = layout.inn.top + layout.inn.height / 2;
      check(`${label} part name is the first line`,
        layout.part.bottom <= layout.assembly.top + 1
        && layout.part.bottom <= layout.inn.top + 1
        && partMid < asmMid,
        JSON.stringify({ part: layout.part, inn: layout.inn, assembly: layout.assembly }));
      check(`${label} second line is in plus the assembly name`,
        layout.inn.text === 'in'
        && Math.abs(innMid - asmMid) <= 2
        && layout.inn.right <= layout.assembly.left + 1
        && layout.asmLine
        && layout.inn.left >= layout.asmLine.left - 1
        && layout.assembly.right <= layout.asmLine.right + 1,
        JSON.stringify({ inn: layout.inn, assembly: layout.assembly, line: layout.asmLine }));
      check(`${label} part name truncates with an ellipsis`, truncated(layout.part), JSON.stringify(layout.part));
      check(`${label} assembly name truncates with an ellipsis`, truncated(layout.assembly), JSON.stringify(layout.assembly));
      check(`${label} title does not overlap the feature strip`,
        layout.strip && layout.part.bottom <= layout.strip.top + 0.5 && layout.assembly.bottom <= layout.strip.top + 0.5,
        JSON.stringify({ part: layout.part, assembly: layout.assembly, strip: layout.strip }));
    } else {
      const partMid = layout.part.top + layout.part.height / 2;
      const asmMid = layout.assembly.top + layout.assembly.height / 2;
      const innMid = layout.inn.top + layout.inn.height / 2;
      check(`${label} title stays on one row`,
        Math.abs(partMid - asmMid) <= 2 && Math.abs(innMid - asmMid) <= 2,
        JSON.stringify({ part: layout.part, inn: layout.inn, assembly: layout.assembly }));
      check(`${label} overflowing chip still uses an ellipsis`,
        layout.part.textOverflow === 'ellipsis' && layout.assembly.textOverflow === 'ellipsis',
        JSON.stringify({ part: layout.part?.textOverflow, assembly: layout.assembly?.textOverflow }));
    }

    const shot = join(SHOT_DIR, `viewer-title-narrow-${width}.png`);
    await page.screenshot({
      path: shot,
      clip: { x: 0, y: 0, width, height: 180 },
    });
    check(`${label} shot saved`, existsSync(shot), shot);
  }

  await context.close();
} catch (err) {
  check('viewer title narrow ran', false, String(err?.stack || err));
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.log(`viewer title narrow: ${failed} failed`);
  process.exit(1);
}
console.log('viewer title narrow golden: ok');
