#!/usr/bin/env node
/**
 * Agent prompt: typing vs working states, and the fold chevron (desktop).
 *
 * typing keeps the chat open with the dots and a normal input; working
 * collapses the chat and shows the spinner with "Agent is working". The
 * chevron on the prompt's bottom edge folds the prompt in every state; the
 * chevron at the bottom of the screen shows the state as a badge and brings
 * the prompt back as it was, draft and all. Esc folds, Enter toggles, the
 * live region announces, the folded choice survives a reload, Stop clears.
 *
 * Runs the app on the Vite dev server with the DEV stub
 * (`?agentPromptDemo=1&agentPromptState=…`). Chrome from CHROME_PATH or the usual paths.
 */
/* global document, window, localStorage, sessionStorage, getComputedStyle */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4351);
const BASE = `http://127.0.0.1:${PORT}/?agentPromptDemo=1&agentPromptState=`;
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
  console.log('agent prompt states golden: no system Chrome found — set CHROME_PATH. Skipping.');
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

const snapshot = (page) => page.evaluate(() => {
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, bottom: r.bottom, top: r.top, visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' };
  };
  const prompt = document.querySelector('[data-agent-prompt]');
  return {
    state: prompt?.getAttribute('data-agent-prompt-state'),
    folded: prompt?.getAttribute('data-agent-prompt-folded'),
    pane: !!document.querySelector('[data-agent-reply]'),
    dots: !!document.querySelector('[data-agent-typing]'),
    spinner: !!document.querySelector('[data-agent-working]'),
    workingText: document.querySelector('[data-agent-working]')?.textContent || '',
    inputDisabled: !!document.querySelector('[data-agent-prompt-input]')?.disabled,
    inputValue: document.querySelector('[data-agent-prompt-input]')?.value || '',
    stop: !!document.querySelector('[data-agent-prompt-stop]'),
    dismissX: !!document.querySelector('[data-agent-prompt-dismiss]'),
    fold: rect('[data-agent-prompt-fold]'),
    unfold: rect('[data-agent-prompt-unfold]'),
    promptRect: rect('[data-agent-prompt]'),
    badge: document.querySelector('[data-agent-prompt-unfold]')?.getAttribute('data-agent-prompt-badge') ?? null,
    live: document.querySelector('[data-agent-prompt-live]')?.textContent || '',
    foldLabel: document.querySelector('[data-agent-prompt-fold]')?.getAttribute('aria-label'),
    unfoldLabel: document.querySelector('[data-agent-prompt-unfold]')?.getAttribute('aria-label'),
    paneScroll: document.querySelector('[data-agent-reply]')?.scrollTop ?? null,
    inner: { w: window.innerWidth, h: window.innerHeight },
  };
});

async function openState(browser, state, { viewport = { width: 1280, height: 800 }, keep = false } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
  await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  // Start each scenario open: clear the remembered fold once per tab (a
  // reload inside the scenario keeps it, which is what the reload check needs).
  if (!keep) {
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('goldenFoldCleared')) {
          localStorage.removeItem('surfcadAgentPromptFolded');
          sessionStorage.setItem('goldenFoldCleared', '1');
        }
      } catch { /* ignore */ }
    });
  }
  await page.goto(BASE + state, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.querySelector('[data-app-loading]') && !!document.querySelector('[data-agent-prompt]'), { timeout: 120000 });
  await page.waitForTimeout(400);
  return { page, errors };
}

console.log('agent prompt states golden');
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

// 1. Typing: pane open with the dots, input normal, Stop available, no X.
{
  const { page, errors } = await openState(browser, 'agent-typing');
  const s = await snapshot(page);
  check('typing: state attribute', s.state === 'typing', JSON.stringify(s.state));
  check('typing: the chat stays open with the dots as the next bubble', s.pane && s.dots, JSON.stringify({ pane: s.pane, dots: s.dots }));
  check('typing: the input has no spinner and no working text', !s.spinner && s.workingText === '' && !s.inputDisabled);
  check('typing: Stop is available', s.stop);
  check('typing: the X is gone on desktop', !s.dismissX);
  check('typing: the chevron-down is available', !!s.fold?.visible);
  check('typing: the live region announces', /typing/i.test(s.live), s.live);
  check('typing: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// 2. Working: chat collapsed, spinner and text in the field, Stop clears to idle.
{
  const { page } = await openState(browser, 'agent-working');
  const s = await snapshot(page);
  check('working: state attribute', s.state === 'working');
  check('working: the chat history collapses', !s.pane && !s.dots, JSON.stringify({ pane: s.pane }));
  check('working: the field shows the spinner and "Agent is working"', s.spinner && /Agent is working/.test(s.workingText), s.workingText);
  check('working: the chevron-down is available', !!s.fold?.visible);
  check('working: the live region announces', /working/i.test(s.live), s.live);
  await page.click('[data-agent-prompt-stop]');
  await page.waitForTimeout(200);
  const after = await snapshot(page);
  check('Stop clears the indicators and goes back to idle', after.state === 'idle' && !after.spinner && !after.dots && !after.stop, JSON.stringify({ state: after.state, spinner: after.spinner, dots: after.dots }));
  check('after Stop the conversation is back', after.pane);
  await page.close();
}

// 3. Chevron placement at two desktop sizes, fold and unfold, badges.
for (const viewport of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
  const tag = `${viewport.width}×${viewport.height}`;
  const { page } = await openState(browser, 'chat', { viewport });
  const s = await snapshot(page);
  const centred = s.fold && s.promptRect && Math.abs(s.fold.cx - s.promptRect.cx) <= 2;
  const straddles = s.fold && s.promptRect && Math.abs(s.fold.cy - s.promptRect.bottom) <= 3;
  check(`${tag}: chevron-down centred on the prompt's bottom edge`, centred && straddles, JSON.stringify({ fold: s.fold, prompt: s.promptRect }));
  check(`${tag}: chevron-down has its label`, s.foldLabel === 'Hide agent prompt');
  await page.click('[data-agent-prompt-fold]');
  await page.waitForTimeout(400);
  const f = await snapshot(page);
  check(`${tag}: folding hides the prompt`, f.folded === '1' && !f.promptRect?.visible, JSON.stringify({ folded: f.folded, rect: f.promptRect }));
  // The prompt lives centred in the viewer pane, so the chevron-up sits on
  // that same centre line, at the bottom edge of the screen.
  const upCentred = f.unfold && Math.abs(f.unfold.cx - s.promptRect.cx) <= 2 && f.inner.h - f.unfold.bottom <= 24 && f.inner.h - f.unfold.bottom >= 0;
  check(`${tag}: chevron-up centred under the prompt at the bottom of the screen`, upCentred, JSON.stringify({ unfold: f.unfold, prompt: s.promptRect, inner: f.inner }));
  check(`${tag}: chevron-up has its label and no badge when idle`, f.unfoldLabel === 'Show agent prompt' && f.badge === '');
  await page.click('[data-agent-prompt-unfold]');
  await page.waitForTimeout(400);
  const back = await snapshot(page);
  check(`${tag}: unfolding brings the prompt back`, back.folded === '0' && back.promptRect?.visible && back.pane);
  await page.close();
}

// 4. Badges: the folded chevron shows the state.
for (const [state, badge] of [['agent-typing', 'typing'], ['agent-working', 'working']]) {
  const { page } = await openState(browser, state);
  await page.click('[data-agent-prompt-fold]');
  await page.waitForTimeout(300);
  const s = await snapshot(page);
  check(`folded while ${badge}: the chevron-up badge is ${badge}`, s.badge === badge && /agent is/.test(s.unfoldLabel || ''), JSON.stringify({ badge: s.badge, label: s.unfoldLabel }));
  await page.close();
}

// 5. Fold during a run: the run continues, unfolding restores the reply and the draft.
{
  const { page } = await openState(browser, 'idle');
  // Hold the DEV stub's echo so the in-flight badge cannot race to unread.
  await page.waitForFunction(() => typeof window.__surfcadAgentPromptStub?.holdReply === 'function', { timeout: 5000 });
  const held = await page.evaluate(() => {
    window.__surfcadAgentPromptStub.holdReply(true);
    return true;
  });
  check('fold-during-run: the demo stub can hold its reply', held === true);
  await page.fill('[data-agent-prompt-input]', 'Make the plate 3 mm thicker');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-agent-prompt]')?.getAttribute('data-agent-prompt-state');
    return state === 'typing' || state === 'working';
  }, { timeout: 5000 });
  await page.fill('[data-agent-prompt-input]', 'draft kept');
  await page.click('[data-agent-prompt-fold]');
  await page.waitForFunction(() => {
    const folded = document.querySelector('[data-agent-prompt]')?.getAttribute('data-agent-prompt-folded') === '1';
    const badge = document.querySelector('[data-agent-prompt-unfold]')?.getAttribute('data-agent-prompt-badge');
    return folded && (badge === 'typing' || badge === 'working');
  }, { timeout: 5000 });
  const during = await snapshot(page);
  check('fold during a run: folded with a typing or working badge', during.folded === '1' && (during.badge === 'typing' || during.badge === 'working'), JSON.stringify({ badge: during.badge }));
  await page.evaluate(() => window.__surfcadAgentPromptStub.releaseReply());
  await page.waitForFunction(() => document.querySelector('[data-agent-prompt-unfold]')?.getAttribute('data-agent-prompt-badge') === 'unread', { timeout: 10000 });
  const replied = await snapshot(page);
  check('the reply landed while folded: unread badge', replied.badge === 'unread' && /new reply/.test(replied.unfoldLabel || ''), JSON.stringify({ badge: replied.badge }));
  await page.click('[data-agent-prompt-unfold]');
  await page.waitForTimeout(300);
  const restored = await snapshot(page);
  check('unfolding restores the latest reply and the draft text', restored.pane && restored.inputValue === 'draft kept' && restored.state === 'idle', JSON.stringify({ input: restored.inputValue, pane: restored.pane, state: restored.state }));
  check('the live region announced the reply', /replied/i.test(restored.live), restored.live);
  await page.close();
}

// 6. Keyboard: Tab reaches the chevrons, Enter toggles, Esc folds from the prompt.
{
  const { page } = await openState(browser, 'chat');
  await page.focus('[data-agent-prompt-input]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const esc = await snapshot(page);
  check('Esc with focus in the prompt folds it', esc.folded === '1');
  const reachable = await page.evaluate(() => {
    const btn = document.querySelector('[data-agent-prompt-unfold]');
    btn.focus();
    return document.activeElement === btn && btn.tabIndex >= 0;
  });
  check('the chevron-up is focusable', reachable);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const open = await snapshot(page);
  check('Enter on the chevron-up opens the prompt', open.folded === '0');
  const foldReachable = await page.evaluate(() => {
    const btn = document.querySelector('[data-agent-prompt-fold]');
    btn.focus();
    return document.activeElement === btn && btn.tabIndex >= 0;
  });
  check('the chevron-down is focusable', foldReachable);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('Enter on the chevron-down folds the prompt', (await snapshot(page)).folded === '1');
  await page.close();
}

// 7. The folded state survives a reload.
{
  const { page } = await openState(browser, 'chat');
  await page.click('[data-agent-prompt-fold]');
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.querySelector('[data-app-loading]') && !!document.querySelector('[data-agent-prompt]'), { timeout: 120000 });
  await page.waitForTimeout(300);
  const s = await snapshot(page);
  check('the folded state survives a page reload', s.folded === '1' && !!s.unfold?.visible, JSON.stringify({ folded: s.folded }));
  if (s.unfold?.visible) {
    await page.click('[data-agent-prompt-unfold]');
    await page.waitForTimeout(200);
  }
  await page.close();
}

// 8. The agent_prompt bridge command folds and unfolds too.
{
  const { page } = await openState(browser, 'chat');
  const fold = await page.evaluate(() => window.surfcad?.call('agent_prompt', JSON.stringify({ action: 'fold' })));
  await page.waitForTimeout(200);
  check('agent_prompt fold', fold?.ok === true && (await snapshot(page)).folded === '1', JSON.stringify(fold));
  const unfold = await page.evaluate(() => window.surfcad?.call('agent_prompt', JSON.stringify({ action: 'unfold' })));
  await page.waitForTimeout(200);
  check('agent_prompt unfold', unfold?.ok === true && (await snapshot(page)).folded === '0', JSON.stringify(unfold));
  await page.close();
}

// 9. Mobile is deferred: the compact prompt keeps the X and has no chevron.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
  await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(BASE + 'chat', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.querySelector('[data-app-loading]') && !!document.querySelector('[data-agent-prompt]'), { timeout: 120000 });
  await page.waitForTimeout(400);
  const s = await snapshot(page);
  check('mobile: no chevron yet, the X stays', !s.fold && s.dismissX, JSON.stringify({ fold: s.fold, x: s.dismissX }));
  await page.close();
}

await browser.close();
stop();
if (failed) {
  console.log(`agent prompt states golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('agent prompt states golden: ok');
