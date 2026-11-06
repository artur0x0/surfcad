#!/usr/bin/env node
/**
 * An agent can sketch while its session is working.
 *
 * Over MCP every model-changing call puts the tab's agent session in
 * working, and the feature-popup gate then held every card an agent command
 * opened, including the contour sketch: `sketch_begin` answered ok with no
 * sketch, the next `sketch_add` was `no_sketch`, and `insert_make_extrude`
 * fell back to its placeholder profile (mcp-bugs-2026-11-04 §1). The sketch
 * and the feature slot card are the agent's work surface and open through
 * `allowAgentWorkSurface`; a `sketch_begin` or `slot_open` that still cannot
 * open says so (`sketch_blocked`, `slot_blocked`).
 *
 * Boots the dev server with the agent prompt pinned in its working state
 * (`?agentPromptDemo=1&agentPromptState=agent-working`), then drives the
 * bridge: sketch_begin, two sketch_adds (the second is a loop), the saved
 * contour, sketch_cancel, slot_open with the card up.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5297);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1&agentPromptDemo=1&agentPromptState=agent-working`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('agent sketch while working golden: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}
mkdirSync(SHOT_DIR, { recursive: true });

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--logLevel', 'error'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), { name, argsJson: JSON.stringify(args ?? {}) });
}

console.log('agent sketch while working golden');
if (!(await waitForServer())) {
  console.log('  ❌ dev server did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});
attachConsentPresetToBrowser(browser);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));
await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]') && !!document.querySelector('[data-agent-prompt]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });

const working = await page.evaluate(() => ({
  spinner: !!document.querySelector('[data-agent-working]'),
  session: document.querySelector('[data-agent-prompt]')?.getAttribute('data-agent-session-state') || '',
}));
check('the agent prompt is working (the state that held every agent card)', working.spinner, JSON.stringify(working));

const cube = await agentCall(page, 'insert_cube', { width: 60, depth: 40, height: 10 });
check('insert_cube', cube?.ok === true, JSON.stringify(cube));
await page.waitForTimeout(600);

const began = await agentCall(page, 'sketch_begin', { entry: 'crossSection', plane: 'z', offset: 5, accept_plane: true });
check('sketch_begin answers ok while working', began?.ok === true && began.result?.entry === 'crossSection', JSON.stringify(began));
await page.waitForFunction(() => !!document.querySelector('[data-contour-tool="rectangle"]'), null, { timeout: 15000 }).catch(() => {});
const rail = await page.evaluate(() => !!document.querySelector('[data-contour-tool="rectangle"]'));
check('the contour rail is up', rail);

const first = await agentCall(page, 'sketch_add', { tool: 'rectangle', width: 95.8, height: 101.8, centered: true, radius: 6 });
check('sketch_add (rounded rectangle) draws into that sketch, not no_sketch', first?.ok === true && first.result?.appended === false, JSON.stringify(first));
const second = await agentCall(page, 'sketch_add', { tool: 'rectangle', width: 76.3, height: 82.3, centered: true });
check('a second sketch_add is another loop', second?.ok === true && second.result?.appended === true && second.result?.loops === 2, JSON.stringify(second));
const entities = await agentCall(page, 'list_sketch_entities', {});
const arcs = entities?.result?.arcs || [];
const lines = entities?.result?.lines || [];
check('the sketch holds both loops (rounded outer, square inner)', arcs.length === 4 && lines.length >= 8, JSON.stringify({ arcs: arcs.length, lines: lines.length }));
await page.screenshot({ path: `${SHOT_DIR}/agent-sketch-while-working-1280.png` });

const committed = await agentCall(page, 'sketch_commit', {});
check('sketch_commit saves the two-loop contour', committed?.ok === true, JSON.stringify(committed).slice(0, 300));
const extruded = await agentCall(page, 'insert_make_extrude', { height: 4, combine: 'subtract' });
check('insert_make_extrude uses that contour, not the placeholder rectangle',
  extruded?.ok === true && typeof extruded.result?.contour === 'string' && extruded.result.contour.length > 0,
  JSON.stringify(extruded).slice(0, 300));
const script = await agentCall(page, 'get_script', {});
check('the script has no placeholder profileRectangle(40, 30)', !/profileRectangle\(40, 30\)/.test(script?.result?.source || ''), (script?.result?.source || '').slice(0, 200));

const slot = await agentCall(page, 'slot_open', { kind: 'makeExtrude' });
check('slot_open answers ok while working', slot?.ok === true, JSON.stringify(slot));
await page.waitForFunction(() => !!document.querySelector('[data-feature-slot-card="makeExtrude"]'), null, { timeout: 10000 }).catch(() => {});
const card = await page.evaluate(() => !!document.querySelector('[data-feature-slot-card="makeExtrude"]'));
check('the extrude slot card is up', card);
const cancelled = await agentCall(page, 'slot_cancel', {});
check('slot_cancel', cancelled?.ok === true, JSON.stringify(cancelled));

// The other half (mcp-modeling-bugs-2026-11-05 §1, §2). The session is idle
// when the sketch opens, and goes to working afterwards: a post_progress, a
// set_status building, or the first model change after 60 s idle, usually
// from a later tool call or a later per-call process. That edge used to
// dismiss every agent-owned card, the open sketch included, so sketch_begin
// answered ok and the next sketch_add was no_sketch; a second sketch_begin
// then made the "second" loop the first one of a new sketch (appended: false).
await page.close();
const idle = await browser.newPage({ viewport: { width: 1280, height: 800 } });
idle.on('pageerror', (err) => pageErrors.push(err.message));
await idle.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await idle.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
await idle.goto(APP_URL.replace('agentPromptState=agent-working', 'agentPromptState=idle'), { waitUntil: 'domcontentloaded' });
await idle.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]') && !!document.querySelector('[data-agent-prompt]'),
  { timeout: 120000 },
);
await idle.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });
/** The edge PromptInput produces when the session (or a prompt) becomes busy, and its way back to idle. */
const setWorking = (on) => idle.evaluate(async (value) => {
  const gate = await import('/src/agent/agentFeaturePopupGate.js');
  gate.setAgentPromptWorking(value);
  return gate.featurePopupOwner();
}, on);
const sketchOpen = () => idle.evaluate(() => !!document.querySelector('[data-contour-tool="rectangle"]'));
const idleState = await idle.evaluate(() => ({
  spinner: !!document.querySelector('[data-agent-working]'),
  session: document.querySelector('[data-agent-prompt]')?.getAttribute('data-agent-session-state') || '',
}));
check('idle page: the session is idle, nothing is working', idleState.spinner === false && idleState.session === 'idle', JSON.stringify(idleState));
const idleCube = await agentCall(idle, 'insert_cube', { width: 60, depth: 40, height: 10 });
check('idle page: insert_cube', idleCube?.ok === true, JSON.stringify(idleCube));
await idle.waitForTimeout(600);
const idleBegan = await agentCall(idle, 'sketch_begin', { entry: 'crossSection', plane: 'z', offset: 5, accept_plane: true });
check('idle page: sketch_begin answers ok', idleBegan?.ok === true, JSON.stringify(idleBegan));
await idle.waitForFunction(() => !!document.querySelector('[data-contour-tool="rectangle"]'), null, { timeout: 15000 }).catch(() => {});
check('idle page: the contour rail is up', await sketchOpen());

const owner = await setWorking(true);
await idle.waitForTimeout(300);
check('working starts after the sketch opened: the sketch is the agent\'s work surface and stays open', owner === 'agent-surface' && (await sketchOpen()), JSON.stringify({ owner }));
const lateFirst = await agentCall(idle, 'sketch_add', { tool: 'rectangle', width: 95.8, height: 101.8, centered: true, radius: 6 });
check('sketch_add after the working edge draws into that sketch, not no_sketch', lateFirst?.ok === true && lateFirst.result?.appended === false, JSON.stringify(lateFirst));

// Idle again (60 s with no model change), then working again, between the two loops.
await setWorking(false);
await idle.waitForTimeout(150);
await setWorking(true);
await idle.waitForTimeout(300);
check('a second idle-to-working edge leaves the sketch open too', await sketchOpen());
const lateSecond = await agentCall(idle, 'sketch_add', { tool: 'rectangle', width: 76.3, height: 82.3, centered: true });
check('the second sketch_add across that edge appends a loop (appended: true, loops: 2)', lateSecond?.ok === true && lateSecond.result?.appended === true && lateSecond.result?.loops === 2, JSON.stringify(lateSecond));
const lateCommit = await agentCall(idle, 'sketch_commit', {});
check('sketch_commit saves both loops', lateCommit?.ok === true, JSON.stringify(lateCommit).slice(0, 300));
const lateExtrude = await agentCall(idle, 'insert_make_extrude', { height: 4, combine: 'subtract' });
check('insert_make_extrude uses that contour',
  lateExtrude?.ok === true && typeof lateExtrude.result?.contour === 'string' && lateExtrude.result.contour.length > 0,
  JSON.stringify(lateExtrude).slice(0, 300));
const lateScript = await agentCall(idle, 'get_script', {});
check('no placeholder profileRectangle(40, 30) in the script', !/profileRectangle\(40, 30\)/.test(lateScript?.result?.source || ''), (lateScript?.result?.source || '').slice(0, 200));

// The feature slot card is the same kind of work surface.
await setWorking(false);
const lateSlot = await agentCall(idle, 'slot_open', { kind: 'makeExtrude' });
check('idle page: slot_open answers ok', lateSlot?.ok === true, JSON.stringify(lateSlot));
await idle.waitForFunction(() => !!document.querySelector('[data-feature-slot-card="makeExtrude"]'), null, { timeout: 10000 }).catch(() => {});
await setWorking(true);
await idle.waitForTimeout(300);
check('the slot card survives the working edge', await idle.evaluate(() => !!document.querySelector('[data-feature-slot-card="makeExtrude"]')));
const lateCancel = await agentCall(idle, 'slot_cancel', {});
check('idle page: slot_cancel', lateCancel?.ok === true, JSON.stringify(lateCancel));
await setWorking(false);
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`\nagent sketch while working golden: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nagent sketch while working golden: ok');
process.exit(0);
