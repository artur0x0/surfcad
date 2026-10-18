#!/usr/bin/env node
/**
 * Agent git save of path-less parts (surfcad-mcp "Kettle-MCP" report), end to end.
 *
 * Real GitHub adapter against a throwaway in-memory GitHub REST fake
 * (lib/fakeGithubApi.mjs) — never a real repo. An agent makes three parts
 * with no vault paths in a new assembly, git_save returns consent_pending at
 * once, the user clicks Allow, the retry commits exactly 4 files (3 part
 * scripts + .surf.json) in one commit. Then rename_part updates the working
 * copy only (no vault path move, no commit) and refuses an unknown id.
 * Every bridge call must answer within a few seconds.
 */
/* global document, window, indexedDB, localStorage, sessionStorage, navigator */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { GITHUB_TOKEN_STORAGE_KEY } from '../../src/utils/git/githubAuth.js';
import { createFakeGithub, installFakeGithub } from './lib/fakeGithubApi.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4331);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
const CALL_BUDGET_MS = 5000;

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
  console.log('agent git save consent: no system Chrome found — set CHROME_PATH. Skipping.');
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

async function waitForServer(timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const timings = [];
async function agentCall(page, name, args) {
  const started = Date.now();
  const out = await page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), {
    name,
    argsJson: JSON.stringify(args ?? {}),
  });
  const ms = Date.now() - started;
  timings.push({ name, ms });
  return { out, ms };
}

async function shot(page, label) {
  const buf = await page.screenshot({ type: 'png' });
  writeFileSync(join(SHOT_DIR, `agent-git-save-consent-${label}.png`), buf);
}

console.log('agent git save consent golden (fake GitHub backend)');

if (!(await waitForServer())) {
  console.log('  ❌ preview server did not start');
  stop();
  process.exit(1);
}

const fake = createFakeGithub({ login: 'golden-agent' });
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
// The consent modal only shows in a tab a person drives; automation is
// refused outright. Present as a regular tab so the modal path runs.
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});
await installFakeGithub(page, fake);
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
await page.route('**/api/auth/me', (route) => route.fulfill(json({
  authenticated: true,
  user: { _id: 'user-agent-git-save', email: 'agent@test.local' },
})));
await page.route('**/api/config', (route) => route.fulfill(json({})));
await page.route('**/api/cart', (route) => route.fulfill(json({ version: 0, lines: [], tombstones: [] })));
await page.route('**/api/wins', (route) => route.fulfill(json({ ok: true, wins: [] })));
await page.route('**/api/auth/vault-name', (route) => route.fulfill(json({ ok: true })));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(async ({ tokenKey }) => {
  localStorage.setItem('surfcadAgent', '1');
  sessionStorage.setItem(tokenKey, 'golden-fake-github-token');
  sessionStorage.removeItem('surfcadAgentGitRealSession');
  sessionStorage.removeItem('surfcadAgentGitDenied');
  localStorage.removeItem('surfcadAgentGitReal');
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('surfcad-assembly');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}, { tokenKey: GITHUB_TOKEN_STORAGE_KEY });
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
  { timeout: 120000 },
);
await page.waitForTimeout(800);

const seedCommits = fake.log().length;

const created = await agentCall(page, 'create_assembly', {});
check('create_assembly', created.out.ok === true, JSON.stringify(created.out));
const seedId = created.out.result?.activeId;

const renamedSeed = await agentCall(page, 'rename_part', { part_id: seedId, name: 'Kettle Body' });
check(
  'rename_part on a path-less part renames locally',
  renamedSeed.out.ok === true && renamedSeed.out.result?.status === 'renamed' && renamedSeed.out.result?.git === false,
  JSON.stringify(renamedSeed.out),
);
const body = await agentCall(page, 'set_script', {
  source: 'let part = Manifold.cube([40, 40, 30], true);\nreturn part;\n',
});
check('set_script body', body.out.ok === true, JSON.stringify(body.out));
const lid = await agentCall(page, 'create_part', {
  name: 'Kettle Lid',
  script: 'let part = Manifold.cylinder(4, 18, 18, 48, true);\nreturn part;\n',
});
const handle = await agentCall(page, 'create_part', {
  name: 'Kettle Handle',
  script: 'let part = Manifold.cube([6, 30, 20], true);\nreturn part;\n',
});
check('create_part x2', lid.out.ok === true && handle.out.ok === true, JSON.stringify([lid.out, handle.out]));

const before = await agentCall(page, 'parts', {});
const beforeParts = before.out.result?.parts || [];
check('three parts', beforeParts.length === 3, JSON.stringify(beforeParts));
check(
  'agent parts have no vault paths yet',
  beforeParts.every((part) => !String(part.id).endsWith('.js')),
  JSON.stringify(beforeParts.map((p) => p.id)),
);
check('create_part wrote nothing to git', fake.log().length === seedCommits, JSON.stringify(fake.log()));

const pending = await agentCall(page, 'git_save', { message: 'Save Kettle' });
check(
  'git_save returns consent_pending immediately',
  pending.out.ok === false && pending.out.error?.code === 'consent_pending' && pending.ms < CALL_BUDGET_MS,
  `${pending.ms}ms ${JSON.stringify(pending.out)}`,
);
check('consent_pending carries a retry hint', pending.out.error?.details?.retry === true
  && pending.out.error?.details?.retry_after_ms > 0, JSON.stringify(pending.out.error));
check('nothing written before Allow', fake.log().length === seedCommits, JSON.stringify(fake.log()));

await page.waitForSelector('[data-agent-git-consent-allow]', { timeout: 5000 });
const again = await agentCall(page, 'git_save', { message: 'Save Kettle' });
check(
  'second call while the modal is up is still consent_pending',
  again.out.error?.code === 'consent_pending' && fake.log().length === seedCommits,
  JSON.stringify(again.out),
);
await shot(page, 'modal');
await page.click('[data-agent-git-consent-allow]');
await page.waitForSelector('[data-agent-git-consent-allow]', { state: 'detached', timeout: 5000 });

const saved = await agentCall(page, 'git_save', { message: 'Save Kettle' });
check(
  'retry after Allow commits',
  saved.out.ok === true && saved.out.result?.status === 'committed',
  `${saved.ms}ms ${JSON.stringify(saved.out)}`,
);
const history = fake.log();
check('exactly one new commit', history.length === seedCommits + 1, JSON.stringify(history.map((c) => c.message)));
const commitFiles = history[0]?.files || [];
const scriptsWritten = commitFiles.filter((f) => f.path.endsWith('.js'));
const surfWritten = commitFiles.filter((f) => f.path.endsWith('.surf.json'));
check(
  'commit has exactly 4 files: 3 part .js + .surf.json',
  commitFiles.length === 4 && scriptsWritten.length === 3 && surfWritten.length === 1,
  JSON.stringify(commitFiles),
);
const surfText = surfWritten[0] ? fake.readFile(surfWritten[0].path) : null;
const surf = surfText ? JSON.parse(surfText) : null;
check(
  '.surf.json references exactly the committed scripts',
  !!surf && JSON.stringify(surf.parts.map((p) => p.path).sort())
    === JSON.stringify(scriptsWritten.map((f) => f.path).sort()),
  JSON.stringify(surf?.parts),
);
check(
  'part names kept',
  !!surf && JSON.stringify(surf.parts.map((p) => p.name).sort())
    === JSON.stringify(['Kettle Body', 'Kettle Handle', 'Kettle Lid']),
  JSON.stringify(surf?.parts),
);

const after = await agentCall(page, 'parts', {});
const afterParts = after.out.result?.parts || [];
const beforeIds = beforeParts.map((p) => p.id).sort();
check(
  'working copy keeps the same ids and stores assembly-folder paths',
  JSON.stringify(afterParts.map((p) => p.id).sort()) === JSON.stringify(beforeIds)
    && afterParts.every((p) => p.id && p.path && p.id !== p.path && String(p.path).startsWith('assemblies/'))
    && JSON.stringify(afterParts.map((p) => p.path).sort())
      === JSON.stringify(scriptsWritten.map((f) => f.path).sort()),
  JSON.stringify(afterParts),
);

const clean = await agentCall(page, 'git_save', { message: 'Save Kettle again' });
check(
  'second git_save is clean (no duplicate -2 files)',
  clean.out.ok === true && clean.out.result?.status === 'clean' && fake.log().length === seedCommits + 1,
  JSON.stringify(clean.out),
);

const lidRow = afterParts.find((p) => p.name === 'Kettle Lid');
const moved = await agentCall(page, 'rename_part', { part_id: lidRow?.id, name: 'Kettle Handle' });
check(
  'rename_part updates the working copy and does not move the vault path',
  moved.out.ok === true
    && moved.out.result?.partId === lidRow?.id
    && moved.out.result?.name === 'Kettle Handle (2)'
    && moved.out.result?.path === lidRow?.path
    && moved.out.result?.moved !== true
    && moved.out.result?.git === false,
  JSON.stringify(moved.out),
);
check(
  'rename does not add a commit',
  fake.log().length === seedCommits + 1,
  JSON.stringify(fake.log()[0]),
);
const surfAfter = JSON.parse(fake.readFile(surfWritten[0]?.path) || '{}');
check(
  'vault .surf.json still names the lid',
  (surfAfter.parts || []).some((p) => p.path === lidRow?.path && p.name === 'Kettle Lid')
    && !(surfAfter.parts || []).some((p) => /Handle-2|Handle \(2\)/.test(p.path || '')),
  JSON.stringify(surfAfter.parts),
);
const histAfter = await agentCall(page, 'history', {});
check('history readable after rename', histAfter.out.ok === true, JSON.stringify(histAfter.out));

const unknown = await agentCall(page, 'rename_part', { part_id: 'assemblies/Nope/Nope.js', name: 'X' });
check(
  'rename_part refuses an unknown id',
  unknown.out.ok === false && unknown.out.error?.code === 'unknown_part',
  JSON.stringify(unknown.out),
);

const slowest = timings.reduce((a, b) => (b.ms > a.ms ? b : a), { ms: 0 });
check(
  `every bridge call under ${CALL_BUDGET_MS}ms`,
  timings.every((t) => t.ms < CALL_BUDGET_MS),
  `slowest ${slowest.name} ${slowest.ms}ms`,
);
check('fake GitHub saw no unhandled routes', fake.unhandled.length === 0, fake.unhandled.join(', '));

await shot(page, 'after');
await browser.close();
stop();

if (failed) process.exit(1);
console.log(`agent git save consent: ok (slowest call ${slowest.name} ${slowest.ms}ms)`);
