#!/usr/bin/env node
/**
 * The script snippet feature: insert_code_snippet adds a code block with
 * its FEATURE-GAP line next to the other features, the part still runs,
 * an empty gap is refused, and opening a code chip shows the gap field
 * and the script area. The Script rail button is gone; the agent command
 * stays. Dev server, agent bridge. Chrome from CHROME_PATH or the usual
 * paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4354);
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
  console.log('code snippet golden: no system Chrome found — set CHROME_PATH. Skipping.');
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

console.log('code snippet golden');
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
// No backend in CI: everything under /api that is not stubbed below answers
// like an unreachable API (a local backend answering 401 would open Login).
await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
await page.route('**/api/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ authenticated: true, user: { _id: 'user-code-snippet', email: 'agent@test.local' } }),
}));
await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });

const created = await agentCall(page, 'create_assembly', {});
check('create_assembly', created.ok === true, JSON.stringify(created));
const partId = (await agentCall(page, 'parts', {})).result?.activeId;
const cube = await agentCall(page, 'insert_cube', {});
check('insert_cube', cube.ok === true && cube.result?.ok === true, JSON.stringify(cube.result?.errors || cube.error));
const volume0 = (await agentCall(page, 'status', {})).result?.volume;

// The tool is in the catalog with the three fields, and an empty gap is refused.
const commands = (await agentCall(page, 'list_commands', {})).result?.commands || [];
const tool = commands.find((c) => c.name === 'insert_code_snippet');
check('insert_code_snippet is a bridge command with gap, why, script', !!tool && ['gap', 'why', 'script'].every((k) => tool.schema?.properties?.[k]), JSON.stringify(tool?.schema?.properties ? Object.keys(tool.schema.properties) : tool));
const refused = await agentCall(page, 'insert_code_snippet', { gap: '', why: 'because', script: 'part = part;' });
check('an empty gap is bad_args and writes nothing', refused.ok === false && refused.error?.code === 'bad_args' && /gap|FEATURE/i.test(refused.error?.message || ''), JSON.stringify(refused));
check('nothing was written by the refusal', (await agentCall(page, 'feature_tree', {})).result?.features?.length === 1);

// The snippet: one operation, its own block, the gap line first.
const snippet = await agentCall(page, 'insert_code_snippet', {
  gap: 'sweep along 3D path',
  why: 'the tube follows a curve and extrude only goes straight',
  script: 'part = part.add(Manifold.cylinder(60, 3, 3, 24).translate([0, 0, 10]));',
});
check('insert_code_snippet runs', snippet.ok === true && snippet.result?.ok === true, JSON.stringify(snippet.result?.errors || snippet.error));
const tree = (await agentCall(page, 'feature_tree', {})).result?.features || [];
check('the feature tree has the cube and then a code block', tree.length === 2 && tree[0].kind === 'cube' && tree[1].kind === 'code', JSON.stringify(tree.map((f) => f.kind)));
const source = (await agentCall(page, 'get_script', {})).result?.source || '';
check('the block starts with the FEATURE-GAP line', /\/\/ --- code begin[^\n]*\n\/\/ FEATURE-GAP: sweep along 3D path \| the tube follows a curve and extrude only goes straight\n/.test(source), source.slice(-300));
const volume1 = (await agentCall(page, 'status', {})).result?.volume;
check('the operation ran: the volume grew', Number(volume1) > Number(volume0), `${volume0} → ${volume1}`);
check('status is ok', (await agentCall(page, 'status', {})).result?.runState === 'ok');

// A second snippet with its own gap: two code chips, two gaps.
const second = await agentCall(page, 'insert_code_snippet', { gap: 'thread', why: 'no thread feature', script: 'part = part;' });
check('a second snippet is its own block', second.ok === true && second.result?.ok === true && ((await agentCall(page, 'feature_tree', {})).result?.features || []).filter((f) => f.kind === 'code').length === 2);
const gaps = ((await agentCall(page, 'get_script', {})).result?.source || '').match(/\/\/ FEATURE-GAP: [^\n]+/g) || [];
check('a grep finds every gap, no duplicates', gaps.length === 2 && new Set(gaps).size === 2, JSON.stringify(gaps));

// No Script rail button. Opening a code chip still shows the snippet fields.
await agentCall(page, 'set_active_part', { part_id: partId });
check('the Script button is off the rail', (await page.locator('[data-ui-action="codeSnippet"]').count()) === 0);
const chips = (await agentCall(page, 'feature_tree', {})).result?.features || [];
const codeChip = [...chips].reverse().find((f) => f.kind === 'code');
const opened = await agentCall(page, 'open_feature', { id: codeChip?.id });
check('open_feature on a code chip opens the snippet sheet', opened.ok === true, JSON.stringify(opened));
await page.waitForSelector('[data-helper-param="gap"]', { timeout: 10000 });
check('the sheet shows the gap text field and the script area', (await page.locator('[data-helper-param="gap"]').count()) === 1 && (await page.locator('textarea[data-helper-param="script"]').count()) === 1);
await page.keyboard.press('Escape');

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
stop();
if (failed) {
  console.log(`code snippet golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('code snippet golden: ok');
