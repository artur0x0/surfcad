#!/usr/bin/env node
/**
 * Relay end-to-end: agent writes through surfcad-mcp obey save-model v2.
 *
 * Playtest/production dist, loopback relay (the same stdio MCP client the
 * Safari popup golden uses), and the in-memory GitHub fake. The tab is a
 * signed-in v2 working copy. Nothing talks to GitHub.
 *
 * Host rules this golden locks (no new error codes):
 *   1. Working-copy mutations (set_script, rename_part, create_part) are not
 *      git writes, so they are not consent-gated. git_save on the real
 *      adapter without a session write grant returns consent_pending while
 *      the Allow dialog is up. Deny returns real_repo_blocked /
 *      consent_declined. Neither call commits or changes the model.
 *   2. A granted set_script changes the editor and sets dirty.unsaved, and
 *      still does not commit.
 *   3. git_save then commits exactly once. dirty.unsaved goes back to false.
 *   4. An overlapping remote edit makes the next git_save an error with
 *      code "conflict" (executePlanSave status/code, mapped by gitOpResult).
 *      Nothing else is committed.
 */
/* global localStorage, navigator, sessionStorage */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { GITHUB_TOKEN_STORAGE_KEY } from '../../src/utils/git/githubAuth.js';
import {
  findChrome,
  installApiMocks,
  seedAssembly,
  startPreviewServer,
  waitForBridge,
  waitForServer,
  waitForSignedInChip,
} from '../playtest/lib/harness.mjs';
import { pickFreePort } from '../playtest/lib/pickFreePort.mjs';
import { createFakeGithub, installFakeGithub } from './lib/fakeGithubApi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER_BIN = join(ROOT, 'packages/surfcad-mcp/bin/surfcad-mcp.js');
const PORT = Number(process.env.SMOKE_PORT || 4335);
const USER_ID = 'user-playtest';
const ASM_ID = '2026-10-18-02-50-00-0001-aa01';
const PART_ID = '2026-10-18-02-50-00-0002-bb02';
const SAVE_MESSAGE = 'Save Gearbox v2';
const CONFLICT_MESSAGE = 'Save Gearbox conflict';
const SEEDED_SCRIPT = `// @surf-id ${PART_ID}\n// @name Bracket\nconst part = Manifold.cube([20, 20, 20], true);\nreturn part;\n`;
const EDITED_SCRIPT = 'const part = Manifold.cube([30, 20, 10], true);\nreturn part;\n';
const LID_SCRIPT = 'const part = Manifold.cylinder(8, 12, 12, 24, true);\nreturn part;\n';
const GRANTED_SCRIPT = 'const part = Manifold.cube([16, 16, 16], true);\nreturn part;\n';
const CONFLICT_SCRIPT = 'const part = Manifold.cube([18, 14, 12], true);\nreturn part;\n';
const V2_MARKER = `${JSON.stringify({ kind: 'surfcad-vault', version: 2 }, null, 2)}\n`;

const ASSEMBLY = {
  version: 1,
  id: ASM_ID,
  source: 'git',
  vaultLayout: 'v2',
  name: 'Gearbox',
  activeId: PART_ID,
  parts: [{
    id: PART_ID,
    name: 'Bracket',
    visible: true,
    order: 0,
    surfId: PART_ID,
    isSynced: false,
  }],
};

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const exe = findChrome();
if (!exe) {
  console.log('agent bridge save-model v2: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}
if (!existsSync(join(ROOT, 'dist/index.html'))) {
  console.log('  ❌ dist/ missing — run `npm run build` first');
  process.exit(1);
}

function fakeApi(fake, method, path, body) {
  const url = `https://api.github.com/repos/${fake.login}/${fake.repo}${path}`;
  const out = fake.handle(method, url, body);
  if (!out || out.status >= 300) {
    throw new Error(`${method} ${path} -> ${out?.status} ${JSON.stringify(out?.data)}`);
  }
  return out.data;
}

/** One fast-forward commit on the fake, as if another client pushed. */
function pushRemoteFile(fake, path, content, message, branch = 'feature/save-model') {
  const parent = fake.branches.get(branch);
  const commit = fakeApi(fake, 'GET', `/git/commits/${parent}`);
  const blob = fakeApi(fake, 'POST', '/git/blobs', { content, encoding: 'utf-8' });
  const tree = fakeApi(fake, 'POST', '/git/trees', {
    base_tree: commit.tree.sha,
    tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }],
  });
  const next = fakeApi(fake, 'POST', '/git/commits', {
    message,
    tree: tree.sha,
    parents: [parent],
  });
  fakeApi(fake, 'PATCH', `/git/refs/heads/${branch}`, { sha: next.sha, force: false });
  return next.sha;
}

function commitMessages(fake) {
  return fake.log().map((row) => row.message);
}

async function mcp(client, name, args = {}) {
  const out = await client.callTool({ name, arguments: args });
  const text = out?.content?.[0]?.text || '';
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { isError: out?.isError === true, parsed };
}

console.log('agent bridge save-model v2 golden (MCP relay, fake GitHub)');

const relayPort = await pickFreePort();
const relayUrl = `ws://127.0.0.1:${relayPort}`;
const origin = `http://127.0.0.1:${PORT}`;
const appUrl = `${origin}/?agent=1&agentBridgeWs=${encodeURIComponent(relayUrl)}`;

const { stop: stopPreview } = startPreviewServer(PORT, {
  SURFCAD_MCP_START_RELAY: '0',
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER_BIN],
  env: {
    ...process.env,
    SURFCAD_AGENT_BRIDGE_WS_PORT: String(relayPort),
    SURFCAD_AGENT_BRIDGE_WS_URL: relayUrl,
    SURFCAD_PAIRING_CODE: '',
  },
  stderr: 'pipe',
});
const client = new Client({ name: 'save-model-v2-e2e', version: '1.0.0' });
const fake = createFakeGithub({ login: 'golden-agent', marker: V2_MARKER });
let browser;

const stop = async () => {
  if (browser) await browser.close().catch(() => {});
  await client.close().catch(() => {});
  stopPreview();
};
process.on('exit', () => { stopPreview(); });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stop().finally(() => process.exit(1)); });
}

try {
  if (!(await waitForServer(`${origin}/`))) {
    console.log('  ❌ preview server did not start');
    await stop();
    process.exit(1);
  }
  await client.connect(transport);
  const relayUp = await (async () => {
    const started = Date.now();
    while (Date.now() - started < 20000) {
      try {
        const res = await fetch(`http://127.0.0.1:${relayPort}/bridge`);
        if (res.ok) return true;
      } catch { /* relay still binding */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  })();
  check('relay is up', relayUp);
  if (!relayUp) {
    await stop();
    process.exit(1);
  }

  browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);
  const logs = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') logs.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => { logs.push(`pageerror: ${err.message}`); });
  // The consent modal only opens in a tab a person drives.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  await installApiMocks(page);
  await installFakeGithub(page, fake);

  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await seedAssembly(page, {
    userId: USER_ID,
    assembly: ASSEMBLY,
    parts: [{ id: PART_ID, script: SEEDED_SCRIPT }],
  });
  await page.evaluate((tokenKey) => {
    sessionStorage.setItem(tokenKey, 'golden-fake-github-token');
    sessionStorage.removeItem('surfcadAgentGitRealSession');
    sessionStorage.removeItem('surfcadAgentGitDenied');
    localStorage.removeItem('surfcadAgentGitReal');
  }, GITHUB_TOKEN_STORAGE_KEY);

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await waitForBridge(page);
  await waitForSignedInChip(page);

  const seedCommits = fake.log().length;
  await page.locator('[data-profile-chip]').first().click();
  await page.click('[data-ui-action="data-agent-bridge-connect"]');
  await page.waitForSelector('[data-agent-bridge-waiting-relay]', { state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForSelector('[data-agent-bridge-code]', { state: 'visible', timeout: 15000 });
  const code = (await page.locator('[data-agent-bridge-code]').innerText()).trim();
  const pairPromise = client.callTool({ name: 'pair', arguments: { code } });
  await page.locator('[data-ui-action="data-agent-bridge-approve"]').click();
  const paired = await pairPromise;
  check('MCP pair succeeds after Allow', paired.isError !== true, paired.content?.[0]?.text);
  await page.waitForSelector('[data-agent-bridge-connection-ring="connected"]', { timeout: 15000 });

  const opened = await mcp(client, 'parts');
  check(
    'open working copy is the seeded v2 assembly',
    opened.isError !== true
      && opened.parsed?.vaultLayout === 'v2'
      && opened.parsed?.assemblyName === 'Gearbox'
      && (opened.parsed?.parts || []).some((part) => part.id === PART_ID),
    JSON.stringify(opened.parsed),
  );

  const edited = await mcp(client, 'set_script', { part_id: PART_ID, source: EDITED_SCRIPT });
  const afterEdit = await mcp(client, 'dirty');
  const scriptAfterEdit = await mcp(client, 'get_script');
  check(
    'rule1 set_script without a write grant edits the working copy',
    edited.isError !== true
      && edited.parsed?.ok !== false
      && String(scriptAfterEdit.parsed?.source || '').includes('cube([30, 20, 10]'),
    JSON.stringify({ edited: edited.parsed, script: scriptAfterEdit.parsed }),
  );
  check(
    'rule1 set_script marks dirty.unsaved and does not ask for git consent',
    afterEdit.parsed?.unsaved === true && edited.parsed?.code !== 'consent_pending',
    JSON.stringify(afterEdit.parsed),
  );

  const renamed = await mcp(client, 'rename_part', { part_id: PART_ID, name: 'Bracket Plate' });
  check(
    'rule1 rename_part without a write grant stays local',
    renamed.isError !== true
      && renamed.parsed?.partId === PART_ID
      && renamed.parsed?.name === 'Bracket Plate'
      && renamed.parsed?.git !== true
      && renamed.parsed?.moved !== true,
    JSON.stringify(renamed.parsed),
  );

  const created = await mcp(client, 'create_part', { name: 'Lid', script: LID_SCRIPT });
  const lidId = created.parsed?.partId;
  check(
    'rule1 create_part without a write grant adds a row',
    created.isError !== true && created.parsed?.ok !== false && typeof lidId === 'string' && lidId !== PART_ID,
    JSON.stringify(created.parsed),
  );
  check(
    'rule1 mutations do not commit',
    commitMessages(fake).length === seedCommits,
    JSON.stringify(commitMessages(fake)),
  );

  const beforeDeny = await mcp(client, 'parts');
  const beforeDenyScript = await mcp(client, 'get_script');
  const pending = await mcp(client, 'git_save', { message: SAVE_MESSAGE });
  check(
    'rule1 git_save without a write grant returns consent_pending',
    pending.isError === true && pending.parsed?.code === 'consent_pending'
      && pending.parsed?.details?.reason === 'consent_pending'
      && pending.parsed?.details?.retry === true,
    JSON.stringify(pending.parsed),
  );
  check(
    'rule1 consent_pending writes no commit',
    commitMessages(fake).length === seedCommits,
    JSON.stringify(commitMessages(fake)),
  );
  await page.waitForSelector('[data-agent-git-consent-deny]', { timeout: 5000 });
  await page.click('[data-ui-action="data-agent-git-consent-deny"]');
  await page.waitForSelector('[data-agent-git-consent-deny]', { state: 'detached', timeout: 5000 });

  const declined = await mcp(client, 'git_save', { message: SAVE_MESSAGE });
  const afterDeny = await mcp(client, 'parts');
  const afterDenyScript = await mcp(client, 'get_script');
  check(
    'rule1 git_save after Deny returns real_repo_blocked consent_declined',
    declined.isError === true
      && declined.parsed?.code === 'real_repo_blocked'
      && declined.parsed?.details?.reason === 'consent_declined',
    JSON.stringify(declined.parsed),
  );
  check(
    'rule1 Deny changes nothing',
    commitMessages(fake).length === seedCommits
      && JSON.stringify(afterDeny.parsed) === JSON.stringify(beforeDeny.parsed)
      && afterDenyScript.parsed?.source === beforeDenyScript.parsed?.source,
    JSON.stringify({
      commits: commitMessages(fake),
      parts: afterDeny.parsed,
      script: afterDenyScript.parsed?.source,
    }),
  );

  await page.evaluate(() => {
    sessionStorage.setItem('surfcadAgentGitRealSession', '1');
    sessionStorage.removeItem('surfcadAgentGitDenied');
  });
  await mcp(client, 'set_active_part', { part_id: PART_ID });
  const granted = await mcp(client, 'set_script', { part_id: PART_ID, source: GRANTED_SCRIPT });
  const dirtyGranted = await mcp(client, 'dirty');
  const scriptGranted = await mcp(client, 'get_script');
  check(
    'rule2 granted set_script changes the model and marks dirty.unsaved',
    granted.isError !== true
      && granted.parsed?.ok !== false
      && dirtyGranted.parsed?.unsaved === true
      && String(scriptGranted.parsed?.source || '').includes('cube([16, 16, 16]'),
    JSON.stringify({ granted: granted.parsed, dirty: dirtyGranted.parsed }),
  );
  check(
    'rule2 a granted working-copy edit still does not commit',
    commitMessages(fake).length === seedCommits,
    JSON.stringify(commitMessages(fake)),
  );

  const saved = await mcp(client, 'git_save', { message: SAVE_MESSAGE });
  const saveCommit = fake.log().find((row) => row.message === SAVE_MESSAGE);
  const savePaths = (saveCommit?.files || []).map((file) => file.path);
  check(
    'rule3 git_save commits exactly once',
    saved.isError !== true
      && saved.parsed?.status === 'committed'
      && commitMessages(fake).filter((message) => message === SAVE_MESSAGE).length === 1
      && fake.log().length === seedCommits + 1,
    JSON.stringify({ saved: saved.parsed, log: fake.log() }),
  );
  const surfPath = savePaths.find((path) => path.endsWith('.surf.json'));
  let surf = null;
  try { surf = JSON.parse(fake.readFile(surfPath) || 'null'); } catch { surf = null; }
  check(
    'rule3 the one commit is a v2 id-path save',
    !!saveCommit
      && savePaths.some((path) => path === `parts/${PART_ID}.js`)
      && savePaths.some((path) => path === `parts/${lidId}.js`)
      && surfPath === `assemblies/${ASM_ID}.surf.json`
      && surf?.version === 2
      && (surf?.parts || []).every((part) => part.path == null)
      && !savePaths.includes('README.md'),
    JSON.stringify({ savePaths, surf }),
  );
  const dirtyAfterSave = await mcp(client, 'dirty');
  check(
    'rule3 dirty.unsaved is false after git_save',
    dirtyAfterSave.parsed?.unsaved === false,
    JSON.stringify(dirtyAfterSave.parsed),
  );

  // The rule3 commit checked the session out on main. The next git_save
  // has to be on another branch. The working copy is clean, so create switches.
  const leftMain = await mcp(client, 'git_branch_create', { name: 'feature/save-model' });
  check(
    'conflict git_save is off main',
    leftMain.isError !== true && leftMain.parsed?.switched === true,
    JSON.stringify(leftMain.parsed),
  );

  // planSave conflicts only on overlapping planned paths. Bracket is the
  // part this golden edits (`part_id: PART_ID`); overlapping Lid would
  // commit as a non-overlapping remote change.
  const committedBracket = fake.readFile(`parts/${PART_ID}.js`) || '';
  pushRemoteFile(fake, `parts/${PART_ID}.js`, `${committedBracket}\n// remote edit\n`, 'remote overlap');
  const remoteCount = fake.log().length;
  await mcp(client, 'set_active_part', { part_id: PART_ID });
  const conflictEdit = await mcp(client, 'set_script', { part_id: PART_ID, source: CONFLICT_SCRIPT });
  const conflict = await mcp(client, 'git_save', { message: CONFLICT_MESSAGE });
  check(
    'rule4 git_save conflict is the host conflict code',
    conflictEdit.isError !== true
      && conflict.isError === true
      && conflict.parsed?.code === 'conflict',
    JSON.stringify(conflict.parsed),
  );
  check(
    'rule4 a conflict commits nothing',
    !commitMessages(fake).includes(CONFLICT_MESSAGE) && fake.log().length === remoteCount,
    JSON.stringify(commitMessages(fake)),
  );
  check('fake GitHub saw no unhandled routes', fake.unhandled.length === 0, fake.unhandled.join(', '));

  if (failed && logs.length) {
    console.log('  browser console:');
    for (const line of logs.slice(-20)) console.log(`    ${line}`);
  }
} catch (err) {
  failed += 1;
  console.log(`  ❌ golden threw — ${err?.stack || err}`);
} finally {
  await stop();
}

if (failed) process.exit(1);
console.log('agent bridge save-model v2: ok');
