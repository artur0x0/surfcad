#!/usr/bin/env node
/**
 * Sheet-metal ribbon at 390 and 1280.
 *
 * While sheet metal is open the CAD bar is not assembly joints and not the
 * one Sheet chip. Plane shows Base. Edit shows Base, each bend, and each
 * tab. A tap highlights that chip and does not open its card. A part that
 * also has a cube, a fillet, and an extrude keeps those chips on the same
 * bar, in script order. Closing the flow puts the Sheet chip back.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* The evaluate callbacks run in the browser. */
/* global window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import {
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
  CUBE_BEGIN,
  CUBE_END,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
  newPartStarterScript,
} from '../../src/utils/helperPaletteSnippets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SHEET_RIBBON_PORT || 4372);
const catalog = readFileSync(join(ROOT, 'scripts/golden/fixtures/scs/catalog.json'), 'utf8');
const specs = readFileSync(join(ROOT, 'scripts/golden/fixtures/scs/specs.json'), 'utf8');

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

console.log('sheet ribbon');

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
check('system Chrome available', !!exe, 'set CHROME_PATH');

function withNeighbors(script) {
  const head = [
    CUBE_BEGIN,
    'let box = 1;',
    CUBE_END,
    FILLET_MODE_BEGIN,
    'let edge = 1;',
    FILLET_MODE_END,
    '',
  ].join('\n');
  const extrude = [
    CONTOUR_EXTRUDE_BEGIN,
    'let ex = 1;',
    CONTOUR_EXTRUDE_END,
    '',
  ].join('\n');
  const text = String(script || '');
  const at = text.lastIndexOf('return part;');
  if (at < 0) return `${head}${text}\n${extrude}`;
  return `${head}${text.slice(0, at)}${extrude}${text.slice(at)}`;
}

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
  const ribbonOf = () => {
    const root = window.document.querySelector('[data-cad-feature-strip] [data-feature-strip]');
    if (!root) return null;
    return {
      ribbon: root.hasAttribute('data-sheet-ribbon'),
      joints: root.hasAttribute('data-assembly-joints'),
      sketch: root.hasAttribute('data-sketch-entities'),
      label: root.getAttribute('aria-label') || '',
      rollback: !!root.querySelector('[data-rollback-bar]'),
      chips: [...root.querySelectorAll('[data-feature-chip]')].map((el) => ({
        kind: el.getAttribute('data-feature-chip') || '',
        label: el.getAttribute('aria-label') || '',
        pressed: el.getAttribute('aria-pressed') === 'true',
      })),
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
        await page.evaluate((text) => {
          window.monaco.editor.getModels()[0].setValue(text);
        }, newPartStarterScript());
        await page.locator('[data-sheet-metal-button]').click();
        await page.waitForSelector('[data-sheet-metal-picker]', { timeout: 10000 });
        await page.waitForFunction(() => [...window.document.querySelectorAll('#sm-material option')].some((o) => o.value), null, { timeout: 15000 });
        await page.selectOption('#sm-material', { label: '5052 H32 Aluminum' });
        await page.waitForFunction(() => {
          const gauge = window.document.querySelector('#sm-gauge option[value="ALU-090"]');
          return !!(gauge && !gauge.disabled);
        }, null, { timeout: 10000 });
        await page.selectOption('#sm-gauge', 'ALU-090');
        await page.locator('[data-sheet-metal-start]').click();
        await page.waitForSelector('[data-sheet-metal-step="plane"]', { timeout: 15000 });
        await page.waitForSelector('[data-cad-feature-strip] [data-sheet-ribbon]', { timeout: 10000 });
        const plane = await page.evaluate(ribbonOf);
        check(`${label}: plane shows Base only, not joints and not the Sheet chip`,
          plane?.ribbon && !plane.joints && !plane.sketch && plane.label === 'Sheet metal'
          && plane.chips.length === 1 && plane.chips[0].kind === 'sheetBase' && plane.chips[0].label === 'Base'
          && !plane.rollback,
          JSON.stringify(plane));

        await page.locator('[data-sm-plane="XY"]').click();
        await page.waitForSelector('[data-sheet-metal-base]', { timeout: 10000 });
        const baseStage = await page.evaluate(ribbonOf);
        check(`${label}: the base card still shows only Base`,
          baseStage?.chips.length === 1 && baseStage.chips[0].kind === 'sheetBase',
          JSON.stringify(baseStage));
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
          return page.waitForFunction((sel) => !window.document.querySelector(sel), popup, { timeout: 15000 })
            .then(() => true).catch(() => false);
        };

        const bend1 = await acceptFeature('[data-sheet-metal-bend]', { kind: 'edge', panel: 'base', edge: 'u+' });
        const bend2 = await acceptFeature('[data-sheet-metal-bend]', { kind: 'edge', panel: 'base', edge: 'u-' });
        await page.locator('[data-sheet-tool="tab"]').click();
        const tab = await acceptFeature('[data-sheet-metal-tab]', { kind: 'edge', panel: 'base', edge: 'v+' });
        await page.waitForFunction(() => {
          const root = window.document.querySelector('[data-cad-feature-strip] [data-sheet-ribbon]');
          return root && root.querySelectorAll('[data-feature-chip]').length >= 4;
        }, null, { timeout: 10000 });
        const edit = await page.evaluate(ribbonOf);
        const kinds = (edit?.chips || []).map((chip) => chip.kind);
        const labels = (edit?.chips || []).map((chip) => chip.label);
        check(`${label}: edit lists Base, each bend, and the tab`,
          bend1 && bend2 && tab && edit?.ribbon && !edit.joints && !edit.rollback
          && kinds.join(',') === 'sheetBase,sheetBend,sheetBend,sheetTab'
          && labels.join(',') === 'Base,Bend 1,Bend 2,Tab'
          && !kinds.includes('sheetMetal'),
          JSON.stringify({ bend1, bend2, tab, edit, errors: errors.slice(0, 2) }));

        await page.locator('[data-cad-feature-strip] [data-feature-id="sheet:base"]').click();
        const baseLit = await page.waitForFunction(() => {
          const el = window.document.querySelector('[data-cad-feature-strip] [data-feature-id="sheet:base"]');
          return el && el.getAttribute('aria-pressed') === 'true';
        }, null, { timeout: 5000 }).then(() => true).catch(() => false);
        const pressedBase = await page.evaluate(ribbonOf);
        const bendCard = await page.locator('[data-sheet-metal-bend]').count();
        check(`${label}: tapping Base highlights it and does not open a card`,
          baseLit
          && pressedBase?.chips[0]?.pressed === true
          && pressedBase.chips.slice(1).every((chip) => !chip.pressed)
          && bendCard === 0,
          JSON.stringify(pressedBase));
        await page.locator('[data-cad-feature-strip] [data-sheet-kind="bend"]').first().click();
        const bendLit = await page.waitForFunction(() => {
          const chips = [...window.document.querySelectorAll('[data-cad-feature-strip] [data-sheet-kind="bend"]')];
          return chips[0] && chips[0].getAttribute('aria-pressed') === 'true';
        }, null, { timeout: 5000 }).then(() => true).catch(() => false);
        const pressedBend = await page.evaluate(ribbonOf);
        check(`${label}: tapping a bend highlights that chip only`,
          bendLit
          && pressedBend?.chips[1]?.pressed === true
          && pressedBend.chips[0]?.pressed === false
          && await page.locator('[data-sheet-metal-bend]').count() === 0,
          JSON.stringify(pressedBend));

        const saved = await page.evaluate(scriptOf);
        const mixed = withNeighbors(saved);
        await page.evaluate((text) => {
          window.monaco.editor.getModels()[0].setValue(text);
        }, mixed);
        await page.locator('[data-sheet-tool="hole"]').click();
        await page.waitForFunction(() => {
          const root = window.document.querySelector('[data-cad-feature-strip] [data-sheet-ribbon]');
          const chips = [...(root?.querySelectorAll('[data-feature-chip]') || [])].map((el) => el.getAttribute('data-feature-chip'));
          return chips[0] === 'cube' && chips.includes('extrude');
        }, null, { timeout: 10000 });
        const mix = await page.evaluate(ribbonOf);
        check(`${label}: a mixed part keeps every feature in script order`,
          (mix?.chips || []).map((chip) => chip.kind).join(',')
            === 'cube,fillet,sheetBase,sheetBend,sheetBend,sheetTab,extrude',
          JSON.stringify(mix));
        const shot = join(shotDir, `sheet-ribbon-${label}.png`);
        await page.screenshot({ path: shot });
        console.log(`  shot ${shot}`);

        await page.locator('[data-sheet-metal-mode] [data-feature-card-cancel]').click();
        await page.waitForFunction(() => !window.document.querySelector('[data-sheet-metal-mode]'), null, { timeout: 10000 });
        const closed = await page.evaluate(ribbonOf);
        const stillExpanded = (closed?.chips || []).some((chip) => chip.kind === 'sheetBase' || chip.kind === 'sheetBend');
        const partStrip = (closed?.chips || []).some((chip) => chip.kind === 'sheetMetal');
        check(`${label}: closing the flow leaves the sheet ribbon`,
          !closed?.ribbon && !stillExpanded && (closed?.joints || partStrip) && errors.length === 0,
          JSON.stringify({ closed, errors: errors.slice(0, 2) }));
        await context.close();
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    stop();
  }
}

if (failed) {
  console.log(`\nsheet ribbon: ${failed} failed`);
  process.exit(1);
}
console.log('sheet ribbon: ok');
