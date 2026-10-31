#!/usr/bin/env node
/**
 * Agent bridge: cross-section view, cad_select_all, sketch_delete_entity, profile Local agent.
 */
/* global document, window, indexedDB, localStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { PAIRING_TOKEN_LENGTH } from '../../src/agent/ws/pairingToken.js';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4328);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const ASSEMBLY = {
  format: 'surfcad.assembly',
  v: 1,
  name: 'agent-xsection',
  activeId: 'local:part1',
  source: 'git',
  parts: [{ id: 'local:part1', name: 'Part (1)', visible: true }],
  joints: [],
};

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
  console.log('agent bridge xsection: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('  ❌ dist/ missing — run `npm run build:playtest` first');
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
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
  try { server.kill('SIGKILL'); } catch { /* already gone */ }
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

async function waitForServer(timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function seedAssembly(page) {
  await page.evaluate(async ({ doc }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-agent-xsection': {
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
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: ASSEMBLY });
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), {
    name,
    argsJson: JSON.stringify(args ?? {}),
  });
}

async function shot(page, label, width) {
  await page.setViewportSize({ width, height: Math.round(width * 0.62) });
  const buf = await page.screenshot({ type: 'png' });
  writeFileSync(join(SHOT_DIR, `agent-bridge-xsection-${label}-${width}.png`), buf);
}

async function waitContourReady(page) {
  await page.waitForFunction(
    () => {
      const m = window.surfcad?.call;
      if (typeof m !== 'function') return false;
      return true;
    },
    null,
    { timeout: 30000 },
  );
}

console.log('agent bridge xsection golden');

if (!(await waitForServer())) {
  console.log('  ❌ preview server did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
attachConsentPresetToBrowser(browser);

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    authenticated: true,
    user: { _id: 'user-agent-xsection', email: 'agent@test.local' },
  }),
}));
await page.route('**/api/config', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({}),
}));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await seedAssembly(page);
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });

const cube = await agentCall(page, 'insert_cube', { width: 40, depth: 30, height: 20 });
check('insert_cube', cube.ok === true && cube.result?.ok === true, JSON.stringify(cube));

const ran = await agentCall(page, 'run', {});
check('run cube', ran.ok === true && ran.result?.ok === true, JSON.stringify(ran));
await page.waitForTimeout(600);

const toggled = await agentCall(page, 'cross_section_toggle', { enabled: true });
check('cross_section_toggle on', toggled.ok === true && toggled.result?.enabled === true,
  JSON.stringify(toggled.result));

const expanded = await agentCall(page, 'cross_section_expand', { open: true });
check('cross_section_expand', expanded.ok === true && expanded.result?.optionsOpen === true,
  JSON.stringify(expanded.result));

const plane = await agentCall(page, 'cross_section_plane', { plane: 'XZ' });
check('cross_section_plane XZ', plane.ok === true && plane.result?.plane === 'XZ',
  JSON.stringify(plane.result));

const center = plane.result?.offsetCenter ?? 0;
const offset = await agentCall(page, 'cross_section_offset', { offset: center + 2 });
check('cross_section_offset', offset.ok === true && Math.abs(offset.result?.offset - (center + 2)) < 0.01,
  JSON.stringify(offset.result));

const state = await agentCall(page, 'cross_section_state', {});
check('cross_section_state', state.ok === true && state.result?.enabled === true,
  JSON.stringify(state.result));

await shot(page, 'section', 1280);
await shot(page, 'section', 390);

const selectAll = await agentCall(page, 'cad_select_all', {});
check('cad_select_all', selectAll.ok === true, JSON.stringify(selectAll));

const faces = await agentCall(page, 'list_faces', {});
const topKey = faces.result?.faces?.find((row) => row.key?.n?.[2] > 0.9)?.key
  || faces.result?.faces?.[0]?.key;
await agentCall(page, 'select_faces', { keys: [topKey] });
const began = await agentCall(page, 'sketch_begin', { entry: 'crossSection', accept_plane: true });
check('sketch_begin', began.ok === true, JSON.stringify(began));
await waitContourReady(page);

const drew = await agentCall(page, 'sketch_add', { tool: 'rectangle', width: 20, height: 12 });
check('sketch_add rectangle', drew.ok === true, JSON.stringify(drew));

const entities = await agentCall(page, 'list_sketch_entities', {});
const deleteId = entities.result?.lines?.[0]?.id
  || entities.result?.arcs?.[0]?.id
  || (entities.result?.lines?.length ? null : 'shape');
check('list_sketch_entities id', !!deleteId, JSON.stringify(entities.result));

const deleted = await agentCall(page, 'sketch_delete_entity', { id: deleteId });
check('sketch_delete_entity', deleted.ok === true && deleted.result?.ok === true,
  JSON.stringify(deleted));

const badDelete = await agentCall(page, 'sketch_delete_entity', { id: 'missing-entity' });
check('sketch_delete_entity unknown', badDelete.ok === false && badDelete.error?.code === 'unknown_entity',
  JSON.stringify(badDelete));

await agentCall(page, 'cross_section_expand', { open: false });
await agentCall(page, 'cross_section_toggle', { enabled: false });

await page.locator('[data-profile-chip]').first().click();
await page.click('[data-ui-action="data-agent-bridge-connect"]');
await page.waitForSelector('[data-agent-bridge-waiting-relay]', { state: 'hidden', timeout: 15000 }).catch(() => {});
await page.waitForSelector('[data-agent-bridge-code]', { state: 'visible', timeout: 15000 });
const code = (await page.locator('[data-agent-bridge-code]').innerText()).trim();
check('pairing code length', code.length === PAIRING_TOKEN_LENGTH, code);

await shot(page, 'profile-agent', 1280);
await shot(page, 'profile-agent', 390);

await browser.close();
stop();

if (failed) {
  console.log(`\nagent bridge xsection: ${failed} failed`);
  process.exit(1);
}
console.log('\nagent bridge xsection: all checks passed');
process.exit(0);
