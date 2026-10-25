#!/usr/bin/env node
/**
 * Agent bridge: open_feature → edit_feature { dx } → confirm_feature on a
 * move, while the agent prompt is working.
 *
 * The prompt demo (DEV only) puts the popup gate in the closed state the
 * MCP playtest hits: every bridge call runs inside withAgentDrivenChange,
 * so allowFeaturePopup is false and no move card mounts. The session still
 * has to survive until confirm, and the script has to change. A call with
 * no session is no_feature_edit. An unknown param is bad_args and is not
 * stored. This does not save to git.
 *
 * Vite dev server (the prompt demo is stripped from production builds).
 * Chrome from CHROME_PATH or the usual paths. Skip line matches the other
 * agent-bridge goldens: "no system Chrome found".
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4362);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1&agentPromptDemo=1&agentPromptState=working`;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const SCRIPT = `let part = Manifold.cube([20, 20, 20], true);
// --- move begin id=move6 ---
part = move(part, [0, 0, 0], { bodies: [{ at: [0, 0, 0] }] });
// --- move end ---
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
  console.log('agent bridge move edit: no system Chrome found — set CHROME_PATH. Skipping.');
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

console.log('agent bridge move edit golden');
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
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-move-edit', email: 'agent@test.local' } }),
}));
await page.route('**/api/config', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: '{}',
}));

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });
await page.waitForSelector('[data-agent-prompt-working="1"]', { timeout: 30000 });

const created = await agentCall(page, 'create_assembly', {});
check('create_assembly', created.ok === true, JSON.stringify(created));
const partId = (await agentCall(page, 'parts', {})).result?.activeId;
const seeded = await agentCall(page, 'set_script', { part_id: partId, source: SCRIPT });
check('cube plus move6', seeded.ok === true && seeded.result?.ok === true, JSON.stringify(seeded.result?.errors || seeded.error));

const before = (await agentCall(page, 'get_script', {})).result?.source || '';
const closed = await agentCall(page, 'edit_feature', { params: { dx: -38 } });
check('edit with no session is no_feature_edit', closed.ok === false && closed.error?.code === 'no_feature_edit', JSON.stringify(closed));
check('a refused edit does not change the script', (await agentCall(page, 'get_script', {})).result?.source === before);

const working = await page.getAttribute('[data-agent-prompt]', 'data-agent-prompt-working');
check('prompt still working, so the feature card stays closed', working === '1', working);

const opened = await agentCall(page, 'open_feature', { id: 'move6' });
check('open_feature move6', opened.ok === true && opened.result?.id === 'move6' && opened.result?.kind === 'move', JSON.stringify(opened));
const card = await page.locator('[data-move-mode]').count();
check('no move card while the prompt is working', card === 0, String(card));

const unknown = await agentCall(page, 'edit_feature', { params: { height: 12 } });
check('unknown param is bad_args', unknown.ok === false && unknown.error?.code === 'bad_args', JSON.stringify(unknown));
check('unknown param is not written', !/height/.test((await agentCall(page, 'get_script', {})).result?.source || '')
  && /move\(part, \[0, 0, 0\]/.test((await agentCall(page, 'get_script', {})).result?.source || ''));

const edited = await agentCall(page, 'edit_feature', { params: { dx: -38 } });
check('edit_feature dx', edited.ok === true && edited.result?.params?.dx === -38, JSON.stringify(edited));
const mid = await agentCall(page, 'status', {});
check('status between edit and confirm keeps the flow alive', mid.ok === true, JSON.stringify(mid.error || mid));
check('the script waits for confirm', /move\(part, \[0, 0, 0\]/.test((await agentCall(page, 'get_script', {})).result?.source || ''));

const confirmed = await agentCall(page, 'confirm_feature', {});
check('confirm_feature', confirmed.ok === true && confirmed.result?.ok === true && confirmed.result?.unchanged === false, JSON.stringify(confirmed.result || confirmed.error));
const after = (await agentCall(page, 'get_script', {})).result?.source || '';
check('script offset is dx -38', /move\(part, \[-38, 0, 0\]/.test(after), after.slice(-240));
const bbox = confirmed.result?.status?.bbox;
check('rebuild moved the solid', bbox && Array.isArray(bbox.min) && bbox.min[0] < -20, JSON.stringify(bbox));

const again = await agentCall(page, 'edit_feature', { params: { dx: 1 } });
check('session closes on confirm', again.ok === false && again.error?.code === 'no_feature_edit', JSON.stringify(again));

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`agent bridge move edit golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('agent bridge move edit golden: ok');
