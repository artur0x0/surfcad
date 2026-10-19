#!/usr/bin/env node
/**
 * Side-edge bends. A straight flange side (v+ / v-) can take a bend when the
 * flat blank and the swept fold are both clear. A corner side is dimmed and
 * has no pick handle. A bend that swings through another flange disables
 * Confirm and names that flange.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* The evaluate callbacks run in the browser. */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { Raycaster, Vector3 } from 'three';
import { joinScsCatalog, findScsSku } from '../../src/utils/scs/scsCatalog.js';
import { createSheetSpec, sheetFreeEdges, solveSheet } from '../../src/utils/sheetMetal/sheetModel.js';
import { bendInterference } from '../../src/utils/sheetMetal/sheetInterference.js';
import {
  acceptBaseFlange,
  acceptDraft,
  bendBlockReason,
  cancelDraft,
  enterSheetMetalMode,
  pickSheetPlane,
  sheetTap,
  updateDraft,
} from '../../src/utils/sheetMetal/sheetMetalMode.js';
import { buildSheetOverlay, sheetPickFromHits } from '../../src/utils/sheetMetal/sheetOverlay.js';
import { starterCubeScript } from '../../src/utils/helperPaletteSnippets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const fixture = (name) => JSON.parse(read(`scripts/golden/fixtures/scs/${name}.json`));
const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SIDE_BEND_PORT || 4392);
const catalog = read('scripts/golden/fixtures/scs/catalog.json');
const specs = read('scripts/golden/fixtures/scs/specs.json');

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
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const { records } = joinScsCatalog(fixture('catalog'), fixture('specs'));
const alu = findScsSku(records, 'ALU-090');
const blank = () => createSheetSpec(alu, 'XY');
const withBends = (spec, bends) => ({ ...spec, bends });

console.log('side bend — an eligible side confirms');
{
  const spec = withBends(blank(), [{ id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 40 }]);
  const side = sheetFreeEdges(spec).find((e) => e.panel === 'b1' && e.edge === 'v-');
  check('the free side of an L is eligible', side?.eligible === true && side.bendable === true);
  check('the bend tangent u- is not offered', !sheetFreeEdges(spec).some((e) => e.panel === 'b1' && e.edge === 'u-'));
  const edit = acceptBaseFlange(pickSheetPlane(enterSheetMetalMode(alu, 'p1'), 'XY')).mode;
  let mode = { ...edit, spec, stage: 'edit', tool: 'bend' };
  mode = sheetTap(mode, { kind: 'edge', panel: 'b1', edge: 'v-' });
  check('tapping the side opens a bend on that edge', mode.draft?.edge === 'v-' && mode.draft.panel === 'b1' && !bendBlockReason(mode));
  const preview = buildSheetOverlay({ ...mode, previewSpec: { ...spec, bends: [...spec.bends, { id: mode.draft.id, panel: 'b1', edge: 'v-', angle: mode.draft.angle, length: mode.draft.length, flip: false }] }, draft: mode.draft, stage: 'edit' });
  check('the cyan preview builds the side bend', preview.children.some((c) => c.userData.sm?.kind === 'bend'));
  const committed = acceptDraft(mode);
  const solved = solveSheet(committed.spec);
  check('Confirm writes the side bend',
    committed.spec?.bends?.length === 2
    && committed.spec.bends[1].panel === 'b1'
    && committed.spec.bends[1].edge === 'v-'
    && solved.errors.length === 0
    && solved.panels.some((p) => p.id === committed.spec.bends[1].id));
  const flow = read('src/components/sheetMetal/SheetMetalFlow.jsx');
  check('the bend card names a side and can disable Confirm',
    /Flange \$\{d\.panel\} \$\{place\}/.test(flow)
    && /data-sm-bend-block/.test(flow)
    && /confirmDisabled/.test(flow));
}

console.log('side bend — a corner side is not pickable');
{
  const spec = withBends(blank(), [
    { id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 20 },
    { id: 'b2', panel: 'base', edge: 'v+', angle: 90, length: 20 },
  ]);
  const toward = sheetFreeEdges(spec).find((e) => e.panel === 'b1' && e.edge === 'v+');
  check('the side toward flange 2 is ineligible',
    toward?.bendable === true && toward.eligible === false
    && toward.block === 'Collides with flange 2 when folded');
  const g = buildSheetOverlay({ stage: 'edit', tool: 'bend', spec, lineResolution: [390, 844] });
  const handle = g.children.find((c) => c.userData.sm?.kind === 'edge' && c.userData.sm.panel === 'b1' && c.userData.sm.edge === 'v+');
  const dim = g.children.find((c) => c.userData.sheetEdgeDim?.panel === 'b1' && c.userData.sheetEdgeDim?.edge === 'v+');
  check('that side has a dim line and no handle', !handle && !!dim && dim.material.opacity < 0.4);
  g.updateMatrixWorld(true);
  const mid = new Vector3(...toward.a).add(new Vector3(...toward.b)).multiplyScalar(0.5);
  const hit = sheetPickFromHits(new Raycaster(mid.clone().add(new Vector3(0, 0, 80)), new Vector3(0, 0, -1)).intersectObject(g, true));
  check('a ray on that side does not pick an edge', hit?.kind !== 'edge', JSON.stringify(hit));
  const edit = acceptBaseFlange(pickSheetPlane(enterSheetMetalMode(alu, 'p1'), 'XY')).mode;
  const tapped = sheetTap({ ...edit, spec, stage: 'edit', tool: 'bend' }, { kind: 'edge', panel: 'b1', edge: 'v+' });
  check('tapping it does not open a bend', !tapped.draft);
}

console.log('side bend — a fold through another flange is blocked');
{
  const spec = withBends({ ...blank(), width: 40 }, [
    { id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 25 },
    { id: 'b2', panel: 'base', edge: 'u-', angle: 90, length: 60 },
  ]);
  const tip = sheetFreeEdges(spec).find((e) => e.panel === 'b1' && e.edge === 'u+');
  check('the short return is eligible at the default length', tip?.eligible === true);
  const edit = acceptBaseFlange(pickSheetPlane(enterSheetMetalMode(alu, 'p1'), 'XY')).mode;
  let mode = sheetTap({ ...edit, spec, stage: 'edit', tool: 'bend' }, { kind: 'edge', panel: 'b1', edge: 'u+' });
  check('the popup opens clear', mode.draft && !bendBlockReason(mode));
  mode = updateDraft(mode, { length: 45 });
  const reason = bendBlockReason(mode);
  check('lengthening it collides with flange 2 when folded', reason === 'Collides with flange 2 when folded', reason);
  const hit = bendInterference(
    { ...spec, bends: [...spec.bends, { id: mode.draft.id, panel: 'b1', edge: 'u+', angle: mode.draft.angle, length: 45, flip: false }] },
    mode.draft.id,
  );
  check('the block is the swept fold, not a flat overlap', hit.kind === 'sweep' && !(hit.area > 0.5), JSON.stringify({ kind: hit.kind, area: hit.area }));
  const refused = acceptDraft(mode);
  check('Confirm does not write the colliding bend', refused.spec == null && refused.mode.draft);
  mode = cancelDraft(mode);
  check('Back leaves the two walls', mode.spec.bends.length === 2 && !mode.draft);
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
check('system Chrome available', !!exe, 'set CHROME_PATH');

if (exe && failed === 0) {
  console.log('side bend — 390px screenshots');
  const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
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
  const waitUp = async () => {
    const started = Date.now();
    while (Date.now() - started < 30000) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/`);
        if (res.ok) return true;
      } catch { /* booting */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };
  const setNumber = async (page, id, value) => {
    const input = page.locator(`[data-sm-number="${id}"]`);
    await input.fill(String(value));
    await input.blur();
  };
  let browser;
  try {
    if (!await waitUp()) {
      check('vite started', false, `no response on ${PORT}`);
    } else {
      mkdirSync(shotDir, { recursive: true });
      browser = await chromium.launch({
        executablePath: exe,
        args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
      });
attachConsentPresetToBrowser(browser);
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', (err) => errors.push(String(err.message || err)));
      await page.route('**/api/auth/me', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }),
      }));
      await page.route('**/api/config', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: '{}',
      }));
      await page.route('**/sendcutsend-catalog*.json', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: catalog,
      }));
      await page.route('**/sendcutsend-specs*.json', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: specs,
      }));
      const openSheet = async () => {
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('[data-sheet-metal-button]', { timeout: 90000 });
        await page.waitForFunction(() => window.monaco?.editor?.getModels?.()?.length > 0, null, { timeout: 30000 });
        await page.evaluate((text) => {
          window.monaco.editor.getModels()[0].setValue(text);
        }, starterCubeScript());
        await page.locator('[data-sheet-metal-button]').click();
        await page.waitForSelector('[data-sheet-metal-picker]', { timeout: 10000 });
        await page.waitForFunction(() => [...document.querySelectorAll('#sm-material option')].some((o) => o.value), null, { timeout: 15000 });
        await page.selectOption('#sm-material', { label: '5052 H32 Aluminum' });
        await page.waitForFunction(() => {
          const gauge = document.querySelector('#sm-gauge option[value="ALU-090"]');
          return !!(gauge && !gauge.disabled);
        }, null, { timeout: 10000 });
        await page.selectOption('#sm-gauge', 'ALU-090');
        await page.locator('[data-sheet-metal-start]').click();
        await page.waitForSelector('[data-sheet-metal-step="plane"]', { timeout: 15000 });
        await page.locator('[data-sm-plane="XY"]').click();
        await page.waitForSelector('[data-sheet-metal-base]', { timeout: 10000 });
      };
      const acceptBend = async (pick, length) => {
        await page.evaluate((next) => window.__SHEET__?.tap(next), pick);
        await page.waitForSelector('[data-sheet-metal-bend]', { timeout: 8000 });
        if (length != null) await setNumber(page, 'sm-bend-length', length);
        await page.locator('[data-sheet-metal-bend] [data-sm-accept]').click();
        await page.waitForFunction(() => !document.querySelector('[data-sheet-metal-bend]'), null, { timeout: 15000 });
      };

      await openSheet();
      await setNumber(page, 'sm-base-x', 100);
      await setNumber(page, 'sm-base-y', 60);
      await page.locator('[data-sheet-metal-base] [data-sm-accept]').click();
      await page.waitForSelector('[data-sheet-metal-step="edit"]', { timeout: 15000 });
      await acceptBend({ kind: 'edge', panel: 'base', edge: 'u+' }, 40);
      await page.evaluate((next) => window.__SHEET__?.tap(next), { kind: 'edge', panel: 'b1', edge: 'v-' });
      await page.waitForSelector('[data-sheet-metal-bend]', { timeout: 8000 });
      const eligibleUi = await page.evaluate(() => ({
        subtitle: document.querySelector('[data-sheet-metal-bend] [data-feature-card-subtitle]')?.textContent || '',
        disabled: !!document.querySelector('[data-sheet-metal-bend] [data-sm-accept]')?.disabled,
        block: document.querySelector('[data-sm-bend-block]')?.textContent || '',
      }));
      const eligibleShot = join(shotDir, 'side-bend-eligible-390.png');
      await page.screenshot({ path: eligibleShot });
      console.log(`  shot ${eligibleShot}`);
      check('390: the side bend card is open and Confirm is enabled',
        /side/i.test(eligibleUi.subtitle) && !eligibleUi.disabled && !eligibleUi.block && errors.length === 0,
        JSON.stringify({ eligibleUi, errors: errors.slice(0, 2) }));
      await page.locator('[data-sheet-metal-bend] [data-sm-back]').click();
      await page.waitForFunction(() => !document.querySelector('[data-sheet-metal-bend]'), null, { timeout: 8000 });
      await acceptBend({ kind: 'edge', panel: 'base', edge: 'v+' }, 20);
      const stillClosed = await page.evaluate((next) => {
        window.__SHEET__?.tap(next);
        return !document.querySelector('[data-sheet-metal-bend]');
      }, { kind: 'edge', panel: 'b1', edge: 'v+' });
      const ineligibleShot = join(shotDir, 'side-bend-ineligible-390.png');
      await page.screenshot({ path: ineligibleShot });
      console.log(`  shot ${ineligibleShot}`);
      check('390: the corner side does not open a bend', stillClosed && errors.length === 0);

      errors.length = 0;
      await openSheet();
      await setNumber(page, 'sm-base-x', 40);
      await setNumber(page, 'sm-base-y', 60);
      await page.locator('[data-sheet-metal-base] [data-sm-accept]').click();
      await page.waitForSelector('[data-sheet-metal-step="edit"]', { timeout: 15000 });
      await acceptBend({ kind: 'edge', panel: 'base', edge: 'u+' }, 25);
      await acceptBend({ kind: 'edge', panel: 'base', edge: 'u-' }, 60);
      await page.evaluate((next) => window.__SHEET__?.tap(next), { kind: 'edge', panel: 'b1', edge: 'u+' });
      await page.waitForSelector('[data-sheet-metal-bend]', { timeout: 8000 });
      await setNumber(page, 'sm-bend-length', 45);
      await page.waitForSelector('[data-sm-bend-block]', { timeout: 8000 });
      const blockedUi = await page.evaluate(() => ({
        reason: (document.querySelector('[data-sm-bend-block]')?.textContent || '').trim(),
        disabled: !!document.querySelector('[data-sheet-metal-bend] [data-sm-accept]')?.disabled,
      }));
      const blockedShot = join(shotDir, 'side-bend-blocked-390.png');
      await page.screenshot({ path: blockedShot });
      console.log(`  shot ${blockedShot}`);
      check('390: Confirm is disabled and the card says it collides with flange 2',
        blockedUi.disabled && blockedUi.reason === 'Collides with flange 2 when folded' && errors.length === 0,
        JSON.stringify({ blockedUi, errors: errors.slice(0, 2) }));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    stop();
  }
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll side-bend checks passed');
process.exit(0);
