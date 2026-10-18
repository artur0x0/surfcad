#!/usr/bin/env node
/**
 * Before/after shots for the desktop git branch chip and the CAD feature
 * ribbon height. LABEL=before|after. Assertions run only on after.
 *
 * Viewports: 390 (mobile), 768 (mobile breakpoint), 1280 (desktop).
 * Also 1024 for a narrow-desktop overflow check after the move.
 */
/* global document, window, getComputedStyle, indexedDB, localStorage, sessionStorage */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { mintSurfId, withSurfId } from '../../src/utils/git/surfId.js';
import { assemblyPartPath } from '../../src/utils/git/vaultLayout.js';

const ROOT = process.env.SURFCAD_ROOT || fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.SMOKE_PORT || 5268);
const OUT = process.env.CHROME_LAYOUT_SHOT_DIR
  || (existsSync('/opt/cursor/artifacts')
    ? join('/opt/cursor/artifacts', 'chrome-layout')
    : join(ROOT, 'artifacts', 'chrome-layout'));
const LABEL = process.env.LABEL || 'after';
const USER = 'user-chrome-layout';

const CHROME = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));

const VIEWPORTS = [
  { tag: '390', width: 390, height: 844, mobile: true },
  { tag: '768', width: 768, height: 800, mobile: true },
  { tag: '1024', width: 1024, height: 800, mobile: false },
  { tag: '1280', width: 1280, height: 800, mobile: false },
];

const CUBE = `// --- cube begin ---
let part = Manifold.cube([30, 20, 10], true);
// --- cube end ---
return part;
`;
const EMPTY = 'return Manifold.cube([8, 8, 8], true);\n';

function cubeWithId() {
  const surfId = mintSurfId();
  return { surfId, script: withSurfId(CUBE, surfId) };
}

function emptyWithId() {
  const surfId = mintSurfId();
  return { surfId, script: withSurfId(EMPTY, surfId) };
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

async function seedGitAssembly(page, { mobile = false } = {}) {
  const featured = cubeWithId();
  const blank = emptyWithId();
  const featuredId = assemblyPartPath('DemoAssembly', 'Bracket');
  const blankId = assemblyPartPath('DemoAssembly', 'Blank');
  const doc = {
    version: 1,
    source: 'git',
    name: 'DemoAssembly',
    activeId: featuredId,
    parts: [
      {
        id: featuredId, name: 'Bracket', visible: true, order: 0,
        surfId: featured.surfId, isSynced: true,
      },
      {
        id: blankId, name: 'Blank', visible: true, order: 1,
        surfId: blank.surfId, isSynced: true,
      },
    ],
    joints: [],
  };
  await page.evaluate(async ({ doc, parts, uid, mobile }) => {
    if (mobile) sessionStorage.setItem('3dculos.mobileStage', 'cad');
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
        for (const row of parts) {
          tx.objectStore('parts').put({ id: row.id, script: row.script, savedAt: Date.now() }, row.id);
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, {
    doc,
    parts: [
      { id: featuredId, script: featured.script },
      { id: blankId, script: blank.script },
    ],
    uid: USER,
    mobile,
  });
  return { featuredId, blankId };
}

async function waitForApp(page) {
  await page.waitForFunction(
    () => !document.querySelector('[data-app-loading]'),
    { timeout: 60000 },
  );
  await page.waitForSelector('[data-parts-feed], canvas, [data-cad-feature-strip]', {
    state: 'attached',
    timeout: 60000,
  });
}

async function waitForStrip(page) {
  await page.waitForSelector('[data-feature-strip]:not([hidden])', {
    state: 'visible',
    timeout: 30000,
  });
}

async function measure(page) {
  return page.evaluate(() => {
    const strip = document.querySelector('[data-cad-feature-strip] [data-feature-strip], [data-desktop-feature-strip] [data-feature-strip]');
    const canvas = document.querySelector('.viewport-shell');
    const viewer = document.querySelector('[data-viewer-git-branch]');
    const ribbonBranch = document.querySelector('[data-parts-ribbon-branch]');
    const assemblyBranch = document.querySelector('[data-parts-ribbon-center] [data-assembly-branch]');
    const header = document.querySelector('[data-parts-feed-ribbon]');
    const leftRail = document.querySelector('[data-rail-pair="left"]');
    const rightRail = document.querySelector('[data-rail-pair="right"]');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom,
        text: (el.innerText || '').trim(),
      };
    };
    const chip = ribbonBranch || assemblyBranch;
    const chipStyle = chip ? getComputedStyle(chip) : null;
    const gap = (rail) => {
      if (!strip || !rail) return null;
      return rail.getBoundingClientRect().top - strip.getBoundingClientRect().bottom;
    };
    return {
      strip: box(strip),
      canvas: box(canvas),
      viewerBranch: box(viewer),
      ribbonBranch: box(ribbonBranch),
      assemblyBranch: box(assemblyBranch),
      header: box(header),
      headerWraps: header ? header.scrollHeight > header.clientHeight + 1 : false,
      leftRail: box(leftRail),
      rightRail: box(rightRail),
      leftGap: gap(leftRail),
      rightGap: gap(rightRail),
      viewportH: window.innerHeight,
      branchBorder: chipStyle ? chipStyle.borderTopWidth : null,
      branchColor: chipStyle ? chipStyle.color : null,
    };
  });
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
  return { stop };
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

async function shot(page, name) {
  const path = join(OUT, `${LABEL}-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  ✅ screenshot ${path}`);
  return path;
}

async function gotoParts(page, mobile) {
  if (!mobile) return;
  const btn = page.locator('[data-stage-btn="parts"]');
  if (await btn.count()) {
    await btn.click({ timeout: 8000 }).catch(() => {});
    await page.waitForSelector('[data-stage-pane="parts"]:not(.invisible)', { timeout: 8000 }).catch(() => {});
  }
}

async function gotoCad(page, mobile) {
  if (!mobile) return;
  const btn = page.locator('[data-stage-btn="cad"]');
  if (await btn.count()) {
    await btn.click({ timeout: 8000 }).catch(() => {});
    await page.waitForSelector('[data-stage-pane="cad"]:not(.invisible)', { timeout: 8000 }).catch(() => {});
  }
}

async function main() {
  if (!CHROME) {
    console.log('no Chrome — skipping chrome-layout capture');
    return;
  }
  mkdirSync(OUT, { recursive: true });
  const notes = [];
  const { stop } = startPreview();
  const baseUrl = await waitServer();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  attachConsentPresetToBrowser(browser);

  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
      });
      await installMocks(page);
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      const ids = await seedGitAssembly(page, { mobile: vp.mobile });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForApp(page);

      await gotoParts(page, vp.mobile);
      const featuredRow = page.locator(`[data-part-row="${ids.featuredId}"]`);
      if (await featuredRow.count()) {
        await featuredRow.first().click({ timeout: 5000 }).catch(() => {});
      }
      await gotoCad(page, vp.mobile);
      await waitForStrip(page).catch(() => {});
      const partMeasure = await measure(page);
      await shot(page, `${vp.tag}-part`);
      notes.push({ vp: vp.tag, state: 'part', ...partMeasure });

      const assemblyChip = page.locator('[data-title-role="assembly"][data-title-chip="button"]');
      if (await assemblyChip.count()) {
        await assemblyChip.first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(250);
      }
      const assemblyMeasure = await measure(page);
      await shot(page, `${vp.tag}-assembly`);
      notes.push({ vp: vp.tag, state: 'assembly', ...assemblyMeasure });

      await gotoParts(page, vp.mobile);
      const blankRow = page.locator(`[data-part-row="${ids.blankId}"]`);
      if (await blankRow.count()) {
        await blankRow.first().click({ timeout: 5000 }).catch(() => {});
      } else {
        const named = page.locator('[data-part-name="Blank"], text=Blank');
        if (await named.count()) await named.first().click({ timeout: 5000 }).catch(() => {});
      }
      await gotoCad(page, vp.mobile);
      await waitForStrip(page).catch(() => {});
      const emptyMeasure = await measure(page);
      await shot(page, `${vp.tag}-empty`);
      notes.push({ vp: vp.tag, state: 'empty', ...emptyMeasure });

      await gotoParts(page, vp.mobile);
      await shot(page, `${vp.tag}-parts-header`);

      if (LABEL === 'after') {
        if (vp.mobile) {
          if (partMeasure.viewerBranch) {
            throw new Error(`${vp.tag}: mobile grew a viewer branch chip`);
          }
        } else {
          if (partMeasure.viewerBranch) {
            throw new Error(`${vp.tag}: desktop still shows viewer branch chip`);
          }
          if (!partMeasure.ribbonBranch && !partMeasure.assemblyBranch) {
            throw new Error(`${vp.tag}: desktop missing parts-header branch chip`);
          }
          if (partMeasure.headerWraps) {
            throw new Error(`${vp.tag}: parts header wrapped`);
          }
        }
        const heights = [partMeasure.strip?.h, assemblyMeasure.strip?.h, emptyMeasure.strip?.h]
          .filter((n) => typeof n === 'number');
        if (heights.length === 3) {
          const max = Math.max(...heights);
          const min = Math.min(...heights);
          if (max - min > 0.5) {
            throw new Error(`${vp.tag}: strip heights differ part=${heights[0]} assembly=${heights[1]} empty=${heights[2]}`);
          }
        }
        const tops = [partMeasure.canvas?.top, assemblyMeasure.canvas?.top, emptyMeasure.canvas?.top]
          .filter((n) => typeof n === 'number');
        if (tops.length === 3) {
          const max = Math.max(...tops);
          const min = Math.min(...tops);
          if (max - min > 1) {
            throw new Error(`${vp.tag}: viewport shifted partTop=${tops[0]} assemblyTop=${tops[1]} emptyTop=${tops[2]}`);
          }
        }
        for (const row of [partMeasure, assemblyMeasure, emptyMeasure]) {
          const state = row === partMeasure ? 'part' : (row === assemblyMeasure ? 'assembly' : 'empty');
          if (typeof row.leftGap === 'number' && row.leftGap + 0.5 < 10) {
            throw new Error(`${vp.tag} ${state}: left rail gap ${row.leftGap}px < 10px`);
          }
          if (typeof row.rightGap === 'number' && row.rightGap + 0.5 < 10) {
            throw new Error(`${vp.tag} ${state}: right rail gap ${row.rightGap}px < 10px`);
          }
          const floor = row.viewportH - 8;
          if (row.leftRail && row.leftRail.bottom > floor) {
            throw new Error(`${vp.tag} ${state}: left rail overflows bottom ${row.leftRail.bottom} > ${floor}`);
          }
          if (row.rightRail && row.rightRail.bottom > floor) {
            throw new Error(`${vp.tag} ${state}: right rail overflows bottom ${row.rightRail.bottom} > ${floor}`);
          }
        }
        const chip = partMeasure.ribbonBranch || partMeasure.assemblyBranch;
        if (chip && partMeasure.branchBorder) {
          const bw = parseFloat(partMeasure.branchBorder);
          if (!(bw >= 1)) {
            throw new Error(`${vp.tag}: branch chip border ${partMeasure.branchBorder}`);
          }
        }
      }

      await page.close();
    }
  } finally {
    await browser.close();
    stop();
  }
  writeFileSync(join(OUT, `${LABEL}-measures.json`), JSON.stringify(notes, null, 2));
  console.log(`\nArtifacts in ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
