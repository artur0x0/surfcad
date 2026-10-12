#!/usr/bin/env node
/**
 * Fillet Accept while the rollback bar sits after the cube. The fillet
 * lands in that gap, the bar moves onto it, and the shell stays grey and
 * titled rolled back on the strip and the rail. The solid is the filleted
 * cube, not the cube and not the shelled part. The run names the shell.
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
import { renderRollbackAcceptShot } from '/scripts/golden/rollback_accept_shot.js';
renderRollbackAcceptShot(document.getElementById('root'), {
  compact: ${compact ? 'true' : 'false'},
  script: ${JSON.stringify(SCRIPT)},
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

function grey(chip) {
  return chip
    && chip.rolled === '1'
    && chip.opacity === '0.4'
    && /grayscale/i.test(chip.filter || '')
    && /rolled back/i.test(chip.title || '')
    && /rolled back/i.test(chip.label || '');
}

function live(chip) {
  return chip
    && !chip.rolled
    && chip.opacity === '1'
    && !/rolled back/i.test(chip.title || '')
    && !/grayscale/i.test(chip.filter || '');
}

async function runSize(label, compact, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  try {
    await page.waitForFunction(() => {
      const row = window.document.querySelector('[data-feature-strip-orientation="horizontal"]');
      const rail = window.document.querySelector('[data-feature-strip-orientation="vertical"]');
      const shell = row?.querySelector('[data-feature-id="shell1"]');
      const railShell = rail?.querySelector('[data-feature-id="shell1"]');
      if (!row || !rail || !shell || !railShell || window.__MESH__ !== true) {
        return typeof window.__MESH_ERROR__ === 'string';
      }
      return row.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') === 'cube1'
        && shell.getAttribute('data-feature-rolled-back') === '1'
        && railShell.getAttribute('data-feature-rolled-back') === '1';
    }, null, { timeout: 120000 });
  } catch (err) {
    const state = await page.evaluate(() => ({
      mesh: window.__MESH__,
      error: window.__MESH_ERROR__,
      row: window.document.querySelector('[data-feature-strip-orientation="horizontal"]')?.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') || '',
    }));
    console.log(label, 'state', state);
    console.log(label, 'errors', errors.slice(0, 8));
    throw err;
  }
  const meshError = await page.evaluate(() => window.__MESH_ERROR__ || '');
  if (meshError) throw new Error(`${label} mesh: ${meshError}`);

  const before = await page.evaluate(() => {
    const readStrip = (orientation) => {
      const root = window.document.querySelector(`[data-feature-strip-orientation="${orientation}"]`);
      const read = (id) => {
        const node = root?.querySelector(`[data-feature-id="${id}"]`);
        const style = node ? window.getComputedStyle(node) : null;
        return {
          rolled: node?.getAttribute('data-feature-rolled-back') || '',
          opacity: style ? style.opacity : '',
          filter: style ? style.filter : '',
          title: node?.getAttribute('title') || '',
          label: node?.getAttribute('aria-label') || '',
        };
      };
      return {
        anchor: root?.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') || '',
        shell: read('shell1'),
        cube: read('cube1'),
      };
    };
    return {
      row: readStrip('horizontal'),
      rail: readStrip('vertical'),
      rolled: window.__PREFIX_ROLLED__,
    };
  });
  check(`${label}: bar starts after the cube`,
    before.row.anchor === 'cube1' && before.rail.anchor === 'cube1',
    `${before.row.anchor} / ${before.rail.anchor}`);
  check(`${label}: shell is grey and rolled back on the strip`,
    grey(before.row.shell), JSON.stringify(before.row.shell));
  check(`${label}: shell is grey and rolled back on the rail`,
    grey(before.rail.shell), JSON.stringify(before.rail.shell));
  check(`${label}: cube stays live before Accept`,
    live(before.row.cube) && live(before.rail.cube),
    JSON.stringify({ row: before.row.cube, rail: before.rail.cube }));
  check(`${label}: prefix run names the shell`,
    Array.isArray(before.rolled) && before.rolled.join(',') === 'shell1',
    JSON.stringify(before.rolled));

  await page.locator('[data-rollback-accept]').click();
  await page.waitForFunction(() => window.__ACCEPT_DONE__ && window.__ACCEPT_DONE__ !== '', null, { timeout: 120000 });
  const acceptError = await page.evaluate(() => window.__ACCEPT_ERROR__ || window.__FULL_ERROR__ || '');
  if (acceptError) throw new Error(`${label} accept: ${acceptError}`);

  const view = await page.evaluate(() => {
    const readStrip = (orientation) => {
      const root = window.document.querySelector(`[data-feature-strip-orientation="${orientation}"]`);
      const read = (id) => {
        const node = root?.querySelector(`[data-feature-id="${id}"]`);
        const style = node ? window.getComputedStyle(node) : null;
        return {
          rolled: node?.getAttribute('data-feature-rolled-back') || '',
          opacity: style ? style.opacity : '',
          filter: style ? style.filter : '',
          title: node?.getAttribute('title') || '',
          label: node?.getAttribute('aria-label') || '',
        };
      };
      const ids = [...(root?.querySelectorAll('[data-feature-id]') || [])].map((node) => node.getAttribute('data-feature-id'));
      return {
        anchor: root?.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') || '',
        ids,
        cube: read('cube1'),
        shell: read('shell1'),
        chips: Object.fromEntries(ids.map((id) => [id, read(id)])),
      };
    };
    return {
      row: readStrip('horizontal'),
      rail: readStrip('vertical'),
      script: window.__ACCEPTED_SCRIPT__ || '',
      prefix: window.__PREFIX_SIG__ || '',
      anchored: window.__ACCEPT_SIG__ || '',
      full: window.__FULL_SIG__ || '',
      prefixVolume: window.__PREFIX_VOLUME__,
      volume: window.__ACCEPT_VOLUME__,
      rolled: window.__ACCEPT_ROLLED__,
      ok: window.__ACCEPT_OK__ === true,
    };
  });
  const newId = (view.row.ids || []).find((id) => id !== 'cube1' && id !== 'shell1') || '';
  const rowFillet = view.row.chips?.[newId];
  const railFillet = view.rail.chips?.[newId];
  check(`${label}: fillet sits between the cube and the shell`,
    view.row.ids.join(',') === `cube1,${newId},shell1` && view.rail.ids.join(',') === view.row.ids.join(','),
    view.row.ids.join(','));
  check(`${label}: bar moves past the fillet`,
    view.row.anchor === newId && view.rail.anchor === newId && !!newId,
    `${view.row.anchor} / ${view.rail.anchor}`);
  check(`${label}: fillet is live on the strip and the rail`,
    live(rowFillet) && live(railFillet),
    JSON.stringify({ row: rowFillet, rail: railFillet }));
  check(`${label}: shell stays grey and rolled back on the strip`,
    grey(view.row.shell), JSON.stringify(view.row.shell));
  check(`${label}: shell stays grey and rolled back on the rail`,
    grey(view.rail.shell), JSON.stringify(view.rail.shell));
  check(`${label}: cube stays live`,
    live(view.row.cube) && live(view.rail.cube),
    JSON.stringify({ row: view.row.cube, rail: view.rail.cube }));
  check(`${label}: fillet changes the mesh`,
    view.anchored && view.anchored !== view.prefix && view.full && view.anchored !== view.full,
    `${view.prefix} / ${view.anchored} / ${view.full}`);
  check(`${label}: fillet changes the volume`,
    Number.isFinite(view.prefixVolume) && Number.isFinite(view.volume) && view.volume !== view.prefixVolume,
    `${view.prefixVolume} → ${view.volume}`);
  check(`${label}: run names the shell and not the fillet`,
    view.ok && Array.isArray(view.rolled) && view.rolled.includes('shell1') && !view.rolled.includes(newId),
    JSON.stringify(view.rolled));
  check(`${label}: shell stays in the script and the fillet ran`,
    view.script.includes("hollow(part, 2, 'z')") && view.script.includes('filletAlongPath('));

  const shotPath = join(shotDir, `rollback-accept-${label}.png`);
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
  console.log(`\nrollback accept: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nrollback accept: all checks passed');
process.exit(0);
