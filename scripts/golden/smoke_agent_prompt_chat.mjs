#!/usr/bin/env node
/**
 * Agent prompt chat pane (chat PR 2): the conversation shows both senders in
 * order, caps its height and scrolls inside, follows new messages unless the
 * user scrolled up, and the input never leaves the viewport.
 *
 * Runs the app on the Vite dev server with the DEV echo stub
 * (`?agentPromptDemo=1&agentPromptState=chat-long`). Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4349);
const APP_URL = `http://127.0.0.1:${PORT}/?agentPromptDemo=1&agentPromptState=chat-long`;
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
  console.log('agent prompt chat golden: no system Chrome found — set CHROME_PATH. Skipping.');
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

const paneMetrics = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-agent-reply]');
  const input = document.querySelector('[data-agent-prompt-input]');
  const r = input?.getBoundingClientRect();
  return el ? {
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    scrollTop: el.scrollTop,
    count: Number(el.getAttribute('data-agent-chat-count')),
    roles: [...el.querySelectorAll('[data-agent-msg]')].map((n) => n.getAttribute('data-agent-msg')),
    jump: !!document.querySelector('[data-agent-prompt-jump]'),
    inputVisible: !!r && r.top >= 0 && r.bottom <= window.innerHeight,
    lastUserRight: (() => {
      const users = el.querySelectorAll('[data-agent-msg="user"]');
      const last = users[users.length - 1];
      if (!last) return false;
      const a = last.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      return (b.right - a.right) < (a.left - b.left);
    })(),
  } : null;
});

async function run(page, label, { maxHeight }) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-agent-prompt]', { timeout: 120000 });
  await page.waitForSelector('[data-agent-reply]', { timeout: 30000 });
  await page.waitForTimeout(300);
  let m = await paneMetrics(page);
  check(`${label}: both senders in order`, m && m.roles.join(',') === 'user,agent,user,agent,user,agent,user,agent', JSON.stringify(m?.roles));
  check(`${label}: user messages sit right`, m?.lastUserRight === true);
  check(`${label}: pane is capped at ${maxHeight}px and scrolls inside`, m && m.clientHeight <= maxHeight && m.scrollHeight > m.clientHeight, JSON.stringify(m));
  check(`${label}: pane starts at the newest message`, m && m.scrollHeight - (m.scrollTop + m.clientHeight) <= 24, JSON.stringify(m));
  check(`${label}: input stays on screen`, m?.inputVisible === true);

  // Send through the DEV echo stub: the user bubble and the reply both land and the pane follows.
  await page.fill('[data-agent-prompt-input]', 'Make the seat tube 2 mm thicker.');
  await page.click('[data-agent-prompt-send]');
  await page.waitForFunction(() => Number(document.querySelector('[data-agent-reply]')?.getAttribute('data-agent-chat-count')) >= 10, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  m = await paneMetrics(page);
  check(`${label}: the sent message and its reply were appended`, m && m.count === 10 && m.roles.slice(-2).join(',') === 'user,agent', JSON.stringify({ count: m?.count, tail: m?.roles.slice(-2) }));
  check(`${label}: the pane followed the new reply`, m && m.scrollHeight - (m.scrollTop + m.clientHeight) <= 24 && m.jump === false, JSON.stringify(m));

  // Sending scrolls to your own message; then scroll up to read while the
  // reply is on its way: the pane stays put when it lands and offers a way down.
  await page.fill('[data-agent-prompt-input]', 'And the head tube.');
  await page.click('[data-agent-prompt-send]');
  await page.waitForFunction(() => Number(document.querySelector('[data-agent-reply]')?.getAttribute('data-agent-chat-count')) >= 11, null, { timeout: 10000 });
  await page.evaluate(() => { document.querySelector('[data-agent-reply]').scrollTop = 0; });
  await page.waitForTimeout(100);
  await page.waitForFunction(() => Number(document.querySelector('[data-agent-reply]')?.getAttribute('data-agent-chat-count')) >= 12, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  m = await paneMetrics(page);
  check(`${label}: scrolled up, the pane stays where the reader is`, m && m.scrollTop < 40, JSON.stringify({ scrollTop: m?.scrollTop }));
  check(`${label}: a way back to the bottom is offered`, m?.jump === true);
  await page.click('[data-agent-prompt-jump]');
  await page.waitForTimeout(150);
  m = await paneMetrics(page);
  check(`${label}: jump returns to the newest message`, m && m.scrollHeight - (m.scrollTop + m.clientHeight) <= 24 && m.jump === false, JSON.stringify(m));

  // Desktop: the fold chevron puts the prompt away and brings it back with
  // the history intact. Phone: the X still hides the pane, and the next
  // message brings it back.
  if ((await page.locator('[data-agent-prompt-fold]').count()) > 0) {
    await page.click('[data-agent-prompt-fold]');
    await page.waitForTimeout(300);
    check(`${label}: fold hides the prompt`, (await page.locator('[data-agent-prompt][data-agent-prompt-folded="1"]').count()) === 1);
    await page.click('[data-agent-prompt-unfold]');
    await page.waitForTimeout(300);
    m = await paneMetrics(page);
    check(`${label}: unfold brings the history back`, m && m.count === 12, JSON.stringify({ count: m?.count }));
  } else {
    await page.click('[data-agent-prompt-dismiss]');
    await page.waitForTimeout(150);
    check(`${label}: dismiss hides the pane`, (await page.locator('[data-agent-reply]').count()) === 0);
  }
  await page.fill('[data-agent-prompt-input]', 'Back again.');
  await page.click('[data-agent-prompt-send]');
  await page.waitForFunction(() => Number(document.querySelector('[data-agent-reply]')?.getAttribute('data-agent-chat-count')) >= 14, null, { timeout: 10000 });
  m = await paneMetrics(page);
  check(`${label}: the history came back with the next message`, m && m.count === 14, JSON.stringify({ count: m?.count }));
}

console.log('agent prompt chat golden');
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
const pageErrors = [];

const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
desktop.on('pageerror', (err) => pageErrors.push(err.message));
await run(desktop, 'desktop', { maxHeight: 200 });
await desktop.close();

const phone = await browser.newPage({ viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
phone.on('pageerror', (err) => pageErrors.push(err.message));
await run(phone, 'phone', { maxHeight: 160 });
await phone.close();

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`agent prompt chat golden: ${failed} failed`);
  process.exit(1);
}
console.log('agent prompt chat golden: all passed');
