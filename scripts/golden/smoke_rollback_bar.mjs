#!/usr/bin/env node
/**
 * Rollback bar. It starts after the last feature. A drag to the mid-chain
 * gap dims the tail and rebuilds the prefix. A drag back to the end
 * restores the solid. The script is not rewritten and the drag does not undo.
 *
 * Shots: 390×844 and 1280×900, under GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global window */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createServer as createVite } from 'vite';
import { markerWithId } from '../../src/utils/featureBlockId.js';
import {
  CUBE_BEGIN,
  CUBE_END,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
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

const CUBE = region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true);');
const FILLET = region(
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
  'fillet1',
  [
    'const selEdges = edgesBetween(part, 0, 6);',
    'const path = makeSweepPath(selEdges);',
    'part = filletAlongPath(part, path, 2);',
  ].join('\n'),
);
const SHELL = region(SHELL_BEGIN, SHELL_END, 'shell1', "part = hollow(part, 2, 'z');");
const FULL = [CUBE, FILLET, SHELL, 'return part;', ''].join('\n');
const PREFIX = [CUBE, FILLET, 'return part;', ''].join('\n');

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
import { renderRollbackBarShot } from '/scripts/golden/rollback_bar_shot.js';
renderRollbackBarShot(document.getElementById('root'), {
  compact: ${compact ? 'true' : 'false'},
  script: ${JSON.stringify(FULL)},
  prefix: ${JSON.stringify(PREFIX)},
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
attachConsentPresetToBrowser(browser);

async function dragBar(page, point) {
  const bar = page.locator('[data-rollback-bar]');
  const box = await bar.boundingBox();
  if (!box) throw new Error('rollback bar has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 12 });
  await page.mouse.up();
}

async function runSize(label, compact, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  try {
    await page.waitForFunction(() => {
      const bar = window.document.querySelector('[data-rollback-bar]');
      const shell = window.document.querySelector('[data-feature-id="shell1"]');
      if (!bar || !shell || window.__MESH__ !== true) return typeof window.__MESH_ERROR__ === 'string';
      const barBox = bar.getBoundingClientRect();
      const shellBox = shell.getBoundingClientRect();
      return bar.getAttribute('data-rollback-anchor') === 'end'
        && barBox.left + barBox.width / 2 >= shellBox.right - 8;
    }, null, { timeout: 120000 });
  } catch (err) {
    const state = await page.evaluate(() => ({
      mesh: window.__MESH__,
      error: window.__MESH_ERROR__,
      anchor: window.document.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') || '',
    }));
    console.log(label, 'state', state);
    console.log(label, 'errors', errors.slice(0, 8));
    throw err;
  }
  const meshError = await page.evaluate(() => window.__MESH_ERROR__ || '');
  if (meshError) throw new Error(`${label} mesh: ${meshError}`);

  const sigs = await page.evaluate(() => ({
    prefix: window.__PREFIX_SIG__,
    full: window.__FULL_SIG__,
  }));
  check(`${label}: bar starts at the end`, true);

  const mid = await page.evaluate(() => {
    const fillet = window.document.querySelector('[data-feature-id="fillet1"]').getBoundingClientRect();
    const shell = window.document.querySelector('[data-feature-id="shell1"]').getBoundingClientRect();
    return {
      x: (fillet.right + shell.left) / 2,
      y: (fillet.top + fillet.bottom) / 2,
    };
  });
  await dragBar(page, mid);
  await page.waitForFunction(() => window.__ROLLBACK_DONE__ === 'fillet1', null, { timeout: 60000 });
  const rolled = await page.evaluate(() => {
    const read = (id) => {
      const node = window.document.querySelector(`[data-feature-id="${id}"]`);
      return {
        rolled: node?.getAttribute('data-feature-rolled-back') || '',
        opacity: node ? window.getComputedStyle(node).opacity : '',
        failed: node?.getAttribute('data-feature-failed') || '',
      };
    };
    return {
      anchor: window.document.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') || '',
      cube: read('cube1'),
      fillet: read('fillet1'),
      shell: read('shell1'),
      sig: window.__MESH_SIG__,
      script: window.__SCRIPT__ || '',
      undos: window.__UNDO_CLICKS__ || 0,
    };
  });
  check(`${label}: mid-chain gap sits after the fillet`, rolled.anchor === 'fillet1', rolled.anchor);
  check(`${label}: tail shell is dim and not red`,
    rolled.shell.rolled === '1' && rolled.shell.opacity === '0.4' && !rolled.shell.failed,
    JSON.stringify(rolled.shell));
  check(`${label}: cube and fillet stay live`,
    !rolled.cube.rolled && rolled.cube.opacity === '1' && !rolled.fillet.rolled && rolled.fillet.opacity === '1',
    JSON.stringify({ cube: rolled.cube, fillet: rolled.fillet }));
  check(`${label}: solid is the prefix`, rolled.sig === sigs.prefix, `${rolled.sig} vs ${sigs.prefix}`);
  check(`${label}: drag leaves the script and does not undo`,
    rolled.script.includes("hollow(part, 2, 'z')") && rolled.undos === 0, String(rolled.undos));

  const geom = await page.evaluate(() => {
    const strip = window.document.querySelector('[data-feature-strip]');
    const mark = window.document.querySelector('[data-rollback-mark]');
    const line = window.document.querySelector('[data-rollback-line]');
    const fillet = window.document.querySelector('[data-feature-id="fillet1"]');
    const shell = window.document.querySelector('[data-feature-id="shell1"]');
    const chips = [...window.document.querySelectorAll('[data-feature-id]')];
    if (!strip || !mark || !line || !fillet || !shell) return null;
    const stripBox = strip.getBoundingClientRect();
    const markBox = mark.getBoundingClientRect();
    const lineBox = line.getBoundingClientRect();
    const filletBox = fillet.getBoundingClientRect();
    const shellBox = shell.getBoundingClientRect();
    const filletBadge = fillet.querySelector('[data-feature-type-badge]')?.getBoundingClientRect();
    const filletRight = Math.max(filletBox.right, filletBadge?.right || 0);
    const overlaps = chips.some((chip) => {
      const chipBox = chip.getBoundingClientRect();
      const overlapX = Math.min(markBox.right, chipBox.right) - Math.max(markBox.left, chipBox.left);
      const overlapY = Math.min(markBox.bottom, chipBox.bottom) - Math.max(markBox.top, chipBox.top);
      return overlapX > 0 && overlapY > 0;
    });
    return {
      tipDelta: markBox.bottom - stripBox.top,
      overlaps,
      centerDelta: (lineBox.left + lineBox.width / 2) - ((filletRight + shellBox.left) / 2),
      clearLeft: lineBox.left - filletRight,
      clearRight: shellBox.left - lineBox.right,
      lineTopDelta: lineBox.top - stripBox.top,
      lineBottomDelta: stripBox.bottom - lineBox.bottom,
    };
  });
  check(`${label}: triangle tip touches the strip top`,
    !!geom && Math.abs(geom.tipDelta) <= 1, JSON.stringify(geom));
  check(`${label}: triangle does not overlap a chip`,
    !!geom && !geom.overlaps, JSON.stringify(geom));
  check(`${label}: line is centred in the gap`,
    !!geom && Math.abs(geom.centerDelta) <= 1, JSON.stringify(geom));
  check(`${label}: line clears each chip by at least 2px`,
    !!geom && geom.clearLeft >= 2 && geom.clearRight >= 2, JSON.stringify(geom));
  check(`${label}: line spans the strip`,
    !!geom && Math.abs(geom.lineTopDelta) <= 1 && Math.abs(geom.lineBottomDelta) <= 1,
    JSON.stringify(geom));

  const shotPath = join(shotDir, `rollback-bar-${label}.png`);
  await page.screenshot({ path: shotPath });
  console.log(`  shot ${shotPath}`);

  const end = await page.evaluate(() => {
    const shell = window.document.querySelector('[data-feature-id="shell1"]').getBoundingClientRect();
    return { x: shell.right + 6, y: shell.top + shell.height / 2 };
  });
  await dragBar(page, end);
  await page.waitForFunction(() => window.__ROLLBACK_DONE__ === 'end', null, { timeout: 60000 });
  const restored = await page.evaluate(() => {
    const shell = window.document.querySelector('[data-feature-id="shell1"]');
    return {
      anchor: window.document.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') || '',
      rolled: shell?.getAttribute('data-feature-rolled-back') || '',
      opacity: shell ? window.getComputedStyle(shell).opacity : '',
      sig: window.__MESH_SIG__,
    };
  });
  check(`${label}: dragging back to the end clears the bar`, restored.anchor === 'end', restored.anchor);
  check(`${label}: the shell is live again`, !restored.rolled && restored.opacity === '1', JSON.stringify(restored));
  check(`${label}: the full solid is back`, restored.sig === sigs.full, `${restored.sig} vs ${sigs.full}`);
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
  console.log(`\nrollback bar: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nrollback bar: all checks passed');
process.exit(0);
