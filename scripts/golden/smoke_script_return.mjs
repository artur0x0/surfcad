#!/usr/bin/env node
/**
 * Study setup, then fillet Accept: one `return part;`, and the fillet
 * changes the solid. Then a Bracket-shaped script (return, study, two
 * fillet blocks, a second return) is repaired and the fillets render.
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
import { CUBE_BEGIN, CUBE_END } from '../../src/utils/helperPaletteSnippets.js';

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

const SCRIPT = [
  `${markerWithId(CUBE_BEGIN, 'extrude2')}`,
  'let part = Manifold.cube([20, 20, 20], true);',
  `${markerWithId(CUBE_END, 'extrude2')}`,
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
import { renderScriptReturnShot } from '/scripts/golden/script_return_shot.js';
renderScriptReturnShot(document.getElementById('root'), {
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

function beforeReturn(view, key) {
  return typeof view[key] === 'number' && view[key] >= 0 && view[key] < view.returnAt;
}

async function runSize(label, compact, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  try {
    await page.waitForFunction(
      () => window.__MESH__ === true || typeof window.__MESH_ERROR__ === 'string',
      null,
      { timeout: 120000 },
    );
  } catch (err) {
    console.log(label, 'errors', errors.slice(0, 8));
    throw err;
  }
  const meshError = await page.evaluate(() => window.__MESH_ERROR__ || '');
  if (meshError) throw new Error(`${label} mesh: ${meshError}`);

  const prefix = await page.evaluate(() => ({
    volume: window.__PREFIX_VOLUME__,
    sig: window.__PREFIX_SIG__ || '',
  }));
  check(`${label}: cube rendered`, !!prefix.sig && Number.isFinite(prefix.volume), JSON.stringify(prefix));

  await page.locator('[data-study-accept]').click();
  await page.waitForFunction(() => window.__ACCEPT_DONE__ && window.__ACCEPT_DONE__ !== '', null, { timeout: 120000 });
  const acceptError = await page.evaluate(() => window.__ACCEPT_ERROR__ || '');
  if (acceptError) throw new Error(`${label} accept: ${acceptError}`);

  const accepted = await page.evaluate(() => ({
    returns: window.__ACCEPT_RETURNS__,
    returnAt: window.__ACCEPT_RETURN_AT__,
    filletAt: window.__ACCEPT_FILLET_AT__,
    studyAt: window.__ACCEPT_STUDY_AT__,
    dead: window.__ACCEPT_DEAD__,
    sig: window.__ACCEPT_SIG__ || '',
    volume: window.__ACCEPT_VOLUME__,
    ok: window.__ACCEPT_OK__ === true,
    script: window.__ACCEPT_SCRIPT__ || '',
    ids: [...(window.document.querySelector('[data-feature-strip-orientation="horizontal"]')?.querySelectorAll('[data-feature-id]') || [])]
      .map((node) => node.getAttribute('data-feature-id')),
  }));
  check(`${label}: accept has one return`, accepted.returns === 1, String(accepted.returns));
  check(`${label}: fillet lands before the return`,
    beforeReturn(accepted, 'filletAt') && accepted.script.includes('filletAlongPath('),
    `fillet ${accepted.filletAt} return ${accepted.returnAt}`);
  check(`${label}: study stays after the return`,
    accepted.studyAt > accepted.returnAt,
    `study ${accepted.studyAt} return ${accepted.returnAt}`);
  check(`${label}: no feature block after the return`,
    Array.isArray(accepted.dead) && accepted.dead.length === 0,
    JSON.stringify(accepted.dead));
  check(`${label}: fillet changes the mesh`,
    accepted.ok && accepted.sig && accepted.sig !== prefix.sig,
    `${prefix.sig} → ${accepted.sig}`);
  check(`${label}: fillet changes the volume`,
    Number.isFinite(prefix.volume) && Number.isFinite(accepted.volume) && accepted.volume !== prefix.volume,
    `${prefix.volume} → ${accepted.volume}`);
  check(`${label}: strip shows the fillet`,
    accepted.ids.includes('extrude2') && accepted.ids.some((id) => id !== 'extrude2'),
    accepted.ids.join(','));

  const acceptShot = join(shotDir, `script-return-accept-${label}.png`);
  await page.screenshot({ path: acceptShot });
  console.log(`  shot ${acceptShot}`);

  await page.locator('[data-script-repair]').click();
  await page.waitForFunction(() => window.__REPAIR_DONE__ && window.__REPAIR_DONE__ !== '', null, { timeout: 120000 });
  const repairError = await page.evaluate(() => window.__REPAIR_ERROR__ || '');
  if (repairError) throw new Error(`${label} repair: ${repairError}`);

  const repaired = await page.evaluate(() => ({
    brokenReturns: window.__BROKEN_RETURNS__,
    brokenDead: window.__BROKEN_DEAD__,
    deadSig: window.__DEAD_SIG__ || '',
    deadVolume: window.__DEAD_VOLUME__,
    returns: window.__REPAIR_RETURNS__,
    returnAt: window.__REPAIR_RETURN_AT__,
    sel1: window.__REPAIR_SEL1__,
    sel5: window.__REPAIR_SEL5__,
    studyAt: window.__REPAIR_STUDY_AT__,
    moved: window.__REPAIR_MOVED__,
    changed: window.__REPAIR_CHANGED__ === true,
    dead: window.__REPAIR_DEAD__,
    sig: window.__REPAIR_SIG__ || '',
    volume: window.__REPAIR_VOLUME__,
    ok: window.__REPAIR_OK__ === true,
    script: window.__REPAIR_SCRIPT__ || '',
    ids: [...(window.document.querySelector('[data-feature-strip-orientation="horizontal"]')?.querySelectorAll('[data-feature-id]') || [])]
      .map((node) => node.getAttribute('data-feature-id')),
  }));
  check(`${label}: buried script has two returns and both fillets dead`,
    repaired.brokenReturns === 2 && JSON.stringify(repaired.brokenDead) === '["selEdges1","selEdges5"]',
    `${repaired.brokenReturns} ${JSON.stringify(repaired.brokenDead)}`);
  check(`${label}: dead run matches the cube`,
    repaired.deadVolume === prefix.volume && repaired.deadSig === prefix.sig,
    `vol ${repaired.deadVolume} sig ${repaired.deadSig}`);
  check(`${label}: repair keeps one return`, repaired.returns === 1, String(repaired.returns));
  check(`${label}: repair moves both fillets above the return`,
    repaired.changed
      && beforeReturn(repaired, 'sel1')
      && beforeReturn(repaired, 'sel5')
      && JSON.stringify(repaired.moved) === '["selEdges1","selEdges5"]',
    JSON.stringify({ moved: repaired.moved, sel1: repaired.sel1, sel5: repaired.sel5, at: repaired.returnAt }));
  check(`${label}: study stays after the repaired return`,
    repaired.studyAt > repaired.returnAt,
    `study ${repaired.studyAt} return ${repaired.returnAt}`);
  check(`${label}: repaired script has no feature after the return`,
    Array.isArray(repaired.dead) && repaired.dead.length === 0,
    JSON.stringify(repaired.dead));
  check(`${label}: repaired fillets change the mesh`,
    repaired.ok && repaired.sig && repaired.sig !== repaired.deadSig,
    `${repaired.deadSig} → ${repaired.sig}`);
  check(`${label}: repaired fillets change the volume`,
    Number.isFinite(repaired.deadVolume) && Number.isFinite(repaired.volume) && repaired.volume !== repaired.deadVolume,
    `${repaired.deadVolume} → ${repaired.volume}`);
  check(`${label}: strip shows both repaired fillets`,
    repaired.ids.join(',') === 'extrude2,selEdges1,selEdges5',
    repaired.ids.join(','));
  check(`${label}: both radii sit before the return`,
    repaired.script.indexOf('3.72') < repaired.returnAt && repaired.script.indexOf('3.27') < repaired.returnAt,
    repaired.script.slice(Math.max(0, repaired.returnAt - 40), repaired.returnAt + 40));

  const repairShot = join(shotDir, `script-return-repair-${label}.png`);
  await page.screenshot({ path: repairShot });
  console.log(`  shot ${repairShot}`);
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
  console.log(`\nscript return: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nscript return: all checks passed');
process.exit(0);
