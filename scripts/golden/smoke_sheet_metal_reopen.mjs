#!/usr/bin/env node
/**
 * Tapping an existing Sheet chip reopens the flow at the last screen.
 * The saved bends come back. Check shows DFM and writes nothing. X writes
 * nothing, including after a bend that exists only in memory. Done closes
 * without writing when the spec matches, and writes when it does not.
 * The strip Undo drops that write. 390 and 1280.
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
import { starterCubeScript } from '../../src/utils/helperPaletteSnippets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SHEET_REOPEN_PORT || 4346);
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

console.log('sheet metal reopen — ribbon tap restores steps');

{
  const view = read('src/components/Viewport.jsx');
  const flow = read('src/components/sheetMetal/SheetMetalFlow.jsx');
  const label = read('src/utils/scs/scsCatalog.js');
  const palette = read('src/components/HelperInsertPalette.jsx');
  check('ribbon reopen builds a gauge the chip can render',
    /reopenSheetMetalMode\(/.test(view)
    && !/bendable: true,\s*thicknessMm: active\.spec\.t/.test(view));
  check('Check and Done live on the edit chip, and the in-card undo is gone',
    /data-sm-check="1"/.test(flow) && /data-sm-done="1"/.test(flow)
    && !/data-sm-undo/.test(flow) && !/data-sm-confirm/.test(flow)
    && !/undoSheetStep/.test(flow));
  check('a missing thickness does not call toFixed',
    /Number\.isFinite\(inchN\)/.test(label) && /Number\.isFinite\(mmN\)/.test(label));
  const shapeAt = palette.indexOf("section.section === 'shape' && onOpenSheetMetal");
  check('Sheet Metal stays the Shape button',
    shapeAt > 0 && palette.slice(shapeAt, shapeAt + 800).includes('data-sheet-metal-button="1"'));
}

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
  const specOf = (script) => {
    const m = String(script || '').match(/const sheetSpec\s*=\s*(\{.*\});/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
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
      const cases = [
        ['desktop', 1280, 900],
        ['390', 390, 844],
      ];
      for (const [label, width, height] of cases) {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (err) => errors.push(`${err.message}\n${err.stack || ''}`));
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
        const starter = starterCubeScript();
        await page.evaluate((text) => {
          window.monaco.editor.getModels()[0].setValue(text);
        }, starter);
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
        await page.locator('[data-sheet-metal-base] [data-sm-accept]').click();
        await page.waitForSelector('[data-sheet-metal-step="edit"]', { timeout: 15000 });

        const acceptFeature = async (popup, pick) => {
          const opened = await page.evaluate((next) => {
            window.__SHEET__?.tap(next);
            return !!window.__SHEET__;
          }, pick);
          if (!opened) return false;
          const popupSel = await page.waitForSelector(popup, { timeout: 8000 }).then(() => true).catch(() => false);
          if (!popupSel) return false;
          await page.locator(`${popup} [data-sm-accept]`).click();
          return page.waitForFunction((sel) => !document.querySelector(sel), popup, { timeout: 15000 })
            .then(() => true).catch(() => false);
        };

        const openSheetChip = async () => {
          const row = await page.evaluate(() => {
            const rows = [...window.document.querySelectorAll('[data-part-row]')];
            const part = rows.find((el) => el.getClientRects().length) || rows[0];
            if (part && part.getAttribute('data-part-selected') !== 'true') part.click();
            return !!part;
          });
          if (!row) return false;
          const ready = await page.waitForFunction(() => {
            const chips = [...window.document.querySelectorAll('[data-feature-chip="sheetBase"]')];
            return chips.some((el) => el.getClientRects().length);
          }, null, { timeout: 10000 }).then(() => true).catch(() => false);
          if (!ready) return false;
          await page.evaluate(() => {
            const chips = [...window.document.querySelectorAll('[data-feature-chip="sheetBase"]')];
            const el = chips.find((node) => node.getClientRects().length) || chips[0];
            el?.click();
          });
          const opened = await page.waitForSelector(
            '[data-sheet-metal-base], [data-sheet-metal-bend], [data-sheet-metal-tab], [data-sm-reopen="1"]',
            { timeout: 10000 },
          ).then(() => true).catch(() => false);
          if (!opened) return false;
          const back = page.locator('[data-sm-back]');
          if (await back.count()) {
            const visible = back.filter({ hasNot: page.locator('[hidden]') }).first();
            const target = (await visible.count()) ? visible : back.first();
            await target.click();
          }
          return page.waitForSelector('[data-sm-reopen="1"]', { timeout: 8000 }).then(() => true).catch(() => false);
        };

        const bend1 = await acceptFeature('[data-sheet-metal-bend]', { kind: 'edge', panel: 'base', edge: 'u+' });
        const bend2 = await acceptFeature('[data-sheet-metal-bend]', { kind: 'edge', panel: 'base', edge: 'u-' });
        await page.locator('[data-sheet-tool="tab"]').click();
        const tab = await acceptFeature('[data-sheet-metal-tab]', { kind: 'edge', panel: 'base', edge: 'v+' });
        const built = await page.evaluate(scriptOf);
        const builtSpec = specOf(built);
        const builtCount = (builtSpec?.bends?.length || 0) + (builtSpec?.tabs?.length || 0) + (builtSpec?.holes?.length || 0);
        check(`${label}: two bends and a tab are confirmed`,
          bend1 && bend2 && tab && builtSpec?.bends?.length >= 2 && builtSpec?.tabs?.length >= 1,
          JSON.stringify({ bend1, bend2, tab, bends: builtSpec?.bends?.length, tabs: builtSpec?.tabs?.length, errors: errors.slice(0, 2) }));

        await page.locator('[data-sheet-metal-mode] [data-feature-card-cancel]').click();
        await page.waitForFunction(() => !document.querySelector('[data-sheet-metal-mode]'), null, { timeout: 10000 });
        const saved = await page.evaluate(scriptOf);
        errors.length = 0;
        const tapped = await openSheetChip();
        if (!tapped) {
          check(`${label}: ribbon tap reopens edit with the bends, and does not crash`, false, 'Base chip was not on the part strip');
          await context.close();
          continue;
        }
        const reopened = await page.waitForSelector('[data-sm-reopen="1"]', { timeout: 10000 }).then(() => true).catch(() => false);
        const ui = await page.evaluate(() => {
          const step = document.querySelector('[data-sm-step-count]');
          const gauge = document.querySelector('[data-sm-gauge]');
          return {
            stage: document.querySelector('[data-sheet-metal-mode]')?.getAttribute('data-sheet-metal-mode') || '',
            count: step ? Number(step.getAttribute('data-sm-step-count')) : null,
            bends: step ? Number(step.getAttribute('data-sm-bends')) : null,
            tabs: step ? Number(step.getAttribute('data-sm-tabs')) : null,
            gauge: gauge ? (gauge.textContent || '').trim() : '',
            root: (document.querySelector('#root')?.innerText || '').length,
          };
        });
        const shot = join(shotDir, `sheet-metal-reopen-${label}.png`);
        await page.screenshot({ path: shot });
        console.log(`  shot ${shot}`);
        check(`${label}: ribbon tap reopens edit with the bends, and does not crash`,
          reopened && errors.length === 0 && ui.stage === 'edit' && ui.root > 0
          && ui.bends >= 2 && ui.tabs >= 1 && ui.count === builtCount
          && /mm/.test(ui.gauge),
          JSON.stringify({ ui, errors: errors.slice(0, 2) }));

        await page.locator('[data-sm-check]').click();
        const openedCheck = await page.waitForSelector('[data-sheet-metal-export]', { timeout: 8000 }).then(() => true).catch(() => false);
        const dfm = await page.evaluate(() => {
          const card = window.document.querySelector('[data-sheet-metal-export]');
          return {
            title: (card?.querySelector('[data-feature-card-title]')?.textContent || '').trim(),
            downloads: card?.querySelectorAll('[data-sm-dxf], [data-sm-step], [data-sm-order]').length || 0,
            flat: !!card?.querySelector('[data-sm-flat-size]'),
            step: card?.querySelector('[data-sm-step-source]')?.getAttribute('data-sm-step-source') || '',
            undo: !!window.document.querySelector('[data-sm-undo]'),
          };
        });
        check(`${label}: Check shows DFM and does not download or order`,
          openedCheck && dfm.title === 'Check' && dfm.downloads === 0 && dfm.flat && !!dfm.step && !dfm.undo,
          JSON.stringify(dfm));
        await page.locator('[data-sheet-metal-export] [data-feature-card-cancel]').click();
        await page.waitForSelector('[data-sm-done]', { timeout: 8000 });
        const afterCheck = await page.evaluate(scriptOf);
        check(`${label}: closing Check writes nothing`, afterCheck === saved && errors.length === 0);

        const held = await acceptFeature('[data-sheet-metal-bend]', { kind: 'edge', panel: 'base', edge: 'v-' });
        const heldScript = await page.evaluate(scriptOf);
        check(`${label}: a reopen bend stays in memory`,
          held && heldScript === saved,
          JSON.stringify({ held, same: heldScript === saved }));
        await page.locator('[data-sheet-metal-mode] [data-feature-card-cancel]').click();
        const cancelled = await page.waitForFunction(() => !window.document.querySelector('[data-sheet-metal-mode]'), null, { timeout: 8000 })
          .then(() => true).catch(() => false);
        const afterCancel = await page.evaluate(scriptOf);
        check(`${label}: X writes nothing`,
          cancelled && afterCancel === saved && errors.length === 0,
          cancelled ? '' : 'mode still open');

        if (!await openSheetChip()) {
          check(`${label}: Done closes without writing when the spec matches`, false, 'Base chip was not on the part strip');
          await context.close();
          continue;
        }
        await page.waitForSelector('[data-sm-reopen="1"]', { timeout: 10000 });
        await page.locator('[data-sm-done]').click();
        const closedSame = await page.waitForFunction(() => !window.document.querySelector('[data-sheet-metal-mode]'), null, { timeout: 8000 })
          .then(() => true).catch(() => false);
        const afterSame = await page.evaluate(scriptOf);
        check(`${label}: Done closes without writing when the spec matches`,
          closedSame && afterSame === saved && errors.length === 0);

        if (!await openSheetChip()) {
          check(`${label}: Done writes the new bend and keeps Base, the bends, and the tab`, false, 'Base chip was not on the part strip');
          await context.close();
          continue;
        }
        await page.waitForSelector('[data-sm-reopen="1"]', { timeout: 10000 });
        const extra = await acceptFeature('[data-sheet-metal-bend]', { kind: 'edge', panel: 'base', edge: 'v-' });
        const beforeDone = await page.evaluate(scriptOf);
        await page.locator('[data-sm-done]').click();
        const confirmed = await page.waitForFunction(() => !window.document.querySelector('[data-sheet-metal-mode]'), null, { timeout: 15000 })
          .then(() => true).catch(() => false);
        const written = specOf(await page.evaluate(scriptOf));
        const chips = await page.evaluate(() => (
          [...window.document.querySelectorAll('[data-cad-feature-strip] [data-feature-chip]')]
            .map((el) => el.getAttribute('data-feature-chip'))
        ));
        check(`${label}: Done writes the new bend and keeps Base, the bends, and the tab`,
          extra && beforeDone === saved && confirmed
          && written?.bends?.length === (builtSpec?.bends?.length || 0) + 1
          && written?.tabs?.length === builtSpec?.tabs?.length
          && chips.includes('sheetBase') && chips.filter((kind) => kind === 'sheetBend').length === written.bends.length
          && !chips.includes('sheetMetal') && errors.length === 0,
          JSON.stringify({ extra, same: beforeDone === saved, confirmed, bends: written?.bends?.length, tabs: written?.tabs?.length, chips, errors: errors.slice(0, 2) }));

        await page.evaluate(() => {
          const buttons = [...window.document.querySelectorAll('[data-cad-feature-strip] [data-feature-bar-undo]')];
          const btn = buttons.find((el) => !el.disabled && el.getClientRects().length) || buttons.find((el) => !el.disabled);
          btn?.click();
        });
        const restored = await page.waitForFunction((text) => {
          const live = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
          return live === text;
        }, saved, { timeout: 8000 }).then(() => true).catch(() => false);
        check(`${label}: strip Undo drops that Done write`, restored && errors.length === 0);
        await context.close();
      }
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
console.log('\nSheet metal reopen restores the last screen.');
