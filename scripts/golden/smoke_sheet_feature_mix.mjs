#!/usr/bin/env node
/**
 * One feature strip for a mixed part, at 390 and 1280.
 *
 * Extrude, then a sheet (Base, bend, tab), then a fillet and a cut. The CAD
 * strip lists those chips in that order. At 390 the script rail lists the
 * same order. There is no separate sheet-mode list. A bar between the tab
 * and the fillet blanks the fillet and the cut, keeps the sheet, and does
 * not rewrite the script. Deleting the tab and the cut each undo in one step.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* The evaluate callbacks run in the browser. */
/* global window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { markerWithId } from '../../src/utils/featureBlockId.js';
import {
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
  CUT_BEGIN,
  CUT_END,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
} from '../../src/utils/helperPaletteSnippets.js';
import { createSheetSpec } from '../../src/utils/sheetMetal/sheetModel.js';
import { sheetMetalBlock } from '../../src/utils/sheetMetal/sheetMetalScript.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SHEET_FEATURE_MIX_PORT || 4382);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const spec = {
  ...createSheetSpec(
    { sku: 'T', name: 'T', thicknessMm: 1.5, bend: { radiusIn: 0.05, kFactor: 0.44 } },
    'XY',
    { width: 80, height: 40 },
  ),
  bends: [{ id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 12 }],
  tabs: [{ id: 't1', panel: 'base', edge: 'v+', width: 12, depth: 8 }],
};

function region(begin, end, id, body) {
  return `${markerWithId(begin, id)}\n${body}\n${markerWithId(end, id)}`;
}

const SCRIPT = [
  region(CONTOUR_EXTRUDE_BEGIN, CONTOUR_EXTRUDE_END, 'extrude1', 'let part = Manifold.cube([30, 20, 10], true);'),
  sheetMetalBlock(spec, { union: true }),
  region(FILLET_MODE_BEGIN, FILLET_MODE_END, 'fillet1', 'part = part;'),
  region(CUT_BEGIN, CUT_END, 'cut1', 'part = part;'),
  'return part;',
  '',
].join('\n');

const ORDER = ['extrude', 'sheetBase', 'sheetBend', 'sheetTab', 'fillet', 'cut'];
const IDS = ['extrude1', 'sheet:base', 'sheet:bend:b1', 'sheet:tab:t1', 'fillet1', 'cut1'];

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('sheet feature mix');

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
check('system Chrome available', !!exe, 'set CHROME_PATH');

if (exe && failed === 0) {
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

  const scriptOf = () => (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
  const chipsOf = (rootSel) => {
    const root = window.document.querySelector(rootSel);
    if (!root) return null;
    const bar = root.querySelector('[data-rollback-bar]');
    return {
      ribbon: root.querySelector('[data-sheet-ribbon]') != null || root.hasAttribute('data-sheet-ribbon'),
      kinds: [...root.querySelectorAll('[data-feature-chip]')].map((el) => el.getAttribute('data-feature-chip') || ''),
      ids: [...root.querySelectorAll('[data-feature-id]')].map((el) => el.getAttribute('data-feature-id') || ''),
      anchor: bar?.getAttribute('data-rollback-anchor') || '',
      rolled: [...root.querySelectorAll('[data-feature-rolled-back="1"]')].map((el) => el.getAttribute('data-feature-id') || ''),
    };
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
      const cases = [
        ['390', 390, 844],
        ['1280', 1280, 800],
      ];
      for (const [label, width, height] of cases) {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        const errors = [];
        const logs = [];
        page.on('pageerror', (err) => errors.push(`${err.message}\n${err.stack || ''}`));
        page.on('console', (msg) => logs.push(msg.text()));
        await page.route('**/api/auth/me', (route) => route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }),
        }));
        await page.route('**/api/config', (route) => route.fulfill({
          status: 200, contentType: 'application/json', body: '{}',
        }));
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('[data-sheet-metal-button]', { timeout: 90000 });
        await page.waitForFunction(() => window.monaco?.editor?.getModels?.()?.length > 0, null, { timeout: 30000 });
        await page.evaluate((text) => {
          window.monaco.editor.getModels()[0].setValue(text);
        }, SCRIPT);
        await page.evaluate(() => {
          const buttons = [...window.document.querySelectorAll('[data-cad-run]')];
          const btn = buttons.find((el) => el.getClientRects().length) || buttons[0];
          btn?.click();
        });
        const mobile = width < 800;
        if (mobile) await page.locator('[data-stage-btn="parts"]').click();
        await page.waitForSelector('[data-part-row]', { timeout: 45000 });
        await page.evaluate(() => {
          const rows = [...window.document.querySelectorAll('[data-part-row]')];
          const part = rows.find((el) => el.getClientRects().length) || rows[0];
          if (part && part.getAttribute('data-part-selected') !== 'true') part.click();
        });
        if (mobile) await page.locator('[data-stage-btn="cad"]').click();
        const listed = await page.waitForFunction((ids) => {
          const chips = [...window.document.querySelectorAll('[data-cad-feature-strip] [data-feature-id]')];
          return chips.map((el) => el.getAttribute('data-feature-id')).join(',') === ids.join(',');
        }, IDS, { timeout: 15000 }).then(() => true).catch(() => false);
        const strip = await page.evaluate(chipsOf, '[data-cad-feature-strip] [data-feature-strip]');
        check(`${label}: chip order equals script order`,
          listed && strip && !strip.ribbon
          && strip.kinds.join(',') === ORDER.join(',')
          && strip.ids.join(',') === IDS.join(','),
          JSON.stringify(strip));

        if (mobile) {
          await page.locator('[data-stage-btn="parts"]').click();
          await page.locator('[data-part-edit-script]').click();
          const railReady = await page.waitForFunction((ids) => {
            const chips = [...window.document.querySelectorAll('[data-script-feature-strip] [data-feature-id]')];
            return chips.length && chips.map((el) => el.getAttribute('data-feature-id')).join(',') === ids.join(',');
          }, IDS, { timeout: 10000 }).then(() => true).catch(() => false);
          const rail = await page.evaluate(chipsOf, '[data-script-feature-strip] [data-feature-strip]');
          check(`${label}: the script rail lists the same chips in script order`,
            railReady && rail && !rail.ribbon
            && rail.kinds.join(',') === ORDER.join(',')
            && rail.ids.join(',') === IDS.join(','),
            JSON.stringify(rail));
          await page.locator('[data-script-editor-close]').click();
          await page.locator('[data-stage-btn="cad"]').click();
        }

        const beforeBar = await page.evaluate(scriptOf);
        await page.evaluate(() => {
          window.document.querySelector('[data-cad-feature-strip] [data-feature-id="sheet:tab:t1"]')
            ?.scrollIntoView({ inline: 'center', block: 'nearest' });
        });
        const gap = await page.evaluate(() => {
          const root = window.document.querySelector('[data-cad-feature-strip]');
          const left = root?.querySelector('[data-feature-id="sheet:tab:t1"]');
          const right = root?.querySelector('[data-feature-id="fillet1"]');
          if (!left || !right) return null;
          const lb = left.getBoundingClientRect();
          const rb = right.getBoundingClientRect();
          return { x: (lb.right + rb.left) / 2, y: (lb.top + lb.bottom) / 2 };
        });
        const bar = await page.locator('[data-cad-feature-strip] [data-rollback-bar]').boundingBox();
        if (gap && bar) {
          await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
          await page.mouse.down();
          await page.mouse.move(gap.x, gap.y, { steps: 12 });
          await page.mouse.up();
        }
        const anchored = await page.waitForFunction(() => {
          const el = window.document.querySelector('[data-cad-feature-strip] [data-rollback-bar]');
          return el?.getAttribute('data-rollback-anchor') === 'sheet:tab:t1';
        }, null, { timeout: 8000 }).then(() => true).catch(() => false);
        const started = Date.now();
        let rolledLog = '';
        while (Date.now() - started < 20000) {
          rolledLog = logs.find((line) => line.includes('Rolled back') && line.includes('fillet1') && line.includes('cut1')) || '';
          if (rolledLog) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        const mid = await page.evaluate(chipsOf, '[data-cad-feature-strip] [data-feature-strip]');
        const afterBar = await page.evaluate(scriptOf);
        const kept = ['extrude1', 'sheet:base', 'sheet:bend:b1', 'sheet:tab:t1'];
        check(`${label}: a bar between the tab and the fillet evaluates the sheet and blanks the tail`,
          !!gap && anchored && !!rolledLog
          && mid?.anchor === 'sheet:tab:t1'
          && kept.every((id) => !(mid?.rolled || []).includes(id))
          && (mid?.rolled || []).includes('fillet1')
          && (mid?.rolled || []).includes('cut1')
          && afterBar === beforeBar
          && errors.length === 0,
          JSON.stringify({ gap, anchored, rolledLog, mid, same: afterBar === beforeBar, errors: errors.slice(0, 2) }));

        if (mobile) {
          await page.locator('[data-stage-btn="parts"]').click();
          await page.locator('[data-part-edit-script]').click();
          await page.waitForSelector('[data-script-feature-strip] [data-feature-id="fillet1"]', { timeout: 10000 });
          const railMid = await page.evaluate(chipsOf, '[data-script-feature-strip] [data-feature-strip]');
          check(`${label}: the rail bar sits on the same gap`,
            railMid?.anchor === 'sheet:tab:t1'
            && (railMid?.rolled || []).includes('fillet1')
            && (railMid?.rolled || []).includes('cut1')
            && kept.every((id) => !(railMid?.rolled || []).includes(id)),
            JSON.stringify(railMid));
          await page.locator('[data-script-editor-close]').click();
          await page.locator('[data-stage-btn="cad"]').click();
        }

        const end = await page.evaluate(() => {
          const root = window.document.querySelector('[data-cad-feature-strip]');
          const last = root?.querySelector('[data-feature-id="cut1"]');
          if (!last) return null;
          const box = last.getBoundingClientRect();
          return { x: box.right + 12, y: (box.top + box.bottom) / 2 };
        });
        const barAgain = await page.locator('[data-cad-feature-strip] [data-rollback-bar]').boundingBox();
        if (end && barAgain) {
          await page.mouse.move(barAgain.x + barAgain.width / 2, barAgain.y + barAgain.height / 2);
          await page.mouse.down();
          await page.mouse.move(end.x, end.y, { steps: 8 });
          await page.mouse.up();
        }
        await page.waitForFunction(() => {
          const el = window.document.querySelector('[data-cad-feature-strip] [data-rollback-bar]');
          return el?.getAttribute('data-rollback-anchor') === 'end';
        }, null, { timeout: 8000 }).catch(() => null);

        const saved = await page.evaluate(scriptOf);
        await page.locator('[data-cad-feature-strip] [data-feature-id="sheet:tab:t1"]').click();
        const tabCard = await page.waitForSelector('[data-sheet-metal-tab]', { timeout: 10000 }).then(() => true).catch(() => false);
        if (tabCard) await page.locator('[data-sheet-metal-tab] [data-sm-delete]').click();
        const tabToast = await page.locator('[data-delete-undo-toast]').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
        if (tabToast) await page.locator('[data-delete-undo-toast] [data-error-undo]').click();
        const tabRestored = await page.waitForFunction((text) => {
          const live = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
          return live === text;
        }, saved, { timeout: 15000 }).then(() => true).catch(() => false);
        check(`${label}: deleting the tab undoes in one step`,
          tabCard && tabToast && tabRestored,
          JSON.stringify({ tabCard, tabToast, tabRestored }));

        await page.locator('[data-cad-feature-strip] [data-feature-id="cut1"]').click();
        await page.waitForFunction(() => !window.document.querySelector('[data-sheet-metal-mode]'), null, { timeout: 8000 }).catch(() => null);
        const cutDelete = await page.waitForSelector('[data-feature-edit-delete]', { timeout: 10000 }).then(() => true).catch(() => false);
        if (cutDelete) await page.locator('[data-feature-edit-delete]').click();
        const confirm = page.locator('[data-feature-edit-delete-confirm]');
        if (await confirm.count()) await confirm.click();
        const cutToast = await page.locator('[data-delete-undo-toast]').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
        if (cutToast) await page.locator('[data-delete-undo-toast] [data-error-undo]').click();
        const cutRestored = await page.waitForFunction((text) => {
          const live = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
          return live === text;
        }, saved, { timeout: 15000 }).then(() => true).catch(() => false);
        check(`${label}: deleting the cut undoes in one step`,
          cutDelete && cutToast && cutRestored && errors.length === 0,
          JSON.stringify({ cutDelete, cutToast, cutRestored, errors: errors.slice(0, 2) }));

        const shot = join(shotDir, `sheet-feature-mix-${label}.png`);
        await page.screenshot({ path: shot });
        console.log(`  shot ${shot}`);
        await context.close();
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    stop();
  }
}

if (failed) {
  console.log(`\nsheet feature mix: ${failed} failed`);
  process.exit(1);
}
console.log('sheet feature mix: ok');
