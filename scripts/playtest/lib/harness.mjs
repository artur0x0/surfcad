/**
 * Shared Playwright harness for window.surfcad scripted playtests.
 * Frontend-only: vite preview on localhost. Never staging or production hosts.
 */
/* global indexedDB, localStorage, sessionStorage, window, document */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import {
  attachConsentPresetToBrowser,
  presetAnalyticsConsentInit,
} from '../../golden/lib/presetConsentInit.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const CONSOLE_ALLOW = [
  /favicon/i,
  /Failed to load resource.*404/i,
  /Failed to load resource: the server responded with a status of 500/i,
  /monaco-editor.*simpleWorker\.nls/i,
  /Failed trying to load default language strings/i,
  /Error executing script:.*playtest deliberate failure/i,
  /Error executing script:.*Identifier 'cut' has already been declared/,
  /Error executing script:.*Cube failed: result is not a valid solid \(NotManifold\)/i,
];

/** Hard-fail unless the URL host is loopback (cloud-agent safety). */
export function assertLocalhost(urlString) {
  let host;
  try {
    host = new URL(urlString).hostname;
  } catch (err) {
    throw new Error(`playtest: invalid base URL — ${err?.message || err}`);
  }
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error(`playtest: base URL must be localhost (got host "${host}")`);
  }
}

export function findChrome() {
  return CHROME_CANDIDATES.find((p) => existsSync(p)) || null;
}

export function defaultOutDir() {
  if (process.env.PLAYTEST_OUT) return process.env.PLAYTEST_OUT;
  if (existsSync('/opt/cursor/artifacts')) return join('/opt/cursor/artifacts', 'playtest');
  return join(tmpdir(), 'surfcad-playtest');
}

export async function waitForServer(baseUrl, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(baseUrl);
      if (res.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export function startPreviewServer(port, extraEnv = {}) {
  if (!existsSync(join(REPO_ROOT, 'dist/index.html'))) {
    throw new Error('playtest: dist/ missing — run `npm run build` first');
  }
  const server = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: REPO_ROOT,
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, ...extraEnv },
    },
  );
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
    try { server.kill('SIGKILL'); } catch { /* gone */ }
  };
  return { server, stop };
}

/**
 * Fake GitHub token so mock vault Save is allowed (never hits the network).
 * One-time `evaluate` on the current origin — not `addInitScript`, which would
 * re-plant the token on every later reload and send other playtests onto the
 * real-GitHub path. Call after the page has landed on the app origin.
 */
export async function seedGithubToken(page) {
  await page.evaluate(() => {
    localStorage.setItem('surfcad.github.tokenBundle', JSON.stringify({
      accessToken: 'gho_playtest_mock',
      expiresAt: Date.now() + 3_600_000,
    }));
    localStorage.removeItem('surfcad.github.token');
    try { sessionStorage.removeItem('surfcad.github.token'); } catch { /* private mode */ }
  });
}

/** Profile chip in the connected (green) phase — not pending, reauth, or signed-out. */
export async function waitForSignedInChip(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-profile-chip]')?.getAttribute('data-profile-chip-state') === 'signed-in',
    { timeout: 20000 },
  );
}

/** Playtest / MCP demo: auto-approve M1 pairing (never set in normal use). */
export async function enableAgentBridgeAutoApprove(page) {
  await page.evaluate(() => {
    localStorage.setItem('surfcadAgentBridgeAutoApprove', '1');
  });
}

/**
 * Open Local agent pairing and return the 6-character code shown in the panel.
 * @param {import('playwright-core').Page} page
 */
export async function showAgentBridgePairingCode(page) {
  await seedGithubToken(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBridge(page);
  await waitForSignedInChip(page);
  const profileChip = page.locator('[data-profile-chip]').first();
  if (await profileChip.count()) {
    await profileChip.click();
  }
  await page.click('[data-ui-action="data-agent-bridge-connect"]');
  await page.waitForSelector('[data-profile-panel]', { state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForSelector('[data-agent-bridge-dialog]', { state: 'visible', timeout: 10000 });
  await page.waitForSelector('[data-agent-bridge-waiting-relay]', { state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForSelector('[data-agent-bridge-code]', { state: 'visible', timeout: 15000 });
  const code = await page.locator('[data-agent-bridge-code]').innerText();
  return String(code || '').trim();
}

/**
 * @param {import('playwright-core').Page} page
 * @param {{ userId: string, assembly: object, parts: Array<{ id: string, script: string }> }} seed
 */
export async function seedAssembly(page, seed) {
  const { userId, assembly, parts } = seed;
  await page.evaluate(async ({ doc, partRows, uid }) => {
    localStorage.setItem('surfcadAgent', '1');
    localStorage.setItem('surfcad.lastAssembly', JSON.stringify({
      [uid]: {
        name: doc.name,
        activeId: doc.activeId,
        source: doc.source || 'git',
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
  }, { doc: assembly, partRows: parts, uid: userId });
}

const EMPTY_CART = Object.freeze({
  version: 0,
  lines: [],
  tombstones: [],
});

/**
 * Stub the /api calls the CAD shell hits on boot when auth/me says signed-in.
 * Playwright intercepts before the network (preview has no proxy; dev may hit a
 * real backend and return 401 when cookies do not match the stubbed session).
 *
 * Does not plant a GitHub token. Pairing tests that need a connected chip call
 * `seedGithubToken` once after the first app-origin navigation.
 */
export async function installApiMocks(page) {
  const fulfill = (route, status, body) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  await page.route('**/api/auth/me', (route) => fulfill(route, 200, {
    authenticated: true,
    user: { _id: 'user-playtest', email: 'playtest@test.local' },
  }));

  await page.route('**/api/config', (route) => fulfill(route, 200, {
    githubAppClientId: null,
  }));

  await page.route('**/api/cart', async (route) => {
    const method = route.request().method();
    if (method === 'GET' || method === 'PUT') {
      return fulfill(route, 200, { ...EMPTY_CART });
    }
    return route.fallback();
  });

  await page.route('**/api/github/oauth/refresh', (route) => fulfill(route, 404, {
    error: 'not found',
  }));

  await page.route('**/api/auth/github', (route) => fulfill(route, 200, {
    ok: true,
  }));

  await page.route('**/api/wins', (route) => {
    const method = route.request().method();
    if (method === 'POST' || method === 'GET') {
      return fulfill(route, 200, { ok: true, wins: [] });
    }
    return route.fallback();
  });
}

export async function waitForBridge(page) {
  await page.waitForFunction(
    () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
    { timeout: 120000 },
  );
  await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });
}

/** Relay-style call: args are JSON-serialised like an external agent. */
export async function agentCall(page, name, args) {
  const argsJson = JSON.stringify(args ?? {});
  return page.evaluate(async ({ name, argsJson }) => {
    const env = await window.surfcad.call(name, argsJson);
    return JSON.parse(JSON.stringify(env));
  }, { name, argsJson });
}

/** Match the feature bar: part undo needs a highlighted CAD part when the joint strip is showing. */
export async function focusPartHistoryForUndo(page) {
  const hist = await agentCall(page, 'history', {});
  if (hist.result?.kind === 'part') return;
  const parts = await agentCall(page, 'parts', {});
  const id = parts.result?.activeId || parts.result?.parts?.[0]?.id;
  if (id) await agentCall(page, 'select_parts', { part_id: id });
}

export function createConsoleCollector(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_ALLOW.some((re) => re.test(text))) return;
    errors.push(text);
  });
  return errors;
}

/**
 * @param {import('playwright-core').Browser} browser
 * @param {{ width: number, height: number, baseUrl: string, userId: string, assembly: object, parts: Array<{id:string,script:string}> }} opts
 */
export async function openAgentPage(browser, opts) {
  const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });
  await presetAnalyticsConsentInit(page);
  const consoleErrors = createConsoleCollector(page);
  await installApiMocks(page);
  const origin = new URL(opts.baseUrl).origin;
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await seedAssembly(page, { userId: opts.userId, assembly: opts.assembly, parts: opts.parts });
  await page.goto(opts.baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForBridge(page);
  return { page, consoleErrors };
}

export async function saveBridgeScreenshot(page, outPath, { width, height } = {}) {
  if (width && height) await page.setViewportSize({ width, height });
  const shot = await agentCall(page, 'screenshot', { format: 'png' });
  if (!shot?.ok || !shot.result?.dataUrl) {
    throw new Error(`screenshot bridge failed: ${JSON.stringify(shot?.error || shot)}`);
  }
  const b64 = String(shot.result.dataUrl).split(',')[1] || '';
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(b64, 'base64'));
  if (width && height) await page.setViewportSize({ width: 1280, height: 800 });
  return outPath;
}

export async function savePageScreenshot(page, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath });
  return outPath;
}

export async function launchBrowser(exe) {
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  attachConsentPresetToBrowser(browser);
  return browser;
}
