#!/usr/bin/env node
/**
 * An agent builds a part through window.surfcad only.
 *
 * Dev server (the bridge is on in dev). The page is driven with
 * getScript / setScript / run / status / errors / screenshot / undo.
 * No toolbar clicks. A box, then a hole, then status and a screenshot,
 * then undo once, then a script that throws.
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
    () => window.surfcad && typeof window.surfcad.setScript === 'function'
      && document.querySelector('canvas'),
    null,
    { timeout: 60000 },
  );
  await pause(page, 600);

  const beforePath = join(OUT_DIR, 'agent-bridge-before.png');
  await page.screenshot({ path: beforePath });
  console.log(`  before ${beforePath}`);

  const box = await page.evaluate(async (src) => {
    const wrote = await window.surfcad.setScript(src);
    const ran = await window.surfcad.run();
    return {
      script: window.surfcad.getScript(),
      wrote,
      ran,
      status: window.surfcad.status(),
      errors: window.surfcad.errors(),
    };
  }, BOX);
  check('box script is the editor buffer', box.script === BOX);
  check('box run ok', box.ran.ok === true, JSON.stringify(box.ran.errors));
  check('box is one feature', box.status.featureCount === 1, `count ${box.status.featureCount}`);
  check('box part name', box.status.partName === 'Part (1)', box.status.partName);
  check('box volume', Math.abs(box.status.volume - 24000) < 1, String(box.status.volume));
  check('box bbox', Array.isArray(box.status.bbox?.min) && box.status.bbox.min.length === 3, JSON.stringify(box.status.bbox));
  check('run after setScript did not add a second step', box.wrote.status.featureCount === box.ran.status.featureCount);
  await pause(page, 700);

  const hole = await page.evaluate(async (src) => {
    const wrote = await window.surfcad.setScript(src);
    const ran = await window.surfcad.run();
    const status = window.surfcad.status();
    const png = await window.surfcad.screenshot();
    return { wrote, ran, status, errors: window.surfcad.errors(), png, script: window.surfcad.getScript() };
  }, HOLE);
  check('hole script is the editor buffer', hole.script === HOLE);
  check('hole run ok', hole.ran.ok === true, JSON.stringify(hole.ran.errors));
  check('hole is two features', hole.status.featureCount === 2, `count ${hole.status.featureCount}`);
  check('hole volume dropped', hole.status.volume < 23000 && hole.status.volume > 15000, String(hole.status.volume));
  check('hole errors empty', hole.errors.length === 0, hole.errors.join(' | '));
  check('screenshot is a png data url', typeof hole.png === 'string' && hole.png.startsWith('data:image/png;base64,'), String(hole.png).slice(0, 32));
  const pngBytes = Buffer.from(String(hole.png).split(',')[1] || '', 'base64');
  check('screenshot png is a real image', pngBytes.length > 5000 && pngBytes[0] === 0x89 && pngBytes[1] === 0x50, `bytes ${pngBytes.length}`);
  writeFileSync(join(OUT_DIR, 'agent-bridge-viewport.png'), pngBytes);

  const afterPath = join(OUT_DIR, 'agent-bridge-after.png');
  await page.screenshot({ path: afterPath });
  console.log(`  after ${afterPath}`);
  await pause(page, 800);

  const undone = await page.evaluate(async (boxSrc) => {
    const result = await window.surfcad.undo();
    return {
      result,
      script: window.surfcad.getScript(),
      status: window.surfcad.status(),
      backToBox: window.surfcad.getScript() === boxSrc,
    };
  }, BOX);
  check('undo once restores the box', undone.backToBox === true, undone.script.slice(0, 80));
  check('undo run ok', undone.result.ok === true, JSON.stringify(undone.result.errors));
  check('undo volume is the box', Math.abs(undone.status.volume - 24000) < 1, String(undone.status.volume));
  check('undo feature count is one', undone.status.featureCount === 1, String(undone.status.featureCount));
  await pause(page, 800);

  const bad = await page.evaluate(async (src) => {
    const wrote = await window.surfcad.setScript(src);
    const ran = await window.surfcad.run();
    return {
      wrote,
      ran,
      errors: window.surfcad.errors(),
      status: window.surfcad.status(),
    };
  }, BAD);
  check('error run is not ok', bad.ran.ok === false, JSON.stringify(bad.ran));
  check('errors() names the throw', bad.errors.some((msg) => String(msg).includes('agent bridge demo')), bad.errors.join(' | '));
  check('failed status has no volume', bad.status.volume == null, String(bad.status.volume));
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
