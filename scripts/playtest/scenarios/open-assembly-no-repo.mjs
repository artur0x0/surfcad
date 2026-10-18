/* global window, document */
/**
 * open_assembly with no repo shows "No repo yet. Save creates it."
 * open_assembly { assembly_id } against a real adapter does not write git.
 * A missing id is unknown_assembly.
 *
 *   npm run build:playtest && node scripts/playtest/run.mjs --scenario open-assembly-no-repo
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { agentCall, savePageScreenshot, seedGithubToken } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';
import { createFakeGithub } from '../../golden/lib/fakeGithubApi.mjs';

export const id = 'open-assembly-no-repo';
export const title = 'open_assembly no-repo notice and v2 id open';
export const userId = 'user-playtest-open-notice';

const LOGIN = 'playtest-open';
const NOTICE = 'No repo yet. Save creates it.';
const CUBE_ID = '2026-10-18-12-00-00-0001-a1b2';
const PIN_ID = '2026-10-18-12-00-00-0002-c3d4';
const BRACKET_ASM = '2026-10-18-12-00-00-0003-bb01';
const HOUSING_ASM = '2026-10-18-12-00-00-0004-hh01';
const MISSING_ASM = '2026-10-18-12-00-00-0009-dead';
const CUBE = `// @surf-id ${CUBE_ID}\nlet part = Manifold.cube([20, 20, 20], true);\nreturn part;\n`;
const PIN = `// @surf-id ${PIN_ID}\nlet part = Manifold.cylinder(12, 4, 4, 32, true);\nreturn part;\n`;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': '*',
  'cache-control': 'no-store',
};

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'Assembly',
    activeId: 'seed',
    source: 'local',
    parts: [{ id: 'seed', name: 'Shell', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{
    id: 'seed',
    script: 'let part = Manifold.cube([16, 16, 16], true);\nreturn part;\n',
  }];
}

function v2Surf(id, name, partId, partName) {
  return `${JSON.stringify({
    format: 'surfcad.assembly',
    version: 2,
    id,
    name,
    activeId: partId,
    parts: [{ id: partId, name: partName, visible: true, order: 0 }],
  }, null, 2)}\n`;
}

function routeOf(url) {
  const u = new URL(url);
  return `${u.pathname}${u.search}`.replace(
    new RegExp(`/repos/${LOGIN}/[^/]+`),
    '/repos/:o/:r',
  ).replace(/[0-9a-f]{40}/g, ':sha');
}

function tally(rows) {
  const byRoute = {};
  for (const row of rows) {
    const key = `${row.method} ${routeOf(row.url).replace(/\?.*$/, '')}`;
    byRoute[key] = (byRoute[key] || 0) + 1;
  }
  const gets = rows.filter((row) => row.method === 'GET');
  const writes = rows.filter((row) => row.method !== 'GET' && row.method !== 'HEAD' && row.method !== 'OPTIONS');
  return { total: rows.length, gets: gets.length, writes: writes.length, byRoute };
}

/** Commit text files onto main through the fake's own REST handler. */
function commitFiles(fake, files, message) {
  const prefix = `https://api.github.com/repos/${fake.login}/${fake.repo}`;
  const branch = fake.handle('GET', `${prefix}/branches/main`, null);
  const sha = branch.data.commit.sha;
  const commit = fake.handle('GET', `${prefix}/git/commits/${sha}`, null);
  const entries = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = fake.handle('POST', `${prefix}/git/blobs`, { content });
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.data.sha });
  }
  const tree = fake.handle('POST', `${prefix}/git/trees`, {
    base_tree: commit.data.tree.sha,
    tree: entries,
  });
  const next = fake.handle('POST', `${prefix}/git/commits`, {
    message,
    tree: tree.data.sha,
    parents: [sha],
  });
  const patched = fake.handle('PATCH', `${prefix}/git/refs/heads/main`, {
    sha: next.data.sha,
    force: true,
  });
  if (patched.status >= 300) {
    throw new Error(`fake commit failed ${patched.status}`);
  }
}

export async function run(ctx) {
  const { page, outDir } = ctx;
  const runner = createStepRunner();
  const shotDir = join(outDir, 'open-assembly-no-repo');
  mkdirSync(shotDir, { recursive: true });

  const fake = createFakeGithub({ login: LOGIN, repo: 'surfcad-vault' });
  const gate = { noVault: true, record: false };
  const recorded = [];
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS, body: '' });
      return;
    }
    const url = req.url();
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    const path = new URL(url).pathname;
    let out;
    if (gate.noVault && path.startsWith('/repos/')) {
      out = { status: 404, data: { message: 'Not Found' } };
    } else {
      out = fake.handle(req.method(), url, body) || { status: 404, data: { message: 'Not Found' } };
    }
    if (gate.record) recorded.push({ method: req.method(), url, status: out.status });
    await route.fulfill({
      status: out.status,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify(out.data),
    });
  });

  await runner.runStep('connect with no repo and show the blocked-open notice', async () => {
    await seedGithubToken(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
      null,
      { timeout: 120000 },
    );
    await page.waitForSelector('[data-git-save]', { timeout: 20000 });
    const beforeShot = join(shotDir, 'before-open-no-repo.png');
    await savePageScreenshot(page, beforeShot);
    const beforeText = await page.locator('body').innerText();
    const opened = await agentCall(page, 'open_assembly', { assembly_id: MISSING_ASM });
    const toast = page.locator('[data-upload-toast]');
    await toast.waitFor({ state: 'visible', timeout: 10000 });
    const toastText = await toast.innerText();
    const afterShot = join(shotDir, 'after-open-no-repo-notice.png');
    await savePageScreenshot(page, afterShot);
    const toasts = await agentCall(page, 'toasts', {});
    const listed = (toasts.result?.toasts || []).map((row) => row.message);
    const ok = opened.ok === false
      && opened.error?.code === 'git_blocked'
      && opened.error?.message === NOTICE
      && toastText.includes(NOTICE)
      && !beforeText.includes(NOTICE)
      && listed.some((message) => message === NOTICE);
    return {
      ok,
      call: 'open_assembly',
      args: { assembly_id: MISSING_ASM },
      envelope: opened,
      detail: `toast=${JSON.stringify(toastText)} toasts=${JSON.stringify(listed)}`,
    };
  });

  await runner.runStep('unknown assembly_id is unknown_assembly', async () => {
    gate.noVault = false;
    commitFiles(fake, {
      'surfcad.json': `${JSON.stringify({ kind: 'surfcad-vault', version: 2 }, null, 2)}\n`,
      [`assemblies/${BRACKET_ASM}.surf.json`]: v2Surf(BRACKET_ASM, 'Bracket', CUBE_ID, 'Cube'),
      [`parts/${CUBE_ID}.js`]: CUBE,
      [`assemblies/${HOUSING_ASM}.surf.json`]: v2Surf(HOUSING_ASM, 'Housing', PIN_ID, 'Pin'),
      [`parts/${PIN_ID}.js`]: PIN,
    }, 'seed v2 assemblies');
    const missing = await agentCall(page, 'open_assembly', { assembly_id: MISSING_ASM });
    const ok = missing.ok === false && missing.error?.code === 'unknown_assembly';
    return {
      ok,
      call: 'open_assembly',
      args: { assembly_id: MISSING_ASM },
      envelope: missing,
      detail: `code=${missing.error?.code}`,
    };
  });

  await runner.runStep('opening a known assembly_id does not write git', async () => {
    recorded.length = 0;
    gate.record = true;
    const opened = await agentCall(page, 'open_assembly', { assembly_id: BRACKET_ASM });
    await page.waitForTimeout(3000);
    gate.record = false;
    const counts = tally(recorded);
    const ok = opened.ok === true
      && opened.result?.assemblyId === BRACKET_ASM
      && opened.result?.assemblyName === 'Bracket'
      && counts.writes === 0;
    return {
      ok,
      call: 'open_assembly',
      args: { assembly_id: BRACKET_ASM },
      envelope: { assemblyId: opened.result?.assemblyId, error: opened.error || null },
      detail: `gets=${counts.gets} writes=${counts.writes} ${JSON.stringify(counts.byRoute)}`,
    };
  });

  return {
    id,
    title,
    ok: runner.failed === 0,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots: [
      join(shotDir, 'before-open-no-repo.png'),
      join(shotDir, 'after-open-no-repo-notice.png'),
    ],
  };
}
