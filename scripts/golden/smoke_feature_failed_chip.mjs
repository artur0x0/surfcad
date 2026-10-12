#!/usr/bin/env node
/**
 * A feature whose run failed gets a red chip border in the feature strip.
 *
 * The worker runs the script as a `new Function` body. A throw from a
 * helper still has one frame in that body: the script line that made the
 * call. The worker calibrates the engine's header lines once, maps that
 * frame to a 1-based script line and sends it with the error
 * (`scriptLine`). The viewport reports every run (`onRunOutcome`); App maps
 * a failed line to the marked feature block that holds it
 * (`failedFeatureFor`) and the strip draws that chip with `border-red-400`
 * (the error popup's red) while that block's text is unchanged. A throw
 * inside a marked feature is skipped and the rest of the script runs
 * again; the report still names that feature, so the chip stays red.
 * A good run clears it. Successful chips keep their classes.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import {
  anonymousFrameLine,
  calibrateScriptLineOffset,
  failedFeatureFor,
  failedFeatureIds,
  lineStartOffset,
  scriptLineFromStack,
} from '../../src/utils/featureFailure.js';
import { chipTone } from '../../src/utils/featureChipTone.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';

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

console.log('feature failed chip — a failed feature gets a red strip border');

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
const GOOD = `${CUBE}\n${GOOD_FILLET}\nreturn part;\n`;

// ── Line mapping ───────────────────────────────────────────────────────
{
  const off = calibrateScriptLineOffset();
  check('the engine header offset calibrates', Number.isFinite(off), String(off));
  check('V8 and Firefox anonymous frames parse',
    anonymousFrameLine('at eval (eval at x (w.js:1:2), <anonymous>:7:3)') === 7
    && anonymousFrameLine('@w.js line 9 > Function:5:1') === 5
    && anonymousFrameLine('at foo (w.js:1:1)') === null);
  check('scriptLineFromStack subtracts the header', scriptLineFromStack('<anonymous>:9:1', 3) === 6
    && scriptLineFromStack('no frame', 3) === null);
  check('lineStartOffset finds a line', lineStartOffset('a\nbb\nccc', 3) === 5);
}

// ── Worker: the failing call's script line rides with the error ────────
{
  const bad = await run(FAILING);
  const badLine = FAILING.split('\n').findIndex((l) => l.includes('edgesBetween(part, 90, 91)')) + 1;
  const skip = bad.payload?.featureSkip;
  check('a failing helper call recovers the earlier solid', bad.type === 'result' && !!skip?.featureId,
    bad.payload?.message || bad.type);
  check(`the report names the failing script line (${badLine})`, skip?.scriptLine === badLine,
    String(skip?.scriptLine));
  const hit = failedFeatureFor(FAILING, skip?.scriptLine);
  const feats = parseFeatureMarkers(FAILING);
  check('the line maps to the second fillet block, not the cube or the first fillet',
    hit && hit.kind === 'fillet' && hit.typeIndex === 2 && hit.id === feats[2].id,
    JSON.stringify(hit && { id: hit.id, kind: hit.kind, typeIndex: hit.typeIndex }));
  const ids = failedFeatureIds(FAILING, hit);
  check('exactly that chip is failed', ids.size === 1 && ids.has(feats[2].id));

  const noFrame = await run('let part = Manifold.cube([1, 1, 1]);\nreturn 5;\n');
  check('a failure with no script frame names no line (no chip)',
    noFrame.type === 'error' && noFrame.payload?.scriptLine == null);
  const syntax = await run('let part = ;\nreturn part;\n');
  check('a syntax error names no line', syntax.type === 'error' && syntax.payload?.scriptLine == null);
  const outside = `${CUBE}\nreturn part.nope();\n`;
  const out = await run(outside);
  check('a failure outside any marked block marks no chip',
    out.type === 'error' && out.payload?.scriptLine === 4 && failedFeatureFor(outside, out.payload.scriptLine) === null);
  const good = await run(GOOD);
  check('the same features without the bad block run', good.type === 'result');
}

// ── Strip rules ────────────────────────────────────────────────────────
{
  const hit = failedFeatureFor(FAILING, FAILING.split('\n').findIndex((l) => l.includes('90, 91')) + 1);
  const edited = FAILING.replace('edgesBetween(part, 90, 91)', 'edgesBetween(part, 0, 6)');
  check('editing the failed block clears its red border', failedFeatureIds(edited, hit).size === 0);
  const typed = FAILING.replace('return part;', '// note\nreturn part;');
  check('editing elsewhere keeps it', failedFeatureIds(typed, hit).size === 1);
  check('another part script does not match', failedFeatureIds(GOOD, hit).size === 0);
  check('no failure, no red chip', failedFeatureIds(FAILING, null).size === 0);
  check('failed chip: red-400 border, active or not',
    /border-2 border-red-400/.test(chipTone(false, false, true)) && /border-2 border-red-400/.test(chipTone(true, false, true)));
  check('failed wins over the external yellow', !/yellow/.test(chipTone(false, true, true)));
  check('successful chips keep their classes',
    chipTone(false) === 'bg-gray-800/70 text-gray-200 border-gray-500/40 hover:text-white'
    && chipTone(true) === 'bg-cyan-600 text-white border-cyan-400/70 shadow'
    && /border-yellow-400/.test(chipTone(false, true)) && !/red/.test(chipTone(true, true)));
  check('the red matches the error popup', /border-red-400/.test(read('src/components/ErrorPopup.jsx')));
}

// ── Wiring ─────────────────────────────────────────────────────────────
{
  const worker = read('src/workers/sandboxWorker.js') + '\n' + read('src/lib/surfcad/runtime.js');
  const mw = read('src/utils/ManifoldWorker.js');
  const vp = read('src/components/Viewport.jsx');
  const app = read('src/App.jsx');
  const strip = read('src/components/FeatureStrip.jsx');
  check('worker error payload carries scriptLine', /scriptLine: Number\.isFinite\(error\?\.scriptLine\)/.test(worker));
  check('ManifoldWorker keeps scriptLine on the rejected error', /error\.scriptLine = payload\.scriptLine/.test(mw));
  check('viewport reports success, clear and failure runs',
    (vp.match(/onRunOutcomeRef\.current\?\.\(\{ script, ok: true, scriptLine: null \}\)/g) || []).length === 2
    && /ok: false,\s*scriptLine: Number\.isFinite\(error\?\.scriptLine\)/.test(vp));
  check('App maps the outcome and feeds every strip',
    /failedFeatureFromOutcome\(script, \{ featureId, featureBlock, scriptLine \}\)/.test(app)
    && (app.match(/failedIds=\{stripFailedIds\}/g) || []).length === 2
    && /failedIds=\{scriptStripFailedIds\}/.test(app)
    && (app.match(/onRunOutcome=\{handleRunOutcome\}/g) || []).length === 2);
  check('both strip layouts mark failed chips',
    (strip.match(/data-feature-failed=\{failed \? '1' : undefined\}/g) || []).length === 2
    && (strip.match(/chipTone\(active, f\.external, failed\)/g) || []).length === 2);
  check('architecture.md documents the failed chip', /failedFeatureFor/.test(read('docs/architecture.md')));
}

if (failed) {
  console.log(`\nfeature failed chip: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nfeature failed chip: all checks passed');
process.exit(0);
