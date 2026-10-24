#!/usr/bin/env node
/**
 * ui-bug-triage #5: with enough parts to scroll, the Parts strip's scroll bar
 * must not land on the delete icons. The rows container reserves the gutter
 * (`list-scroll`: scrollbar-gutter: stable, with rail-scroll's classic 8 px
 * bar), so every row's trash button ends inside the container's client box,
 * left of the bar. Vite dev server; Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window, getComputedStyle */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4373);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
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
  console.log('list scroll gutter golden: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

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
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), {
    name,
    argsJson: JSON.stringify(args ?? {}),
  });
}

const CUBE = 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;\n';

console.log('list scroll gutter golden');
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
// A short desktop window so nine rows overflow the strip.
const page = await browser.newPage({ viewport: { width: 1280, height: 560 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));
await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-list-gutter', email: 'agent@test.local' } }),
}));
await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-parts-rows]', { state: 'attached', timeout: 120000 });

const created = await agentCall(page, 'create_assembly', {});
check('create_assembly', created.ok === true, JSON.stringify(created));
for (let i = 0; i < 9; i += 1) {
  const made = await agentCall(page, 'create_part', { name: `Part ${i + 1}`, script: CUBE, position: [i * 30, 0, 0] });
  if (made.ok !== true) check(`create_part ${i + 1}`, false, JSON.stringify(made));
}
await page.waitForTimeout(400);

const measured = await page.evaluate(() => {
  const list = document.querySelector('[data-parts-rows]');
  if (!list) return { error: 'no parts rows container' };
  const style = getComputedStyle(list);
  const box = list.getBoundingClientRect();
  // clientWidth excludes a classic (non-overlay) scroll bar; everything the
  // rows draw must end at or before that edge.
  const contentRight = box.left + list.clientLeft + list.clientWidth;
  const barWidth = list.offsetWidth - list.clientWidth - 2 * list.clientLeft;
  const trash = [...list.querySelectorAll('[data-part-delete]')];
  const rows = trash.map((btn) => {
    const r = btn.getBoundingClientRect();
    return { right: r.right, over: r.right - contentRight };
  });
  return {
    scrolls: list.scrollHeight > list.clientHeight + 1,
    gutter: style.scrollbarGutter,
    barWidth,
    contentRight,
    rows,
    worst: rows.length ? Math.max(...rows.map((r) => r.over)) : null,
  };
});
check('nine parts make the strip scroll', measured.scrolls === true, JSON.stringify(measured));
check('the rows container reserves the scroll-bar gutter', /stable/.test(measured.gutter || ''), measured.gutter);
check('a classic scroll bar is present (headless Chrome)', measured.barWidth > 0, `bar ${measured.barWidth}px`);
check('every delete button ends left of the scroll bar', measured.rows.length >= 9 && measured.worst <= 0.5, JSON.stringify({ worst: measured.worst, rows: measured.rows.slice(0, 3) }));

// The same gutter on the other action-column lists: the class is applied, so
// the rule above covers them once they open (Open assembly, branches).
const classed = await page.evaluate(() => ({
  partsRows: document.querySelector('[data-parts-rows]')?.classList.contains('list-scroll') === true,
}));
check('the Parts strip carries list-scroll', classed.partsRows === true);
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
stop();
console.log(failed ? `list scroll gutter golden: FAIL (${failed})` : 'list scroll gutter golden: ok');
process.exit(failed ? 1 : 0);
