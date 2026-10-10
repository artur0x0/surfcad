#!/usr/bin/env node
/**
 * A contour is its own statement.
 *
 *   const c1 = makeCrossSection(frame, profile); // @contour id=c1
 *
 * The id is the marker, never a character offset. A second Confirm appends
 * c2. Rename updates code references and leaves the id. Dimension Confirm
 * writes the contour and leaves an Extrude block alone.
 *
 * Confirm at 390 and 1280 writes that statement, and the saved chip shows
 * the name. Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir(), never the
 * artifacts dir.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { contourFromRectangle } from '../../src/utils/contourSolve.js';
import { composeContourExtrude, composeContourProfile } from '../../src/utils/contourMode.js';
import { writeContourProfileBlock } from '../../src/utils/contourProfileWrite.js';
import { listSavedContours } from '../../src/utils/savedContours.js';
import { renameNamedContour } from '../../src/utils/namedContour.js';

const PORT = Number(process.env.SMOKE_PORT || 5252);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const SCRIPT = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

const FACE = {
  type: 'planar',
  center: [0, 0, 10],
  normal: [0, 0, 1],
  area: 1200,
  triangleCount: 2,
  selectionMode: 'coplanar',
  planeFrame: {
    center: [0, 0, 10],
    normal: [0, 0, 1],
    x: [1, 0, 0],
    y: [0, 1, 0],
  },
};

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

function circle(buffer, extra = {}) {
  return composeContourProfile(buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    ...extra,
  });
}

function nodeChecks() {
  console.log('named contour (script)');
  const first = circle(SCRIPT);
  check('confirm emits const c1', first.ok && /const c1 = makeCrossSection\(\{ center: \[0, 0, 10\], normal: \[0, 0, 1\]/.test(first.buffer), first.message || '');
  check('marker id is c1', /\/\/ @contour id=c1/.test(first.buffer));
  check('id is not an offset', first.ok && !/id=c1@/.test(first.buffer));
  const listed = listSavedContours(first.buffer);
  const shifted = listSavedContours(`// moved\n${first.buffer}`);
  check('listed id is the marker', listed.length === 1 && listed[0].id === 'c1' && listed[0].name === 'c1');
  check('id survives a byte shift', shifted[0]?.id === 'c1' && shifted[0]?.name === 'c1');

  const second = composeContourProfile(first.buffer, {
    face: FACE,
    tool: 'rectangle',
    params: { width: 16, height: 8, centered: true },
  });
  check('second confirm appends c2', second.ok && second.contourId === 'c2' && /@contour id=c1/.test(second.buffer) && /@contour id=c2/.test(second.buffer));
  const rewritten = circle(second.buffer, { contourId: 'c1', contourName: 'c1' });
  check('same id rewrites c1 only', rewritten.ok
    && /const c1 = makeCrossSection\([\s\S]*profileCircle\(5, 32\)/.test(rewritten.buffer)
    && /const c2 = makeCrossSection\([\s\S]*profileRectangle\(16, 8, true\)/.test(rewritten.buffer));

  const old = 'const xs = makeCrossSection({ center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileCircle(4, 16));\n';
  check('old binding is listed by name', listSavedContours(old)[0]?.id === 'xs' && listSavedContours(`// pad\n${old}`)[0]?.id === 'xs');
  check('unbound call is not listed', listSavedContours(
    'makeCrossSection({ center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileCircle(1, 8));\n',
  ).length === 0);

  const script = first.buffer.replace(
    'return part;',
    'const solid = makeLoft([c1, c10]);\nconst label = \'c1\';\nreturn part;',
  );
  const renamed = renameNamedContour(script, 'c1', 'c_base');
  check('rename updates the binding and the loft reference', renamed.ok
    && /const c_base = makeCrossSection\(/.test(renamed.buffer)
    && /makeLoft\(\[c_base, c10\]\)/.test(renamed.buffer)
    && /\/\/ @contour id=c1/.test(renamed.buffer)
    && /const label = 'c1'/.test(renamed.buffer)
    && !/const c1 =/.test(renamed.buffer), renamed.message || '');
  check('rename refuses part', renameNamedContour(renamed.buffer, 'c1', 'part').ok === false);

  const ext = composeContourExtrude(SCRIPT, {
    face: FACE,
    tool: 'rectangle',
    params: { width: 12, height: 8, centered: true },
    extrude: { distance: 12, direction: 'normal', sense: 'positive' },
  });
  const wrote = writeContourProfileBlock(ext.buffer, {
    entry: 'makeExtrude',
    face: FACE,
    tool: 'polyline',
    params: { contour: contourFromRectangle(40, 12, false) },
    contourId: 'c1',
    contourName: 'c1',
  });
  const begin = 'contour-mode extrude begin';
  const end = 'contour-mode extrude end';
  const region = (buf) => buf.slice(buf.indexOf(begin), buf.indexOf(end));
  check('dimension confirm leaves the extrude block', wrote.ok && wrote.written
    && /const c1 = makeCrossSection\([\s\S]*solveContour\(/.test(wrote.buffer)
    && /@contour id=c1/.test(wrote.buffer)
    && region(wrote.buffer) === region(ext.buffer)
    && /makeExtrude\([^)]*12\)/.test(wrote.buffer), wrote.message || '');
}

nodeChecks();
if (failed) {
  console.log(`named contour: ${failed} failed`);
  process.exit(1);
}

console.log('named contour (390 / 1280)');
mkdirSync(SHOT_DIR, { recursive: true });
check('shot dir is not the artifacts folder', !String(SHOT_DIR).startsWith('/opt/cursor/artifacts'), SHOT_DIR);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('named contour: no system Chrome — set CHROME_PATH');
  process.exit(1);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname,
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

async function editorScript(page) {
  return page.evaluate(() => (
    (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n')
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
    const model = window.monaco.editor.getModels()[0];
    model.setValue(src);
  }, SCRIPT);
  await page.waitForFunction((needle) => {
    const model = window.monaco?.editor?.getModels?.()?.[0];
    return !!model && model.getValue().includes(needle) && !model.getValue().includes('filletAlongPath');
  }, 'return part;', { timeout: 8000 });
  const ran = await page.evaluate(async (src) => (
    window.__VIEWPORT__.executeScript(src)
  ), SCRIPT);
  if (ran?.error) throw new Error(ran.error);
  await page.waitForFunction(() => (window.__VIEWPORT__.stageVerifyFraming?.().tris || 0) > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__VIEWPORT__.stageFit({ az: 28, el: 18, margin: 1.02 }));
  await page.waitForTimeout(200);
}

async function confirmCircle(page) {
  await page.locator('button[aria-label^="Insert Create contour"]').click();
  await page.locator('[data-contour-chip]').waitFor({ timeout: 8000 });
  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  await page.locator('[data-contour-confirm]').click();
  await page.waitForFunction(() => !document.querySelector('[data-contour-exit]'), null, { timeout: 8000 });
}

async function savedLabels(page) {
  await page.locator('button[aria-label^="Insert Create contour"]').click();
  await page.locator('[aria-label="Saved contours"]').waitFor({ timeout: 8000 });
  return page.locator('[aria-label="Saved contours"] button').allInnerTexts();
}

async function runSize(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  await boot(page);

  await confirmCircle(page);
  const first = await editorScript(page);
  const line = (first.split('\n').find((row) => row.includes('const c1 =')) || '').trim();
  console.log(`  ${label} ${line.slice(0, 220)}`);
  check(`${label} Confirm writes const c1`, /const c1 = makeCrossSection\(/.test(first), line);
  check(`${label} marker id is c1`, /\/\/ @contour id=c1\b/.test(first), line);
  check(`${label} id is not an offset`, !/id=c1@/.test(first) && !/const c1@/.test(first), line);
  check(`${label} statement is a profile`, /const c1 = makeCrossSection\([\s\S]*profileCircle\(/.test(first), line);
  check(`${label} starter cube stays`, /let part = Manifold\.cube\(\[40, 30, 20\], true\)/.test(first));

  const labels = await savedLabels(page);
  const chip = labels.find((text) => text.trim().startsWith('c1'));
  check(`${label} saved chip shows c1`, !!chip && !chip.includes('@'), labels.join(' | '));
  await page.screenshot({ path: join(SHOT_DIR, `named-contour-${label}.png`) });

  await page.locator('[data-feature-card-confirm]').click();
  await page.waitForFunction(() => (
    document.querySelector('.viewport-shell')?.getAttribute('data-contour-face-aim') === 'done'
    && !document.querySelector('[data-contour-chip]')
  ), null, { timeout: 8000 });
  await page.locator('[data-contour-confirm]').click();
  await page.waitForFunction(() => !document.querySelector('[data-contour-exit]'), null, { timeout: 8000 });
  const both = await editorScript(page);
  check(`${label} second Confirm appends c2`, /\/\/ @contour id=c1\b/.test(both) && /\/\/ @contour id=c2\b/.test(both));
  check(`${label} c1 is still one statement`, (both.match(/const c1 = makeCrossSection\(/g) || []).length === 1);
  const again = await savedLabels(page);
  check(`${label} both chips are named`, again.some((text) => text.trim().startsWith('c1') && !text.includes('@'))
    && again.some((text) => text.trim().startsWith('c2') && !text.includes('@')), again.join(' | '));
  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const up = await waitForServer();
if (!up) {
  console.log('named contour: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  await runSize(browser, '390', {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await runSize(browser, '1280', {
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
} catch (err) {
  failed += 1;
  console.log(`  ❌ run — ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`named contour: ${failed} failed`);
  process.exit(1);
}
console.log('named contour: ok');
