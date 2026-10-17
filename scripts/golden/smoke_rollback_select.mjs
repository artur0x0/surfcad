#!/usr/bin/env node
/**
 * Using the rollback bar keeps the part selected. A mouseup on the canvas
 * that did not start there does not switch the strip to assembly joints.
 * A tap that starts and ends on empty canvas does.
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
const PREFIX = [CUBE, 'return part;', ''].join('\n');

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
import { renderRollbackSelectShot } from '/scripts/golden/rollback_select_shot.js';
renderRollbackSelectShot(document.getElementById('root'), {
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

function stripState() {
  const root = window.document.querySelector('[data-shot-feature-row] [data-feature-strip]');
  return {
    part: window.__PART__ || '',
    joints: !!root?.hasAttribute('data-assembly-joints'),
    features: !!root?.querySelector('[data-feature-id="cube1"]'),
    anchor: root?.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') || '',
    error: window.document.querySelector('[data-execution-error]')?.textContent || '',
  };
}

async function runSize(label, compact, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  try {
    await page.waitForFunction(() => window.__MESH__ === true || typeof window.__MESH_ERROR__ === 'string', null, { timeout: 120000 });
  } catch (err) {
    const state = await page.evaluate(() => ({ mesh: window.__MESH__, error: window.__MESH_ERROR__ }));
    console.log(label, 'state', state, errors.slice(0, 6));
    throw err;
  }
  const meshError = await page.evaluate(() => window.__MESH_ERROR__ || '');
  if (meshError) throw new Error(`${label} mesh: ${meshError}`);

  const leaked = await page.evaluate(() => {
    const canvas = window.document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new window.MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: rect.left + 6,
      clientY: rect.bottom - 6,
    }));
    const root = window.document.querySelector('[data-shot-feature-row] [data-feature-strip]');
    return {
      part: window.__PART__ || '',
      joints: !!root?.hasAttribute('data-assembly-joints'),
      features: !!root?.querySelector('[data-feature-id="fillet1"]'),
    };
  });
  check(`${label}: a canvas mouseup without a press keeps the part`,
    leaked.part === 'part' && !leaked.joints && leaked.features,
    JSON.stringify(leaked));

  const bar = await page.locator('[data-rollback-bar]').boundingBox();
  if (!bar) throw new Error(`${label} bar missing`);
  await page.mouse.move(bar.x + bar.width / 2, bar.y + 4);
  await page.mouse.down();
  await page.mouse.up();
  const tapped = await page.evaluate(stripState);
  check(`${label}: releasing the bar keeps the part`,
    tapped.part === 'part' && !tapped.joints && tapped.features && !tapped.error,
    JSON.stringify(tapped));

  const mid = await page.evaluate(() => {
    const fillet = window.document.querySelector('[data-feature-id="fillet1"]').getBoundingClientRect();
    const shell = window.document.querySelector('[data-feature-id="shell1"]').getBoundingClientRect();
    return { x: (fillet.right + shell.left) / 2, y: (fillet.top + fillet.bottom) / 2 };
  });
  await page.evaluate(() => { window.__ROLLBACK_DONE__ = ''; });
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__ROLLBACK_DONE__ === 'fillet1', null, { timeout: 60000 });
  const dragged = await page.evaluate(stripState);
  check(`${label}: dragging the bar keeps the part and moves the anchor`,
    dragged.part === 'part' && !dragged.joints && dragged.features && dragged.anchor === 'fillet1' && !dragged.error,
    JSON.stringify(dragged));

  const shotPath = join(shotDir, `rollback-select-${label}.png`);
  await page.screenshot({ path: shotPath });
  console.log(`  shot ${shotPath}`);

  const spots = [
    { x: 10, y: 150 },
    { x: width - 16, y: 170 },
    { x: 10, y: Math.floor(height * 0.72) },
    { x: width - 16, y: Math.floor(height * 0.72) },
    { x: 12, y: height - 28 },
  ];
  let emptied = await page.evaluate(stripState);
  for (const spot of spots) {
    if (emptied.part === 'assembly') break;
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(50);
    emptied = await page.evaluate(stripState);
    emptied.spot = spot;
  }
  check(`${label}: a tap on empty canvas releases the part`,
    emptied.part === 'assembly' && emptied.joints && !emptied.features,
    JSON.stringify(emptied));

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
  console.log(`\nrollback select: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nrollback select: all checks passed');
process.exit(0);
