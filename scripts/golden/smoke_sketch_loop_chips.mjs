#!/usr/bin/env node
/**
 * A second shape in a sketch is one more chip, not a pile of relationships.
 *
 * Rect on the rail, then Rect again (the inset loop), then Circle. Before
 * this golden the strip showed 22 interleaved rows after the second
 * rectangle (Line ×8, Length ×4, Horizontal ×4, Vertical ×4, Fix ×2) and
 * the canvas drew every builder constraint as a tag between the two.
 *
 * Checks: one Rectangle chip after the first click; Rectangle 1 and
 * Rectangle 2 after the second, with no dimensions (a second shape arrives
 * as free and undimensioned as the first); Circle joins after the circle;
 * no constraint or dimension tags on the canvas; the inner rectangle's
 * chip lights on tap; its Delete removes that rectangle only.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4341);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'sketch-loop-chips',
  activeId: 'local:part1',
  source: 'git',
  parts: [{ id: 'local:part1', name: 'Plate', visible: true }],
  joints: [],
};
const SCRIPT = '// --- cube begin id=cube1 ---\nlet box1 = Manifold.cube([60, 40, 10], true);\nlet part = box1;\n// --- cube end id=cube1 ---\nreturn part;\n';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('sketch loop chips: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}
if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('  ❌ dist/ missing — run npm run build');
  process.exit(1);
}
mkdirSync(SHOT_DIR, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ }
  try { server.kill('SIGKILL'); } catch { /* */ }
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

async function waitForServer(timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return true;
    } catch { /* */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function seedAssembly(page) {
  await page.evaluate(async ({ doc, script }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-sketch-loop-chips': { name: doc.name, activeId: doc.activeId, source: 'git', savedAt: Date.now() },
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
        tx.objectStore('parts').put({ id: 'local:part1', script, savedAt: Date.now() }, 'local:part1');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: ASSEMBLY, script: SCRIPT });
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), { name, argsJson: JSON.stringify(args ?? {}) });
}

const readChips = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-sketch-entities] [data-sketch-id]')).map((el) => ({
  id: el.getAttribute('data-sketch-id'),
  kind: el.getAttribute('data-sketch-kind'),
  label: el.getAttribute('aria-label'),
  title: el.getAttribute('title'),
  pressed: el.getAttribute('aria-pressed') === 'true',
})));

const readTags = (page) => page.evaluate(() => ({
  icons: Array.from(document.querySelectorAll('[data-contour-icon]')).map((el) => el.getAttribute('data-contour-icon')),
  dims: Array.from(document.querySelectorAll('[data-contour-tag]:not([data-contour-icon])')).map((el) => el.getAttribute('data-contour-tag')),
}));

console.log('sketch loop chips golden');
if (!(await waitForServer())) {
  console.log('  ❌ preview server did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});
attachConsentPresetToBrowser(browser);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));
await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-sketch-loop-chips', email: 'loops@test.local' } }),
}));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await seedAssembly(page);
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });
await page.keyboard.press('Escape');
await agentCall(page, 'set_active_part', { part_id: 'part1' });
await page.waitForTimeout(800);

const began = await agentCall(page, 'sketch_begin', { entry: 'crossSection', plane: 'z', accept_plane: true });
check('sketch_begin on the Z plane', began?.ok === true, JSON.stringify(began));
await page.waitForSelector('[data-contour-tool="rectangle"]', { timeout: 15000 });

await page.locator('[data-contour-tool="rectangle"]').click({ force: true });
await page.waitForFunction(() => document.querySelectorAll('[data-sketch-entities] [data-sketch-id]').length === 1, null, { timeout: 10000 }).catch(() => {});
const one = await readChips(page);
check('one rectangle is one chip', one.length === 1 && one[0].id === 'shape' && one[0].label === 'Rectangle', JSON.stringify(one));

await page.locator('[data-contour-tool="rectangle"]').click({ force: true });
await page.waitForFunction(() => document.querySelectorAll('[data-sketch-entities] [data-sketch-id]').length === 2, null, { timeout: 10000 }).catch(() => {});
const two = await readChips(page);
check('two rectangles are two shape chips and nothing else, in loop order',
  JSON.stringify(two.map((chip) => chip.label)) === JSON.stringify(['Rectangle', 'Rectangle'])
  && two[0].id === 'loop:1' && two[1].id === 'loop:2'
  && two[0].kind === 'rectangle' && two[1].kind === 'rectangle',
  JSON.stringify(two));
check('no Line, Length, Horizontal, Vertical or Fix chips', !two.some((chip) => /Line|Length|Horizontal|Vertical|Fix/.test(chip.label || '')), JSON.stringify(two));
await page.waitForTimeout(400);
const tagsTwo = await readTags(page);
check('the canvas shows no constraint tags', tagsTwo.icons.length === 0, JSON.stringify(tagsTwo.icons));
check('the canvas shows no dimension tags: nothing was dimensioned', tagsTwo.dims.length === 0, JSON.stringify(tagsTwo.dims));
const entitiesTwo = await agentCall(page, 'list_sketch_entities', {});
check('the sketch has no dimensions and no fix', (entitiesTwo?.result?.dimensions || []).length === 0
  && !(entitiesTwo?.result?.constraints || []).some((con) => con.kind === 'fix'),
  JSON.stringify({ dims: entitiesTwo?.result?.dimensions, cons: (entitiesTwo?.result?.constraints || []).map((c) => c.kind) }));
await page.screenshot({ path: `${SHOT_DIR}/sketch-loop-chips-two-1280.png` });

await page.locator('[data-contour-tool="circle"]').click({ force: true });
await page.waitForFunction(() => document.querySelectorAll('[data-sketch-entities] [data-sketch-id]').length === 3, null, { timeout: 10000 }).catch(() => {});
const three = await readChips(page);
check('a circle adds one Circle chip and no Radius',
  JSON.stringify(three.map((chip) => chip.label)) === JSON.stringify(['Rectangle', 'Rectangle', 'Circle'])
  && three[2].id === 'loop:3' && three[2].kind === 'circle',
  JSON.stringify(three));
check('still no constraint or dimension tags', (await readTags(page)).icons.length === 0 && (await readTags(page)).dims.length === 0);
await page.screenshot({ path: `${SHOT_DIR}/sketch-loop-chips-three-1280.png` });

// Tap the inner rectangle's chip: it is pressed, and its Delete card drops only that loop.
await page.locator('[data-sketch-entities] [data-sketch-id="loop:2"]').click({ force: true });
await page.waitForTimeout(400);
const pressed = await readChips(page);
check('the inner rectangle chip is pressed after a tap', pressed.find((chip) => chip.id === 'loop:2')?.pressed === true, JSON.stringify(pressed));
const card = await page.locator('[data-contour-card="entity"]').count();
check('its short card opens', card === 1, String(card));
await page.locator('[data-contour-entity-delete]').click({ force: true });
await page.waitForFunction(() => document.querySelectorAll('[data-sketch-entities] [data-sketch-id]').length === 2, null, { timeout: 10000 }).catch(() => {});
const after = await readChips(page);
check('Delete on the loop chip removes that rectangle only',
  JSON.stringify(after.map((chip) => chip.label)) === JSON.stringify(['Rectangle', 'Circle']),
  JSON.stringify(after));
const entities = await agentCall(page, 'list_sketch_entities', {});
const lines = entities?.result?.lines || [];
check('the sketch keeps the outer rectangle and the circle', lines.length === 4 && (entities?.result?.arcs || []).length === 1, JSON.stringify({ lines: lines.length, arcs: (entities?.result?.arcs || []).length }));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`\nsketch loop chips golden: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nsketch loop chips golden: ok');
process.exit(0);
