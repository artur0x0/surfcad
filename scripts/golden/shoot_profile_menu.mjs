#!/usr/bin/env node
/**
 * Before/after screenshots for the profile menu PR (desktop 1280, mobile 390).
 * Output: GOLDEN_SHOT_DIR or /opt/cursor/artifacts/profile-menu/
 */
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = process.env.GOLDEN_SHOT_DIR || '/opt/cursor/artifacts/profile-menu';
mkdirSync(outDir, { recursive: true });

const CHROME = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p) => existsSync(p));

const USER_BEFORE = join(root, 'profile-menu/current-dropdown.png');

async function vitePage() {
  const html = `<!doctype html><meta charset="utf-8">
<style>html, body, #root { margin: 0; height: 100%; }</style>
<div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module">
import '/src/index.css';
import { renderProfileMenuShot } from '/scripts/golden/profile_menu_shot.js';
renderProfileMenuShot(document.getElementById('root'));
</script>`;

  const vite = await createVite({
    root,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const server = createServer((req, res) => {
    vite.middlewares(req, res, async () => {
      if (req.url === '/' || req.url?.startsWith('/?')) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
        return;
      }
      res.statusCode = 404;
      res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    baseUrl: `http://127.0.0.1:${port}/`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await vite.close();
    },
  };
}

async function shot(page, path, width, height = 800) {
  await page.setViewportSize({ width, height });
  await page.screenshot({ path, fullPage: false });
  console.log('wrote', path);
}

async function main() {
  if (!CHROME) {
    console.log('No Chrome — skip profile-menu screenshots');
    return;
  }

  if (existsSync(USER_BEFORE)) {
    copyFileSync(USER_BEFORE, join(outDir, 'before-dropdown-playtest.png'));
    console.log('wrote', join(outDir, 'before-dropdown-playtest.png'));
  }

  const srv = await vitePage();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();

  await page.goto(`${srv.baseUrl}?before=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, { timeout: 15000 });
  await page.waitForSelector('[data-profile-panel]');
  await page.waitForSelector('[data-agent-bridge-disconnect]');
  await shot(page, join(outDir, 'before-dropdown-1280.png'), 1280);
  await shot(page, join(outDir, 'before-dropdown-390.png'), 390, 844);

  await page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, { timeout: 15000 });
  await page.waitForSelector('[data-profile-panel]');
  await page.waitForSelector('[data-agent-bridge-connect]');
  await shot(page, join(outDir, 'after-dropdown-1280.png'), 1280);
  await shot(page, join(outDir, 'after-dropdown-390.png'), 390, 844);

  await page.goto(`${srv.baseUrl}?account=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, { timeout: 15000 });
  await page.waitForSelector('[data-profile-account-pane]');
  await shot(page, join(outDir, 'after-account-1280.png'), 1280);
  await shot(page, join(outDir, 'after-account-390.png'), 390, 844);

  await browser.close();
  await srv.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
