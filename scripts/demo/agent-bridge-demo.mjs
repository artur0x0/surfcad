#!/usr/bin/env node
/**
 * An agent builds a part through window.surfcad.call only.
 *
 * Dev server (the bridge is on in dev). Every command is a JSON string
 * in and a JSON envelope out. No toolbar clicks. A box, then a hole,
 * then status and a screenshot, then undo once, then a script that throws.
 *
 * Writes before.png, after.png, and agent-bridge-demo.webm under
 * AGENT_DEMO_DIR or /opt/cursor/artifacts when that directory exists.
 */
/* The evaluate callbacks run in the browser. */
/* global window, document */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const OUT_DIR = process.env.AGENT_DEMO_DIR
  || (existsSync('/opt/cursor/artifacts') ? '/opt/cursor/artifacts' : join(tmpdir(), 'agent-bridge-demo'));
const PORT = Number(process.env.DEMO_PORT || 4319);
const APP_URL = `http://127.0.0.1:${PORT}/`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const BOX = `// --- cube begin ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
return part;
`;

const HOLE = `// --- cube begin ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
// --- hole begin ---
part = part.subtract(Manifold.cylinder(40, 6, 6, 48, true));
// --- hole end ---
return part;
`;

const BAD = `// --- cube begin ---
let part = Manifold.cube([10, 10, 10], true);
throw new Error('agent bridge demo');
// --- cube end ---
return part;
`;

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
  console.log('agent bridge demo: no system Chrome found — set CHROME_PATH.');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const videoDir = join(OUT_DIR, 'agent-bridge-video');
mkdirSync(videoDir, { recursive: true });

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
  try { server.kill('SIGKILL'); } catch { /* already gone */ }
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

async function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function pause(page, ms) {
  return page.waitForTimeout(ms);
}

/** Relay path: args are a JSON string. The page round-trips the envelope. */
async function agentCall(page, name, args) {
  const argsJson = JSON.stringify(args ?? {});
  return page.evaluate(async ({ name, argsJson }) => {
    function assertJsonValue(value, path) {
      if (value === null) return;
      const kind = typeof value;
      if (kind === 'string' || kind === 'boolean') return;
      if (kind === 'number') {
        if (!Number.isFinite(value)) throw new Error(`non-finite at ${path}`);
        return;
      }
      if (kind !== 'object') throw new Error(`non-json ${kind} at ${path}`);
      if (ArrayBuffer.isView(value)) throw new Error(`typed array at ${path}`);
      if (Array.isArray(value)) {
        value.forEach((item, i) => assertJsonValue(item, `${path}[${i}]`));
        return;
      }
      if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`instance at ${path}`);
      Object.keys(value).forEach((key) => assertJsonValue(value[key], `${path}.${key}`));
    }
    const env = await window.surfcad.call(name, argsJson);
    assertJsonValue(env, 'envelope');
    return JSON.parse(JSON.stringify(env));
  }, { name, argsJson });
}

console.log('agent bridge demo — window.surfcad only');

let browser;
let context;
try {
  if (!await waitForServer()) {
    check('dev server started', false, `no response on ${APP_URL}`);
    process.exit(1);
  }

  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('  pageerror', String(err && err.message ? err.message : err)));

  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }));

  await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(
    () => window.surfcad && window.surfcad.version === 1 && typeof window.surfcad.call === 'function'
      && document.querySelector('canvas'),
    null,
    { timeout: 60000 },
  );
  const surface = await page.evaluate(() => ({
    version: window.surfcad.version,
    commands: JSON.parse(JSON.stringify(window.surfcad.commands)),
  }));
  check('version is 1', surface.version === 1, String(surface.version));
  check('commands are the v1 tool list', JSON.stringify(surface.commands) === JSON.stringify([
    'get_script', 'set_script', 'run', 'status', 'errors', 'screenshot', 'undo', 'list_commands',
  ]), JSON.stringify(surface.commands));
  await pause(page, 600);

  const beforePath = join(OUT_DIR, 'agent-bridge-before.png');
  await page.screenshot({ path: beforePath });
  console.log(`  before ${beforePath}`);

  const wroteBox = await agentCall(page, 'set_script', { source: BOX });
  const ranBox = await agentCall(page, 'run', {});
  const boxScript = await agentCall(page, 'get_script', {});
  const boxStatus = await agentCall(page, 'status', {});
  const boxErrors = await agentCall(page, 'errors', {});
  check('box envelope ok', wroteBox.v === 1 && wroteBox.ok === true && ranBox.ok === true, JSON.stringify(wroteBox.error || ranBox.error));
  check('box script is the editor buffer', boxScript.result?.source === BOX);
  check('box run ok', ranBox.result?.ok === true, JSON.stringify(ranBox.result?.errors));
  check('box is one feature', boxStatus.result?.featureCount === 1, `count ${boxStatus.result?.featureCount}`);
  check('box part name', boxStatus.result?.partName === 'Part (1)', boxStatus.result?.partName);
  check('box volume', Math.abs(boxStatus.result?.volume - 24000) < 1, String(boxStatus.result?.volume));
  check('box bbox', Array.isArray(boxStatus.result?.bbox?.min) && boxStatus.result.bbox.min.length === 3, JSON.stringify(boxStatus.result?.bbox));
  check('box errors empty', boxErrors.result?.errors?.length === 0, JSON.stringify(boxErrors.result));
  check('run after set_script did not change the feature count', wroteBox.result?.status?.featureCount === ranBox.result?.status?.featureCount);
  await pause(page, 700);

  const wroteHole = await agentCall(page, 'set_script', { source: HOLE });
  const ranHole = await agentCall(page, 'run', {});
  const holeScript = await agentCall(page, 'get_script', {});
  const holeStatus = await agentCall(page, 'status', {});
  const holeErrors = await agentCall(page, 'errors', {});
  const shot = await agentCall(page, 'screenshot', { format: 'png' });
  check('hole envelope ok', wroteHole.ok === true && ranHole.ok === true && shot.ok === true, JSON.stringify(shot.error || ranHole.error));
  check('hole script is the editor buffer', holeScript.result?.source === HOLE);
  check('hole run ok', ranHole.result?.ok === true, JSON.stringify(ranHole.result?.errors));
  check('hole is two features', holeStatus.result?.featureCount === 2, `count ${holeStatus.result?.featureCount}`);
  check('hole volume dropped', holeStatus.result?.volume < 23000 && holeStatus.result?.volume > 15000, String(holeStatus.result?.volume));
  check('hole errors empty', holeErrors.result?.errors?.length === 0, (holeErrors.result?.errors || []).join(' | '));
  const png = shot.result?.dataUrl;
  check('screenshot is a png data url', typeof png === 'string' && png.startsWith('data:image/png;base64,'), String(png).slice(0, 32));
  const pngBytes = Buffer.from(String(png).split(',')[1] || '', 'base64');
  check('screenshot png is a real image', pngBytes.length > 5000 && pngBytes[0] === 0x89 && pngBytes[1] === 0x50, `bytes ${pngBytes.length}`);
  writeFileSync(join(OUT_DIR, 'agent-bridge-viewport.png'), pngBytes);

  const afterPath = join(OUT_DIR, 'agent-bridge-after.png');
  await page.screenshot({ path: afterPath });
  console.log(`  after ${afterPath}`);
  await pause(page, 800);

  const undone = await agentCall(page, 'undo', {});
  const undoneScript = await agentCall(page, 'get_script', {});
  const undoneStatus = await agentCall(page, 'status', {});
  check('undo envelope ok', undone.v === 1 && undone.ok === true, JSON.stringify(undone.error));
  check('undo once restores the box', undoneScript.result?.source === BOX, String(undoneScript.result?.source).slice(0, 80));
  check('undo run ok', undone.result?.ok === true, JSON.stringify(undone.result?.errors));
  check('undo volume is the box', Math.abs(undoneStatus.result?.volume - 24000) < 1, String(undoneStatus.result?.volume));
  check('undo feature count is one', undoneStatus.result?.featureCount === 1, String(undoneStatus.result?.featureCount));
  await pause(page, 800);

  const wroteBad = await agentCall(page, 'set_script', { source: BAD });
  const ranBad = await agentCall(page, 'run', {});
  const badErrors = await agentCall(page, 'errors', {});
  const badStatus = await agentCall(page, 'status', {});
  check('error script still returns an envelope', wroteBad.ok === true && ranBad.ok === true && ranBad.v === 1, JSON.stringify(ranBad.error));
  check('error run result is not ok', ranBad.result?.ok === false, JSON.stringify(ranBad.result));
  check('errors names the throw', (badErrors.result?.errors || []).some((msg) => String(msg).includes('agent bridge demo')), (badErrors.result?.errors || []).join(' | '));
  check('failed status has no volume', badStatus.result?.volume == null, String(badStatus.result?.volume));
  await page.waitForFunction(
    () => {
      const node = document.querySelector('[data-execution-error]');
      return node && /agent bridge demo/.test(node.textContent || '');
    },
    null,
    { timeout: 8000 },
  ).then(() => check('error popup is on screen', true)).catch(() => check('error popup is on screen', false));
  await pause(page, 1200);

  const video = page.video();
  await context.close();
  context = null;
  const webmPath = join(OUT_DIR, 'agent-bridge-demo.webm');
  await video.saveAs(webmPath);
  const size = statSync(webmPath).size;
  check('video saved under 15MB', size > 1000 && size < 15 * 1024 * 1024, `${size} bytes`);
  console.log(`  video ${webmPath} (${size} bytes)`);
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.log(`\nagent bridge demo: ${failed} failed`);
  process.exit(1);
}
console.log('\nagent bridge demo: ok');
