#!/usr/bin/env node
/**
 * Load the production bundle with the same Content-Security-Policy nginx will send.
 * Fails on CSP console violations or the same boot checks as golden:app-loads (abbreviated).
 */
/* global document */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const distRoot = join(repoRoot, 'dist');
const snippetPath = join(repoRoot, 'docs/nginx-snippets/surfcad-security.conf');

const PORT = Number(process.env.CSP_SMOKE_PORT || 4318);
const APP_URL = `http://127.0.0.1:${PORT}/`;

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
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-frame-options': 'SAMEORIGIN',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(self "https://js.stripe.com"), usb=()',
  'content-security-policy': CSP,
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
  '.webmanifest': 'application/manifest+json',
};

function resolveDistFile(urlPath) {
  const decoded = decodeURIComponent((urlPath || '/').split('?')[0]);
  if (decoded === '/' || decoded === '') return join(distRoot, 'index.html');
  const rel = decoded.replace(/^\/+/, '');
  const file = resolve(distRoot, rel);
  if (!file.startsWith(`${distRoot}/`)) return join(distRoot, 'index.html');
  if (existsSync(file) && !decoded.endsWith('/')) return file;
  const indexInDir = join(file, 'index.html');
  if (existsSync(indexInDir)) return indexInDir;
  return join(distRoot, 'index.html');
}

const server = createServer((req, res) => {
  const path = resolveDistFile(req.url || '/');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(k, v);
  }
  const ext = extname(path);
  res.setHeader('content-type', MIME[ext] || 'application/octet-stream');
  res.statusCode = 200;
  createReadStream(path).pipe(res);
});

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('csp app loads: no system Chrome — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (!existsSync(join(distRoot, 'index.html'))) {
  console.error('dist/ missing — run npm run build first');
  process.exit(1);
}

await new Promise((resolve, reject) => {
  server.listen(PORT, '127.0.0.1', () => resolve());
  server.on('error', reject);
});

const ALLOWED = [
  /favicon/i,
  /Failed to load resource.*404.*favicon/i,
  /WebGL|WEBGL|GPU stall|Automatic fallback to software WebGL/i,
  /\[APP\]|\[App\]/,
];

let browser;
try {
  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const pageErrors = [];
  const consoleErrors = [];
  const cspViolations = [];

  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Refused to/i.test(text)) {
      cspViolations.push(text);
    }
    if (msg.type() !== 'error') return;
    if (ALLOWED.some((re) => re.test(text))) return;
    consoleErrors.push(text);
  });

  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({}),
  }));

  await page.goto(APP_URL, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(
    () => document.querySelector('#root')?.children.length > 0,
    null,
    { timeout: 20000 },
  ).catch(() => {});

  const rootChildren = await page.evaluate(
    () => document.querySelector('#root')?.children.length ?? 0,
  );
  check('#root rendered under CSP', rootChildren > 0, `children=${rootChildren}`);

  // #root's first paint is the "Starting CAD engine…" splash, which has no
  // canvas and no Run button. Those mount only after the sandbox worker
  // inits. Checking immediately reports a false failure.
  const shellReady = await page.waitForFunction(
    () => document.querySelector('canvas') && document.querySelector('[data-cad-run]'),
    null,
    { timeout: 30000 },
  ).then(() => true).catch(() => false);
  const loadingStatus = await page.locator('[data-app-loading-status]').textContent().catch(() => '');
  const shellDetail = shellReady ? '' : (loadingStatus ? `still showing "${loadingStatus.trim()}"` : 'shell did not mount');
  check('canvas mounted under CSP', shellReady && (await page.locator('canvas').count()) > 0, shellDetail);
  check('Run button present under CSP', shellReady && (await page.locator('[data-cad-run]').count()) > 0, shellDetail);
  check('no CSP console violations', cspViolations.length === 0, cspViolations.slice(0, 3).join(' | '));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('CSP smoke run', false, String(err?.message || err));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nCSP smoke: app renders with enforcing policy from surfcad-security.conf');
