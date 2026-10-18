#!/usr/bin/env node
/**
 * Agent rename_part commit isolation (Artur product decision).
 *
 * Fake GitHub only. Edit a saved part's script, move it, rename it: rename
 * is working-copy only (no commit). The edit and placement stay dirty, then
 * Save writes the new name plus those pending edits.
 */
/* global document, window, indexedDB, localStorage, sessionStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { GITHUB_TOKEN_STORAGE_KEY } from '../../src/utils/git/githubAuth.js';
import { createFakeGithub, installFakeGithub } from './lib/fakeGithubApi.mjs';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4333);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1&agentGit=real`;
const TIP_SCRIPT = 'let part = Manifold.cube([40, 40, 30], true);\nreturn part;\n';
const EDIT_SCRIPT = `${TIP_SCRIPT}// pending rename isolation edit\n`;

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
  console.log('agent part rename commit: no system Chrome found — set CHROME_PATH. Skipping.');
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

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), {
    name,
    argsJson: JSON.stringify(args ?? {}),
  });
}

async function shot(page, label) {
  const buf = await page.screenshot({ type: 'png' });
  writeFileSync(join(SHOT_DIR, `agent-part-rename-commit-${label}.png`), buf);
}

function userCommits(fake) {
  return fake.log().filter((row) => row.message !== 'Create SurfCAD vault');
}

console.log('agent part rename commit golden (fake GitHub backend)');

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
await installFakeGithub(page, fake);
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
await page.route('**/api/auth/me', (route) => route.fulfill(json({
  authenticated: true,
  user: { _id: 'user-agent-part-rename', email: 'agent@test.local' },
})));
await page.route('**/api/config', (route) => route.fulfill(json({})));
await page.route('**/api/cart', (route) => route.fulfill(json({ version: 0, lines: [], tombstones: [] })));
await page.route('**/api/wins', (route) => route.fulfill(json({ ok: true, wins: [] })));
await page.route('**/api/auth/vault-name', (route) => route.fulfill(json({ ok: true })));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(async ({ tokenKey }) => {
  localStorage.setItem('surfcadAgent', '1');
  localStorage.setItem('surfcadAgentGitReal', '1');
  sessionStorage.setItem(tokenKey, 'golden-fake-github-token');
  sessionStorage.setItem('surfcadAgentGitRealSession', '1');
  sessionStorage.removeItem('surfcadAgentGitDenied');
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

const created = await agentCall(page, 'create_assembly', {});
check('create_assembly', created.ok === true, JSON.stringify(created));
const seedId = created.result?.activeId;
const renamedSeed = await agentCall(page, 'rename_part', { part_id: seedId, name: 'Body' });
check(
  'path-less rename is local (no git commit)',
  renamedSeed.ok === true && renamedSeed.result?.git === false && userCommits(fake).length === 0,
  JSON.stringify({ renamed: renamedSeed, log: fake.log().map((c) => c.message) }),
);

const scripted = await agentCall(page, 'set_script', { source: TIP_SCRIPT });
check('set_script tip', scripted.ok === true, JSON.stringify(scripted));

const saved = await agentCall(page, 'git_save', { message: 'Save Body' });
check(
  'git_save commits the tip',
  saved.ok === true && saved.result?.status === 'committed',
  JSON.stringify(saved),
);
const afterSave = userCommits(fake);
check('exactly one save commit so far', afterSave.length === 1, JSON.stringify(afterSave.map((c) => c.message)));
const listed = await agentCall(page, 'parts', {});
const row = (listed.result?.parts || []).find((part) => part.id === seedId) || listed.result?.parts?.[0];
check('saved part has a vault path', !!(row?.id && row?.path), JSON.stringify(row));
const tipPath = row?.path;
const tipText = tipPath ? fake.readFile(tipPath) : null;
check('tip script is the saved body', typeof tipText === 'string' && tipText.includes('Manifold.cube([40, 40, 30]'), tipText?.slice(0, 120));

const edited = await agentCall(page, 'set_script', { source: EDIT_SCRIPT });
check('set_script pending edit', edited.ok === true, JSON.stringify(edited));
const moved = await agentCall(page, 'part_set_transform', { part: row.id, position: [25, 0, 0] });
check('part_set_transform placement', moved.ok === true, JSON.stringify(moved));
const dirtyBefore = await agentCall(page, 'dirty', {});
check(
  'edit and placement are dirty before rename',
  dirtyBefore.ok === true
    && dirtyBefore.result?.workspaceDirty === true
    && dirtyBefore.result?.assemblyDirty === true
    && (dirtyBefore.result?.partIds || []).includes(row.id),
  JSON.stringify(dirtyBefore),
);

const renamed = await agentCall(page, 'rename_part', { part_id: row.id, name: 'Mount' });
check(
  'rename_part updates the working copy and does not commit',
  renamed.ok === true
    && renamed.result?.partId === row.id
    && renamed.result?.git === false
    && renamed.result?.moved !== true
    && renamed.result?.name === 'Mount',
  JSON.stringify(renamed),
);
const afterRename = userCommits(fake);
check('rename does not add a commit', afterRename.length === 1, JSON.stringify(afterRename.map((c) => c.message)));
const tipAfterRename = tipPath ? fake.readFile(tipPath) : null;
check(
  'vault file still has the tip content',
  typeof tipAfterRename === 'string'
    && tipAfterRename === tipText
    && !tipAfterRename.includes('pending rename isolation edit'),
  tipAfterRename?.slice(0, 180),
);

const dirtyAfter = await agentCall(page, 'dirty', {});
const live = await agentCall(page, 'get_script', {});
check(
  'edit and placement stay dirty after rename',
  dirtyAfter.ok === true
    && dirtyAfter.result?.workspaceDirty === true
    && dirtyAfter.result?.assemblyDirty === true
    && dirtyAfter.result?.unsaved === true
    && (dirtyAfter.result?.partIds || []).includes(row.id)
    && (dirtyAfter.result?.editedSinceLoad || []).includes(row.id)
    && String(live.result?.source || '').includes('pending rename isolation edit'),
  JSON.stringify({ dirty: dirtyAfter, script: live.result?.source?.slice(-80) }),
);

const savedAgain = await agentCall(page, 'git_save', { message: 'Save edit and placement' });
check(
  'Save after rename commits',
  savedAgain.ok === true && savedAgain.result?.status === 'committed',
  JSON.stringify(savedAgain),
);
const afterSecondSave = userCommits(fake);
check('exactly one more commit after Save', afterSecondSave.length === 2, JSON.stringify(afterSecondSave.map((c) => c.message)));
const saveCommit = afterSecondSave[0];
const surfPath = saveCommit?.files.find((f) => f.path.endsWith('.surf.json'))?.path;
const savedPath = (saveCommit?.files || []).map((f) => f.path).find((path) => path.endsWith('.js'));
check(
  'Save commit holds the edit, placement, and new name',
  saveCommit
    && saveCommit.message === 'Save edit and placement'
    && !!surfPath,
  JSON.stringify(saveCommit),
);
const savedBytes = (savedPath && fake.readFile(savedPath)) || (tipPath && fake.readFile(tipPath));
check(
  'saved script has the pending edit',
  typeof savedBytes === 'string' && savedBytes.includes('pending rename isolation edit'),
  savedBytes?.slice(0, 180),
);
const surfSaved = JSON.parse(fake.readFile(surfPath) || '{}');
const savedRow = (surfSaved.parts || []).find((part) => part.id === row.id);
check(
  'saved .surf.json has the new name and placement',
  !!savedRow
    && savedRow.name === 'Mount'
    && Array.isArray(savedRow.position)
    && savedRow.position[0] === 25,
  JSON.stringify(savedRow),
);
check('fake GitHub saw no unhandled routes', fake.unhandled.length === 0, fake.unhandled.join(', '));

await shot(page, 'after');
await browser.close();
stop();

if (failed) process.exit(1);
console.log('agent part rename commit: ok');
