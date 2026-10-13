#!/usr/bin/env node
/**
 * The painted rollback bar and the anchor that blanks the script stay the
 * same through Accept, undo, redo, delete, reload, and a part switch.
 * A stale id sits at the end and runs the full solid. It does not jump
 * to the start.
 *
 * Shots: 390×844 and 1280×900, under GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global window */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';
import { markerWithId } from '../../src/utils/featureBlockId.js';
import {
  CUBE_BEGIN,
  CUBE_END,
  SHELL_BEGIN,
  SHELL_END,
} from '../../src/utils/helperPaletteSnippets.js';

const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
mkdirSync(shotDir, { recursive: true });

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function region(begin, end, id, body) {
  return `${markerWithId(begin, id)}\n${body}\n${markerWithId(end, id)}`;
}

const SCRIPT = [
  region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true);'),
  region(SHELL_BEGIN, SHELL_END, 'shell1', "part = hollow(part, 2, 'z');"),
  'return part;',
  '',
].join('\n');

const OTHER = [
  region(CUBE_BEGIN, CUBE_END, 'cubeB', 'let part = Manifold.cube([10, 30, 8], true);'),
  'return part;',
  '',
].join('\n');

const htmlFor = (compact) => `<!doctype html><meta charset="utf-8">
<div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module">
import '/src/index.css';
import { renderRollbackSyncShot } from '/scripts/golden/rollback_sync_shot.js';
renderRollbackSyncShot(document.getElementById('root'), {
  compact: ${compact ? 'true' : 'false'},
  script: ${JSON.stringify(SCRIPT)},
  otherScript: ${JSON.stringify(OTHER)},
});
window.__READY__ = true;
</script>`;

const vite = await createVite({
  root: new URL('../..', import.meta.url).pathname,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
const server = createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url.startsWith('/?')) {
    const compact = url.includes('compact=1');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(htmlFor(compact));
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end('no');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader'],
});

function readBars() {
  const measure = (orientation) => {
    const root = window.document.querySelector(`[data-feature-strip-orientation="${orientation}"]`);
    const track = root?.querySelector('[data-feature-bar-track]');
    const bar = root?.querySelector('[data-rollback-bar]');
    const chips = [...(track?.querySelectorAll('[data-feature-id]') || [])];
    if (!track || !bar || !chips.length) return null;
    const vertical = orientation === 'vertical';
    const trackRect = track.getBoundingClientRect();
    const extent = (chip) => {
      const box = chip.getBoundingClientRect();
      let left = box.left;
      let right = box.right;
      let top = box.top;
      let bottom = box.bottom;
      chip.querySelectorAll('[data-feature-type-badge], [data-feature-separate-body], [data-contour-unused-dot]').forEach((mark) => {
        const markBox = mark.getBoundingClientRect();
        if (markBox.width <= 0 || markBox.height <= 0) return;
        left = Math.min(left, markBox.left);
        right = Math.max(right, markBox.right);
        top = Math.min(top, markBox.top);
        bottom = Math.max(bottom, markBox.bottom);
      });
      return { left, right, top, bottom };
    };
    const boxes = chips.map(extent);
    const endPad = 4;
    const gaps = [];
    if (vertical) {
      gaps.push(boxes[0].top - trackRect.top);
      for (let i = 1; i < boxes.length; i += 1) {
        gaps.push(((boxes[i - 1].bottom + boxes[i].top) / 2) - trackRect.top);
      }
      gaps.push(boxes[boxes.length - 1].bottom - trackRect.top + endPad);
    } else {
      gaps.push(boxes[0].left - trackRect.left);
      for (let i = 1; i < boxes.length; i += 1) {
        gaps.push(((boxes[i - 1].right + boxes[i].left) / 2) - trackRect.left);
      }
      gaps.push(boxes[boxes.length - 1].right - trackRect.left + endPad);
    }
    const barRect = bar.getBoundingClientRect();
    const center = vertical
      ? ((barRect.top + barRect.bottom) / 2) - trackRect.top
      : ((barRect.left + barRect.right) / 2) - trackRect.left;
    const index = Number(bar.getAttribute('data-rollback-index'));
    const gap = Number.isFinite(index) ? gaps[index] : null;
    return {
      anchor: bar.getAttribute('data-rollback-anchor') || '',
      index,
      center,
      gap,
      delta: gap == null ? null : Math.abs(center - gap),
      startDelta: Math.abs(center - gaps[0]),
      ids: chips.map((chip) => chip.getAttribute('data-feature-id')),
    };
  };
  const last = window.__LAST__ || {};
  return {
    row: measure('horizontal'),
    rail: measure('vertical'),
    label: last.anchorLabel || '',
    skip: last.skipIds || null,
    rolled: last.rolled,
    sig: last.sig || '',
    volume: last.volume,
    ok: last.ok === true,
    error: last.error || '',
    prefix: window.__PREFIX__ || null,
    full: window.__FULL__ || null,
  };
}

function sameIds(row, rail) {
  return !!row && !!rail && row.ids.join(',') === rail.ids.join(',');
}

function aligned(view) {
  return view.row
    && view.rail
    && view.row.anchor === view.label
    && view.rail.anchor === view.label
    && view.row.index === view.rail.index
    && view.row.delta != null
    && view.rail.delta != null
    && view.row.delta <= 2
    && view.rail.delta <= 2
    && sameIds(view.row, view.rail);
}

async function step(page, token) {
  await page.locator(`[data-rollback-sync="${token}"]`).click();
  await page.waitForFunction((name) => window.__STEP__ === name, token, { timeout: 120000 });
  return page.evaluate(readBars);
}

async function runSize(label, compact, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__STEP__ === 'ready' || typeof window.__MESH_ERROR__ === 'string', null, { timeout: 120000 });
  const meshError = await page.evaluate(() => window.__MESH_ERROR__ || '');
  if (meshError) throw new Error(`${label} mesh: ${meshError}`);

  const ready = await page.evaluate(readBars);
  check(`${label}: ready bar matches the cube anchor`,
    aligned(ready) && ready.label === 'cube1' && ready.row.startDelta > 8,
    JSON.stringify({ row: ready.row, rail: ready.rail, label: ready.label }));
  check(`${label}: ready run rolls back the shell`,
    ready.ok && Array.isArray(ready.rolled) && ready.rolled.join(',') === 'shell1' && ready.skip.join(',') === 'shell1',
    JSON.stringify({ rolled: ready.rolled, skip: ready.skip }));
  check(`${label}: ready solid is the cube, not the shell`,
    ready.prefix && ready.full && ready.sig === ready.prefix.sig && ready.sig !== ready.full.sig
      && ready.volume === ready.prefix.volume && ready.volume !== ready.full.volume,
    `${ready.volume} / ${ready.prefix?.volume} / ${ready.full?.volume}`);

  const accepted = await step(page, 'accept');
  if (accepted.error) throw new Error(`${label} accept: ${accepted.error}`);
  const filletId = (accepted.row?.ids || []).find((id) => id !== 'cube1' && id !== 'shell1') || '';
  check(`${label}: accept bar sits on the fillet, not the start`,
    aligned(accepted) && accepted.label === filletId && filletId && accepted.row.anchor !== 'start' && accepted.row.startDelta > 8,
    JSON.stringify({ label: accepted.label, row: accepted.row }));
  check(`${label}: accept rolls back only the shell`,
    accepted.ok && accepted.rolled?.join(',') === 'shell1' && accepted.skip?.join(',') === 'shell1' && !accepted.rolled?.includes(filletId),
    JSON.stringify({ rolled: accepted.rolled, skip: accepted.skip }));
  check(`${label}: accept changes the solid`,
    accepted.sig && accepted.sig !== ready.prefix.sig && accepted.sig !== ready.full.sig
      && accepted.volume !== ready.prefix.volume && accepted.volume !== ready.full.volume,
    `${accepted.volume} vs ${ready.prefix.volume} / ${ready.full.volume}`);

  const undone = await step(page, 'undo');
  if (undone.error) throw new Error(`${label} undo: ${undone.error}`);
  check(`${label}: undo keeps a stale id at the end, not the start`,
    aligned(undone) && undone.label === 'end' && undone.row.anchor !== 'start' && undone.row.startDelta > 8,
    JSON.stringify({ label: undone.label, row: undone.row, rail: undone.rail }));
  check(`${label}: undo runs the full shelled solid`,
    undone.ok && undone.rolled?.length === 0 && undone.skip?.length === 0
      && undone.sig === ready.full.sig && undone.volume === ready.full.volume,
    `${undone.volume} vs ${ready.full.volume} rolled ${JSON.stringify(undone.rolled)}`);

  const redone = await step(page, 'redo');
  if (redone.error) throw new Error(`${label} redo: ${redone.error}`);
  check(`${label}: redo puts the bar back on the fillet`,
    aligned(redone) && redone.label === filletId && redone.row.anchor !== 'start',
    JSON.stringify({ label: redone.label, row: redone.row }));
  check(`${label}: redo restores the filleted solid`,
    redone.ok && redone.sig === accepted.sig && redone.volume === accepted.volume
      && redone.rolled?.join(',') === 'shell1',
    `${redone.volume} vs ${accepted.volume}`);

  const deleted = await step(page, 'delete');
  if (deleted.error) throw new Error(`${label} delete: ${deleted.error}`);
  check(`${label}: deleting the anchor feature sits the bar at the end`,
    aligned(deleted) && deleted.label === 'end' && deleted.row.anchor !== 'start' && deleted.row.startDelta > 8
      && !(deleted.row.ids || []).includes(filletId),
    JSON.stringify({ label: deleted.label, ids: deleted.row?.ids }));
  check(`${label}: delete runs the remaining shelled solid`,
    deleted.ok && deleted.rolled?.length === 0 && deleted.sig === ready.full.sig && deleted.volume === ready.full.volume,
    `${deleted.volume} vs ${ready.full.volume}`);

  const reloaded = await step(page, 'reload');
  if (reloaded.error) throw new Error(`${label} reload: ${reloaded.error}`);
  check(`${label}: reload drops the bar to the end`,
    aligned(reloaded) && reloaded.label === 'end' && reloaded.row.anchor !== 'start' && reloaded.row.startDelta > 8,
    JSON.stringify({ label: reloaded.label, row: reloaded.row }));
  check(`${label}: reload runs the full remaining solid`,
    reloaded.ok && reloaded.sig === ready.full.sig && reloaded.volume === ready.full.volume && reloaded.rolled?.length === 0,
    `${reloaded.volume}`);

  const partB = await step(page, 'part-b');
  if (partB.error) throw new Error(`${label} part B: ${partB.error}`);
  check(`${label}: part B bar is at the end of its own strip`,
    aligned(partB) && partB.label === 'end' && partB.row.ids.join(',') === 'cubeB' && partB.row.startDelta > 8,
    JSON.stringify({ label: partB.label, ids: partB.row?.ids }));
  check(`${label}: part B is a different solid`,
    partB.ok && partB.sig !== ready.full.sig && partB.sig !== ready.prefix.sig && partB.volume !== ready.full.volume,
    `${partB.volume}`);

  const partA = await step(page, 'part-a');
  if (partA.error) throw new Error(`${label} part A: ${partA.error}`);
  check(`${label}: switching back restores the cube anchor`,
    aligned(partA) && partA.label === 'cube1' && partA.row.ids.join(',') === 'cube1,shell1' && partA.row.startDelta > 8,
    JSON.stringify({ label: partA.label, ids: partA.row?.ids }));
  check(`${label}: switching back restores the cube solid`,
    partA.ok && partA.sig === ready.prefix.sig && partA.volume === ready.prefix.volume && partA.rolled?.join(',') === 'shell1',
    `${partA.volume} vs ${ready.prefix.volume}`);

  const shotPath = join(shotDir, `rollback-sync-${label}.png`);
  await page.screenshot({ path: shotPath });
  console.log(`  shot ${shotPath}`);
  if (errors.length) console.log(`  ${label} page errors`, errors.slice(0, 4).join('\n'));
  await page.close();
}

try {
  await runSize('390', true, 390, 844);
  await runSize('1280', false, 1280, 900);
} finally {
  await browser.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\nrollback sync: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nrollback sync: all checks passed');
process.exit(0);
