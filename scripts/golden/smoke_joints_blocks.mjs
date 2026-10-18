#!/usr/bin/env node
/**
 * Joints opens from the Blocks button at the end of Move.
 * A tap with nothing selected selects the part and does not open the card.
 * The feature strip stays on assembly joints while nothing is selected.
 *
 * 390 and 1280. Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, indexedDB, localStorage, sessionStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { cadStripsShowJoints, shouldArmJointPick } from '../../src/joints/jointUi.js';

const PORT = Number(process.env.SMOKE_PORT || 5239);
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

console.log('joints blocks button');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);
check('a closed card does not arm a joint', shouldArmJointPick({ cadPartId: null, kind: 'face' }) === false);
check('an open card arms a face tap', shouldArmJointPick({ jointPicking: true, kind: 'face' }) === true);
check('the joints strip still follows an empty selection', cadStripsShowJoints(null) === true && cadStripsShowJoints('bracket') === false);

{
  const palette = read('src/components/HelperInsertPalette.jsx');
  const move = palette.slice(palette.indexOf("section.section === 'transforms'"));
  check('Blocks is the last control added to Move',
    move.includes('data-joints-button') && move.includes('<Blocks')
    && move.indexOf('data-joints-button') < move.indexOf('</button>'));
  const app = read('src/App.jsx');
  check('the create card opens from Blocks and picking follows that card',
    app.includes('handleOpenJoints') && app.includes('jointPicking={jointCreateOpen}')
    && app.includes('onOpenJoints={handleOpenJoints}'));
  const arch = read('docs/architecture.md');
  const map = read('docs/ui-map.md');
  check('architecture and UI map name the Blocks button',
    /golden:joints-blocks/.test(arch) && /data-joints-button/.test(arch) && /data-joints-button/.test(map));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('joints blocks: no system Chrome — set CHROME_PATH');
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

async function moveButton(page) {
  return page.evaluate(() => {
    const section = document.querySelector('[data-palette-section="transforms"]');
    if (!section) return { ok: false, reason: 'no move section' };
    const label = [...section.querySelectorAll(':scope > div')]
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .find((text) => text) || '';
    const buttons = [...section.querySelectorAll(':scope > button')];
    const last = buttons[buttons.length - 1];
    return {
      ok: true,
      label,
      count: buttons.length,
      lastJoints: last?.getAttribute('data-joints-button') || '',
      lastLabel: last?.getAttribute('aria-label') || '',
      earlierJoints: buttons.slice(0, -1).some((btn) => btn.hasAttribute('data-joints-button')),
    };
  });
}

async function chromeState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-viewer-title]');
    const part = document.querySelector('[data-title-role="part"]');
    const strip = document.querySelector('[data-assembly-joints]');
    const card = document.querySelector('[data-joint-card]');
    return {
      text: root?.getAttribute('data-viewer-title-text') || '',
      part: (part?.textContent || '').trim(),
      joints: (strip?.textContent || '').replace(/\s+/g, ' ').trim(),
      card: !!card,
      sticky: !!card?.hasAttribute('data-sticky-pick-apply') || !!document.querySelector('[data-joint-card][data-sticky-pick-apply], [data-joint-card] [data-sticky-pick-apply]'),
      title: (card?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
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
  await page.waitForSelector('[data-joints-button]', { state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    return !!(canvas && canvas.clientWidth > 0 && (globalThis.__VIEWPORT__?.stageVerifyFraming?.().tris || 0) > 10);
  }, null, { timeout: 45000 });
  return { context, page, errors };
}

async function tapPart(page) {
  const point = await page.evaluate(() => {
    const p = globalThis.__VIEWPORT__.stageProject([0, 0, 0]);
    const canvas = document.querySelector('.viewport-shell > canvas');
    if (!p || !canvas) return { ok: false };
    const el = document.elementFromPoint(p.x, p.y);
    return { ok: el === canvas, x: p.x, y: p.y, tag: el ? el.tagName : '' };
  });
  if (!point.ok) return point;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);
  return point;
}

async function runView(browser, vp) {
  const { context, page, errors } = await boot(browser, vp);
  const rail = await moveButton(page);
  console.log(`  ${vp.name} rail ${JSON.stringify(rail)}`);
  check(`${vp.name} Move section is labeled Move`, rail.label === 'Move', rail.label || rail.reason);
  check(`${vp.name} Blocks is the last Move button`, rail.lastJoints === '1' && rail.lastLabel === 'Joints' && rail.earlierJoints === false, JSON.stringify(rail));

  const idle = await chromeState(page);
  console.log(`  ${vp.name} idle ${JSON.stringify(idle)}`);
  check(`${vp.name} nothing selected keeps the joints strip`, /No assembly joints/.test(idle.joints) && idle.part === '' && idle.text === ASM, JSON.stringify(idle));
  check(`${vp.name} the joint card starts closed`, idle.card === false);

  await page.locator('[data-joints-button]').click();
  await page.waitForSelector('[data-joint-card]', { timeout: 8000 });
  const opened = await chromeState(page);
  console.log(`  ${vp.name} opened ${JSON.stringify(opened)}`);
  check(`${vp.name} Blocks opens the Joints card`, opened.card && opened.sticky && /Joint/.test(opened.title), JSON.stringify(opened));
  check(`${vp.name} the strip stays on assembly joints`, /No assembly joints/.test(opened.joints) && opened.part === '' && opened.text === ASM, JSON.stringify(opened));
  const shot = join(SHOT_DIR, `joints-blocks-${vp.name}.png`);
  await page.screenshot({ path: shot });
  check(`${vp.name} shot saved outside artifacts`, existsSync(shot) && !shot.startsWith('/opt/cursor/artifacts'), shot);

  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForSelector('[data-joint-card]', { state: 'detached', timeout: 8000 });
  const point = await tapPart(page);
  console.log(`  ${vp.name} tap ${JSON.stringify(point)}`);
  check(`${vp.name} the part tap hits the canvas`, point.ok === true, JSON.stringify(point));
  await page.waitForFunction(() => {
    const part = (document.querySelector('[data-title-role="part"]')?.textContent || '').trim();
    return part === 'Bracket';
  }, null, { timeout: 8000 }).catch(() => {});
  const selected = await chromeState(page);
  console.log(`  ${vp.name} selected ${JSON.stringify(selected)}`);
  check(`${vp.name} tapping the part selects it`, selected.part === 'Bracket' && selected.text.includes('Bracket'), JSON.stringify(selected));
  check(`${vp.name} that tap does not open the joint card`, selected.card === false, JSON.stringify(selected));
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
  check('joints blocks browser pass', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.error(`\n${failed} joints-blocks check(s) failed`);
  process.exit(1);
}
console.log('\njoints blocks golden passed');
