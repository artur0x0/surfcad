#!/usr/bin/env node
/**
 * Sheet-metal ribbon at 390 and 1280.
 *
 * While sheet metal is open the CAD bar is not assembly joints and not the
 * one Sheet chip. Plane shows Base. Edit shows Base, each bend, and each
 * tab. Two edges confirm as one chip: two ids, two refKeys, and one undo
 * drops both. A tip and a side that collide keep Confirm disabled. A tap
 * opens that chip's card. An unused tab deletes with no dialog,
 * the one-line Deleted toast, and one undo. A bend that carries a tab and a
 * hole confirms Delete along with 2 features; a contour ref on its wall is
 * not part of that count, and one undo restores the bend, the tab, and the
 * hole. A part that also has a cube, a fillet, and an extrude keeps those
 * chips on the same bar, in script order. Closing the flow keeps those
 * expanded chips. The rollback bar stays on the list.
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
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { panelById, panelPoint, solveSheet } from '../../src/utils/sheetMetal/sheetModel.js';
import { readSheetMetalSpec } from '../../src/utils/sheetMetal/sheetMetalScript.js';
import { sheetContourEdges } from '../../src/utils/sheetMetal/sheetContourEdges.js';
import {
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
  CUBE_BEGIN,
  CUBE_END,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
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
attachConsentPresetToBrowser(browser);
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
        }, '');
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
        await page.waitForSelector('[data-cad-feature-strip] [data-feature-chip="sheetBase"]', { timeout: 10000 });
        const plane = await page.evaluate(ribbonOf);
        check(`${label}: plane shows Base only, not joints and not a separate sheet list`,
          !plane?.ribbon && !plane.joints && !plane.sketch && plane.label === 'Modeling features'
          && plane.chips.length === 1 && plane.chips[0].kind === 'sheetBase' && plane.chips[0].label === 'Base'
          && plane.rollback,
          JSON.stringify(plane));

        await page.locator('[data-sm-plane="XY"]').click();
        await page.waitForSelector('[data-sheet-metal-base]', { timeout: 10000 });
        const baseStage = await page.evaluate(ribbonOf);
        check(`${label}: the base card still shows only Base`,
          baseStage?.chips.length === 1 && baseStage.chips[0].kind === 'sheetBase',
          JSON.stringify(baseStage));
        await page.locator('[data-sheet-metal-base] [data-sm-accept]').click();
        await page.waitForSelector('[data-sheet-metal-step="edit"]', { timeout: 15000 });

        const tapEdge = (pick) => page.evaluate((next) => {
          window.__SHEET__?.tap(next);
        }, pick);
        await tapEdge({ kind: 'edge', panel: 'base', edge: 'u+' });
        await page.waitForSelector('[data-sheet-metal-bend]', { timeout: 8000 });
        await tapEdge({ kind: 'edge', panel: 'base', edge: 'u-' });
        const twoEdges = await page.waitForFunction(() => {
          const card = window.document.querySelector('[data-sheet-metal-bend]');
          return card && card.getAttribute('data-sm-edges') === '2';
        }, null, { timeout: 8000 }).then(() => true).catch(() => false);
        const multiEnabled = await page.locator('[data-sheet-metal-bend] [data-sm-accept]').isEnabled().catch(() => false);
        await page.locator('[data-sheet-metal-bend] [data-sm-accept]').click();
        await page.waitForFunction(() => !window.document.querySelector('[data-sheet-metal-bend]'), null, { timeout: 15000 });
        const groupedChip = await page.waitForFunction(() => {
          const chips = [...window.document.querySelectorAll('[data-cad-feature-strip] [data-sheet-kind="bend"]')];
          const members = (chips[0]?.getAttribute('data-sheet-members') || '').split(' ').filter(Boolean);
          return chips.length === 1 && members.length === 2 ? members : null;
        }, null, { timeout: 10000 }).catch(() => null);
        const groupedMembers = await page.evaluate(() => {
          const chip = window.document.querySelector('[data-cad-feature-strip] [data-sheet-kind="bend"]');
          return (chip?.getAttribute('data-sheet-members') || '').split(' ').filter(Boolean);
        });
        const groupedSpec = readSheetMetalSpec(await page.evaluate(scriptOf));
        const groupedKeys = (sheetContourEdges(groupedSpec)?.edges || []).map((edge) => edge.refKey);
        const featureIds = (groupedSpec?.bends || []).map((row) => row.id);
        const oneFeature = new Set((groupedSpec?.bends || []).map((row) => row.feature)).size === 1;
        const bothRefs = featureIds.length === 2 && featureIds.every((id) => (
          groupedKeys.some((key) => key.startsWith(`bend:${id}:`) || key.startsWith(`wall:${id}:`))
        ));
        check(`${label}: two edges are one chip, two ids, and two refKeys`,
          twoEdges && multiEnabled && !!groupedChip && oneFeature && bothRefs
          && groupedMembers.join(' ') === featureIds.join(' '),
          JSON.stringify({ twoEdges, multiEnabled, groupedMembers, featureIds, oneFeature, bothRefs }));
        await page.evaluate(() => {
          const buttons = [...window.document.querySelectorAll('[data-cad-feature-strip] [data-feature-bar-undo]')];
          const btn = buttons.find((el) => !el.disabled && el.getClientRects().length) || buttons.find((el) => !el.disabled);
          btn?.click();
        });
        const undone = await page.waitForFunction(() => {
          const root = window.document.querySelector('[data-cad-feature-strip] [data-feature-strip]');
          const chips = [...(root?.querySelectorAll('[data-feature-chip]') || [])].map((el) => el.getAttribute('data-feature-chip'));
          return chips.join(',') === 'sheetBase';
        }, null, { timeout: 10000 }).then(() => true).catch(() => false);
        const undoneSpec = readSheetMetalSpec(await page.evaluate(scriptOf));
        check(`${label}: one undo drops both edges`,
          undone && (undoneSpec?.bends || []).length === 0,
          JSON.stringify({ undone, bends: undoneSpec?.bends?.length }));

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
        const flangeId = await page.evaluate(() => {
          const chip = window.document.querySelector('[data-cad-feature-strip] [data-sheet-kind="bend"]');
          return (chip?.getAttribute('data-sheet-members') || '').split(' ')[0];
        });
        await tapEdge({ kind: 'edge', panel: flangeId, edge: 'u+' });
        await page.waitForSelector('[data-sheet-metal-bend]', { timeout: 8000 });
        await tapEdge({ kind: 'edge', panel: flangeId, edge: 'v-' });
        const blockedEdges = await page.waitForFunction(() => {
          const card = window.document.querySelector('[data-sheet-metal-bend]');
          return card && card.getAttribute('data-sm-edges') === '2';
        }, null, { timeout: 8000 }).then(() => true).catch(() => false);
        const blockedUi = await page.evaluate(() => ({
          disabled: !!window.document.querySelector('[data-sheet-metal-bend] [data-sm-accept]')?.disabled,
          reason: (window.document.querySelector('[data-sm-bend-block]')?.textContent || '').trim(),
        }));
        check(`${label}: a blocked edge disables Confirm`,
          blockedEdges && blockedUi.disabled && blockedUi.reason.length > 0,
          JSON.stringify({ blockedEdges, blockedUi, flangeId }));
        await page.locator('[data-sheet-metal-bend] [data-sm-back]').click();
        await page.waitForFunction(() => !window.document.querySelector('[data-sheet-metal-bend]'), null, { timeout: 8000 });
        const bend2 = await acceptFeature('[data-sheet-metal-bend]', { kind: 'edge', panel: 'base', edge: 'u-' });
        await page.locator('[data-sheet-tool="tab"]').click();
        const tab = await acceptFeature('[data-sheet-metal-tab]', { kind: 'edge', panel: 'base', edge: 'v+' });
        await page.waitForFunction(() => {
          const root = window.document.querySelector('[data-cad-feature-strip] [data-feature-strip]');
          return root && root.querySelectorAll('[data-feature-chip]').length >= 4;
        }, null, { timeout: 10000 });
        const edit = await page.evaluate(ribbonOf);
        const kinds = (edit?.chips || []).map((chip) => chip.kind);
        const labels = (edit?.chips || []).map((chip) => chip.label);
        check(`${label}: edit lists Base, each bend, and the tab`,
          bend1 && bend2 && tab && !edit?.ribbon && !edit.joints && edit?.rollback
          && kinds.join(',') === 'sheetBase,sheetBend,sheetBend,sheetTab'
          && labels.join(',') === 'Base,Bend 1,Bend 2,Tab'
          && !kinds.includes('sheetMetal'),
          JSON.stringify({ bend1, bend2, tab, edit, errors: errors.slice(0, 2) }));

        const saved = await page.evaluate(scriptOf);
        const bendId = await page.evaluate(() => {
          const chips = [...window.document.querySelectorAll('[data-cad-feature-strip] [data-sheet-kind="bend"]')];
          return (chips[1]?.getAttribute('data-sheet-members') || '').split(' ')[0];
        });

        await page.locator('[data-cad-feature-strip] [data-feature-id="sheet:base"]').click();
        const baseCard = await page.waitForSelector('[data-sheet-metal-base]', { timeout: 8000 }).then(() => true).catch(() => false);
        const baseOpen = await page.evaluate(ribbonOf);
        check(`${label}: tapping Base opens its card and keeps every bend`,
          baseCard
          && (baseOpen?.chips || []).map((chip) => chip.kind).join(',') === 'sheetBase,sheetBend,sheetBend,sheetTab'
          && baseOpen?.chips[0]?.pressed === true,
          JSON.stringify(baseOpen));
        await page.locator('[data-sheet-metal-base] [data-sm-back]').click();
        await page.waitForSelector('[data-sheet-metal-step="edit"]', { timeout: 8000 });

        await page.locator('[data-cad-feature-strip] [data-sheet-kind="bend"]').first().click();
        const bendCard = await page.waitForSelector('[data-sheet-metal-bend]', { timeout: 8000 }).then(() => true).catch(() => false);
        const bendOpen = await page.evaluate(ribbonOf);
        check(`${label}: tapping a bend opens its card`,
          bendCard && bendOpen?.chips[1]?.pressed === true && bendOpen?.chips[0]?.pressed === false,
          JSON.stringify(bendOpen));
        await page.locator('[data-sheet-metal-bend] [data-sm-back]').click();
        await page.waitForFunction(() => !window.document.querySelector('[data-sheet-metal-bend]'), null, { timeout: 8000 });

        await page.locator('[data-cad-feature-strip] [data-sheet-kind="tab"]').first().click();
        await page.waitForSelector('[data-sheet-metal-tab]', { timeout: 8000 });
        await page.locator('[data-sheet-metal-tab] [data-sm-delete]').click();
        const tabDialog = await page.locator('[data-sm-delete-dialog]').count();
        await page.locator('[data-delete-undo-toast]').waitFor({ timeout: 8000 });
        const tabToast = await page.evaluate(() => {
          const root = window.document.querySelector('[data-delete-undo-toast]');
          const undo = root?.querySelector('[data-error-undo]');
          const box = undo?.getBoundingClientRect();
          return {
            text: (root?.innerText || '').replace(/\s+/g, ' ').trim(),
            width: box?.width || 0,
          };
        });
        check(`${label}: an unused tab deletes now, with the Deleted toast`,
          tabDialog === 0 && tabToast.text.includes('Deleted.') && tabToast.width >= 44,
          JSON.stringify({ tabDialog, tabToast }));
        await page.locator('[data-delete-undo-toast] [data-error-undo]').click();
        const tabRestored = await page.waitForFunction((before) => {
          const text = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
          return text === before;
        }, saved, { timeout: 15000 }).then(() => true).catch(() => false);
        check(`${label}: Undo puts that tab back in one step`, tabRestored);

        await page.locator('[data-sheet-tool="tab"]').click();
        const childTab = await acceptFeature('[data-sheet-metal-tab]', { kind: 'edge', panel: bendId, edge: 'u+' });
        const holePoint = await page.evaluate(scriptOf).then((text) => {
          const live = readSheetMetalSpec(text);
          const panel = panelById(solveSheet(live), bendId);
          if (!panel) return null;
          const u = (panel.u0 + panel.u1) / 2;
          const v = (panel.v0 + panel.v1) / 2;
          return panelPoint(panel, u, v, 0);
        });
        await page.locator('[data-sheet-tool="hole"]').click();
        const childHole = await (async () => {
          const opened = await page.evaluate((next) => {
            window.__SHEET__?.tap(next);
            return !!window.__SHEET__;
          }, { kind: 'panel', panel: bendId, point: holePoint });
          if (!opened) return false;
          const card = await page.waitForSelector('[data-sheet-metal-hole]', { timeout: 8000 }).then(() => true).catch(() => false);
          if (!card) return false;
          await page.locator('[data-sm-next]').click();
          const aimed = await page.waitForFunction(() => {
            const sketch = window.__VIEWPORT__?.stageContourSketch?.();
            return sketch?.entry === 'hole'
              && sketch.planeCard === false
              && window.document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done';
          }, null, { timeout: 8000 }).then(() => true).catch(() => false);
          if (!aimed) return false;
          await page.locator('[data-contour-tool="polyline"]').click();
          const hit = await page.evaluate((world) => {
            const p = window.__VIEWPORT__.stageProject(world);
            const canvas = window.document.querySelector('.viewport-shell > canvas');
            if (!p || !canvas) return null;
            const el = window.document.elementFromPoint(p.x, p.y);
            return { x: p.x, y: p.y, ok: el === canvas };
          }, holePoint);
          if (!hit?.ok) return false;
          await page.mouse.click(hit.x, hit.y);
          const placed = await page.waitForFunction(() => (
            window.__VIEWPORT__.stageContourSketch().points === 1
          ), null, { timeout: 4000 }).then(() => true).catch(() => false);
          if (!placed) return false;
          await page.locator('[data-contour-confirm]').click();
          return page.waitForFunction(() => !window.document.querySelector('[data-contour-exit]'), null, { timeout: 15000 })
            .then(() => true).catch(() => false);
        })();
        const refNote = "// refKey: 'wall:b2:u+:w0'";
        await page.evaluate((note) => {
          const model = window.monaco.editor.getModels()[0];
          const text = model.getValue();
          if (!text.includes(note)) model.setValue(`${note}\n${text}`);
        }, refNote);
        await page.waitForTimeout(1600);
        const withChildren = await page.evaluate(scriptOf);
        await page.locator(`[data-cad-feature-strip] [data-feature-id="sheet:bend:${bendId}"]`).click();
        await page.waitForSelector('[data-sheet-metal-bend]', { timeout: 8000 });
        await page.locator('[data-sheet-metal-bend] [data-sm-delete]').click();
        await page.locator('[data-sm-delete-dialog]').waitFor({ timeout: 8000 });
        const confirmLabel = ((await page.locator('[data-sm-delete-confirm]').innerText()) || '').replace(/\s+/g, ' ').trim();
        check(`${label}: a bend with a tab and a hole confirms, and a wall ref stays out`,
          childTab && childHole && !!holePoint
          && withChildren.includes(refNote)
          && confirmLabel === 'Delete along with 2 features',
          JSON.stringify({ childTab, childHole, holePoint, confirmLabel, bendId }));
        await page.locator('[data-sm-delete-confirm]').click();
        await page.locator('[data-delete-undo-toast]').waitFor({ timeout: 8000 });
        await page.locator('[data-delete-undo-toast] [data-error-undo]').click();
        const bendRestored = await page.waitForFunction((before) => {
          const text = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
          return text === before;
        }, withChildren, { timeout: 15000 }).then(() => true).catch(() => false);
        const restoredSpec = readSheetMetalSpec(await page.evaluate(scriptOf));
        check(`${label}: one undo restores that bend, its tab, and its hole`,
          bendRestored
          && (restoredSpec?.bends || []).some((row) => row.id === bendId)
          && (restoredSpec?.tabs || []).some((row) => row.panel === bendId)
          && (restoredSpec?.holes || []).some((row) => row.panel === bendId),
          JSON.stringify({ bendRestored, bends: restoredSpec?.bends?.length, tabs: restoredSpec?.tabs?.length, holes: restoredSpec?.holes?.length }));

        const mixed = withNeighbors(withChildren);
        await page.evaluate((text) => {
          window.monaco.editor.getModels()[0].setValue(text);
        }, mixed);
        await page.locator('[data-sheet-tool="hole"]').click();
        await page.waitForFunction(() => {
          const root = window.document.querySelector('[data-cad-feature-strip] [data-feature-strip]');
          const chips = [...(root?.querySelectorAll('[data-feature-chip]') || [])].map((el) => el.getAttribute('data-feature-chip'));
          return chips[0] === 'cube' && chips.includes('extrude');
        }, null, { timeout: 10000 });
        const mix = await page.evaluate(ribbonOf);
        check(`${label}: a mixed part keeps every feature in script order`,
          (mix?.chips || []).map((chip) => chip.kind).join(',')
            === 'cube,fillet,sheetBase,sheetBend,sheetBend,sheetTab,sheetTab,extrude',
          JSON.stringify(mix));
        const shot = join(shotDir, `sheet-ribbon-${label}.png`);
        await page.screenshot({ path: shot });
        console.log(`  shot ${shot}`);

        await page.locator('[data-sheet-metal-mode] [data-feature-card-cancel]').click();
        await page.waitForFunction(() => !window.document.querySelector('[data-sheet-metal-mode]'), null, { timeout: 10000 });
        await page.evaluate(() => {
          const rows = [...window.document.querySelectorAll('[data-part-row]')];
          const part = rows.find((el) => el.getClientRects().length) || rows[0];
          if (part && part.getAttribute('data-part-selected') !== 'true') part.click();
        });
        await page.waitForFunction(() => {
          const chips = [...window.document.querySelectorAll('[data-cad-feature-strip] [data-feature-chip]')];
          const kinds = chips.map((el) => el.getAttribute('data-feature-chip'));
          return kinds.includes('sheetBase') && kinds.includes('cube');
        }, null, { timeout: 10000 }).catch(() => null);
        const closed = await page.evaluate(ribbonOf);
        const closedKinds = (closed?.chips || []).map((chip) => chip.kind);
        check(`${label}: closing the flow keeps Base and the other features on the one strip`,
          !closed?.ribbon && closedKinds.includes('sheetBase') && closedKinds.includes('cube')
          && !closedKinds.includes('sheetMetal') && errors.length === 0,
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
