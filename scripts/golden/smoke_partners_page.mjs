#!/usr/bin/env node
/**
 * Public /partners form — Paper identity, thank-you state, 390 and 1280.
 * Shots go to GOLDEN_SHOT_DIR or os.tmpdir(). Needs system Chrome.
 */
/* global document, getComputedStyle, window */
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const PORT = Number(process.env.SMOKE_PORT || 5248);
const APP_URL = `http://127.0.0.1:${PORT}/partners`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();

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

console.log('partners page — public form');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

{
  const page = read('src/pages/PartnersPage.jsx');
  const main = read('src/main.jsx');
  const server = read('backend/server.js');
  const arch = read('docs/architecture.md');
  const map = read('docs/UI_MAP.md');
  check('route mounted at /partners without auth',
    /pathIsPartners/.test(main) && /<PartnersPage/.test(main));
  check('form fields, honeypot, and turnstile mount',
    /data-partners-form/.test(page)
    && /name="name"/.test(page)
    && /name="email"/.test(page)
    && /name="company"/.test(page)
    && /name="website"/.test(page)
    && /name="partnerType"/.test(page)
    && /name="message"/.test(page)
    && /name="company_fax"/.test(page)
    && /data-partners-turnstile/.test(page));
  check('thank-you state',
    /data-partners-thanks/.test(page) && /data-partners-send-another/.test(page));
  check('brand colors on Paper',
    /#FAFAF9/.test(page) && /#16171D/.test(page) && /#6B6E78/.test(page) && /#E6E7EB/.test(page));
  check('wordmark uses splash tone at 24px+',
    /BrandWordmark tone="splash" size=\{32\}/.test(page));
  check('API route registered',
    /\/api\/partners/.test(server));
  check('docs mention golden:partners-page',
    /golden:partners-page/.test(arch) && /golden:partners-page/.test(map)
    && /\/partners/.test(map));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('partners page: no system Chrome — set CHROME_PATH');
  process.exit(failed ? 1 : 1);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
  detached: true,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
  try { server.kill('SIGKILL'); } catch { /* gone */ }
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

async function readBrand(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-partners-page]');
    const mark = document.querySelector('[data-brand-wordmark]');
    const cad = document.querySelector('[data-brand-word="cad"]');
    const bg = root ? getComputedStyle(root).backgroundColor : '';
    const cadFill = cad ? getComputedStyle(cad).fill : '';
    return { bg, cadFill, cadAttr: mark?.getAttribute('data-brand-cad') };
  });
}

let browser;
try {
  if (!await waitForServer()) {
    check('vite server started', false, APP_URL);
    process.exit(1);
  }

  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });

  for (const vp of [{ w: 390, h: 844, tag: '390' }, { w: 1280, h: 800, tag: '1280' }]) {
    const context = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 1,
      isMobile: vp.w < 500,
      hasTouch: vp.w < 500,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.turnstile = {
        render() { return 'golden-turnstile'; },
        execute(_id, opts) {
          if (opts?.callback) opts.callback('golden-turnstile-token');
        },
        reset() {},
        remove() {},
      };
    });
    let posted = false;
    await page.route('**/api/partners', async (route) => {
      if (route.request().method() === 'POST') {
        posted = true;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, id: 'golden' }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-partners-form]', { timeout: 20000 });
    await page.waitForSelector('[data-brand-cad="orange"]', { timeout: 20000 });
    const brand = await readBrand(page);
    check(`${vp.tag} form — paper background`, /250, 250, 249|#fafaf9/i.test(brand.bg), brand.bg);
    check(`${vp.tag} form — orange CAD wordmark`, brand.cadAttr === 'orange', brand.cadAttr);
    await page.screenshot({ path: join(SHOT_DIR, `partners-form-${vp.tag}.png`), fullPage: true });
    check(`${vp.tag} form screenshot`, existsSync(join(SHOT_DIR, `partners-form-${vp.tag}.png`)));

    await page.fill('[data-partners-field="name"]', 'Golden Partner');
    await page.fill('[data-partners-field="email"]', 'partner@example.com');
    await page.fill('[data-partners-field="company"]', 'Example Co');
    await page.selectOption('[data-partners-field="partnerType"]', 'software');
    await page.fill('[data-partners-field="message"]', 'Interested in a reseller partnership.');
    await page.click('[data-partners-submit]');
    await page.waitForSelector('[data-partners-thanks]', { timeout: 10000 });
    check(`${vp.tag} thank-you after submit`, posted);
    await page.screenshot({ path: join(SHOT_DIR, `partners-thanks-${vp.tag}.png`), fullPage: true });
    check(`${vp.tag} thank-you screenshot`, existsSync(join(SHOT_DIR, `partners-thanks-${vp.tag}.png`)));
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.error(`\n${failed} partners page check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll partners page checks passed. Shots in ${SHOT_DIR}`);
