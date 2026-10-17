#!/usr/bin/env node
/**
 * A feature that throws is skipped, and so are the features that name
 * something it declared. The rest of the part rebuilds.
 *
 * Cube, a fillet that runs, a fillet that throws and declares badContour,
 * a shell that only touches part, and an extrude that names badContour.
 * The recovered solid matches the cube, the good fillet, and the shell.
 * The bad fillet stays "failed on the last run". The extrude is the same
 * red, titled with Fillet 2. The viewer is not blank.
 *
 * Shots: 390×844 and 1280×900, under GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global window */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createServer as createVite } from 'vite';
import { createServer } from 'node:http';
import { markerWithId } from '../../src/utils/featureBlockId.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';
import {
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
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
const GOOD_FILLET = region(
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
  'fillet1',
  [
    'const selEdges = edgesBetween(part, 0, 6);',
    'const path = makeSweepPath(selEdges);',
    'part = filletAlongPath(part, path, 2);',
  ].join('\n'),
);
const BAD_FILLET = region(
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
  'fillet2',
  [
    'const selEdges2 = edgesBetween(part, 90, 91);',
    'const badContour = { plane: {}, contours: [] };',
    'const path2 = makeSweepPath(selEdges2);',
    'part = filletAlongPath(part, path2, 2);',
  ].join('\n'),
);
const SHELL = region(SHELL_BEGIN, SHELL_END, 'shell1', "part = hollow(part, 2, 'z');");
const EXTRUDE = region(
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
  'extrude1',
  'part = part.add(placeInFrame(badContour.plane, makeExtrude(badContour.contours, 10), [0, 0, 0]));',
);
const MID = [CUBE, GOOD_FILLET, BAD_FILLET, SHELL, EXTRUDE, 'return part;', ''].join('\n');
const CONTROL = [CUBE, GOOD_FILLET, SHELL, 'return part;', ''].join('\n');
const TOTAL = [
  region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true).nope();'),
  GOOD_FILLET,
  'return part;',
  '',
].join('\n');

register('./manifold-resolve-hook.mjs', import.meta.url);
const pending = new Map();
let msgId = 0;
const workerSelf = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    waiter.resolve(msg);
  },
};
globalThis.self = workerSelf;
function send(type, payload = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, { resolve });
    Promise.resolve().then(() => workerSelf.onmessage({ data: { type, payload, id } }));
  });
}
await import('../../src/workers/sandboxWorker.js');
await send('init');
const run = (script) => send('execute', { script, importedModels: {}, memoryLimitMB: 512 });

console.log('feature skip mid-chain — recover the solid, mark the failure and its dependent');

{
  const ids = parseFeatureMarkers(MID).map((feature) => feature.id);
  check('the chain is cube, two fillets, shell, extrude', ids.join(',') === 'cube1,fillet1,fillet2,shell1,extrude1', ids.join(','));
  const badLine = MID.split('\n').findIndex((line) => line.includes('edgesBetween(part, 90, 91)')) + 1;
  const mid = await run(MID);
  const skip = mid.payload?.featureSkip;
  const dep = skip?.skipped?.find((row) => row.id === 'extrude1');
  check('the run returns a solid', mid.type === 'result' && mid.payload?.volume > 0, mid.payload?.message || mid.type);
  check('the report names the bad fillet and its script line',
    skip?.featureId === 'fillet2' && skip?.scriptLine === badLine, JSON.stringify(skip && { featureId: skip.featureId, scriptLine: skip.scriptLine }));
  check('the extrude is skipped because it depends on that fillet',
    !!dep && dep.threw === false && dep.dependsOn === 'fillet2', JSON.stringify(dep));
  check('the shell and the good fillet stay in the run',
    !skip?.skipped?.some((row) => row.id === 'shell1' || row.id === 'fillet1' || row.id === 'cube1'));
  const control = await run(CONTROL);
  const delta = Math.abs((mid.payload?.volume || 0) - (control.payload?.volume || 0));
  check('the solid matches cube + good fillet + shell',
    control.type === 'result' && delta < 1e-3,
    `mid ${mid.payload?.volume} control ${control.payload?.volume}`);
  check('the user script still contains the skipped blocks',
    MID.includes('const badContour') && MID.includes('makeExtrude'));

  const total = await run(TOTAL);
  const thrownLater = total.payload?.featureSkip?.skipped?.find((row) => row.id === 'fillet1');
  check('a part with no surviving solid stays an error on the first block',
    total.type === 'error' && total.payload?.featureId === 'cube1', total.payload?.message);
  check('that error still names the fillet that threw after the cube was skipped',
    thrownLater?.threw === true, JSON.stringify(total.payload?.featureSkip));

  const syntax = await run('let part = ;\nreturn part;\n');
  check('a syntax error stays an error with no skip report',
    syntax.type === 'error' && !syntax.payload?.featureSkip);
  const bare = await run('let part = Manifold.cube([1, 1, 1], true);\nreturn 5;\n');
  check('a bad return outside every block stays an error',
    bare.type === 'error' && bare.payload?.featureId == null);
}

if (failed) {
  console.log(`\nfeature skip mid-chain: ${failed} check(s) failed`);
  process.exit(1);
}

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
import { renderFeatureSkipMidchainShot } from '/scripts/golden/feature_skip_midchain_shot.js';
renderFeatureSkipMidchainShot(document.getElementById('root'), {
  compact: ${compact ? 'true' : 'false'},
  script: ${JSON.stringify(MID)},
  control: ${JSON.stringify(CONTROL)},
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

function chipOf(chips, id) {
  return chips.find((chip) => chip.id === id) || null;
}

async function runSize(label, compact, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  try {
    await page.waitForFunction(() => {
      const bad = window.document.querySelector('[data-feature-id="fillet2"]');
      return window.__MESH__ === true
        || typeof window.__MESH_ERROR__ === 'string'
        || (bad && bad.getAttribute('data-feature-failed') === '1' && window.__MESH__ === true);
    }, null, { timeout: 120000 });
  } catch (err) {
    const state = await page.evaluate(() => ({
      ready: window.__READY__,
      mesh: window.__MESH__,
      error: window.__MESH_ERROR__,
      verts: window.__VERTS__,
      control: window.__CONTROL_SIG__,
      mid: window.__MID_SIG__,
    }));
    console.log(label, 'state', state);
    console.log(label, 'errors', errors.slice(0, 8));
    throw err;
  }
  const meshError = await page.evaluate(() => window.__MESH_ERROR__ || '');
  if (meshError) throw new Error(`${label} mesh: ${meshError}`);

  const shotPath = join(shotDir, `feature-skip-midchain-${label}.png`);
  await page.screenshot({ path: shotPath });
  console.log(`  shot ${shotPath}`);

  const view = await page.evaluate(() => {
    const read = (id) => {
      const node = window.document.querySelector(`[data-feature-id="${id}"]`);
      if (!node) return null;
      const border = window.getComputedStyle(node).borderTopColor;
      return {
        id,
        failed: node.getAttribute('data-feature-failed'),
        depends: node.getAttribute('data-feature-depends'),
        title: node.getAttribute('title') || '',
        border,
      };
    };
    const popup = window.document.querySelector('[data-execution-error]');
    const mesh = window.__VIEWPORT__?._lastRenderedMesh;
    return {
      chips: ['cube1', 'fillet1', 'fillet2', 'shell1', 'extrude1'].map(read),
      popup: popup ? (popup.innerText || '').replace(/\s+/g, ' ').trim() : '',
      verts: mesh?.vertProperties?.length || 0,
      script: window.__SCRIPT__ || '',
      sig: window.__MID_SIG__ || '',
      control: window.__CONTROL_SIG__ || '',
    };
  });
  const red = 'rgb(248, 113, 113)';
  const bad = chipOf(view.chips, 'fillet2');
  const dep = chipOf(view.chips, 'extrude1');
  const live = ['cube1', 'fillet1', 'shell1'].map((id) => chipOf(view.chips, id));
  check(`${label}: viewer mesh matches the control solid`,
    view.verts > 0 && view.sig && view.sig === view.control, `verts ${view.verts} ${view.sig} vs ${view.control}`);
  check(`${label}: bad fillet is red and failed on the last run`,
    bad?.failed === '1' && bad.border === red && /failed on the last run/.test(bad.title) && !bad.depends,
    JSON.stringify(bad));
  check(`${label}: extrude is red and skipped, depends on Fillet 2`,
    dep?.failed === '1' && dep.border === red && dep.depends === 'fillet2'
      && dep.title === 'Extrude — skipped, depends on Fillet 2',
    JSON.stringify(dep));
  check(`${label}: cube, good fillet, and shell stay unmarked`,
    live.every((chip) => chip && chip.failed !== '1' && chip.border !== red),
    JSON.stringify(live));
  check(`${label}: error popup is up and the script is unchanged`,
    view.popup.length > 0 && view.script.includes('const badContour') && view.script.includes("hollow(part, 2, 'z')"),
    view.popup.slice(0, 160));
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
  console.log(`\nfeature skip mid-chain: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nfeature skip mid-chain: all checks passed');
process.exit(0);
