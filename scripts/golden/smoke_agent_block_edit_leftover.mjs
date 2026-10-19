#!/usr/bin/env node
/**
 * Pi 5 acceptance B2: after a block feature is edited through the agent and
 * the part is hidden, nothing from the edit card (block preview skin and
 * outline) or the hidden part stays in the scene.
 *
 * Runs the app on the Vite dev server so the dev-only `__VIEWPORT__` hook can
 * list the scene. Chrome from CHROME_PATH or the usual system paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4341);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const VERBOSE = process.env.SMOKE_VERBOSE === '1';

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
  console.log('agent block edit leftover golden: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--logLevel', 'error'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), {
    name,
    argsJson: JSON.stringify(args ?? {}),
  });
}

async function inventory(page, label) {
  const inv = await page.evaluate(() => window.__VIEWPORT__?.sceneInventory?.() ?? null);
  if (VERBOSE) console.log(`  · ${label}:`, JSON.stringify(inv));
  return inv;
}

/** Lines and meshes that are not the solid itself and not the viewport furniture. */
function strayObjects(inv) {
  const furniture = /^(grid|axes|axis|ground|light|camera|helper|triad|gizmo|assembly-parts)$/i;
  return (inv?.objects || []).filter((o) => !o.isResult && !furniture.test(o.name) && o.parent !== 'assembly-parts' && o.vertices > 0);
}

console.log('agent block edit leftover golden');
if (!(await waitForServer())) {
  console.log('  ❌ dev server did not start');
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
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-block-leftover', email: 'agent@test.local' } }),
}));
await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]') && !!window.__VIEWPORT__,
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });

const created = await agentCall(page, 'create_assembly', {});
check('create_assembly', created.ok === true, JSON.stringify(created));
const parts0 = await agentCall(page, 'parts', {});
const lidId = parts0.result?.activeId;
check('active part id', typeof lidId === 'string' && lidId.length > 0, JSON.stringify(parts0));

const seeded = await agentCall(page, 'set_script', {
  part_id: lidId,
  source: '',
});
check('blank part', seeded.ok === true, JSON.stringify(seeded));
const cube = await agentCall(page, 'insert_cube', { width: 20, depth: 20, height: 20, center: true });
check('insert 20 mm seed cube', cube.ok === true && cube.result?.ok === true, JSON.stringify(cube));
const baseline = await inventory(page, 'after insert');
const baselineStray = strayObjects(baseline).length;

const tree = await agentCall(page, 'feature_tree', {});
const chip = (tree.result?.features || []).find((f) => f.kind === 'cube');
check('cube chip', !!chip, JSON.stringify(tree));

// Variant 0: open the card, then cancel. The card and its preview go.
const open0 = await agentCall(page, 'open_feature', { id: chip.id });
check('open_feature cube (cancel variant)', open0.ok === true, JSON.stringify(open0));
await page.waitForFunction(() => window.__VIEWPORT__.sceneInventory().blockPreview === true, null, { timeout: 15000 });
const cancel0 = await agentCall(page, 'cancel_feature', {});
check('cancel_feature', cancel0.ok === true, JSON.stringify(cancel0));
await page.waitForTimeout(400);
const afterCancel = await inventory(page, 'after cancel');
check('cancel closes the card', !(await page.$('#helper-param-title')));
check('no block preview after cancel', afterCancel?.blockPreview === false && afterCancel?.dataBlockPreview == null, JSON.stringify(afterCancel));

// Variant A: open the cube card, shrink it on the card, confirm.
const open = await agentCall(page, 'open_feature', { id: chip.id });
check('open_feature cube', open.ok === true, JSON.stringify(open));
await page.waitForFunction(() => window.__VIEWPORT__.sceneInventory().blockPreview === true, null, { timeout: 15000 });
const whileOpen = await inventory(page, 'card open');
check('block preview is up while the card is open', whileOpen?.blockPreview === true && whileOpen?.dataBlockPreview === 'add', JSON.stringify(whileOpen));
const edited = await agentCall(page, 'edit_feature', { params: { width: 5, depth: 5, height: 5 } });
check('edit_feature shrink', edited.ok === true, JSON.stringify(edited));
// The card's preview follows the edit: the skin is the 5 mm cube, not the 20 mm seed.
await page.waitForFunction(() => {
  const inv = window.__VIEWPORT__.sceneInventory();
  return inv.blockPreview === true && window.__VIEWPORT__.blockPreviewSize?.() != null && Math.abs(window.__VIEWPORT__.blockPreviewSize() - 5) < 1e-3;
}, null, { timeout: 15000 }).catch(() => {});
const previewSize = await page.evaluate(() => window.__VIEWPORT__.blockPreviewSize?.());
check('preview follows edit_feature (5 mm)', previewSize != null && Math.abs(previewSize - 5) < 1e-3, JSON.stringify(previewSize));
const confirmed = await agentCall(page, 'confirm_feature', {});
check('confirm_feature', confirmed.ok === true && confirmed.result?.ok === true, JSON.stringify(confirmed));
await page.waitForTimeout(600);
const afterConfirm = await inventory(page, 'after confirm');
check('no block preview after confirm', afterConfirm?.blockPreview === false && afterConfirm?.dataBlockPreview == null, JSON.stringify(afterConfirm));
check('no stray overlay after confirm', strayObjects(afterConfirm).length <= baselineStray, JSON.stringify(strayObjects(afterConfirm)));
const st = await agentCall(page, 'status', {});
check('status shows the 5 mm cube', Math.abs((st.result?.volume ?? 0) - 125) < 1e-6, JSON.stringify(st.result?.volume));

// Variant B: open the card, then shrink the script directly (the card stays open).
const open2 = await agentCall(page, 'open_feature', { id: chip.id });
check('open_feature cube again', open2.ok === true, JSON.stringify(open2));
await page.waitForFunction(() => window.__VIEWPORT__.sceneInventory().blockPreview === true, null, { timeout: 15000 });
const src = await agentCall(page, 'get_script', {});
const shrunk = String(src.result?.source || '').replace('[5, 5, 5]', '[2, 2, 2]');
const wrote = await agentCall(page, 'set_script', { part_id: lidId, source: shrunk });
check('set_script shrinks under the open card', wrote.ok === true && wrote.result?.ok === true, JSON.stringify(wrote));
await page.waitForTimeout(600);
const afterScript = await inventory(page, 'after set_script with the card open');
check('set_script closes the stale card preview', afterScript?.blockPreview === false, JSON.stringify(afterScript));

// Hide the part: nothing of it or its card may stay.
const hidden = await agentCall(page, 'set_part_visible', { part_id: lidId, visible: false });
check('set_part_visible false', hidden.ok === true, JSON.stringify(hidden));
await page.waitForTimeout(600);
const afterHide = await inventory(page, 'after hide');
const strayAfterHide = strayObjects(afterHide);
check('nothing is left in the scene after the part is hidden', strayAfterHide.length === 0 && afterHide?.blockPreview === false, JSON.stringify(afterHide));
check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`agent block edit leftover golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('agent block edit leftover golden: ok');
