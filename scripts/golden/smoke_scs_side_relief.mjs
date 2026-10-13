#!/usr/bin/env node
/**
 * Side-bend relief and export truth. The root of a flange side shortens by
 * the same square as a base corner, and that square is cut from the parent
 * flange so the DXF shows it. STEP keeps exact cylinders. A blank whose
 * rectangles cover each other ships no DXF and no STEP. A fold that hits
 * another flange, and a parent shorter than SCS min-flange-before, fail DFM.
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
import { joinScsCatalog, findScsSku } from '../../src/utils/scs/scsCatalog.js';
import {
  bendAllowance,
  bendDefaults,
  cornerReliefSize,
  createSheetSpec,
  notchRect,
  solveSheet,
} from '../../src/utils/sheetMetal/sheetModel.js';
import { blankOverlap } from '../../src/utils/sheetMetal/sheetInterference.js';
import { sheetFlatDxf, sheetFlatPattern } from '../../src/utils/sheetMetal/sheetFlat.js';
import { brepVolume, buildSheetBrep } from '../../src/utils/sheetMetal/sheetBrep.js';
import { checkSheetDfm } from '../../src/utils/sheetMetal/sheetDfm.js';
import { buildSheetExport, sheetExpectedVolume } from '../../src/utils/sheetMetal/sheetExport.js';
import { newPartStarterScript } from '../../src/utils/helperPaletteSnippets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const fixture = (name) => JSON.parse(read(`scripts/golden/fixtures/scs/${name}.json`));
const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SIDE_RELIEF_PORT || 4394);
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
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const rules = (spec) => checkSheetDfm(spec).issues.filter((i) => i.level === 'fail');
const covers = (loop, x, y) => {
  let c = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const yi = loop[i][1];
    const yj = loop[j][1];
    const xi = loop[i][0];
    const xj = loop[j][0];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

const { records } = joinScsCatalog(fixture('catalog'), fixture('specs'));
const alu = findScsSku(records, 'ALU-090');
const blank = () => createSheetSpec(alu, 'XY');

console.log('side relief — the root notch is in the flat and the STEP');
{
  const parent = { ...blank(), bends: [{ id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 40 }] };
  const proposal = bendDefaults(parent, 'b1', 'v-');
  const spec = {
    ...parent,
    bends: [...parent.bends, { id: 'b2', panel: 'b1', edge: 'v-', angle: proposal.angle, length: proposal.length, flip: false }],
  };
  const g = cornerReliefSize(spec);
  const solved = solveSheet(spec);
  const side = solved.bends.find((b) => b.id === 'b2');
  const notch = solved.notches.find((n) => n.panel === 'b1');
  check('the side bend shortens off the parent tangent by g',
    side && near(side.q0, g) && near(side.q1, 40) && solved.notches.length === 1);
  check('the square is cut from the parent flange, not the tip',
    notch && notch.corner[0] === 'u-' && near(notch.u1 - notch.u0, g) && near(notch.v1 - notch.v0, g)
    && near(notch.u0, 0) && near(notch.v0, -30));
  const flat = sheetFlatPattern(spec);
  const ba = bendAllowance(spec, 90);
  const span = 40 - g;
  const want = 100 * 60 + ba * 60 + 40 * 60 + ba * span + proposal.length * span - g * g;
  check('flat area drops the notch and the shortened side', near(flat.area, want, 1e-3), `${flat.area} vs ${want}`);
  const flatSolved = solveSheet(spec, { flat: true });
  const cut = notchRect(flatSolved.panels[0], flatSolved.panels, notch);
  const cx = (cut.x0 + cut.x1) / 2;
  const cy = (cut.y0 + cut.y1) / 2;
  check('the DXF outline goes around the notch',
    flat.outline.length === 1 && !covers(flat.outline[0], cx, cy) && covers(flat.outline[0], 0, 0),
    JSON.stringify(cut));
  const dxf = sheetFlatDxf(flat);
  const lines = dxf.split('\n');
  const count = (kw) => lines.filter((l, i) => l === kw && lines[i - 1] === '0').length;
  check('DXF draws the notched outline', count('LINE') === flat.outline[0].length && flat.outline[0].length > 4);
  const brep = buildSheetBrep(spec);
  const radii = brep.faces.filter((f) => f.kind === 'bend').map((f) => f.surface.radius);
  check('STEP cylinders stay at r and r + t',
    brep.stats.cylinders === 4 && radii.some((x) => near(x, spec.r, 1e-6)) && radii.some((x) => near(x, spec.r + spec.t, 1e-6)),
    JSON.stringify(radii));
  const vol = brepVolume(brep, 64);
  const expect = sheetExpectedVolume(spec, flat);
  check('B-rep volume matches the notched blank', Math.abs(vol - expect) / expect < 0.001, `${vol} vs ${expect}`);
  const bundle = buildSheetExport(spec, { partName: 'Side Bend' });
  check('a clear side bend exports DXF and exact STEP',
    !bundle.blocked && bundle.files.dxf && bundle.stepSource === 'spec' && /CYLINDRICAL_SURFACE/.test(bundle.files.step.text));
  check('that blank does not overlap itself', blankOverlap(spec) == null);
}

console.log('side relief — export overlap and SCS checks');
{
  const tray = {
    ...blank(),
    bends: ['u+', 'u-', 'v+', 'v-'].map((edge, i) => ({ id: `b${i + 1}`, panel: 'base', edge, angle: 90, length: 20 })),
  };
  check('a four-wall tray still passes DFM', checkSheetDfm(tray).ok && blankOverlap(tray) == null);
  const corner = {
    ...blank(),
    bends: [
      { id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 20 },
      { id: 'b2', panel: 'base', edge: 'v+', angle: 90, length: 20 },
    ],
  };
  check('two walls at a corner still pass', checkSheetDfm(corner).ok);
  const ret = {
    ...blank(),
    width: 40,
    bends: [
      { id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 25 },
      { id: 'b2', panel: 'base', edge: 'u-', angle: 90, length: 60 },
      { id: 'b3', panel: 'b1', edge: 'u+', angle: 90, length: 45 },
    ],
  };
  const retFail = rules(ret);
  check('a fold through another flange fails collide',
    retFail.some((i) => i.rule === 'collide' && i.message === 'Collides with flange 2 when folded'),
    retFail.map((i) => i.message).join(' | '));
  const retBundle = buildSheetExport(ret, { partName: 'Return' });
  check('a fold collision keeps the files and blocks the handoff',
    retBundle.blocked && retBundle.files.dxf && retBundle.files.step && !retFail.some((i) => i.rule === 'overlap'));
  const lap = {
    ...blank(),
    bends: [
      { id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 20 },
      { id: 'b2', panel: 'base', edge: 'v+', angle: 90, length: 20 },
      { id: 'b3', panel: 'b2', edge: 'v-', angle: 90, length: 40 },
    ],
    tabs: [{ id: 't1', panel: 'b3', edge: 'v-', width: 30, depth: 15, centered: true }],
  };
  const lapFail = rules(lap);
  check('a tab covering another flange fails overlap',
    lapFail.some((i) => i.rule === 'overlap' && i.message === 'Overlaps flange 1 and flange 3 in the flat pattern'),
    lapFail.map((i) => i.message).join(' | '));
  const lapBundle = buildSheetExport(lap, { partName: 'Lap' });
  check('an overlapping blank exports no DXF and no STEP',
    lapBundle.blocked && lapBundle.files.dxf === null && lapBundle.files.step === null);
  const narrow = { ...blank(), width: 5, bends: [{ id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 20 }] };
  const narrowFail = rules(narrow);
  check('material before the bend below the SCS min fails flange-before',
    narrowFail.some((i) => i.rule === 'flange-before' && /6\.48 mm/.test(i.message)) && !narrowFail.some((i) => i.rule === 'flange'),
    narrowFail.map((i) => `${i.rule}: ${i.message}`).join(' | '));
  check('architecture.md documents the side notch and the new DFM rules',
    /side bend \(`v\+` \/ `v-`/.test(read('docs/architecture.md'))
    && /`flange-before`/.test(read('docs/architecture.md'))
    && /`overlap`/.test(read('docs/architecture.md'))
    && /golden:scs-side-relief/.test(read('docs/architecture.md')));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
check('system Chrome available', !!exe, 'set CHROME_PATH');

if (exe && failed === 0) {
  console.log('side relief — 390px screenshots');
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
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('[data-sheet-metal-button]', { timeout: 90000 });
      await page.waitForFunction(() => window.monaco?.editor?.getModels?.()?.length > 0, null, { timeout: 30000 });
      await page.evaluate((text) => {
        window.monaco.editor.getModels()[0].setValue(text);
      }, newPartStarterScript());
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
      for (const [id, value] of [['sm-base-x', 100], ['sm-base-y', 60]]) {
        const input = page.locator(`[data-sm-number="${id}"]`);
        await input.fill(String(value));
        await input.blur();
      }
      await page.locator('[data-sheet-metal-base] [data-sm-accept]').click();
      await page.waitForSelector('[data-sheet-metal-step="edit"]', { timeout: 15000 });
      const acceptBend = async (pick, length) => {
        await page.evaluate((next) => window.__SHEET__?.tap(next), pick);
        await page.waitForSelector('[data-sheet-metal-bend]', { timeout: 8000 });
        if (length != null) {
          const input = page.locator('[data-sm-number="sm-bend-length"]');
          await input.fill(String(length));
          await input.blur();
        }
        await page.locator('[data-sheet-metal-bend] [data-sm-accept]').click();
        await page.waitForFunction(() => !document.querySelector('[data-sheet-metal-bend]'), null, { timeout: 15000 });
      };
      await acceptBend({ kind: 'edge', panel: 'base', edge: 'u+' }, 40);
      await acceptBend({ kind: 'edge', panel: 'b1', edge: 'v-' });
      const partShot = join(shotDir, 'side-relief-part-390.png');
      await page.screenshot({ path: partShot });
      console.log(`  shot ${partShot}`);
      await page.locator('[data-sm-check]').click();
      await page.waitForSelector('[data-sheet-metal-export]', { timeout: 8000 });
      const ui = await page.evaluate(() => ({
        ok: (document.querySelector('[data-sm-dfm-ok]')?.textContent || '').trim(),
        fails: (document.querySelector('[data-sm-dfm-fails]')?.textContent || '').trim(),
      }));
      const exportShot = join(shotDir, 'side-relief-export-390.png');
      await page.screenshot({ path: exportShot });
      console.log(`  shot ${exportShot}`);
      check('390: the relieved side bend passes Check',
        ui.ok === 'All SCS checks passed.' && !ui.fails && errors.length === 0,
        JSON.stringify({ ui, errors: errors.slice(0, 2) }));
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
console.log('\nAll side-relief checks passed');
process.exit(0);
