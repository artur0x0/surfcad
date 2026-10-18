#!/usr/bin/env node
/**
 * PR #544 evidence: signed-in mock git, long part names, desktop + mobile shots,
 * kettle path-less save (4 files, valid .surf.json). Uses preview + mock token only.
 */
/* global document, indexedDB, localStorage, sessionStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import { assemblyFilePath, assemblyPartPath } from '../../src/utils/git/vaultLayout.js';
import { validateSurfJson } from '../../src/utils/git/surfJson.js';
import { assembleCommitFiles, firstCommitBaseline, commitWorkspace } from '../../src/utils/git/gitCommit.js';
import { captureBaseline } from '../../src/utils/git/gitWorkspace.js';
import { mintSurfId, withSurfId } from '../../src/utils/git/surfId.js';

const ROOT = process.env.SURFCAD_ROOT || fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.SMOKE_PORT || 5244);
const OUT = process.env.PR544_SHOT_DIR || join('/opt/cursor/artifacts', 'pr544-parts-sidebar');
const LABEL = process.env.PR544_LABEL || 'after';
const USER = 'user-pr544';

const LONG_NAMES = [
  'Superconducting Magnet Housing End Cap',
  'Cryogenic Feedthrough Flange Assembly',
  'Vacuum Chamber Viewport Retainer Ring',
  'Thermal Radiation Baffle Segment',
];

const CHROME = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));

const VIEWPORTS = [
  { tag: 'desktop-1280', width: 1280, height: 800, mobile: false },
  { tag: 'desktop-1440', width: 1440, height: 900, mobile: false },
  { tag: 'desktop-1920', width: 1920, height: 1080, mobile: false },
  { tag: 'mobile-390', width: 390, height: 844, mobile: true },
];

function cubeScript() {
  return 'let part = Manifold.cube([10, 10, 10], true);\nreturn part;\n';
}

async function seedKettleMock() {
  const gh = createMockGithubAdapter({ login: 'playtest' });
  const vault = await findOrCreateVault(gh);
  const baseline = firstCommitBaseline({ headSha: vault.headSha });
  const localIds = ['local-body', 'local-lid', 'local-handle'];
  const localNames = ['Kettle Body', 'Kettle Lid', 'Kettle Handle'];
  const mixed = {
    source: 'git',
    name: 'Kettle',
    activeId: localIds[0],
    parts: localIds.map((id, i) => ({
      id,
      name: localNames[i],
      visible: true,
      order: i,
      surfId: mintSurfId(),
      isSynced: false,
    })),
  };
  const mixedScripts = {};
  for (let i = 0; i < localIds.length; i += 1) {
    mixedScripts[localIds[i]] = withSurfId(cubeScript(), mixed.parts[i].surfId);
  }
  const BODY = assemblyPartPath('Kettle', 'Kettle Body');
  const LID = assemblyPartPath('Kettle', 'Kettle Lid');
  const HANDLE = assemblyPartPath('Kettle', 'Kettle Handle');
  const assembled = await assembleCommitFiles(gh, vault.repo, {
    doc: mixed,
    scripts: mixedScripts,
    baseline,
    message: 'Save kettle',
  });
  if (assembled.status !== 'ready') throw new Error(`assemble not ready: ${assembled.status}`);
  const paths = new Set(assembled.files.map((f) => f.path));
  for (const need of [BODY, LID, HANDLE, assemblyFilePath('Kettle')]) {
    if (!paths.has(need)) throw new Error(`missing ${need} in ${[...paths].join(', ')}`);
  }
  const asmFile = assembled.files.find((f) => f.path === assemblyFilePath('Kettle'));
  const surf = JSON.parse(asmFile.content);
  const check = validateSurfJson(surf);
  if (!check.ok) throw new Error(check.errors.join('; '));
  const committed = await commitWorkspace(gh, vault.repo, {
    doc: mixed,
    scripts: mixedScripts,
    baseline,
    message: 'Save kettle',
  });
  if (committed.status !== 'committed' || committed.files.length !== 4) {
    throw new Error(`commit: ${committed.status} files=${JSON.stringify(committed.files)}`);
  }
  for (const need of [BODY, LID, HANDLE, assemblyFilePath('Kettle')]) {
    if (!committed.files.includes(need)) throw new Error(`commit missing ${need}`);
  }
  return { doc: mixed, scripts: mixedScripts, baseline: captureBaseline({
    assemblyPath: assemblyFilePath('Kettle'),
    assemblyName: 'Kettle',
    doc: assembled.doc,
    scripts: assembled.scripts,
    branch: 'main',
    headSha: committed.sha,
  }) };
}

async function installMocks(page) {
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      authenticated: true,
      user: { _id: USER, email: 'playtest@test.local' },
    }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ githubAppClientId: null }),
  }));
  await page.route('**/api/cart', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: 0, lines: [], tombstones: [] }),
  }));
  await page.route('**/api/wins', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, wins: [] }),
  }));
}

async function seedLongParts(page, { mobile = false } = {}) {
  const parts = LONG_NAMES.map((name, order) => {
    const surfId = mintSurfId();
    const id = assemblyPartPath('DemoAssembly', name);
    return {
      id,
      name,
      visible: true,
      order,
      surfId,
      script: withSurfId(cubeScript(), surfId),
    };
  });
  const doc = {
    version: 1,
    source: 'git',
    name: 'DemoAssembly',
    activeId: parts[0].id,
    parts: parts.map(({ id, name, visible, order, surfId }) => ({
      id, name, visible, order, surfId, isSynced: true,
    })),
  };
  await page.evaluate(async ({ doc, partRows, uid, mobile }) => {
    if (mobile) {
      sessionStorage.setItem('3dculos.mobileStage', 'parts');
    }
    localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify({
      accessToken: 'gho_playtest_mock',
      expiresAt: Date.now() + 3_600_000,
    }));
    localStorage.removeItem('surfcad.github.token');
    sessionStorage.removeItem('surfcad.github.token');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      [uid]: {
        name: doc.name,
        activeId: doc.activeId,
        source: 'git',
        savedAt: Date.now(),
      },
    }));
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('surfcad-assembly');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
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
        for (const row of partRows) {
          tx.objectStore('parts').put({ id: row.id, script: row.script, savedAt: Date.now() }, row.id);
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, {
    doc,
    partRows: parts.map((p) => ({ id: p.id, script: p.script })),
    uid: USER,
    mobile,
  });
}

async function waitForApp(page) {
  await page.waitForFunction(
    () => !document.querySelector('[data-app-loading]') && document.querySelector('[data-parts-feed]'),
    { timeout: 120000 },
  );
  await page.waitForSelector('[data-parts-feed]', { state: 'visible', timeout: 120000 });
}

function startPreview() {
  if (!existsSync(join(ROOT, 'dist/index.html'))) {
    throw new Error('dist/ missing — run npm run build');
  }
  const server = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', detached: true },
  );
  const stop = () => {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ }
    try { server.kill('SIGKILL'); } catch { /* */ }
  };
  return { server, stop };
}

async function waitServer() {
  const url = `http://127.0.0.1:${PORT}/`;
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return url;
    } catch { /* */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview did not start');
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log('kettle mock save (unit)');
  await seedKettleMock();
  console.log('  ✅ kettle: 4 files, surf.json valid');

  if (!CHROME) {
    console.log('no Chrome — skipping UI screenshots');
    return;
  }

  const { stop } = startPreview();
  const baseUrl = await waitServer();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
      });
      await installMocks(page);
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await seedLongParts(page, { mobile: vp.mobile });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForApp(page);
      const feed = page.locator('[data-parts-feed]');
      await feed.waitFor({ state: 'visible' });
      const path = join(OUT, `${LABEL}-${vp.tag}.png`);
      await page.screenshot({ path, fullPage: false });
      const text = await feed.innerText();
      if (LABEL === 'after' && text.includes('Add to Repo')) {
        throw new Error(`${vp.tag}: Add to Repo still visible`);
      }
      if (LABEL === 'after' && vp.mobile === false && text.includes('DemoAssembly')
        && await page.locator('[data-parts-ribbon-center] >> text=DemoAssembly').count()) {
        throw new Error(`${vp.tag}: assembly name still in ribbon center`);
      }
      await page.close();
      console.log(`  ✅ screenshot ${path}`);
    }

    if (LABEL === 'after') {
      const branchPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await installMocks(branchPage);
      await branchPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await seedLongParts(branchPage);
      await branchPage.reload({ waitUntil: 'domcontentloaded' });
      await waitForApp(branchPage);
      const branchChip = branchPage.locator('[data-parts-ribbon-branch], [data-assembly-branch]');
      if (await branchChip.count()) {
        const box = await branchChip.boundingBox();
        if (box) {
          await branchPage.screenshot({
            path: join(OUT, `${LABEL}-viewer-branch-chip.png`),
            clip: {
              x: Math.max(0, box.x - 120),
              y: Math.max(0, box.y - 8),
              width: Math.min(400, box.width + 240),
              height: box.height + 16,
            },
          });
          console.log(`  ✅ viewer branch chip ${join(OUT, `${LABEL}-viewer-branch-chip.png`)}`);
        }
      }
      await branchPage.close();
    }
  } finally {
    await browser.close();
    stop();
  }
  console.log(`\nArtifacts in ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
