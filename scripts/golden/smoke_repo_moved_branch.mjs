#!/usr/bin/env node
/**
 * A part save and an assembly save that hit a moved main show one yellow
 * warning with Make a new branch. The button cuts a branch from the local
 * baseline, lands the save there, and switches the working ref.
 * The G13 conflict popup is not shown for that Save.
 *
 * 390 and 1280. The moved-main response is a stubbed GitHub ref, not surfcad.com.
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global indexedDB, localStorage, sessionStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault, vaultMarkerContent } from '../../src/utils/git/vault.js';
import { assemblyFilePath, sharedPartPath } from '../../src/utils/git/vaultLayout.js';
import { stringifySurfJson } from '../../src/utils/git/surfJson.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { openVaultAssembly } from '../../src/utils/git/gitWorkspace.js';
import {
  commitPartToRepo,
  REPO_MOVED_WARNING,
  repoSavedMessage,
  saveLocalOnNewBranch,
  assembleCommitFiles,
} from '../../src/utils/git/gitCommit.js';
import { createSyncStore } from '../../src/utils/git/syncStore.js';
import { flushSyncQueue } from '../../src/utils/git/syncWorker.js';
import { withSurfId } from '../../src/utils/git/surfId.js';

const PORT = Number(process.env.SMOKE_PORT || 5248);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SURF = '2026-10-10-15-00-00-0000-ab12';
const PART = sharedPartPath('Bracket');
const ASM = assemblyFilePath('Gearbox');
const ORIGINAL = withSurfId('// original-tip\nreturn Manifold.cube([20, 20, 20], true);\n', SURF);
const LOCAL = withSurfId('// local-edit\nreturn Manifold.cube([20, 20, 20], true);\n', SURF);
const DOC = {
  version: 1,
  source: 'git',
  name: 'Gearbox',
  activeId: PART,
  parts: [{
    id: PART, name: 'Bracket', visible: true, order: 0, surfId: SURF, isSynced: true,
  }],
};

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
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

console.log('repo moved — branch from local state');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

{
  const commitSrc = read('src/utils/git/gitCommit.js');
  const app = read('src/App.jsx');
  const feed = read('src/components/PartFeed.jsx');
  const arch = read('docs/architecture.md');
  const map = read('docs/ui-map.md');
  check('the old red Upload Error sentence is gone', !/Save the assembly \(or resolve the conflict\)/.test(commitSrc + app));
  check('part save returns repo-moved, not an error toast', /status: 'repo-moved'/.test(commitSrc)
    && /result\.status === 'repo-moved'/.test(app)
    && /setUploadError\(result\.error/.test(app));
  check('assembly save does not open the popup for this result', /surfaceConflict: false/.test(app)
    && /status === 'repo-moved'/.test(feed));
  check('warning is yellow with Make a new branch', /data-repo-moved-toast/.test(app)
    && /data-repo-moved-branch/.test(app)
    && /Make a new branch/.test(app)
    && /tone="warn"/.test(app.slice(app.indexOf('data-repo-moved-toast'))));
  check('success toast names the branch', /data-repo-saved-toast/.test(app) && /tone="success"/.test(app));
  check('architecture states one condition never shows both', /data-repo-moved-toast/.test(arch)
    && /One condition never shows both/.test(arch)
    && /data-git-conflict-popup/.test(arch));
  check('UI map states the same rule', /data-repo-moved-toast/.test(map)
    && /data-repo-moved-branch/.test(map)
    && /data-repo-saved-toast/.test(map)
    && /does not open the conflict popup/.test(map));
}

async function seedVault() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const seed = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed',
    baseSha: vault.headSha,
    files: [
      fileWrite(ASM, stringifySurfJson(DOC)),
      fileWrite(PART, ORIGINAL),
    ],
  });
  const opened = await openVaultAssembly(gh, vault.repo, 'Gearbox', { branch: 'main', headSha: seed.sha });
  return { gh, repo: vault.repo, opened, seedSha: seed.sha };
}

{
  const { gh, repo, opened, seedSha } = await seedVault();
  const remote = await gh.commitFiles(repo, {
    branch: 'main',
    message: 'remote',
    baseSha: seedSha,
    files: [fileWrite(PART, ORIGINAL.replace('original-tip', 'remote-moved'))],
  });
  const moved = await commitPartToRepo(gh, repo, {
    doc: opened.doc,
    scripts: { ...opened.scripts, [PART]: LOCAL },
    baseline: opened.baseline,
    partId: PART,
  });
  check('part save reports repo-moved', moved.status === 'repo-moved' && moved.code === 'non_fast_forward', moved.status);
  check('part save did not write main', (await gh.getBranch(repo, 'main')).sha === remote.sha);
  check('part save kept the local files', moved.files?.some((file) => file.path === PART && String(file.content).includes('local-edit')));
  const saved = await saveLocalOnNewBranch(gh, repo, {
    doc: moved.doc,
    scripts: moved.scripts,
    baseline: { ...opened.baseline, headSha: moved.baseSha },
    files: moved.files,
    message: moved.message,
    now: new Date(2026, 9, 10, 12, 0),
  });
  check('part branch name', saved.branch === 'surfcad/Gearbox-2026-10-10', saved.branch || '');
  check('part save landed on the branch', (await gh.readFile(repo, PART, saved.branch))?.content?.includes('local-edit'));
  check('part save left the remote edit on main', (await gh.readFile(repo, PART, 'main'))?.content?.includes('remote-moved'));
  check('working ref is the new branch', saved.baseline?.branch === saved.branch && saved.baseline?.headSha === saved.sha);
}

{
  const { gh, repo, opened, seedSha } = await seedVault();
  const store = createSyncStore({ persist: false });
  await store.setLastSyncedSha(repo, seedSha, 'main');
  const remote = await gh.commitFiles(repo, {
    branch: 'main',
    message: 'remote',
    baseSha: seedSha,
    files: [fileWrite(PART, ORIGINAL.replace('original-tip', 'remote-moved'))],
  });
  const assembled = await assembleCommitFiles(gh, repo, {
    doc: opened.doc,
    scripts: { ...opened.scripts, [PART]: LOCAL },
    baseline: opened.baseline,
    message: 'Update Gearbox',
  });
  await store.enqueue(repo, {
    op: 'save',
    branch: 'main',
    message: assembled.message,
    partIds: assembled.partIds,
    files: assembled.files,
  });
  const flushed = await flushSyncQueue({ store, adapter: gh, repo, branch: 'main', online: true });
  check('assembly save reports conflict', flushed.status === 'conflict', flushed.status);
  check('assembly flush did not write main', (await gh.getBranch(repo, 'main')).sha === remote.sha);
  const saved = await saveLocalOnNewBranch(gh, repo, {
    doc: assembled.doc,
    scripts: assembled.scripts,
    baseline: { ...opened.baseline, headSha: flushed.lastSyncedSha },
    files: assembled.files,
    message: assembled.message,
    now: new Date(2026, 9, 10, 12, 0),
  });
  check('assembly branch name', saved.branch === 'surfcad/Gearbox-2026-10-10', saved.branch || '');
  check('assembly save landed on the branch', (await gh.readFile(repo, PART, saved.branch))?.content?.includes('local-edit'));
  check('assembly save left the remote edit on main', (await gh.readFile(repo, PART, 'main'))?.content?.includes('remote-moved'));
  check('saved message names the branch', repoSavedMessage(saved.branch) === `Saved to ${saved.branch}`);
  check('warning copy', REPO_MOVED_WARNING === 'Repo moved. Nothing was overwritten.');
}

if (failed) {
  console.log(`\n❌ FAIL (${failed} failed before the browser)`);
  process.exit(1);
}

function createGithubStub() {
  let n = 1;
  const nextSha = () => (n++).toString(16).padStart(40, '0');
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const branches = new Map();
  const unhandled = [];
  let inflight = 0;
  let movedSha = null;

  const putBlob = (text) => {
    const id = nextSha();
    blobs.set(id, String(text));
    return id;
  };
  const putTree = (map) => {
    const id = nextSha();
    trees.set(id, new Map(map));
    return id;
  };
  const seedFiles = new Map([
    ['surfcad.json', vaultMarkerContent()],
    ['README.md', '# surfcad-vault\n'],
    [ASM, stringifySurfJson(DOC)],
    [PART, ORIGINAL],
  ]);
  const seedBlobs = new Map();
  for (const [path, text] of seedFiles) seedBlobs.set(path, putBlob(text));
  const seedTree = putTree(seedBlobs);
  const seedCommit = nextSha();
  commits.set(seedCommit, { treeSha: seedTree, parent: null, message: 'seed' });
  branches.set('main', seedCommit);

  const commitOf = (ref) => {
    if (!ref) return null;
    if (branches.has(ref)) return branches.get(ref);
    if (commits.has(ref)) return ref;
    return null;
  };
  const filesOf = (ref) => {
    const id = commitOf(ref);
    if (!id) return null;
    const tree = trees.get(commits.get(id).treeSha);
    const files = new Map();
    for (const [path, blob] of tree) files.set(path, blobs.get(blob));
    return files;
  };

  function moveMain() {
    const head = branches.get('main');
    const files = new Map(filesOf('main'));
    files.set(PART, files.get(PART).replace('original-tip', 'remote-moved'));
    const blobMap = new Map();
    for (const [path, text] of files) blobMap.set(path, putBlob(text));
    const treeSha = putTree(blobMap);
    const id = nextSha();
    commits.set(id, { treeSha, parent: head, message: 'remote edit' });
    branches.set('main', id);
    movedSha = id;
    return id;
  }

  function json(status, data) {
    return {
      status,
      contentType: 'application/json',
      body: JSON.stringify(data),
    };
  }

  function decodePath(suffix) {
    return suffix.split('/').map((seg) => decodeURIComponent(seg)).join('/');
  }

  function respond(request) {
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace(/^\/repos\/artur\/surfcad-vault/, '') || '/';
    let body = null;
    if (method !== 'GET' && method !== 'HEAD') {
      try { body = request.postDataJSON(); } catch { body = null; }
    }
    if (url.pathname === '/user' && method === 'GET') return json(200, { login: 'artur' });
    if (url.pathname === '/repos/artur/surfcad-vault' && method === 'GET') {
      return json(200, {
        name: 'surfcad-vault',
        private: true,
        default_branch: 'main',
        size: 12,
        owner: { login: 'artur' },
      });
    }
    if (path === '/branches' && method === 'GET') {
      return json(200, [...branches.entries()].map(([name, sha]) => ({ name, commit: { sha } })));
    }
    const branchGet = path.match(/^\/branches\/(.+)$/);
    if (branchGet && method === 'GET') {
      const name = decodeURIComponent(branchGet[1]);
      const sha = branches.get(name);
      if (!sha) return json(404, { message: 'Branch not found' });
      return json(200, { name, commit: { sha } });
    }
    if (path.startsWith('/contents/') && method === 'GET') {
      const filePath = decodePath(path.slice('/contents/'.length));
      const ref = url.searchParams.get('ref') || 'main';
      const files = filesOf(ref);
      const text = files?.get(filePath);
      if (text == null) return json(404, { message: 'Not Found' });
      return json(200, {
        type: 'file',
        path: filePath,
        encoding: 'base64',
        content: Buffer.from(text, 'utf8').toString('base64'),
        sha: 'blob',
      });
    }
    const commitGet = path.match(/^\/git\/commits\/([0-9a-f]+)$/);
    if (commitGet && method === 'GET') {
      const row = commits.get(commitGet[1]);
      if (!row) return json(404, { message: 'Not Found' });
      return json(200, { sha: commitGet[1], tree: { sha: row.treeSha }, message: row.message });
    }
    const treeGet = path.match(/^\/git\/trees\/([0-9a-f]+)$/);
    if (treeGet && method === 'GET') {
      const tree = trees.get(treeGet[1]);
      if (!tree) return json(404, { message: 'Not Found' });
      return json(200, {
        sha: treeGet[1],
        tree: [...tree.entries()].map(([filePath, sha]) => ({
          path: filePath, mode: '100644', type: 'blob', sha,
        })),
      });
    }
    if (path === '/git/blobs' && method === 'POST') {
      const text = body?.encoding === 'base64'
        ? Buffer.from(String(body.content || ''), 'base64').toString('utf8')
        : String(body?.content ?? '');
      return json(201, { sha: putBlob(text) });
    }
    if (path === '/git/trees' && method === 'POST') {
      const base = body?.base_tree ? new Map(trees.get(body.base_tree) || []) : new Map();
      for (const entry of body?.tree || []) {
        if (entry?.path && entry?.sha) base.set(entry.path, entry.sha);
      }
      return json(201, { sha: putTree(base) });
    }
    if (path === '/git/commits' && method === 'POST') {
      const id = nextSha();
      commits.set(id, {
        treeSha: body?.tree,
        parent: body?.parents?.[0] || null,
        message: body?.message || '',
      });
      return json(201, { sha: id, tree: { sha: body?.tree } });
    }
    if (path === '/git/refs' && method === 'POST') {
      const name = String(body?.ref || '').replace(/^refs\/heads\//, '');
      if (!name || branches.has(name)) return json(422, { message: `Reference already exists: ${name}` });
      if (!commits.has(body?.sha)) return json(404, { message: 'Not Found' });
      branches.set(name, body.sha);
      return json(201, { ref: body.ref, object: { sha: body.sha } });
    }
    const refPatch = path.match(/^\/git\/refs\/heads\/(.+)$/);
    if (refPatch && method === 'PATCH') {
      const name = decodeURIComponent(refPatch[1]);
      const current = branches.get(name);
      const next = commits.get(body?.sha);
      if (!current || !next) return json(422, { message: `${name} moved` });
      if (!body?.force && next.parent !== current) return json(422, { message: `${name} moved` });
      branches.set(name, body.sha);
      return json(200, { ref: `refs/heads/${name}`, object: { sha: body.sha } });
    }
    const compare = path.match(/^\/compare\/(.+)$/);
    if (compare && method === 'GET') {
      const spec = decodeURIComponent(compare[1]);
      const [base, head] = spec.split('...');
      const same = commitOf(base) === commitOf(head);
      return json(200, {
        status: same ? 'identical' : 'ahead',
        ahead_by: same ? 0 : 1,
        behind_by: 0,
        merge_base_commit: { sha: commitOf(base) },
        base_commit: { sha: commitOf(base) },
        commits: same ? [] : [{ sha: commitOf(head) }],
        files: [],
      });
    }
    unhandled.push(`${method} ${url.pathname}`);
    return json(404, { message: `stub miss ${method} ${url.pathname}` });
  }

  return {
    unhandled,
    get inflight() { return inflight; },
    get movedSha() { return movedSha; },
    moveMain,
    file: filesOf,
    sha: (name) => branches.get(name) || null,
    async handle(route) {
      inflight += 1;
      try {
        await route.fulfill(respond(route.request()));
      } finally {
        inflight -= 1;
      }
    },
  };
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('repo moved: no system Chrome — set CHROME_PATH');
  process.exit(1);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
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
      const res = await fetch(APP_URL);
      if (res.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function waitQuiet(git, page, timeoutMs = 20000) {
  const started = Date.now();
  let quietAt = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (git.inflight === 0) {
      if (Date.now() - quietAt > 500) return true;
    } else {
      quietAt = Date.now();
    }
    await page.waitForTimeout(50);
  }
  return false;
}

async function seedBrowser(page) {
  await page.evaluate(async ({ doc, script, part }) => {
    sessionStorage.setItem('surfcad.github.token', 'gho_golden');
    localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify({
      accessToken: 'gho_golden',
      refreshToken: '',
      expiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: 0,
    }));
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      'user-ar': {
        name: doc.name,
        activeId: part,
        source: 'git',
        savedAt: Date.now(),
      },
    }));
    const drop = (name) => new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    await drop('surfcad-assembly');
    await drop('surfcad-sync');
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('surfcad-assembly', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('assembly')) db.createObjectStore('assembly');
        if (!db.objectStoreNames.contains('parts')) db.createObjectStore('parts');
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['assembly', 'parts'], 'readwrite');
        tx.objectStore('assembly').put(doc, 'current');
        tx.objectStore('parts').put({ id: part, script, savedAt: Date.now(), isSynced: true }, part);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { doc: DOC, script: LOCAL, part: PART });
}

let browser;
try {
  if (!await waitForServer()) {
    check('dev server started', false, APP_URL);
    process.exit(1);
  }
  check('dev server started', true);
  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  const viewports = [
    { name: '390', width: 390, height: 844, touch: true },
    { name: '1280', width: 1280, height: 800, touch: false },
  ];
  for (const vp of viewports) {
    for (const kind of ['part', 'assembly']) {
      const git = createGithubStub();
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.touch,
        isMobile: vp.touch,
        userAgent: vp.touch
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
          : undefined,
      });
      const page = await context.newPage();
      const logs = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') logs.push(msg.text());
      });
      page.on('pageerror', (err) => logs.push(String(err)));
      await page.route('https://api.github.com/**', (route) => git.handle(route));
      await page.route('**/api/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: false }),
      }));
      await page.route('**/api/auth/me', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: 'user-ar',
            firstName: 'Artur',
            lastName: 'R',
            email: 'artur@example.com',
            vaultName: 'surfcad-vault',
          },
        }),
      }));
      await page.route('**/api/config', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ githubAppClientId: 'Iv1.golden' }),
      }));
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await seedBrowser(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const label = `${vp.name} ${kind}`;
      try {
        if (vp.touch) {
          await page.locator('[data-stage-btn="parts"]').click({ timeout: 90000 });
          await page.waitForSelector('[data-stage-pane="parts"]:not(.invisible)', { timeout: 8000 });
        }
        await page.waitForSelector(`[data-part-save="${PART}"][data-part-dirty="true"]`, {
          state: 'visible',
          timeout: 90000,
        });
        check(`${label} git settled before the move`, await waitQuiet(git, page));
        const moved = git.moveMain();
        check(`${label} stub moved main`, !!moved && git.sha('main') === moved);
        if (kind === 'part') {
          await page.locator(`[data-part-save="${PART}"]`).click();
        } else {
          await page.locator('[data-git-save]').click();
          await page.locator('[data-git-commit-confirm]').click();
        }
        await page.waitForSelector('[data-repo-moved-toast]', { timeout: 15000 });
        const shot = join(SHOT_DIR, `repo-moved-${kind}-${vp.name}.png`);
        await page.screenshot({ path: shot });
        const tone = await page.locator('[data-repo-moved-toast] [data-error-tone]').getAttribute('data-error-tone');
        const button = (await page.locator('[data-repo-moved-branch]').innerText()).trim();
        const movedKind = await page.locator('[data-repo-moved-toast]').getAttribute('data-repo-moved-kind');
        check(`${label} yellow warning`, tone === 'warn', tone || '');
        check(`${label} warning copy`, (await page.locator('[data-repo-moved-msg]').innerText()).includes(REPO_MOVED_WARNING));
        check(`${label} Make a new branch`, button === 'Make a new branch', button);
        check(`${label} kind`, movedKind === kind, movedKind || '');
        check(`${label} not a red Upload Error`, await page.locator('text=Upload Error').count() === 0);
        check(`${label} no G13 popup`, await page.locator('[data-git-conflict-popup]').count() === 0);
        await page.locator('[data-repo-moved-branch]').click();
        await page.waitForSelector('[data-repo-saved-toast]', { timeout: 15000 });
        const branch = await page.locator('[data-repo-saved-toast]').getAttribute('data-repo-saved-branch');
        const savedTone = await page.locator('[data-repo-saved-toast] [data-error-tone]').getAttribute('data-error-tone');
        const savedText = await page.locator('[data-repo-saved-toast]').innerText();
        const chip = (await page.locator('[data-viewer-git-branch], [data-assembly-branch]').first().innerText()).trim();
        const landed = git.file(branch)?.get(PART) || '';
        const remoteFile = git.file('main')?.get(PART) || '';
        check(`${label} success toast`, savedTone === 'success' && savedText.includes(branch), savedText);
        check(`${label} branch name`, /^surfcad\/Gearbox-\d{4}-\d{2}-\d{2}(?:-\d+)?$/.test(branch || ''), branch || '');
        check(`${label} working ref switched`, chip === branch, chip);
        check(`${label} save landed on the branch`, landed.includes('local-edit'), landed.slice(0, 80));
        check(`${label} main kept the remote edit`, remoteFile.includes('remote-moved') && git.sha('main') === moved);
        check(`${label} popup still hidden`, await page.locator('[data-git-conflict-popup]').count() === 0);
        const after = join(SHOT_DIR, `repo-moved-saved-${kind}-${vp.name}.png`);
        await page.screenshot({ path: after });
        check(`${label} shots`, existsSync(shot) && existsSync(after));
      } catch (err) {
        check(`${label} flow`, false, String(err?.message || err));
        if (git.unhandled.length) console.log(`    stub miss: ${git.unhandled.slice(0, 8).join(' | ')}`);
        if (logs.length) console.log(`    page: ${logs.slice(-4).join(' | ')}`);
        const failShot = join(SHOT_DIR, `repo-moved-fail-${kind}-${vp.name}.png`);
        await page.screenshot({ path: failShot }).catch(() => {});
      }
      await context.close();
    }
  }
} catch (err) {
  check('repo moved golden', false, String(err?.message || err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

console.log(failed ? `\n❌ FAIL (${failed})` : '\n✅ PASS');
process.exit(failed ? 1 : 0);
