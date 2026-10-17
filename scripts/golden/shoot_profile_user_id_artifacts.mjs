#!/usr/bin/env node
/**
 * Screenshots for profile user id + About modal (desktop 1280, mobile 390).
 * Output: /opt/cursor/artifacts/profile-user-id/
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = '/opt/cursor/artifacts/profile-user-id';
mkdirSync(outDir, { recursive: true });

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find((p) => existsSync(p));

async function vitePage(route, importShot) {
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
import { ${importShot} } from '${route}';
${importShot}(document.getElementById('root'));
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
  const baseUrl = `http://127.0.0.1:${port}/`;

  return {
    baseUrl,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await vite.close();
    },
  };
}

async function shot(page, path, width) {
  await page.setViewportSize({ width, height: 800 });
  await page.screenshot({ path, fullPage: false });
  console.log('wrote', path);
}

async function main() {
  if (!CHROME) {
    console.log('No Chrome — skip artifact screenshots');
    return;
  }

  const profileSrv = await vitePage(
    '/scripts/golden/profile_user_id_shot.js',
    'renderProfileUserIdShot',
  );
  const aboutSrv = await vitePage(
    '/scripts/golden/about_modal_shot.js',
    'renderAboutModalShot',
  );

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();

  const openProfile = async () => {
    await page.goto(profileSrv.baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__READY__, { timeout: 15000 });
    await page.waitForSelector('[data-profile-user-id]');
  };

  await openProfile();
  await shot(page, join(outDir, 'profile-desktop-1280.png'), 1280);
  await page.locator('[data-profile-user-id-copy]').click();
  await page.waitForSelector('text=Copied');
  await shot(page, join(outDir, 'profile-desktop-1280-copied.png'), 1280);

  await openProfile();
  await shot(page, join(outDir, 'profile-mobile-390.png'), 390);
  await page.locator('[data-profile-user-id-copy]').click();
  await page.waitForSelector('text=Copied');
  await shot(page, join(outDir, 'profile-mobile-390-copied.png'), 390);

  await page.goto(aboutSrv.baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, { timeout: 15000 });
  await page.waitForSelector('[data-about-modal-panel]');

  await shot(page, join(outDir, 'about-desktop-1280.png'), 1280);
  await shot(page, join(outDir, 'about-mobile-390.png'), 390);

  await browser.close();
  await profileSrv.close();
  await aboutSrv.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
