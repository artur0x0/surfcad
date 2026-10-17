#!/usr/bin/env node
/**
 * Plane and sketch overlays default off.
 * Opening Extrude forces both on and the rail toggles show ON.
 * X puts them back. An already-on choice stays on. A tap off during
 * the tool stays off after X. Paint, opened while Extrude is up,
 * is another tool and puts a temporary hold back too.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 *
 * Runs vite preview over a production build. `npm run build` first.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 4331);
const APP_URL = `http://127.0.0.1:${PORT}/`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const ALLOWED = [
  /favicon/i,
  /Failed to load resource.*404.*favicon/i,
  /WebGL|WEBGL|GPU stall|Automatic fallback to software WebGL/i,
  /\[APP\]|\[App\]/,
];

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

console.log('overlay visibility — source');
{
  const view = read('src/components/Viewport.jsx');
  const panel = read('src/components/CrossSectionPanel.jsx');
  const hook = read('src/hooks/useTemporaryVisibility.js');
  const storage = read('src/utils/editorStorage.js');
  check(
    'session state defaults off',
    /const \[showPlanes, setShowPlanes\] = useState\(false\)/.test(view)
      && /const \[showContours, setShowContours\] = useState\(false\)/.test(view),
  );
  check(
    'panel defaults off',
    /showPlanes = false/.test(panel) && /showContours = false/.test(panel),
  );
  check(
    'enterContourMode holds and exitContourMode releases',
    /const enterContourMode = useCallback\(\(\{ entry \} = \{\}\) => \{\s*holdContourOverlays\(overlayVis, entry\)/.test(view)
      && /const exitContourMode = useCallback\(\(reason\) => \{[\s\S]{0,420}releaseContourOverlays\(overlayVis\)/.test(view)
      && /const openFeatureSlots = useCallback\(\(entry\) => \{[\s\S]{0,500}holdContourOverlays\(overlayVis, entry\)/.test(view),
  );
  check(
    'rail taps go through choose',
    /onShowPlanesChange=\{onShowPlanesChange\}/.test(view)
      && /overlayVis\.choose\('planes', next\)/.test(view)
      && /overlayVis\.choose\('contours', next\)/.test(view),
  );
  check(
    'toggles report pressed and the on chrome',
    /aria-pressed=\{!!showPlanes\}/.test(panel)
      && /aria-pressed=\{!!showContours\}/.test(panel)
      && /data-overlay-toggle="plane"/.test(panel)
      && /data-overlay-toggle="contour"/.test(panel)
      && /showPlanes[\s\S]{0,80}text-green-600 bg-green-100/.test(panel),
  );
  check(
    'X and Esc share exitContourMode',
    /onCancel=\{cancelContourEditor\}/.test(view)
      && /onCancel=\{closeFeatureSlots\}/.test(view)
      && /releaseContourOverlays\(overlayVis\)/.test(view)
      && /if \(event\.key !== 'Escape'\) return/.test(read('src/components/FeatureSheet.jsx')),
  );
  check(
    'opening paint closes contour mode',
    /const enterPaintMode = useCallback\(\(\) => \{[\s\S]{0,220}exitContourMode\(\)/.test(view),
  );
  check('visibility is not stored on the editor hand-off', !/showPlanes|showContours/.test(storage));
  check(
    'helper is keyed per toggle',
    /OVERLAY_TOGGLE_KEYS = Object\.freeze\(\['planes', 'contours'\]\)/.test(hook)
      && /export function useTemporaryVisibility/.test(hook),
  );
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('overlay visibility: no system Chrome found — set CHROME_PATH. Skipping the browser pass.');
  if (failed) process.exit(1);
  process.exit(0);
}

if (!existsSync(join(ROOT, 'dist/index.html'))) {
  console.log('  ❌ dist/ missing — run `npm run build` first');
  process.exit(1);
}

console.log('overlay visibility — browser');

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
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

async function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

mkdirSync(SHOT_DIR, { recursive: true });

let browser;
try {
  if (!await waitForServer()) {
    check('preview server started', false, `no response on ${APP_URL}`);
    process.exit(1);
  }

  browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
attachConsentPresetToBrowser(browser);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
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
  const planeBtn = page.locator('[data-overlay-toggle="plane"]');
  const sketchBtn = page.locator('[data-overlay-toggle="contour"]');
  await planeBtn.waitFor({ timeout: 20000 });
  await sketchBtn.waitFor({ timeout: 20000 });

  const toggle = async (name) => {
    const button = page.locator(`[data-overlay-toggle="${name}"]`);
    const pressed = await button.getAttribute('aria-pressed');
    const cls = await button.getAttribute('class');
    return {
      pressed: pressed === 'true',
      onChrome: typeof cls === 'string' && cls.includes('bg-green-100'),
    };
  };
  const shot = (name) => page.screenshot({ path: join(SHOT_DIR, name) });

  let planes = await toggle('plane');
  let sketches = await toggle('contour');
  check('planes default off', planes.pressed === false && planes.onChrome === false,
    `pressed=${planes.pressed} on=${planes.onChrome}`);
  check('sketches default off', sketches.pressed === false && sketches.onChrome === false,
    `pressed=${sketches.pressed} on=${sketches.onChrome}`);
  await shot('overlay-default-off.png');

  const extrude = page.locator('button[aria-label^="Insert Extrude"]');
  await extrude.click();
  await page.locator('[data-feature-card]').waitFor({ timeout: 10000 });
  planes = await toggle('plane');
  sketches = await toggle('contour');
  check('extrude turns planes on', planes.pressed === true && planes.onChrome === true,
    `pressed=${planes.pressed} on=${planes.onChrome}`);
  check('extrude turns sketches on', sketches.pressed === true && sketches.onChrome === true,
    `pressed=${sketches.pressed} on=${sketches.onChrome}`);
  await shot('overlay-extrude-on.png');

  await page.locator('[data-feature-card-cancel]').click();
  await page.locator('[data-feature-card]').waitFor({ state: 'detached', timeout: 10000 });
  planes = await toggle('plane');
  sketches = await toggle('contour');
  check('X restores planes off', planes.pressed === false && planes.onChrome === false);
  check('X restores sketches off', sketches.pressed === false && sketches.onChrome === false);
  await shot('overlay-after-x.png');

  await extrude.click();
  await page.locator('[data-feature-card]').waitFor({ timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.locator('[data-feature-card]').waitFor({ state: 'detached', timeout: 10000 });
  planes = await toggle('plane');
  sketches = await toggle('contour');
  check('Esc restores both off', planes.pressed === false && sketches.pressed === false);

  await extrude.click();
  await page.locator('[data-feature-card]').waitFor({ timeout: 10000 });
  await page.locator('[data-paint-chip]').click();
  await page.locator('[data-feature-card-title]', { hasText: 'Paint' }).waitFor({ timeout: 10000 });
  planes = await toggle('plane');
  sketches = await toggle('contour');
  check('opening Paint restores both off', planes.pressed === false && sketches.pressed === false);
  await page.locator('[data-paint-chip]').click();
  await page.locator('[data-feature-card]').waitFor({ state: 'detached', timeout: 10000 });

  await planeBtn.click();
  await sketchBtn.click();
  planes = await toggle('plane');
  sketches = await toggle('contour');
  check('user can turn both on', planes.pressed === true && sketches.pressed === true);
  await extrude.click();
  await page.locator('[data-feature-card]').waitFor({ timeout: 10000 });
  planes = await toggle('plane');
  sketches = await toggle('contour');
  check('already-on stays on while Extrude is open', planes.pressed === true && sketches.pressed === true);
  await page.locator('[data-feature-card-cancel]').click();
  await page.locator('[data-feature-card]').waitFor({ state: 'detached', timeout: 10000 });
  planes = await toggle('plane');
  sketches = await toggle('contour');
  check('already-on planes stay on after X', planes.pressed === true && planes.onChrome === true);
  check('already-on sketches stay on after X', sketches.pressed === true && sketches.onChrome === true);
  await shot('overlay-stays-on.png');

  await extrude.click();
  await page.locator('[data-feature-card]').waitFor({ timeout: 10000 });
  await planeBtn.click();
  planes = await toggle('plane');
  sketches = await toggle('contour');
  check('tapping planes off during Extrude shows off', planes.pressed === false && planes.onChrome === false);
  check('the sketch toggle stays on when only planes were tapped', sketches.pressed === true);
  await page.locator('[data-feature-card-cancel]').click();
  await page.locator('[data-feature-card]').waitFor({ state: 'detached', timeout: 10000 });
  planes = await toggle('plane');
  sketches = await toggle('contour');
  check('planes stay off after X', planes.pressed === false);
  check('untapped sketches stay on after X', sketches.pressed === true);

  await extrude.click();
  await page.locator('[data-feature-card]').waitFor({ timeout: 10000 });
  await sketchBtn.click();
  sketches = await toggle('contour');
  check('tapping sketches off during Extrude shows off', sketches.pressed === false && sketches.onChrome === false);
  await page.locator('[data-feature-card-cancel]').click();
  await page.locator('[data-feature-card]').waitFor({ state: 'detached', timeout: 10000 });
  planes = await toggle('plane');
  sketches = await toggle('contour');
  check('tapped sketches stay off after X', sketches.pressed === false && sketches.onChrome === false);
  check('the earlier planes choice stays off after X', planes.pressed === false);
  await shot('overlay-tap-stays-off.png');

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('overlay visibility browser pass', false, String(err && err.message ? err.message : err));
  if (browser) {
    const pages = browser.contexts().flatMap((ctx) => ctx.pages());
    if (pages[0]) await pages[0].screenshot({ path: join(SHOT_DIR, 'overlay-visibility-error.png') }).catch(() => {});
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

if (failed) {
  console.log(`\n${failed} overlay visibility check(s) failed`);
  process.exit(1);
}
console.log('\nOverlay visibility checks passed.');
