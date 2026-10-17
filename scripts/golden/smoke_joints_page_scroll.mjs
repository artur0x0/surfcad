#!/usr/bin/env node
/**
 * Adding joints must not make the page the scroll container.
 *
 * Two Ground joints are added through the create card. Add leaves the card
 * open. The document stays non-scrollable (scrollHeight <= innerHeight,
 * scrollY 0), including when an in-flow descendant taller than the viewport
 * is added under #root, and again after X drops the inline sheet lock.
 * The left rail still scrolls and a tap on Joints still opens the card.
 *
 * 390 and 1280. Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, indexedDB, localStorage, sessionStorage, window, getComputedStyle */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5241);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const ASM = 'JointsScroll';
const SURF_A = '2026-10-10-14-00-00-0001-a1b2';
const SURF_B = '2026-10-10-14-00-00-0002-c3d4';
const DOC = {
  version: 1,
  source: 'git',
  name: ASM,
  activeId: 'shaft.js',
  parts: [
    { id: 'shaft.js', name: 'Shaft', visible: true, order: 0, surfId: SURF_A, position: [0, 0, 0] },
    {
      id: 'housing.js',
      name: 'Housing',
      visible: true,
      order: 1,
      surfId: SURF_B,
      position: [80, 0, 0],
      placement: { t: [80, 0, 0], q: [0, 0, 0, 1] },
    },
  ],
};
const scriptFor = (id) => `// @surf-id ${id}\nlet part = Manifold.cube([30, 30, 30], true);\nreturn part;\n`;

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

console.log('joints page scroll');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

{
  const css = read('src/index.css');
  const lock = css.slice(css.indexOf('The document is not a scroll container'));
  check('the document lock is overflow hidden on html, body, and #root',
    /html,\s*body,\s*#root\s*\{[^}]*overflow:\s*hidden/s.test(lock)
    && /overscroll-behavior:\s*none/.test(lock));
  const rail = css.slice(css.indexOf('[data-rail-pair="left"]'));
  check('the left rail contains overscroll',
    /overscroll-behavior:\s*contain/.test(rail.slice(0, 400)));
  const hook = read('src/hooks/useModalViewport.js');
  check('a focused sheet pins window scroll back to 0',
    /function pinDocumentScroll/.test(hook)
    && /window\.scrollTo\(0, 0\)/.test(hook)
    && /addEventListener\('scroll', onScroll/.test(hook));
  const arch = read('docs/architecture.md');
  const map = read('docs/UI_MAP.md');
  check('architecture and the UI map name the page-scroll lock',
    /golden:joints-page-scroll/.test(arch)
    && /golden:joints-page-scroll/.test(map)
    && /does not make the page scroll/.test(arch));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('joints page scroll: no system Chrome — set CHROME_PATH');
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
  await page.evaluate(async ({ doc, shaft, housing }) => {
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
        tx.objectStore('parts').put({ id: 'shaft.js', script: shaft, savedAt: Date.now() }, 'shaft.js');
        tx.objectStore('parts').put({ id: 'housing.js', script: housing, savedAt: Date.now() }, 'housing.js');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: DOC, shaft: scriptFor(SURF_A), housing: scriptFor(SURF_B) });
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
  await page.waitForFunction((name) => {
    const text = document.querySelector('[data-viewer-title]')?.getAttribute('data-viewer-title-text') || '';
    return text.includes(name);
  }, ASM, { timeout: 20000 });
  await page.waitForSelector('[data-joints-button]', { state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    const framed = globalThis.__VIEWPORT__?.stageVisibleFraming?.();
    return !!(canvas && canvas.clientWidth > 0 && framed && framed.parts && framed.parts.length >= 2);
  }, null, { timeout: 60000 });
  await page.evaluate(() => globalThis.__VIEWPORT__?.stageZoomToFit?.());
  await page.waitForTimeout(300);
  return { context, page, errors };
}

async function pageMetrics(page) {
  return page.evaluate(() => {
    window.scrollTo(0, 400);
    const root = document.documentElement;
    return {
      scrollHeight: root.scrollHeight,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY || 0,
      overflow: getComputedStyle(root).overflowY,
    };
  });
}

function notScrollable(metrics) {
  return metrics
    && metrics.scrollHeight <= metrics.innerHeight
    && metrics.scrollY === 0;
}

async function cardState(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-joint-card]');
    const picks = card?.querySelector('[data-sticky-picks]');
    return {
      open: !!card,
      n: Number(picks?.getAttribute('data-sticky-picks') || 0),
      subtitle: (card?.querySelector('[data-feature-card-subtitle]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      type: card?.getAttribute('data-joint-type') || '',
      note: (card?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    };
  });
}

async function jointCount(page) {
  return page.evaluate(() => {
    const strips = [...document.querySelectorAll('[data-assembly-joints]')];
    const counts = strips.map((strip) => strip.querySelectorAll('[data-joint-id]').length);
    return { counts, tags: document.querySelectorAll('[data-joint-tag]').length };
  });
}

async function clickCanvas(page, world) {
  const point = await page.evaluate((w) => {
    const p = globalThis.__VIEWPORT__?.stageProject?.(w);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas || p.behind) return { ok: false, reason: 'no project', behind: !!p?.behind };
    const el = document.elementFromPoint(p.x, p.y);
    return {
      ok: el === canvas,
      x: p.x,
      y: p.y,
      tag: el ? el.tagName : '',
    };
  }, world);
  if (!point.ok) return point;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);
  return point;
}

async function pressControl(page, selector) {
  const hit = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.disabled) return { ok: false, reason: el ? 'disabled' : 'missing' };
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      ok: box.width > 2 && box.height > 2,
      x,
      y,
      direct: !!(top && (top === el || el.contains(top))),
    };
  }, selector);
  if (!hit.ok) return hit;
  if (hit.direct) await page.mouse.click(hit.x, hit.y);
  else await page.evaluate((sel) => document.querySelector(sel).click(), selector);
  await page.waitForTimeout(250);
  return hit;
}

async function ensureCard(page) {
  const open = await page.locator('[data-joint-card]').count();
  if (open) return;
  await page.locator('[data-joints-button]').click();
  await page.waitForSelector('[data-joint-card]', { timeout: 8000 });
}

async function addFixedJoint(page, worlds, partName) {
  await ensureCard(page);
  let last = null;
  for (const world of worlds) {
    const state = await cardState(page);
    if (!state.open) await ensureCard(page);
    if ((await cardState(page)).n > 0) {
      await page.evaluate(() => document.querySelector('[data-sticky-pick]')?.click());
      await page.waitForTimeout(200);
    }
    const click = await clickCanvas(page, world);
    last = { click, state: await cardState(page) };
    if (!last.state.open) continue;
    if (last.state.n === 1 && last.state.subtitle.includes(partName)) break;
  }
  const ready = await cardState(page);
  if (!ready.open || ready.n !== 1 || !ready.subtitle.includes(partName)) {
    return { ok: false, reason: 'pick missed', ready, last };
  }
  const ground = await pressControl(page, '[data-joint-ground]');
  await page.waitForFunction(
    () => document.querySelector('[data-joint-card]')?.getAttribute('data-joint-type') === 'fixed',
    null,
    { timeout: 4000 },
  ).catch(() => {});
  const typed = await cardState(page);
  if (typed.type !== 'fixed') return { ok: false, reason: 'ground missed', ground, typed };
  const before = await jointCount(page);
  const beforeMax = Math.max(0, ...(before.counts.length ? before.counts : [0]));
  const confirm = await pressControl(page, '[data-feature-card-confirm]');
  await page.waitForFunction((prev) => {
    const strips = [...document.querySelectorAll('[data-assembly-joints]')];
    const n = Math.max(0, ...strips.map((strip) => strip.querySelectorAll('[data-joint-id]').length), 0);
    return n > prev;
  }, beforeMax, { timeout: 8000 }).catch(() => {});
  const after = await cardState(page);
  const counted = await jointCount(page);
  const afterMax = Math.max(0, ...(counted.counts.length ? counted.counts : [0]));
  return { ok: afterMax > beforeMax, ground, confirm, after, beforeMax, afterMax };
}

async function railStillWorks(page) {
  const measured = await page.evaluate(() => {
    const rail = document.querySelector('[data-rail-pair="left"]');
    const btn = rail?.querySelector('[data-joints-button]');
    if (!rail || !btn) return { ok: false, reason: 'no rail' };
    const room = rail.scrollHeight - rail.clientHeight;
    rail.scrollTop = 0;
    const top = rail.scrollTop;
    rail.scrollTop = room;
    btn.scrollIntoView({ block: 'center', inline: 'nearest' });
    window.scrollTo(0, 500);
    const box = btn.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      ok: true,
      room,
      scrolled: room > 20 && rail.scrollTop > top + 8,
      scrollTop: rail.scrollTop,
      scrollY: window.scrollY || 0,
      x,
      y,
      tap: !!(hit && (hit === btn || btn.contains(hit))),
    };
  });
  return measured;
}

async function runView(browser, vp) {
  const { context, page, errors } = await boot(browser, vp);
  const before = await pageMetrics(page);
  check(`${vp.name} the idle document is not scrollable`, notScrollable(before), JSON.stringify(before));

  const shaft = await addFixedJoint(page, [
    [0, 0, 0], [0, 0, 12], [0, 12, 0], [12, 0, 0],
  ], 'Shaft');
  console.log(`  ${vp.name} shaft ${JSON.stringify(shaft)}`);
  check(`${vp.name} the first joint is added`, shaft.ok === true, JSON.stringify(shaft));
  const one = await jointCount(page);
  check(`${vp.name} the strip shows that joint`, Math.max(0, ...one.counts) >= 1, JSON.stringify(one));
  const mid = await pageMetrics(page);
  check(`${vp.name} one joint does not scroll the page`, notScrollable(mid), JSON.stringify(mid));

  const housing = await addFixedJoint(page, [
    [80, 0, 0], [80, 0, 12], [80, 12, 0], [68, 0, 0], [92, 0, 0],
  ], 'Housing');
  console.log(`  ${vp.name} housing ${JSON.stringify(housing)}`);
  check(`${vp.name} the second joint is added`, housing.ok === true, JSON.stringify(housing));
  const two = await jointCount(page);
  console.log(`  ${vp.name} joints ${JSON.stringify(two)}`);
  check(`${vp.name} two joints are on the strip`, Math.max(0, ...two.counts, 0) >= 2, JSON.stringify(two));

  const laidOut = await pageMetrics(page);
  console.log(`  ${vp.name} layout ${JSON.stringify(laidOut)}`);
  check(`${vp.name} two joints leave the document non-scrollable`, notScrollable(laidOut), JSON.stringify(laidOut));

  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.setAttribute('data-page-scroll-probe', '1');
    probe.style.cssText = 'height:2000px;width:8px;';
    document.getElementById('root').appendChild(probe);
  });
  const grown = await pageMetrics(page);
  console.log(`  ${vp.name} grown ${JSON.stringify(grown)}`);
  check(`${vp.name} in-flow growth still cannot scroll the page`, notScrollable(grown), JSON.stringify(grown));

  const rail = await railStillWorks(page);
  console.log(`  ${vp.name} rail ${JSON.stringify(rail)}`);
  check(`${vp.name} the left rail still scrolls`, rail.scrolled === true && rail.scrollY === 0, JSON.stringify(rail));
  check(`${vp.name} the left rail still receives a tap`, rail.tap === true, JSON.stringify(rail));
  if (rail.tap) {
    await page.mouse.click(rail.x, rail.y);
    await page.waitForSelector('[data-joint-card]', { timeout: 8000 }).catch(() => {});
    const opened = await cardState(page);
    check(`${vp.name} that tap opens the Joints card`, opened.open === true, JSON.stringify(opened));
    if (opened.open) {
      await page.locator('[data-feature-card-cancel]').click();
      await page.waitForSelector('[data-joint-card]', { state: 'detached', timeout: 8000 }).catch(() => {});
    }
  }
  const afterTap = await pageMetrics(page);
  check(`${vp.name} scrollY stays 0 after the rail tap`, notScrollable(afterTap), JSON.stringify(afterTap));

  await page.evaluate(() => document.querySelector('[data-page-scroll-probe]')?.remove());
  const shot = join(SHOT_DIR, `joints-page-scroll-${vp.name}.png`);
  await page.screenshot({ path: shot });
  check(`${vp.name} shot saved outside artifacts`, existsSync(shot) && !shot.startsWith('/opt/cursor/artifacts'), shot);
  check(`${vp.name} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
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
  for (const vp of [
    { name: '390', width: 390, height: 844, touch: true },
    { name: '1280', width: 1280, height: 800, touch: false },
  ]) {
    await runView(browser, vp);
  }
} catch (err) {
  check('joints page scroll browser pass', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.error(`\n${failed} joints-page-scroll check(s) failed`);
  process.exit(1);
}
console.log('\njoints page scroll golden passed');
