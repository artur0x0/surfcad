#!/usr/bin/env node
/**
 * Browser verification for /partners Turnstile + enforcing CSP from surfcad-security.conf.
 * Uses Cloudflare test keys (pass / fail). Writes console log + screenshots to ARTIFACT_DIR.
 */
/* global document, window */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const snippetPath = join(repoRoot, 'docs/nginx-snippets/surfcad-security.conf');
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts/partners-turnstile';
const PORT = Number(process.env.PARTNERS_VERIFY_PORT || 5321);
const PASS_KEY = '1x00000000000000000000AA';
const FAIL_KEY = '2x00000000000000000000AB';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

function extractCspFromSnippet() {
  const text = readFileSync(snippetPath, 'utf8');
  const match = text.match(/add_header Content-Security-Policy "([^"]+)" always;/);
  if (!match) throw new Error('Could not parse CSP from surfcad-security.conf');
  return match[1];
}

const CSP = extractCspFromSnippet();
const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'cache-control': 'no-cache, must-revalidate',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function resolveDistFile(distRoot, urlPath) {
  const decoded = decodeURIComponent((urlPath || '/').split('?')[0]);
  if (decoded === '/' || decoded === '') return join(distRoot, 'index.html');
  const rel = decoded.replace(/^\/+/, '');
  const file = resolve(distRoot, rel);
  if (!file.startsWith(`${distRoot}/`)) return join(distRoot, 'index.html');
  if (existsSync(file) && !decoded.endsWith('/')) return file;
  return join(distRoot, 'index.html');
}

function startCspStaticServer(distRoot) {
  const server = createServer((req, res) => {
    const path = resolveDistFile(distRoot, req.url || '/');
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(k, v);
    }
    const ext = extname(path);
    res.setHeader('content-type', MIME[ext] || 'application/octet-stream');
    res.statusCode = 200;
    createReadStream(path).pipe(res);
  });
  return new Promise((resolvePromise) => {
    server.listen(PORT, '127.0.0.1', () => resolvePromise(server));
  });
}

function runBuild(siteKey) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('npm', ['run', 'build'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, VITE_TURNSTILE_SITE_KEY: siteKey },
    });
    child.on('close', (code) => (code === 0 ? resolvePromise() : reject(new Error(`build failed (${code})`))));
  });
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function fillAndSubmit(page) {
  await page.fill('[data-partners-field="name"]', 'Verify Partner');
  await page.fill('[data-partners-field="email"]', 'verify@example.com');
  await page.fill('[data-partners-field="company"]', 'Verify Co');
  await page.selectOption('[data-partners-field="partnerType"]', 'software');
  await page.fill('[data-partners-field="message"]', 'Turnstile browser verification.');
  await page.click('[data-partners-submit]');
}

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function runScenario(browser, distRoot, siteKey, { expectThanks }) {
  const consoleLines = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (msg) => {
    consoleLines.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    consoleLines.push(`[pageerror] ${err.message}`);
  });

  await page.route('**/api/partners', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: 'verify' }),
      });
      return;
    }
    await route.continue();
  });

  const url = `http://127.0.0.1:${PORT}/partners`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForSelector('[data-partners-form]', { timeout: 30_000 });
  await page.waitForSelector('[data-partners-turnstile]', { timeout: 30_000 });
  await page.waitForFunction(
    () => typeof window.turnstile?.getResponse === 'function',
    { timeout: 90_000 },
  );
  if (expectThanks) {
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-partners-turnstile]');
      if (!el || !window.turnstile) return false;
      const widgetId = el.getAttribute('data-turnstile-widget-id');
      if (!widgetId) return false;
      return Boolean(window.turnstile.getResponse(widgetId));
    }, { timeout: 90_000 }).catch(() => {});
  }

  await fillAndSubmit(page);

  if (expectThanks) {
    await page.waitForSelector('[data-partners-thanks]', { timeout: 45_000 });
    const sending = await page.locator('[data-partners-submit]').filter({ hasText: 'Sending' }).count();
    check(`${siteKey} — thank-you state`, true);
    check(`${siteKey} — not stuck on Sending`, sending === 0, `count=${sending}`);
  } else {
    await page.waitForSelector('[data-partners-error]', { timeout: 45_000 });
    await page.waitForSelector('[data-partners-retry]', { timeout: 5_000 });
    const sending = await page.locator('[data-partners-submit]').filter({ hasText: 'Sending' }).count();
    check(`${siteKey} — inline error`, true);
    check(`${siteKey} — Retry visible`, true);
    check(`${siteKey} — not stuck on Sending`, sending === 0, `count=${sending}`);
  }

  const turnstileErrors = consoleLines.filter((l) => /TurnstileError/i.test(l));
  const cspViolations = consoleLines.filter((l) => /violates.+connect-src|Refused to connect to data:/i.test(l));
  check(`${siteKey} — no TurnstileError in console`, turnstileErrors.length === 0, turnstileErrors.join(' | '));
  check(`${siteKey} — no CSP connect-src violations`, cspViolations.length === 0, cspViolations.join(' | '));

  const tag = siteKey === PASS_KEY ? 'pass' : 'fail';
  const shot = join(ARTIFACT_DIR, `partners-turnstile-${tag}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  writeFileSync(join(ARTIFACT_DIR, `partners-turnstile-${tag}-console.txt`), consoleLines.join('\n'));
  await context.close();
}

mkdirSync(ARTIFACT_DIR, { recursive: true });

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.error('No Chrome/Chromium found — set CHROME_PATH');
  process.exit(1);
}

writeFileSync(join(ARTIFACT_DIR, 'csp-connect-src.txt'), CSP.match(/connect-src[^;]+/)?.[0] || CSP);

const distRoot = join(repoRoot, 'dist');
const baseUrl = `http://127.0.0.1:${PORT}/partners`;
let server;

let browser;
try {
  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });

  console.log('\nPartners Turnstile verification (pass key, enforcing CSP)');
  console.log('Building with VITE_TURNSTILE_SITE_KEY=always-pass…');
  await runBuild(PASS_KEY);
  server = await startCspStaticServer(distRoot);
  if (!await waitForUrl(baseUrl)) {
    check('static server reachable', false, baseUrl);
    process.exit(1);
  }
  await runScenario(browser, distRoot, PASS_KEY, { expectThanks: true });

  console.log('\nPartners Turnstile verification (fail key)');
  server.close();
  console.log('Building with VITE_TURNSTILE_SITE_KEY=always-fail…');
  await runBuild(FAIL_KEY);
  server = await startCspStaticServer(distRoot);
  if (!await waitForUrl(baseUrl)) {
    check('static server reachable after rebuild', false, baseUrl);
    process.exit(1);
  }
  await runScenario(browser, distRoot, FAIL_KEY, { expectThanks: false });
} finally {
  if (browser) await browser.close();
  if (server) server.close();
}

if (failed) {
  console.error(`\n${failed} verification check(s) failed. Artifacts: ${ARTIFACT_DIR}`);
  process.exit(1);
}
console.log(`\nAll partners Turnstile checks passed. Artifacts: ${ARTIFACT_DIR}`);
