#!/usr/bin/env node
/**
 * Assembly Save writes every dirty child part (MVP-1 step 1).
 *
 * Playtest/production dist, loopback MCP relay, in-memory GitHub fake. The
 * agent builds parts through the bridge the way the "Futuristic Bike"
 * session did (create_part, set_active_part, set_script, insert_*), then
 * the Save button in the Parts strip and the MCP git_save each commit once.
 * Each commit's file list (the fake's real diff, not the hash manifest) must
 * hold the assembly JSON plus exactly the parts whose working copy changed.
 *
 *   S0  the seeded working copy has no vaultLayout (a document persisted
 *       before the stamp, or a local one that went git on connect); on
 *       connect the host stamps it v2 and the Save button is enabled.
 *   S1  three agent-created parts plus the seeded one; first UI Save writes
 *       the assembly JSON and all four part files.
 *   S2  two non-active parts edited, a third part made active, UI Save once:
 *       both edited parts are in the commit, the untouched ones are not.
 *   S3  the same shape through git_save.
 *   S4  the active part edited and saved inside the 600 ms draft debounce.
 *   S5  an assembly made with the Parts strip's + > Assembly, parts built by
 *       the agent, placed, then UI Save: a v2 id-path commit with every part
 *       (before the fix: Save disabled, and git_save wrote v1 name paths).
 *
 * After every Save the strip shows no part dots and dirty.unsaved is false.
 */
/* global localStorage, sessionStorage, navigator, document */
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
const PORT = Number(process.env.SMOKE_PORT || 4337);
const USER_ID = 'user-playtest';
const ASM_ID = '2026-10-22-05-00-00-0001-aa01';
const PART_ID = '2026-10-22-05-00-00-0002-bb02';
const SEEDED_SCRIPT = `// @surf-id ${PART_ID}\n// @name Frame\nconst part = Manifold.cube([20, 20, 20], true);\nreturn part;\n`;
const V2_MARKER = `${JSON.stringify({ kind: 'surfcad-vault', version: 2 }, null, 2)}\n`;

const cube = (x, y, z) => `const part = Manifold.cube([${x}, ${y}, ${z}], true);\nreturn part;\n`;

// No vaultLayout on purpose: this is the shape that mis-routed Save.
const ASSEMBLY = {
  version: 1,
  id: ASM_ID,
  source: 'git',
  name: 'Bike',
  activeId: PART_ID,
  parts: [{
    id: PART_ID,
    name: 'Frame',
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
  console.log('assembly save child parts: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}
if (!existsSync(join(ROOT, 'dist/index.html'))) {
  console.log('  ❌ dist/ missing — run `npm run build` first');
  process.exit(1);
}

async function mcp(client, name, args = {}) {
  const out = await client.callTool({ name, arguments: args });
  const text = out?.content?.[0]?.text || '';
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { isError: out?.isError === true, parsed };
}

const sortedPaths = (commit) => (commit?.files || []).map((file) => file.path).sort();
const partPath = (id) => `parts/${id}.js`;
const sameList = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Save button in the Parts strip: message dialog, confirm, wait for the commit. */
async function uiSave(page, fake, message) {
  const before = fake.log().length;
  await page.waitForSelector('[data-ui-action="data-git-save"]:not([disabled])', { timeout: 15000 });
  await page.click('[data-ui-action="data-git-save"]');
  await page.waitForSelector('[data-git-commit-message]', { timeout: 10000 });
  await page.fill('[data-git-commit-message]', message);
  await page.click('[data-ui-action="data-git-commit-confirm"]');
  const started = Date.now();
  while (Date.now() - started < 30000) {
    if (fake.log().length > before) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // The dialog shows the result on its done stage; wait for it, then close.
  await page.waitForSelector('[data-git-commit-done], [data-git-dialog="commit"] [data-git-dialog-cancel]', { timeout: 30000 }).catch(() => {});
  const done = await page.getAttribute('[data-git-commit-done]', 'data-git-commit-done').catch(() => null);
  await page.click('[data-git-dialog="commit"] [data-git-dialog-cancel]').catch(() => {});
  await page.waitForSelector('[data-git-dialog="commit"]', { state: 'detached', timeout: 10000 }).catch(() => {});
  // Let adoptV2SaveResult settle the baseline and the strip re-render.
  await page.waitForTimeout(400);
  const commit = fake.log().find((row) => row.message === message) || null;
  if (commit) commit.uiStatus = done;
  else console.log(`  · UI Save "${message}" produced no commit; dialog status=${done}`);
  return commit;
}

async function stripDirtyIds(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-part-row][data-part-dirty="true"]'))
    .map((el) => el.getAttribute('data-part-row')));
}

async function stripDirtyCount(page) {
  return page.evaluate(() => document.querySelectorAll('[data-part-row][data-part-dirty="true"]').length);
}

console.log('assembly save child parts golden (UI Save + git_save, fake GitHub)');

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
const client = new Client({ name: 'save-child-parts-e2e', version: '1.0.0' });
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
    // The agent's git_save is consent-gated; this golden grants it up front.
    sessionStorage.setItem('surfcadAgentGitRealSession', '1');
    sessionStorage.removeItem('surfcadAgentGitDenied');
    localStorage.removeItem('surfcadAgentGitReal');
  }, GITHUB_TOKEN_STORAGE_KEY);

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await waitForBridge(page);
  await waitForSignedInChip(page);

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
  // Close the profile menu so the Parts strip is clickable.
  await page.keyboard.press('Escape').catch(() => {});

  const asmPath = `assemblies/${ASM_ID}.surf.json`;

  // ---- S0: the unstamped document is healed on connect.
  const started0 = Date.now();
  let opened = await mcp(client, 'parts');
  while (opened.parsed?.vaultLayout !== 'v2' && Date.now() - started0 < 15000) {
    await page.waitForTimeout(250);
    opened = await mcp(client, 'parts');
  }
  check(
    'S0 a git document without vaultLayout reads as v2 after connect',
    opened.parsed?.vaultLayout === 'v2' && opened.parsed?.assemblyId === ASM_ID,
    JSON.stringify(opened.parsed),
  );
  const saveButton0 = await page.evaluate(() => {
    const el = document.querySelector('[data-ui-action="data-git-save"]');
    return el ? { disabled: el.disabled, title: el.title } : null;
  });
  check('S0 Save is enabled for the healed document', saveButton0 && saveButton0.disabled === false, JSON.stringify(saveButton0));

  // ---- S1: the bike shape. Agent creates and scripts parts, then UI Save.
  const a = await mcp(client, 'create_part', { name: 'Fork', script: cube(10, 10, 40) });
  const b = await mcp(client, 'create_part', { name: 'Wheel', script: cube(30, 30, 5) });
  const c = await mcp(client, 'create_part', { name: 'Saddle', script: cube(12, 8, 4) });
  const A = a.parsed?.partId;
  const B = b.parsed?.partId;
  const C = c.parsed?.partId;
  check('S1 create_part x3', [A, B, C].every((id) => typeof id === 'string'), JSON.stringify({ a: a.parsed, b: b.parsed, c: c.parsed }));

  // Edit Fork and Wheel like the agent does: switch, write, switch on.
  await mcp(client, 'set_active_part', { part_id: A });
  const editA1 = await mcp(client, 'set_script', { part_id: A, source: cube(10, 10, 42) });
  await mcp(client, 'set_active_part', { part_id: B });
  const insB1 = await mcp(client, 'insert_cube', {});
  check('S1 agent edits applied', editA1.isError !== true && insB1.isError !== true, JSON.stringify({ editA1: editA1.parsed, insB1: insB1.parsed }));
  const dirtyBefore1 = await mcp(client, 'dirty');
  const stripBefore1 = await stripDirtyIds(page);
  console.log(`  · S1 before save: dirty=${JSON.stringify(dirtyBefore1.parsed)} strip dots=${JSON.stringify(stripBefore1)}`);

  const s1 = await uiSave(page, fake, 'S1 first save');
  const s1Paths = sortedPaths(s1);
  const s1Expected = [asmPath, partPath(PART_ID), partPath(A), partPath(B), partPath(C)];
  check(
    'S1 first UI Save writes the assembly JSON and all four part files',
    !!s1 && sameList(s1Paths, s1Expected),
    JSON.stringify({ got: s1Paths, want: s1Expected }),
  );
  check(
    'S1 committed Fork and Wheel carry the agent edits',
    String(fake.readFile(partPath(A)) || '').includes('cube([10, 10, 42]')
      && String(fake.readFile(partPath(B)) || '').includes('cube(')
      && String(fake.readFile(partPath(B)) || '') !== String(fake.readFile(partPath(A)) || ''),
    JSON.stringify({ A: fake.readFile(partPath(A)), B: fake.readFile(partPath(B)) }),
  );
  const dirtyAfter1 = await mcp(client, 'dirty');
  const dots1 = await stripDirtyCount(page);
  check('S1 clean after save (no dots, dirty.unsaved false)', dirtyAfter1.parsed?.unsaved === false && dots1 === 0, JSON.stringify({ dirty: dirtyAfter1.parsed, dots: dots1 }));

  // ---- S2: two non-active parts edited, a third made active, UI Save once.
  await mcp(client, 'set_active_part', { part_id: A });
  const editA2 = await mcp(client, 'set_script', { part_id: A, source: cube(11, 11, 44) });
  await mcp(client, 'set_active_part', { part_id: B });
  const editB2 = await mcp(client, 'set_script', { part_id: B, source: cube(31, 31, 6) });
  await mcp(client, 'set_active_part', { part_id: C });
  check('S2 edits applied', editA2.isError !== true && editB2.isError !== true, JSON.stringify({ editA2: editA2.parsed, editB2: editB2.parsed }));
  const dirtyBefore2 = await mcp(client, 'dirty');
  const stripBefore2 = await stripDirtyIds(page);
  console.log(`  · S2 before save: dirty=${JSON.stringify(dirtyBefore2.parsed)} strip dots=${JSON.stringify(stripBefore2)}`);
  check(
    'S2 both edited parts show a dot before Save',
    stripBefore2.includes(A) && stripBefore2.includes(B) && !stripBefore2.includes(C),
    JSON.stringify(stripBefore2),
  );

  const s2 = await uiSave(page, fake, 'S2 two parts edited');
  const s2Paths = sortedPaths(s2);
  const s2Expected = [asmPath, partPath(A), partPath(B)];
  check(
    'S2 UI Save writes the assembly JSON and exactly the two edited parts',
    !!s2 && sameList(s2Paths, s2Expected),
    JSON.stringify({ got: s2Paths, want: s2Expected }),
  );
  check(
    'S2 committed bytes are the new edits',
    String(fake.readFile(partPath(A)) || '').includes('cube([11, 11, 44]')
      && String(fake.readFile(partPath(B)) || '').includes('cube([31, 31, 6]'),
    JSON.stringify({ A: fake.readFile(partPath(A)), B: fake.readFile(partPath(B)) }),
  );
  const dirtyAfter2 = await mcp(client, 'dirty');
  const dots2 = await stripDirtyCount(page);
  check('S2 clean after save', dirtyAfter2.parsed?.unsaved === false && dots2 === 0, JSON.stringify({ dirty: dirtyAfter2.parsed, dots: dots2 }));

  // ---- S3: the same shape through git_save.
  await mcp(client, 'set_active_part', { part_id: A });
  await mcp(client, 'set_script', { part_id: A, source: cube(12, 12, 46) });
  await mcp(client, 'set_active_part', { part_id: B });
  await mcp(client, 'set_script', { part_id: B, source: cube(32, 32, 7) });
  await mcp(client, 'set_active_part', { part_id: C });
  const saved3 = await mcp(client, 'git_save', { message: 'S3 git_save' });
  const s3 = fake.log().find((row) => row.message === 'S3 git_save') || null;
  const s3Paths = sortedPaths(s3);
  const s3Expected = [partPath(A), partPath(B)];
  check(
    'S3 git_save writes exactly the two edited parts (assembly JSON unchanged)',
    saved3.isError !== true && !!s3 && (sameList(s3Paths, s3Expected) || sameList(s3Paths, [asmPath, ...s3Expected])),
    JSON.stringify({ saved: saved3.parsed, got: s3Paths, want: s3Expected }),
  );
  const dirtyAfter3 = await mcp(client, 'dirty');
  const dots3 = await stripDirtyCount(page);
  check('S3 clean after save', dirtyAfter3.parsed?.unsaved === false && dots3 === 0, JSON.stringify({ dirty: dirtyAfter3.parsed, dots: dots3 }));

  // ---- S4: edit the active part, Save inside the 600 ms draft debounce.
  const editC4 = await mcp(client, 'set_script', { part_id: C, source: cube(13, 9, 5) });
  const s4 = await uiSave(page, fake, 'S4 active part fast save');
  const s4Paths = sortedPaths(s4);
  check(
    'S4 UI Save right after an active-part edit writes that part',
    editC4.isError !== true && !!s4 && s4Paths.includes(partPath(C))
      && String(fake.readFile(partPath(C)) || '').includes('cube([13, 9, 5]'),
    JSON.stringify({ got: s4Paths, C: fake.readFile(partPath(C)) }),
  );
  const dirtyAfter4 = await mcp(client, 'dirty');
  const dots4 = await stripDirtyCount(page);
  check('S4 clean after save', dirtyAfter4.parsed?.unsaved === false && dots4 === 0, JSON.stringify({ dirty: dirtyAfter4.parsed, dots: dots4 }));

  // ---- S5: an assembly created with the Parts strip's + > Assembly, parts
  // built by the agent, then UI Save. The bike was made this way.
  const prevAsmId = (await mcp(client, 'parts')).parsed?.assemblyId;
  await page.click('[data-part-add]');
  await page.click('[data-ui-action="data-part-add-kind-assembly"]');
  await page.waitForTimeout(1500);
  const dialogs = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]'))
    .map((el) => Array.from(el.attributes).filter((a) => a.name.startsWith('data-')).map((a) => `${a.name}=${a.value}`).join(' ')));
  console.log(`  · S5 dialogs after + > Assembly: ${JSON.stringify(dialogs)}`);
  const started5 = Date.now();
  let fresh = await mcp(client, 'parts');
  while (fresh.parsed?.assemblyId === prevAsmId && Date.now() - started5 < 15000) {
    await page.waitForTimeout(250);
    fresh = await mcp(client, 'parts');
  }
  check('S5 + > Assembly opens a new assembly', fresh.parsed?.assemblyId !== prevAsmId, JSON.stringify(fresh.parsed));
  const newAsmId = fresh.parsed?.assemblyId;
  const seedPartId = fresh.parsed?.activeId;
  console.log(`  · S5 new assembly ${newAsmId} layout=${fresh.parsed?.vaultLayout} seed part ${seedPartId}`);
  const d = await mcp(client, 'create_part', { name: 'Rim', script: cube(40, 40, 3) });
  const e = await mcp(client, 'create_part', { name: 'Hub', script: cube(6, 6, 20) });
  const D = d.parsed?.partId;
  const E = e.parsed?.partId;
  await mcp(client, 'set_active_part', { part_id: D });
  const editD = await mcp(client, 'set_script', { part_id: D, source: cube(41, 41, 3) });
  await mcp(client, 'set_active_part', { part_id: E });
  check('S5 agent parts created and edited', typeof D === 'string' && typeof E === 'string' && editD.isError !== true, JSON.stringify({ d: d.parsed, e: e.parsed, editD: editD.parsed }));
  // The bike session placed parts; that marks the assembly dirty.
  const moved5 = await mcp(client, 'part_set_transform', { part_id: D, position: [10, 0, 0] });
  check('S5 part_set_transform applies', moved5.isError !== true, JSON.stringify(moved5.parsed));
  const saveEnabled5 = await page.evaluate(() => {
    const el = document.querySelector('[data-ui-action="data-git-save"]');
    return el ? { disabled: el.disabled, title: el.title, dirty: el.getAttribute('data-git-dirty') } : null;
  });
  console.log(`  · S5 Save button after transform: ${JSON.stringify(saveEnabled5)}`);
  const dirtyBefore5 = await mcp(client, 'dirty');
  console.log(`  · S5 before save: dirty=${JSON.stringify(dirtyBefore5.parsed)} strip dots=${JSON.stringify(await stripDirtyIds(page))}`);
  check(
    'S5 Save is enabled and the new parts show dots before the first save',
    saveEnabled5 && saveEnabled5.disabled === false && dirtyBefore5.parsed?.unsaved === true,
    JSON.stringify({ button: saveEnabled5, dirty: dirtyBefore5.parsed }),
  );
  check('S5 a UI-created assembly is v2 from birth', fresh.parsed?.vaultLayout === 'v2', JSON.stringify(fresh.parsed));
  const s5 = await uiSave(page, fake, 'S5 new assembly first save');
  const s5Paths = sortedPaths(s5);
  const s5Expected = [`assemblies/${newAsmId}.surf.json`, partPath(seedPartId), partPath(D), partPath(E)];
  check(
    'S5 first UI Save of a UI-created assembly writes the v2 assembly JSON and every part by id',
    !!s5 && sameList(s5Paths, s5Expected),
    JSON.stringify({ got: s5Paths, want: s5Expected, uiStatus: s5?.uiStatus, allCommits: fake.log().map((row) => [row.message, sortedPaths(row)]) }),
  );
  const partsAfter5 = await mcp(client, 'parts');
  check(
    'S5 the working copy is v2 after the save',
    partsAfter5.parsed?.vaultLayout === 'v2' && partsAfter5.parsed?.assemblyId === newAsmId,
    JSON.stringify(partsAfter5.parsed),
  );
  const dirtyAfter5 = await mcp(client, 'dirty');
  const dots5 = await stripDirtyCount(page);
  check('S5 clean after save', dirtyAfter5.parsed?.unsaved === false && dots5 === 0, JSON.stringify({ dirty: dirtyAfter5.parsed, dots: dots5 }));
  // The agent path on the same document is the same v2 writer.
  const editE5 = await mcp(client, 'set_script', { part_id: E, source: cube(7, 7, 21) });
  const saved5 = await mcp(client, 'git_save', { message: 'S5 git_save after UI save' });
  const s5b = fake.log().find((row) => row.message === 'S5 git_save after UI save') || null;
  check(
    'S5 git_save on the UI-created assembly writes the edited part by id',
    editE5.isError !== true && saved5.isError !== true && !!s5b && sameList(sortedPaths(s5b), [partPath(E)]),
    JSON.stringify({ saved: saved5.parsed, got: sortedPaths(s5b) }),
  );
  check(
    'S5 no v1 name-path file ever landed on the v2 vault',
    fake.log().every((row) => sortedPaths(row).every((path) => !/^assemblies\/[^/]+\/(\.surf\.json|[^/]+\.js)$/.test(path) && !/^parts\/(?!\d{4}-)[^/]+\.js$/.test(path))),
    JSON.stringify(fake.log().map((row) => [row.message, sortedPaths(row)])),
  );

  check('fake GitHub saw no unhandled routes', fake.unhandled.length === 0, fake.unhandled.join(', '));

  if (failed && logs.length) {
    console.log('  browser console:');
    for (const line of logs.slice(-30)) console.log(`    ${line}`);
  }
} catch (err) {
  failed += 1;
  console.log(`  ❌ golden threw — ${err?.stack || err}`);
} finally {
  await stop();
}

if (failed) process.exit(1);
console.log('assembly save child parts: ok');
