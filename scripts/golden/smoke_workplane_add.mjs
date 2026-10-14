#!/usr/bin/env node
/**
 * Workplane card. Add plane writes the reference, the angle, and the
 * offset, then closes. There is no helper line and no left Plane rail.
 * X closes without writing. Contour offset stays on its own card.
 *
 * 390×844 and 1280×800. Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global document, window, Event */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.SMOKE_PORT || 5271);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

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

console.log('workplane add plane');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

{
  const arch = readFileSync(join(ROOT, 'docs/architecture.md'), 'utf8');
  const map = readFileSync(join(ROOT, 'docs/UI_MAP.md'), 'utf8');
  check('docs name Add plane', /golden:workplane-add/.test(arch) && /golden:workplane-add/.test(map));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('workplane add: no system Chrome — set CHROME_PATH');
  process.exit(1);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
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

function near(a, b, tol = 0.05) {
  return Math.abs(a - b) <= tol;
}

async function editorScript(page) {
  return page.evaluate(() => (
    (window.monaco?.editor?.getModels?.() || []).map((model) => model.getValue()).join('\n')
  ));
}

async function boot(page) {
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.viewport-shell > canvas');
    return !!(canvas && canvas.clientWidth > 0 && window.__VIEWPORT__?.ready?.() && window.__MANIFOLD_CONTEXT__?.isReady);
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => (window.monaco?.editor?.getModels?.() || []).length > 0, null, { timeout: 30000 });
  await page.evaluate((src) => {
    window.monaco.editor.getModels()[0].setValue(src);
  }, SCRIPT);
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src, { partId: 'plane' })
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 18, el: 68, margin: 1.8 }));
  await page.waitForTimeout(250);
}

async function setNumber(page, id, value) {
  const input = page.locator(`[data-popup-number="${id}"]`);
  await input.scrollIntoViewIfNeeded();
  await input.evaluate((el, next) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function runView(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.touch,
    isMobile: vp.touch,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    userAgent: vp.touch
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

  await page.locator('button[aria-label^="Insert Workplane"]').click();
  await page.locator('[data-plane-editor]').waitFor({ timeout: 8000 });
  const add = page.locator('[data-feature-card-confirm]');
  await add.waitFor({ timeout: 4000 });
  const label = (await add.innerText()).replace(/\s+/g, ' ').trim();
  const footer = await page.locator('[data-feature-sheet-footer]').innerText();
  check(`${vp.name} the button is Add plane`, label === 'Add plane', label);
  check(`${vp.name} the helper line is gone`, !/select plane accepts/i.test(footer), footer.slice(0, 160));
  check(`${vp.name} Offset stays on the card`, await page.locator('[data-popup-number="workplane-offset"]').count() === 1);
  check(`${vp.name} the left Plane rail is gone`,
    await page.locator('[data-contour-back]').count() === 0
      && await page.locator('[data-contour-confirm]').count() === 0
      && await page.locator('[aria-label="Workplane tools"]').count() === 0);

  const before = await editorScript(page);
  await page.locator('[data-feature-card-cancel]').click();
  await page.waitForFunction(() => !document.querySelector('[data-plane-editor]'), null, { timeout: 8000 });
  const cancelled = await editorScript(page);
  check(`${vp.name} X writes nothing`, cancelled === before && !/workplane begin/.test(cancelled));
  check(`${vp.name} X closes the card`, await page.locator('[data-plane-editor]').count() === 0);

  await page.locator('button[aria-label^="Insert Workplane"]').click();
  await page.locator('[data-plane-editor]').waitFor({ timeout: 8000 });
  await page.locator('button[title="World X plane"]').click();
  await page.waitForFunction(() => window.__VIEWPORT__.stageContourSketch().planePreset === 'x', null, { timeout: 4000 });
  await setNumber(page, 'plane-angle-z', '90');
  await setNumber(page, 'workplane-offset', '12');
  await page.waitForFunction(() => {
    const sketch = window.__VIEWPORT__.stageContourSketch();
    const center = sketch.planeCenter;
    return sketch.planePreset === 'x'
      && center
      && Math.abs(center[0]) < 0.05
      && Math.abs(center[1] - 12) < 0.05
      && Math.abs(center[2] - 10) < 0.05;
  }, null, { timeout: 4000 });
  await page.locator('[data-popup-number="workplane-offset"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOT_DIR, `workplane-add-${vp.name}-card.png`) });

  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => {
    const text = (window.monaco?.editor?.getModels?.() || []).map((model) => model.getValue()).join('\n');
    return text.includes('workplane begin') && !document.querySelector('[data-plane-editor]');
  }, null, { timeout: 8000 });
  const written = await editorScript(page);
  const center = written.match(/center:\s*\[\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*\]/);
  const normal = written.match(/normal:\s*\[\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*\]/);
  const begin = written.indexOf('workplane begin');
  const ret = written.indexOf('return part');
  check(`${vp.name} Add plane writes the shifted frame before return`,
    center && normal
      && near(Number(center[1]), 0)
      && near(Number(center[2]), 12)
      && near(Number(center[3]), 10)
      && near(Number(normal[2]), 1)
      && begin >= 0 && ret > begin
      && (written.match(/center:/g) || []).length === 1,
    written.slice(begin, begin + 240));
  check(`${vp.name} the card and the Plane rail are gone`,
    await page.locator('[data-plane-editor]').count() === 0
      && await page.locator('[data-contour-confirm]').count() === 0);
  check(`${vp.name} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
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
  for (const vp of [
    { name: '390', width: 390, height: 844, touch: true },
    { name: '1280', width: 1280, height: 800, touch: false },
  ]) {
    await runView(browser, vp);
  }
} catch (err) {
  check('workplane add browser pass', false, String(err && err.message ? err.message : err));
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.error(`\n${failed} workplane-add check(s) failed`);
  process.exit(1);
}
console.log('\nworkplane add golden passed');
