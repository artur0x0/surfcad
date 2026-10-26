#!/usr/bin/env node
/**
 * A joint chip reopens that joint in the card.
 *
 * Create an angle joint with Parallel, close the card, tap the chip.
 * The card comes back with type angle, value 0, the two faces
 * highlighted, a red Delete, and Confirm. There is no Add button.
 * X discards a changed angle. Confirm saves a new distance and closes.
 * Delete removes the joint.
 *
 * 390 and 1280. Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, indexedDB, localStorage, sessionStorage, Event, HTMLInputElement */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5247);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const ASM = 'JointsReopen';
const SURF_A = '2026-10-10-16-10-00-0001-a1b2';
const SURF_B = '2026-10-10-16-10-00-0002-c3d4';
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
      position: [80, 0, 20],
      placement: { t: [80, 0, 20], q: [0, 0, 0, 1] },
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

console.log('joints reopen');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);
{
  const card = read('src/components/JointCard.jsx');
  const app = read('src/App.jsx');
  check('edit mode is not thrown away',
    !card.includes("card.mode === 'edit') return null") && card.includes('data-joint-delete')
    && card.includes('border-red-700/60') && card.includes("editing ? 'Confirm' : 'Add'"));
  check('a chip tap builds the edit card', app.includes('cardFromJoint(joint, doc)') && app.includes('handleSelectJoint'));
  check('edit Confirm saves and create Add stays open', app.includes("resetPicks: card.mode !== 'edit'"));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('joints reopen: no system Chrome — set CHROME_PATH');
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
    const framed = globalThis.__VIEWPORT__?.stageVisibleFraming?.();
    return !!(framed && framed.parts && framed.parts.length >= 2);
  }, null, { timeout: 60000 });
  await page.evaluate(() => globalThis.__VIEWPORT__?.stageFit?.({ az: 35, el: 24, margin: 1.6, assembly: true }));
  await page.waitForTimeout(300);
  return { context, page, errors };
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
      angle: card?.querySelector('[data-joint-angle]')?.value || '',
      value: card?.querySelector('[data-joint-value]')?.value || '',
      name: card?.querySelector('[data-joint-name]')?.value || '',
      apply: (card?.querySelector('[data-feature-card-confirm]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      del: !!card?.querySelector('[data-joint-delete]'),
      delClass: card?.querySelector('[data-joint-delete]')?.className || '',
      close: !!document.querySelector('[data-joint-card] [data-feature-card-cancel], [data-feature-card-cancel]'),
      highlights: globalThis.__VIEWPORT__?.jointHighlightCount?.() ?? -1,
    };
  });
}

async function clickCanvas(page, world) {
  const point = await page.evaluate((w) => {
    const p = globalThis.__VIEWPORT__?.stageProject?.(w);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas) return { ok: false };
    const el = document.elementFromPoint(p.x, p.y);
    return { ok: el === canvas, x: p.x, y: p.y };
  }, world);
  if (!point.ok) return point;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);
  return point;
}

async function pickUntil(page, worlds, pred) {
  let last = await cardState(page);
  for (const world of worlds) {
    const click = await clickCanvas(page, world);
    last = await cardState(page);
    if (pred(last)) return { ok: true, state: last, click };
  }
  return { ok: false, state: last };
}

async function clickSel(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
}

async function setField(page, selector, value) {
  return page.evaluate(({ sel, value: next }) => {
    const nodes = [...document.querySelectorAll(sel)];
    const input = nodes.find((el) => el instanceof HTMLInputElement);
    if (!input) {
      return { ok: false, tags: nodes.map((el) => el.tagName).slice(0, 6) };
    }
    const tracker = input._valueTracker;
    const prev = input.value;
    input.value = String(next);
    if (tracker) tracker.setValue(String(prev));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, value: input.value };
  }, { sel: selector, value });
}

async function chipRows(page) {
  return page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll('[data-assembly-joints] [data-joint-id]')) {
      const id = el.getAttribute('data-joint-id');
      if (!id || seen.has(id)) continue;
      seen.set(id, {
        id,
        type: el.getAttribute('data-joint-type') || '',
        status: el.getAttribute('data-joint-status') || '',
        value: el.getAttribute('data-joint-value'),
        name: el.getAttribute('data-joint-name') || '',
      });
    }
    return [...seen.values()];
  });
}

const SHAFT_TOP = [[0, 0, 15], [4, 0, 15], [0, 4, 15], [-4, 2, 15]];
const HOUSING_TOP = [[80, 0, 35], [84, 0, 35], [80, 4, 35], [76, 2, 35]];

async function runView(browser, vp) {
  const { context, page, errors } = await boot(browser, vp);
  await page.locator('[data-joints-button]').click();
  await page.waitForSelector('[data-joint-card]', { timeout: 8000 });

  const shaft = await pickUntil(page, SHAFT_TOP, (state) => state.n >= 1 && state.subtitle.includes('Shaft'));
  const housing = await pickUntil(page, HOUSING_TOP, (state) => state.n >= 2 && state.subtitle.includes('Housing'));
  await clickSel(page, '[data-joint-parallel]');
  await page.waitForTimeout(500);
  const written = (await chipRows(page)).find((row) => row.type === 'angle' && row.value === '0');
  console.log(`  ${vp.name} wrote ${JSON.stringify({ shaft: shaft.state, housing: housing.state, written })}`);
  check(`${vp.name} Parallel writes an angle joint at 0`,
    shaft.ok && housing.ok && !!written && written.status === 'ok',
    JSON.stringify(written));

  await clickSel(page, '[data-feature-card-cancel]');
  await page.waitForTimeout(300);
  const closed = await cardState(page);
  check(`${vp.name} X closes the card and the chip stays`,
    !closed.open && (await chipRows(page)).some((row) => row.id === written?.id),
    JSON.stringify(closed));

  await clickSel(page, `[data-assembly-joints] [data-joint-id="${written?.id || ''}"]`);
  await page.waitForTimeout(400);
  const reopened = await cardState(page);
  const red = reopened.delClass.includes('border-red-700/60')
    && reopened.delClass.includes('bg-red-950/50')
    && reopened.delClass.includes('text-red-200');
  console.log(`  ${vp.name} reopened ${JSON.stringify(reopened)}`);
  check(`${vp.name} the chip reopens that joint`,
    reopened.open && reopened.type === 'angle' && reopened.angle === '0'
      && reopened.del && red && reopened.apply === 'Confirm'
      && reopened.n === 2 && reopened.highlights === 2
      && reopened.subtitle.includes('Shaft') && reopened.subtitle.includes('Housing'),
    JSON.stringify(reopened));

  const storedName = reopened.name;
  await setField(page, '[data-joint-angle]', '15');
  await setField(page, '[data-joint-name]', 'Tilted');
  await page.waitForTimeout(100);
  await clickSel(page, '[data-feature-card-cancel]');
  await page.waitForTimeout(300);
  const discarded = await chipRows(page);
  const discardedChip = discarded.find((row) => row.id === written?.id);
  const afterDiscard = await cardState(page);
  check(`${vp.name} X discards a changed value`,
    !afterDiscard.open && discardedChip?.value === '0' && discardedChip?.name === storedName,
    JSON.stringify({ discardedChip, storedName, afterDiscard }));

  await clickSel(page, `[data-assembly-joints] [data-joint-id="${written?.id || ''}"]`);
  await page.waitForTimeout(400);
  const still = await cardState(page);
  check(`${vp.name} the discarded edit is not stored`,
    still.open && still.angle === '0' && still.name === storedName && still.apply === 'Confirm',
    JSON.stringify(still));

  await clickSel(page, '[data-sticky-property="distance"]');
  await page.waitForTimeout(200);
  const typed = await setField(page, '[data-joint-value]', '40');
  await page.waitForTimeout(100);
  await clickSel(page, '[data-feature-card-confirm]');
  await page.waitForTimeout(500);
  const savedRows = await chipRows(page);
  const savedChip = savedRows.find((row) => row.id === written?.id);
  const afterSave = await cardState(page);
  console.log(`  ${vp.name} saved ${JSON.stringify({ typed, savedChip, afterSave })}`);
  check(`${vp.name} Confirm saves a changed value`,
    typed?.ok && !afterSave.open && savedChip?.type === 'distance',
    JSON.stringify({ typed, savedChip, afterSave }));

  await clickSel(page, `[data-assembly-joints] [data-joint-id="${written?.id || ''}"]`);
  await page.waitForTimeout(400);
  const savedCard = await cardState(page);
  check(`${vp.name} the reopened card shows the saved value`,
    savedCard.open && savedCard.type === 'distance' && savedCard.value === '40' && savedCard.apply === 'Confirm',
    JSON.stringify(savedCard));

  await clickSel(page, '[data-joint-delete]');
  await page.waitForTimeout(400);
  const gone = await chipRows(page);
  const after = await cardState(page);
  check(`${vp.name} Delete removes the joint`,
    gone.length === 0 && !after.open,
    JSON.stringify({ gone, after }));

  const shot = join(SHOT_DIR, `joints-reopen-${vp.name}.png`);
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
  failed += 1;
  console.log(`  ❌ joints reopen crashed — ${err?.stack || err}`);
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.error(`\n${failed} joints-reopen check(s) failed`);
  process.exit(1);
}
console.log('\njoints reopen golden passed');
