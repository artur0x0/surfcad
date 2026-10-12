#!/usr/bin/env node
/**
 * Failed feature chip on Safari / iPhone: the red border must not depend on
 * the engine's stack format.
 *
 * Artur (iPhone Safari, mobile top strip + feature sheet) saw the part's red
 * glow (slice F) but no red chip. Chip marking needed `scriptLine`, which
 * the worker reads off a V8 `<anonymous>:L:C` or Firefox `> Function:L:C`
 * frame. WebKit frames for a `new Function` body match neither, so the line
 * was null and no chip was marked. The feature sheet had no red at all.
 *
 * Now the worker tracks the running marked block: `instrumentFeatureBlocks`
 * puts `;__featureEnter(i);` / `;__featureLeave(i);` on the begin / end
 * marker lines (no line moves). A throw while a block is open carries
 * `featureId` + `featureBlock`; App maps that first, the stack line second.
 * Rule: only a throw INSIDE an open block marks a chip. A syntax error, a
 * bad return or code outside every block marks nothing.
 *
 * This golden runs the real worker with a WebKit-shaped stack (V8's
 * `Error.prepareStackTrace`), and renders the real FeatureStrip (both
 * layouts) and FeatureSheet (identity + picker) with react-dom/server.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';
import { build } from 'esbuild';
import {
  anonymousFrameLine,
  createFeatureTracker,
  failedFeatureForId,
  failedFeatureFromOutcome,
  failedFeatureIds,
  instrumentFeatureBlocks,
} from '../../src/utils/featureFailure.js';
import {
  chipTone,
  FAILED_RING_CLASS,
  sheetIdentityTone,
  sheetPickTone,
} from '../../src/utils/featureChipTone.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

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

console.log('feature failed chip on Safari — tracked feature block, strip + sheet red');

const CUBE = `// --- cube begin ---
let part = Manifold.cube([20, 20, 20], true);
// --- cube end ---`;
const GOOD_FILLET = `// --- fillet-mode begin ---
const selEdges = edgesBetween(part, 0, 6);
const path = makeSweepPath(selEdges);
part = filletAlongPath(part, path, 2);
// --- fillet-mode end ---`;
const BAD_FILLET = `// --- fillet-mode begin ---
const selEdges2 = edgesBetween(part, 90, 91);
const path2 = makeSweepPath(selEdges2);
part = filletAlongPath(part, path2, 2);
// --- fillet-mode end ---`;
const FAILING = `${CUBE}\n${GOOD_FILLET}\n${BAD_FILLET}\nreturn part;\n`;
const feats = parseFeatureMarkers(FAILING);
const BAD_ID = feats[2].id;

// ── Instrumentation ────────────────────────────────────────────────────
{
  const t = instrumentFeatureBlocks(FAILING);
  const a = FAILING.split('\n');
  const b = t.script.split('\n');
  check('instrumenting keeps every line number', a.length === b.length);
  check('each begin / end marker line gets enter / leave, nothing else changes',
    b.every((l, i) => {
      const m = /^;__feature(Enter|Leave)\((\d+)\);/.exec(l);
      return m ? l.slice(m[0].length) === a[i] && /--- .* (begin|end) ---/.test(a[i]) : l === a[i];
    })
    && (t.script.match(/;__featureEnter\(\d\);/g) || []).length === 3
    && (t.script.match(/;__featureLeave\(\d\);/g) || []).length === 3,
    t.script);
  check('call indices name the parsed blocks in order',
    t.features.length === 3 && t.features.every((f, i) => f.id === feats[i].id
      && f.block === FAILING.slice(feats[i].startOffset, feats[i].endOffset)));
  const inline = 'let x = 1; // --- cube begin ---\nlet part = Manifold.cube([1, 1, 1]);\n// --- cube end ---\nreturn part;';
  check('a marker not at the start of its line is left alone', !/__feature/.test(instrumentFeatureBlocks(inline).script));
  check('a script without markers is unchanged', instrumentFeatureBlocks('return 1;').script === 'return 1;');
  const tr = createFeatureTracker();
  tr.enter(0); tr.enter(1);
  const nested = tr.current();
  tr.leave(0);
  check('tracker: innermost open block, leave pops back past it', nested === 1 && tr.current() === null);
}

// ── V8 still maps the stack line (existing path) ───────────────────────
{
  const bad = await run(FAILING);
  const badLine = FAILING.split('\n').findIndex((l) => l.includes('edgesBetween(part, 90, 91)')) + 1;
  const v8Skip = bad.payload?.featureSkip;
  check('V8: the recovered run still names the failing script line', v8Skip?.scriptLine === badLine,
    String(v8Skip?.scriptLine));
  check('V8: and also the tracked feature block', v8Skip?.featureId === BAD_ID
    && v8Skip?.featureBlock === FAILING.slice(feats[2].startOffset, feats[2].endOffset),
    String(v8Skip?.featureId));
  const byLine = failedFeatureFromOutcome(FAILING, { scriptLine: v8Skip?.scriptLine });
  check('V8: the line alone still maps to the second fillet', byLine?.id === BAD_ID);
}

// ── Safari: no matching stack frame, the tracked block marks the chip ──
const SAFARI_STACK = (err) => `${err.name}: ${err.message}\n`
  + 'edgesBetween@http://localhost:5173/src/workers/sandboxWorker.js:4210:22\n'
  + 'anonymous@\nexecuteScript@http://localhost:5173/src/workers/sandboxWorker.js:8110:15\n'
  + '@http://localhost:5173/src/workers/sandboxWorker.js:8430:24';
const v8Prepare = Error.prepareStackTrace;
Error.prepareStackTrace = (err) => SAFARI_STACK(err);
let safari;
{
  const probe = new Error('x');
  check('the simulated WebKit stack has no V8 / Firefox frame', anonymousFrameLine(probe.stack) === null, probe.stack);
  const bad = await run(FAILING);
  safari = bad;
  const safariSkip = bad.payload?.featureSkip;
  check('Safari: the run recovers a solid and still names the block',
    bad.type === 'result' && safariSkip?.featureId === BAD_ID, bad.payload?.message || String(safariSkip?.featureId));
  check('Safari: no script line from the stack', safariSkip?.scriptLine == null, String(safariSkip?.scriptLine));
  check('Safari: the report names the open feature block', safariSkip?.featureId === BAD_ID, String(safariSkip?.featureId));
  const hit = failedFeatureFromOutcome(FAILING, safariSkip || {});
  check('Safari: App maps it to the second fillet (not the cube / first fillet)',
    hit && hit.id === BAD_ID && hit.kind === 'fillet' && hit.typeIndex === 2,
    JSON.stringify(hit && { id: hit.id, typeIndex: hit.typeIndex }));
  const ids = failedFeatureIds(FAILING, hit);
  check('Safari: exactly that chip is failed', ids.size === 1 && ids.has(BAD_ID));

  const badCube = `// --- cube begin ---\nlet part = Manifold.cube([20, 20, 20], true).nope();\n// --- cube end ---\n${GOOD_FILLET}\nreturn part;\n`;
  const c = await run(badCube);
  check('Safari: a throw in the first block names that block',
    c.payload?.featureId === parseFeatureMarkers(badCube)[0].id, String(c.payload?.featureId));

  const noFrame = await run(`${CUBE}\nreturn 5;\n`);
  check('Safari: a bad return after every block closed marks nothing',
    noFrame.type === 'error' && noFrame.payload?.featureId == null && noFrame.payload?.scriptLine == null);
  const syntax = await run(`${CUBE}\nlet x = ;\nreturn part;\n`);
  check('Safari: a syntax error marks nothing (no block ever ran)',
    syntax.type === 'error' && syntax.payload?.featureId == null);
  const outside = await run(`${CUBE}\nreturn part.nope();\n`);
  check('Safari: a throw outside every block marks nothing',
    outside.type === 'error' && outside.payload?.featureId == null);
  const inExpr = 'let part = Manifold.union([\n// --- cube begin ---\nManifold.cube([1, 1, 1]),\n// --- cube end ---\nManifold.cube([1, 1, 1]).translate([3, 0, 0])]);\nreturn part;\n';
  const ie = await run(inExpr);
  check('a marker inside an expression falls back to the script as written (still runs)', ie.type === 'result',
    ie.payload?.message);
  const good = await run(`${CUBE}\n${GOOD_FILLET}\nreturn part;\n`);
  check('good runs are unaffected', good.type === 'result');
}
Error.prepareStackTrace = v8Prepare;

// ── Outcome mapping rules ──────────────────────────────────────────────
{
  const block = FAILING.slice(feats[2].startOffset, feats[2].endOffset);
  check('id + matching block maps', failedFeatureForId(FAILING, BAD_ID, block)?.id === BAD_ID);
  const edited = FAILING.replace('edgesBetween(part, 90, 91)', 'edgesBetween(part, 0, 6)');
  check('the block changed since the run: no mark', failedFeatureForId(edited, BAD_ID, block) === null);
  const shifted = `// --- cube begin ---\nlet other = Manifold.cube([1, 1, 1]);\n// --- cube end ---\n${FAILING}`;
  check('the id moved but the identical block is there: that block',
    failedFeatureForId(shifted, BAD_ID, block)?.block === block);
  check('the tracked id wins over a disagreeing line',
    failedFeatureFromOutcome(FAILING, { featureId: BAD_ID, featureBlock: block, scriptLine: 2 })?.id === BAD_ID);
  check('no id, no line: nothing', failedFeatureFromOutcome(FAILING, {}) === null);
}

// ── Strip (both layouts) and FeatureSheet render red ───────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'ffc-safari-'));
  const out = join(dir, 'ui.mjs');
  const res = await build({
    stdin: {
      contents: `export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
export { default as FeatureSheet } from './src/components/FeatureEditSheet.jsx';
export { default as FeatureStrip } from './src/components/FeatureStrip.jsx';`,
      resolveDir: ROOT,
      loader: 'jsx',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'text', '.png': 'dataurl' },
    logLevel: 'error',
    // Node built-ins react-dom/server requires.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  writeFileSync(out, res.outputFiles[0].text);
  const ui = await import(out);
  const renderedSkip = safari.payload?.featureSkip;
  const hit = failedFeatureFromOutcome(FAILING, renderedSkip || {});
  const ids = failedFeatureIds(FAILING, hit ? { ...hit, skipped: renderedSkip?.skipped } : null);
  rmSync(dir, { recursive: true, force: true });
  // Server render: silence React's "useLayoutEffect does nothing on the server".
  const h = (C, props) => {
    const err = console.error;
    console.error = (...a) => { if (!/useLayoutEffect does nothing on the server/.test(String(a[0]))) err(...a); };
    try { return ui.renderToStaticMarkup(ui.createElement(C, props)); } finally { console.error = err; }
  };
  const chipOf = (html, id) => (html.match(new RegExp(`<button[^>]*data-feature-id="${id}"[^>]*>`)) || [''])[0];

  for (const [label, props] of [
    ['mobile top strip', { orientation: 'horizontal', side: 'top' }],
    ['script rail strip', { orientation: 'vertical', side: 'right' }],
  ]) {
    const html = h(ui.FeatureStrip, { script: FAILING, failedIds: ids, onJump: () => {}, ...props });
    const bad = chipOf(html, BAD_ID);
    const ok = chipOf(html, feats[1].id);
    check(`${label}: the failing chip renders red`,
      /data-feature-failed="1"/.test(bad) && /border-red-400/.test(bad) && bad.includes(FAILED_RING_CLASS), bad);
    check(`${label}: the other chips do not`, ok && !/red-400/.test(ok) && !ok.includes(FAILED_RING_CLASS), ok);
  }

  const sheet = h(ui.FeatureSheet, { feature: feats[2], script: FAILING, failedIds: ids });
  const ident = (sheet.match(/<span[^>]*data-feature-sheet-failed="1"[^>]*>/) || [''])[0];
  check('feature sheet: the failed feature\'s identity badge is red', /border-red-400/.test(ident)
    && ident.includes(FAILED_RING_CLASS) && !/yellow/.test(ident), ident || sheet.slice(0, 400));
  check('feature sheet: says it failed', /Failed on the last run/.test(sheet));
  const okSheet = h(ui.FeatureSheet, { feature: feats[1], script: FAILING, failedIds: ids });
  check('feature sheet: a good feature stays cyan', !/data-feature-sheet-failed/.test(okSheet) && !/red-400/.test(okSheet));
  const picker = h(ui.FeatureSheet, { features: feats, script: FAILING, failedIds: ids });
  const pick = (picker.match(new RegExp(`<button[^>]*data-feature-sheet-pick="${BAD_ID}"[^>]*>`)) || [''])[0];
  const pickOk = (picker.match(new RegExp(`<button[^>]*data-feature-sheet-pick="${feats[1].id}"[^>]*>`)) || [''])[0];
  check('feature sheet picker: the failed row is red, the others are not',
    /border-red-400/.test(pick) && /data-feature-sheet-failed="1"/.test(pick) && !/red-400/.test(pickOk), pick);
}

// ── Tones and WebKit-proof CSS ─────────────────────────────────────────
{
  check('red wins over the external yellow on the sheet', !/yellow/.test(sheetIdentityTone(true, true))
    && /border-yellow-400/.test(sheetIdentityTone(true, false))
    && sheetIdentityTone(false, false) === 'border border-cyan-500/40');
  check('picker rows keep their old tones when not failed',
    sheetPickTone(true, false) === 'bg-cyan-950/60 text-white border border-cyan-600/50'
    && sheetPickTone(false, false) === 'bg-gray-900/60 text-gray-300 border border-gray-600/50');
  check('strip, sheet and picker share the failed ring class',
    chipTone(false, false, true).includes(FAILED_RING_CLASS) && chipTone(true, true, true).includes(FAILED_RING_CLASS)
    && sheetIdentityTone(false, true).includes(FAILED_RING_CLASS) && sheetPickTone(true, true).includes(FAILED_RING_CLASS));
  const css = read('src/index.css');
  const rule = (css.match(/\.feature-failed-ring\s*\{[^}]*\}/) || [''])[0];
  check('the ring class spells out width, style and red-400 for WebKit',
    /border-width:\s*2px\s*!important/.test(rule) && /border-style:\s*solid\s*!important/.test(rule)
    && /border-color:\s*#f87171\s*!important/.test(rule), rule);
}

// ── Wiring ─────────────────────────────────────────────────────────────
{
  const worker = read('src/workers/sandboxWorker.js') + '\n' + read('src/lib/surfcad/runtime.js');
  const mw = read('src/utils/ManifoldWorker.js');
  const vp = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  check('worker runs the instrumented script with the tracker in scope',
    /instrumentFeatureBlocks\(script\)/.test(worker) && /\[FEATURE_TRACE_ENTER\]: tracker\.enter/.test(worker)
    && /\[FEATURE_TRACE_LEAVE\]: tracker\.leave/.test(worker) && /err\.featureId = hit\.id/.test(worker));
  check('worker error payload carries featureId + featureBlock',
    /featureId: typeof error\?\.featureId === 'string'/.test(worker) && /featureBlock: typeof error\?\.featureBlock === 'string'/.test(worker));
  check('ManifoldWorker keeps them on the rejected error',
    /error\.featureId = payload\.featureId/.test(mw) && /error\.featureBlock = payload\.featureBlock/.test(mw));
  check('viewport reports them in onRunOutcome',
    /ok: false,[\s\S]{0,200}featureId: typeof error\?\.featureId === 'string'/.test(vp));
  check('App maps the tracked block first and feeds every sheet',
    /failedFeatureFromOutcome\(script, \{ featureId, featureBlock, scriptLine \}\)/.test(app)
    && (app.match(/featureEditFailedIds=\{sheetFailedIds\}/g) || []).length === 2
    && /failedIds=\{featureEditFailedIds\}/.test(vp)
    && (app.match(/failedIds=\{stripFailedIds\}/g) || []).length === 2
    && /failedIds=\{scriptStripFailedIds\}/.test(app));
  const arch = read('docs/architecture.md');
  check('architecture.md documents block tracking, the Safari fallback and the sheet red',
    /instrumentFeatureBlocks/.test(arch) && /Safari/.test(arch) && /data-feature-sheet-failed/.test(arch));
}

if (failed) {
  console.log(`\nfeature failed chip safari: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nfeature failed chip safari: all checks passed');
process.exit(0);
