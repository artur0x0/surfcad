#!/usr/bin/env node
/**
 * Assembly-open spinner.
 *
 * A delayed vault open shows a centered spinner ("Opening Gearbox…",
 * "part 3 of 7") and clears it when the load finishes. A failed open and the
 * safety timeout clear the spinner and surface the failure toast with Retry.
 * A fast open never flashes. prefers-reduced-motion stops the ring.
 */
import { readFileSync } from 'node:fs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { assemblyIdPath, partIdPath } from '../../src/utils/git/idPaths.js';
import { SURFCAD_JSON_V2 } from '../../src/utils/git/writeVaultCommit.js';
import {
  ASSEMBLY_OPEN_SHOW_MS,
  ASSEMBLY_OPEN_SAFETY_MS,
  UNTITLED_ASSEMBLY_NAME,
  assemblyOpenLabel,
  createAssemblyOpenController,
  lookupAssemblyOpenName,
  readVaultAssemblySurf,
  resolveAssemblyOpenName,
  runTrackedAssemblyOpen,
} from '../../src/utils/assemblyOpenOverlay.js';

const SURF_ID = '2026-10-22-02-44-00-0818-65b7';
const OTHER_ID = '2026-10-01-00-00-00-0001-aaaa';

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}

function fakeClock() {
  let now = 0;
  let seq = 1;
  const items = [];
  return {
    now: () => now,
    setTimer(fn, ms) {
      const id = seq;
      seq += 1;
      items.push({ id, fn, at: now + ms, dead: false });
      return id;
    },
    clearTimer(id) {
      const item = items.find((row) => row.id === id);
      if (item) item.dead = true;
    },
    advance(ms) {
      now += ms;
      let guard = 0;
      while (guard < 50) {
        guard += 1;
        const due = items
          .filter((row) => !row.dead && row.at <= now)
          .sort((a, b) => a.at - b.at || a.id - b.id);
        if (!due.length) return;
        const next = due[0];
        next.dead = true;
        next.fn();
      }
    },
  };
}

function controller(clock, hooks, { showDelayMs = ASSEMBLY_OPEN_SHOW_MS, safetyMs = 1000 } = {}) {
  return createAssemblyOpenController({
    showDelayMs,
    safetyMs,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...hooks,
  });
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

console.log('labels');
{
  const gear = assemblyOpenLabel('Gearbox', { index: 3, total: 7 });
  ok('opening line names the assembly', gear.label === 'Opening Gearbox…');
  ok('part counter', gear.detail === 'part 3 of 7');
  ok('no counter before the first part', assemblyOpenLabel('Gearbox', { index: 0, total: 7 }).detail === '');
  ok('blank name falls back', assemblyOpenLabel('  ', {}).label === `Opening ${UNTITLED_ASSEMBLY_NAME}…`);
  ok('raw id is never the label', assemblyOpenLabel(SURF_ID, { index: 7, total: 7 }).label === `Opening ${UNTITLED_ASSEMBLY_NAME}…`
    && !assemblyOpenLabel(SURF_ID, { index: 7, total: 7 }).label.includes(SURF_ID)
    && assemblyOpenLabel(SURF_ID, { index: 7, total: 7 }).detail === 'part 7 of 7');
  ok('show delay is 150ms', ASSEMBLY_OPEN_SHOW_MS === 150);
  ok('safety timeout is finite', ASSEMBLY_OPEN_SAFETY_MS >= 30000);
}

console.log('\nname comes from the assembly being opened');
{
  const surf = JSON.stringify({ id: SURF_ID, name: 'Road Bike' });
  const previous = { id: OTHER_ID, name: 'Bike' };
  ok('surf.json name wins over the assembly already open',
    resolveAssemblyOpenName({ id: SURF_ID, surf, doc: previous, name: previous.name }) === 'Road Bike');
  ok('store copy is used when the file is not passed separately',
    resolveAssemblyOpenName({ id: SURF_ID, storedSurf: surf, doc: previous }) === 'Road Bike');
  ok('a different assembly is ignored',
    resolveAssemblyOpenName({ id: SURF_ID, doc: previous, name: previous.name }) === UNTITLED_ASSEMBLY_NAME);
  ok('matching document is the store name',
    resolveAssemblyOpenName({ doc: { id: SURF_ID, name: 'Road Bike' } }) === 'Road Bike');
  ok('blank surf name is Untitled assembly',
    resolveAssemblyOpenName({ id: SURF_ID, surf: { id: SURF_ID, name: '   ' }, name: 'Bike' }) === UNTITLED_ASSEMBLY_NAME);
  ok('id passed as the name is Untitled assembly',
    resolveAssemblyOpenName({ id: SURF_ID, name: SURF_ID }) === UNTITLED_ASSEMBLY_NAME
    && resolveAssemblyOpenName(SURF_ID) === UNTITLED_ASSEMBLY_NAME);
  const adapter = {
    async readFile(_repo, path) {
      if (path === assemblyIdPath(SURF_ID)) return { content: surf };
      return null;
    },
  };
  const fromFile = await readVaultAssemblySurf(adapter, 'artur/vault', {
    id: SURF_ID,
    branch: 'main',
    storedSurf: JSON.stringify({ id: SURF_ID, name: 'Stale' }),
  });
  ok('vault read uses the file being opened',
    await lookupAssemblyOpenName({ id: SURF_ID, surf: fromFile, doc: previous }) === 'Road Bike');
  const fromStore = await readVaultAssemblySurf(adapter, 'artur/vault', {
    id: OTHER_ID,
    branch: 'feature',
    storedSurf: JSON.stringify({ id: OTHER_ID, name: 'From store' }),
  });
  ok('missing file falls back to that assembly\'s store copy',
    resolveAssemblyOpenName({ id: OTHER_ID, surf: fromStore, doc: previous }) === 'From store');
}

console.log('\nfast open does not flash');
{
  const clock = fakeClock();
  const seen = [];
  const ctrl = controller(clock, { onChange: (ui) => seen.push(ui) });
  await runTrackedAssemblyOpen(ctrl, {
    name: 'Gearbox',
    load: async () => ({ ok: true }),
  });
  clock.advance(1000);
  ok('spinner never became visible', seen.every((ui) => !ui || ui.visible !== true));
}

console.log('\ndelayed open shows, then clears');
{
  const clock = fakeClock();
  let ui = null;
  const frames = [];
  const ctrl = controller(clock, {
    onChange: (next) => {
      ui = next;
      if (next) frames.push(next);
    },
  });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = runTrackedAssemblyOpen(ctrl, {
    name: 'Gearbox',
    total: 7,
    load: async ({ progress }) => {
      progress({ index: 3, total: 7, name: 'Gearbox' });
      await gate;
      return { ok: true };
    },
  });
  await Promise.resolve();
  clock.advance(100);
  ok('still hidden at 100ms', ui == null);
  clock.advance(50);
  ok('visible after 150ms', ui?.visible === true && ui.name === 'Gearbox');
  ok('label is Opening Gearbox…', assemblyOpenLabel(ui.name, ui).label === 'Opening Gearbox…');
  ok('progress is part 3 of 7', assemblyOpenLabel(ui.name, ui).detail === 'part 3 of 7');
  release();
  await pending;
  ok('clears when the load finishes', ui == null);
  ok('it had been shown', frames.length > 0);
}

console.log('\nfailure clears the spinner and toasts Retry');
{
  const clock = fakeClock();
  let ui = null;
  let failure = null;
  const ctrl = controller(clock, {
    onChange: (next) => { ui = next; },
    onFailure: (fail) => { failure = fail; },
  });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = runTrackedAssemblyOpen(ctrl, {
    name: 'Gearbox',
    retry: () => 'retry-gearbox',
    load: async () => {
      await gate;
      throw new Error('Could not open Gearbox');
    },
  });
  clock.advance(150);
  ok('spinner is up while the open is still running', ui?.visible === true);
  release();
  let threw = false;
  try { await pending; } catch (err) { threw = /Could not open Gearbox/.test(err.message); }
  ok('load rejected', threw);
  ok('spinner cleared on failure', ui == null);
  ok('toast message', failure?.message === 'Could not open Gearbox');
  ok('toast keeps Retry', typeof failure?.retry === 'function' && failure.retry() === 'retry-gearbox');
}

console.log('\nsafety timeout');
{
  const clock = fakeClock();
  let ui = null;
  let failure = null;
  const ctrl = controller(clock, {
    showDelayMs: 20,
    safetyMs: 100,
    onChange: (next) => { ui = next; },
    onFailure: (fail) => { failure = fail; },
  });
  void runTrackedAssemblyOpen(ctrl, {
    name: 'Gearbox',
    retry: () => 'again',
    load: () => new Promise(() => {}),
  });
  clock.advance(20);
  ok('spinner shows before the timeout', ui?.visible === true);
  clock.advance(100);
  ok('timeout clears the spinner', ui == null);
  ok('timeout uses the failure toast', failure?.reason === 'timeout'
    && failure.message === 'Could not open Gearbox'
    && failure.retry() === 'again');
}

console.log('\ncancel and a newer open do not stick');
{
  const clock = fakeClock();
  let ui = null;
  let failures = 0;
  const ctrl = controller(clock, {
    onChange: (next) => { ui = next; },
    onFailure: () => { failures += 1; },
  });
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = runTrackedAssemblyOpen(ctrl, {
    name: 'Old',
    load: () => firstGate,
  });
  clock.advance(150);
  ok('first open is showing', ui?.name === 'Old');
  let releaseSecond;
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
  const second = runTrackedAssemblyOpen(ctrl, {
    name: 'New',
    load: () => secondGate,
  });
  ok('replaced open hides immediately', ui == null);
  releaseFirst();
  await first;
  clock.advance(150);
  ok('the new open shows on its own', ui?.name === 'New');
  releaseSecond();
  await second;
  ok('the new open clears when it finishes', ui == null);
  ok('the replaced open does not toast', failures === 0);
}

console.log('\ndelayed vault open');
{
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const assemblyId = '2026-10-22-05-00-00-0000-aa01';
  const parts = [];
  for (let i = 1; i <= 7; i += 1) {
    parts.push({
      id: `2026-10-22-05-00-00-000${i}-bb0${i}`,
      name: `Part ${i}`,
      visible: true,
      order: i - 1,
    });
  }
  const surf = `${JSON.stringify({
    format: 'surfcad.assembly',
    version: 2,
    id: assemblyId,
    name: 'Gearbox',
    activeId: parts[0].id,
    parts,
  }, null, 2)}\n`;
  const files = [
    fileWrite('surfcad.json', SURFCAD_JSON_V2),
    fileWrite(assemblyIdPath(assemblyId), surf),
    ...parts.map((part) => fileWrite(partIdPath(part.id), 'return Manifold.cube([4, 4, 4], true);\n')),
  ];
  const commit = await gh.commitFiles(vault.repo, {
    branch: 'main', message: 'seed', baseSha: vault.headSha, files,
  });
  const orig = gh.readFile.bind(gh);
  gh.readFile = async (...args) => {
    await sleep(80);
    return orig(...args);
  };
  let ui = null;
  const frames = [];
  const ctrl = createAssemblyOpenController({
    onChange: (next) => {
      ui = next;
      if (next) frames.push({ ...next });
    },
  });
  const opened = await runTrackedAssemblyOpen(ctrl, {
    name: 'Gearbox',
    retry: () => {},
    load: async ({ progress }) => openVaultAssemblyDelayed(gh, vault.repo, assemblyId, progress, commit.sha),
  });
  const shown = frames.find((frame) => frame.visible && frame.name === 'Gearbox');
  ok('delayed open shows the spinner', !!shown);
  ok('centered label would read Opening Gearbox…', !!shown
    && assemblyOpenLabel(shown.name, shown).label === 'Opening Gearbox…');
  ok('spinner is gone after the assembly loads', ui == null);
  ok('opened the seven parts', opened?.doc?.parts?.length === 7 && opened.doc.name === 'Gearbox');
}

async function openVaultAssemblyDelayed(adapter, repo, assemblyId, progress, headSha) {
  const { openVaultAssembly } = await import('../../src/utils/git/gitWorkspace.js');
  return openVaultAssembly(adapter, repo, assemblyId, {
    branch: 'main',
    headSha,
    onProgress: (update) => progress({ ...update, name: update.name || 'Gearbox' }),
  });
}

console.log('\nforced failure after the spinner is up');
{
  globalThis.__ASSEMBLY_OPEN_DELAY_MS__ = 180;
  globalThis.__ASSEMBLY_OPEN_FAIL__ = 'Could not open Gearbox';
  let ui = null;
  let saw = null;
  let failure = null;
  const ctrl = createAssemblyOpenController({
    onChange: (next) => {
      ui = next;
      if (next) saw = next;
    },
    onFailure: (fail) => { failure = fail; },
  });
  let threw = false;
  try {
    await runTrackedAssemblyOpen(ctrl, {
      name: 'Gearbox',
      retry: () => 'retry',
      load: async () => ({ ok: true }),
    });
  } catch (err) {
    threw = err?.message === 'Could not open Gearbox';
  } finally {
    delete globalThis.__ASSEMBLY_OPEN_DELAY_MS__;
    delete globalThis.__ASSEMBLY_OPEN_FAIL__;
  }
  ok('delayed failure throws', threw);
  ok('spinner had appeared', saw?.visible === true && saw.name === 'Gearbox');
  ok('spinner cleared', ui == null);
  ok('failure toast offers Retry', failure?.message === 'Could not open Gearbox' && failure.retry() === 'retry');
}

console.log('\nan id progress tick cannot replace the resolved name');
{
  const clock = fakeClock();
  let ui = null;
  const ctrl = controller(clock, { onChange: (next) => { ui = next; } });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = runTrackedAssemblyOpen(ctrl, {
    name: 'Road Bike',
    load: async ({ progress }) => {
      progress({ name: SURF_ID, index: 7, total: 7 });
      await gate;
    },
  });
  // begin() awaits the test hooks before load, so the id tick lands on the
  // next turn. Advance only after that tick has updated the snapshot.
  await Promise.resolve();
  clock.advance(150);
  ok('id tick keeps Road Bike and the part counter', ui?.name === 'Road Bike'
    && assemblyOpenLabel(ui.name, ui).label === 'Opening Road Bike…'
    && assemblyOpenLabel(ui.name, ui).detail === 'part 7 of 7'
    && !assemblyOpenLabel(ui.name, ui).label.includes(SURF_ID));
  release();
  await pending;
}

console.log('\na file read may replace the name; an id tick may not');
{
  const clock = fakeClock();
  let ui = null;
  const ctrl = controller(clock, { onChange: (next) => { ui = next; } });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = runTrackedAssemblyOpen(ctrl, {
    name: 'Road Bike',
    load: async ({ progress }) => {
      progress({ name: '', authoritative: true, index: 1, total: 4 });
      await gate;
    },
  });
  await Promise.resolve();
  clock.advance(150);
  ok('authoritative blank file is Untitled assembly', ui?.name === UNTITLED_ASSEMBLY_NAME
    && assemblyOpenLabel(ui.name, ui).label === `Opening ${UNTITLED_ASSEMBLY_NAME}…`
    && assemblyOpenLabel(ui.name, ui).detail === 'part 1 of 4'
    && !assemblyOpenLabel(ui.name, ui).label.includes(SURF_ID));
  release();
  await pending;
}

console.log('\nmarkup is a blank ground and does not block toasts');
{
  const spinner = readFileSync(new URL('../../src/components/AssemblyOpenSpinner.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  ok('overlay fills and centers', /absolute inset-0/.test(spinner)
    && /flex items-center justify-center/.test(spinner)
    && /data-assembly-open-spinner/.test(spinner));
  ok('opaque viewport ground, no preview image', /surface-dark/.test(spinner)
    && /text-on-dark/.test(spinner)
    && /text-muted-on-dark/.test(spinner)
    && /font-ui/.test(spinner)
    && !/surface-scrim/.test(spinner)
    && !/<img\b/.test(spinner)
    && !/backdrop/.test(spinner)
    && !/text-white|text-gray-|border-white|bg-\[#/.test(spinner));
  ok('clicks pass through under the toasts', /pointer-events-none/.test(spinner)
    && /z-\[45\]/.test(spinner)
    && /z-50/.test(spinner)
    && /pointer-events-auto/.test(spinner));
  ok('reuses the border spinner', /animate-spin/.test(spinner)
    && /assembly-open-ring/.test(spinner)
    && /motion-reduce:animate-none/.test(spinner)
    && /\.assembly-open-ring[\s\S]*border-bottom-color:\s*rgb\(var\(--chrome-text\)\)/.test(css));
  ok('label and part counter hooks', /data-assembly-open-label/.test(spinner)
    && /data-assembly-open-progress/.test(spinner)
    && /resolveAssemblyOpenName\(/.test(spinner));
  ok('toast has Retry', /data-assembly-open-toast/.test(spinner)
    && /data-assembly-open-retry/.test(spinner)
    && />\s*Retry\s*</.test(spinner));
  ok('reduced motion stops the ring', /prefers-reduced-motion:\s*reduce/.test(css)
    && /\[data-assembly-open-ring\]/.test(css)
    && /animation:\s*none/.test(css));
  const openerStart = app.indexOf('const openAssemblyTracked = async');
  const openerEnd = app.indexOf('openAssemblyTrackedRef.current = openAssemblyTracked');
  const opener = openerStart >= 0 ? app.slice(openerStart, openerEnd) : '';
  ok('one opener resolves the name', openerStart >= 0
    && (app.match(/runTrackedAssemblyOpen\(/g) || []).length === 1
    && /resolveAssemblyOpenName\(/.test(opener)
    && /void lookupAssemblyOpenName\(/.test(opener)
    && /readVaultAssemblySurf\(/.test(opener)
    && /authoritative: true/.test(opener)
    && !/assemblyRef/.test(opener));
  const slice = (start, end) => {
    const at = app.indexOf(start);
    const to = app.indexOf(end, at + start.length);
    return at >= 0 && to > at ? app.slice(at, to) : '';
  };
  const loadAsm = slice('const handleLoadAssembly = async', 'const handleResolvePartFile');
  const openAsm = slice('const handleOpenVaultAssembly = async', 'openVaultAssemblyRef.current = handleOpenVaultAssembly');
  const switchAsm = slice('const handleSwitchBranch = async', 'const handleListVaultBrowse');
  const openV2 = slice('const handleOpenV2VaultAssembly = async', 'const flushLivePartScript');
  ok('open dialog, file load, branch switch, and id open use it',
    /openAssemblyTrackedRef\.current\(/.test(loadAsm)
    && /openAssemblyTrackedRef\.current\(\{[\s\S]*?folder: name/.test(openAsm)
    && (switchAsm.match(/openAssemblyTrackedRef\.current\(/g) || []).length === 2
    && /id,/.test(switchAsm)
    && /branch: branchName/.test(switchAsm)
    && /openAssemblyTrackedRef\.current\(\{[\s\S]*?id,/.test(openV2)
    && /agentOpenAssembly[\s\S]*?handleOpenV2VaultAssembly\(/.test(app));
  ok('reload uses the same opener and not the raw plan name',
    /openAssemblyTrackedRef\.current\(\{[\s\S]*?doc: plan\.doc/.test(app)
    && /openVaultAssemblyRef\.current\(plan\.name\)/.test(app)
    && !/name: plan\.name \|\| 'assembly'/.test(app)
    && !/name: id \|\| 'assembly'/.test(app)
    && /Skipping stale IDB hydrate/.test(app)
    && /vault baseline already set/.test(app));
  ok('switch still adopts the opened vault', /handleSwitchBranch[\s\S]*?adoptVaultOpening\(/.test(app));
}

if (!failed) console.log('\nassembly open overlay golden: ok');
console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed} passed)`);
process.exit(failed ? 1 : 0);
