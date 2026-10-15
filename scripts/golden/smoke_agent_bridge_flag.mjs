#!/usr/bin/env node
/**
 * Flag off, the app is the app.
 *
 * Production preview (dev mode is off) at 390 and 1280, with no `?agent=1`
 * and no localStorage `surfcadAgent`. `window.surfcad` stays absent, and the
 * shells still mount the canvas, the CAD toolbar, and Run. Nothing named
 * agent is added to the page.
 *
 * `npm run build` first. Chrome is the system binary (`CHROME_PATH`).
 */
/* The evaluate callbacks run in the browser. */
/* global document, window, localStorage, location */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4318);
const APP_URL = `http://127.0.0.1:${PORT}/`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const VIEWS = [
  { name: '1280', width: 1280, height: 800, touch: false },
  {
    name: '390',
    width: 390,
    height: 844,
    touch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
];

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
  console.log('agent bridge flag: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('  ❌ dist/ missing — run `npm run build` first');
  process.exit(1);
}

mkdirSync(SHOT_DIR, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
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

async function stubBoot(page) {
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
}

console.log('agent bridge flag off at 390 and 1280');

let browser;
try {
  if (!await waitForServer()) {
    check('preview server started', false, `no response on ${APP_URL}`);
    process.exit(1);
  }

  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });

  for (const view of VIEWS) {
    console.log(`\n${view.name}`);
    const page = await browser.newPage({
      viewport: { width: view.width, height: view.height },
      hasTouch: view.touch,
      isMobile: view.touch,
      userAgent: view.userAgent,
    });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));
    await stubBoot(page);
    await page.addInitScript(() => {
      try { localStorage.removeItem('surfcadAgent'); } catch { /* private */ }
    });
    await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(
      () => document.querySelector('#root')?.children.length > 0
        && !document.querySelector('[data-app-loading]'),
      null,
      { timeout: 30000 },
    ).catch(() => {});

    const probe = await page.evaluate(() => ({
      surfcad: typeof window.surfcad,
      agentFlag: localStorage.getItem('surfcadAgent'),
      search: location.search,
      canvas: document.querySelectorAll('canvas').length,
      strip: document.querySelectorAll('[data-toolbar-variant="strip"]').length,
      run: document.querySelectorAll('[data-cad-run]').length,
      agentNodes: document.querySelectorAll('[data-agent-bridge], [data-surfcad-agent]').length,
      editorOpen: document.querySelector('[data-script-editor-open]')?.getAttribute('data-script-editor-open') || null,
      stage: document.querySelector('[data-mobile-stage-toggle]') ? 'phone' : 'desktop',
    }));

    check(`${view.name} window.surfcad is absent`, probe.surfcad === 'undefined', `typeof ${probe.surfcad}`);
    check(`${view.name} localStorage flag is unset`, probe.agentFlag == null, String(probe.agentFlag));
    check(`${view.name} URL has no agent param`, !/[?&]agent=/.test(probe.search), probe.search);
    check(`${view.name} canvas mounted`, probe.canvas > 0, `count ${probe.canvas}`);
    check(`${view.name} CAD toolbar mounted`, probe.strip > 0, `count ${probe.strip}`);
    check(`${view.name} Run button mounted`, probe.run > 0, `count ${probe.run}`);
    check(`${view.name} no agent chrome`, probe.agentNodes === 0, `count ${probe.agentNodes}`);
    if (view.touch) {
      check(`${view.name} phone stage toggle`, probe.stage === 'phone', probe.stage);
    } else {
      check(`${view.name} script drawer stays closed`, probe.editorOpen === 'false', String(probe.editorOpen));
    }
    check(`${view.name} no page errors`, pageErrors.length === 0, pageErrors.join(' | '));

    const shot = join(SHOT_DIR, `agent-bridge-flag-off-${view.name}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`  shot ${shot}`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.log(`\nagent bridge flag: ${failed} failed`);
  process.exit(1);
}
console.log('\nagent bridge flag: ok');
