#!/usr/bin/env node
/**
 * Insert while the rollback bar sits after the fillet. The new cube lands
 * in that gap, the bar moves onto it, and the shell stays dim. The solid
 * is the prefix plus the cube, not the shelled part.
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

const SCRIPT = [
  region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true);'),
  region(
    FILLET_MODE_BEGIN,
    FILLET_MODE_END,
    'fillet1',
    [
      'const selEdges = edgesBetween(part, 0, 6);',
      'const path = makeSweepPath(selEdges);',
      'part = filletAlongPath(part, path, 2);',
    ].join('\n'),
  ),
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
import { renderRollbackInsertShot } from '/scripts/golden/rollback_insert_shot.js';
renderRollbackInsertShot(document.getElementById('root'), {
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
attachConsentPresetToBrowser(browser);

async function runSize(label, compact, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  try {
    await page.waitForFunction(() => {
      const bar = window.document.querySelector('[data-rollback-bar]');
      const fillet = window.document.querySelector('[data-feature-id="fillet1"]');
      const shell = window.document.querySelector('[data-feature-id="shell1"]');
      if (!bar || !fillet || !shell || window.__MESH__ !== true) return typeof window.__MESH_ERROR__ === 'string';
      const barMid = bar.getBoundingClientRect();
      const mid = (fillet.getBoundingClientRect().right + shell.getBoundingClientRect().left) / 2;
      return bar.getAttribute('data-rollback-anchor') === 'fillet1'
        && Math.abs((barMid.left + barMid.width / 2) - mid) < 28;
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

  await page.locator('[data-rollback-insert]').click();
  await page.waitForFunction(() => window.__INSERT_DONE__ && window.__INSERT_DONE__ !== '', null, { timeout: 120000 });
  const insertError = await page.evaluate(() => window.__INSERT_ERROR__ || '');
  if (insertError) throw new Error(`${label} insert: ${insertError}`);

  const view = await page.evaluate(() => {
    const read = (id) => {
      const node = window.document.querySelector(`[data-feature-id="${id}"]`);
      return {
        rolled: node?.getAttribute('data-feature-rolled-back') || '',
        opacity: node ? window.getComputedStyle(node).opacity : '',
      };
    };
    const ids = [...window.document.querySelectorAll('[data-feature-id]')].map((node) => node.getAttribute('data-feature-id'));
    return {
      anchor: window.document.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') || '',
      ids,
      cube: read('cube1'),
      fillet: read('fillet1'),
      shell: read('shell1'),
      script: window.__INSERTED_SCRIPT__ || '',
      prefix: window.__PREFIX_SIG__ || '',
      anchored: window.__ANCHORED_SIG__ || '',
      full: window.__FULL_SIG__ || '',
    };
  });
  const newId = view.ids.find((id) => id !== 'cube1' && id !== 'fillet1' && id !== 'shell1') || '';
  const newChip = await page.evaluate((id) => {
    const node = window.document.querySelector(`[data-feature-id="${id}"]`);
    return {
      rolled: node?.getAttribute('data-feature-rolled-back') || '',
      opacity: node ? window.getComputedStyle(node).opacity : '',
    };
  }, newId);
  check(`${label}: new cube sits between the fillet and the shell`,
    view.ids.join(',') === `cube1,fillet1,${newId},shell1`, view.ids.join(','));
  check(`${label}: bar moves onto the new cube`, view.anchor === newId, view.anchor);
  check(`${label}: new cube is live`, !newChip.rolled && newChip.opacity === '1', JSON.stringify(newChip));
  check(`${label}: shell stays dim`,
    view.shell.rolled === '1' && view.shell.opacity === '0.4', JSON.stringify(view.shell));
  check(`${label}: cube and fillet stay live`,
    !view.cube.rolled && view.cube.opacity === '1' && !view.fillet.rolled && view.fillet.opacity === '1',
    JSON.stringify({ cube: view.cube, fillet: view.fillet }));
  check(`${label}: solid is the prefix plus the cube`,
    view.anchored && view.anchored !== view.prefix && view.anchored !== view.full,
    `${view.prefix} / ${view.anchored} / ${view.full}`);
  check(`${label}: the shell is still in the script`,
    view.script.includes("hollow(part, 2, 'z')"));

  const shotPath = join(shotDir, `rollback-insert-${label}.png`);
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
  console.log(`\nrollback insert: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nrollback insert: all checks passed');
process.exit(0);
