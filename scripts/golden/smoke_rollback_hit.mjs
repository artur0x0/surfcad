#!/usr/bin/env node
/**
 * The rollback triangle's drag target is at least 44×44 on the strip and
 * the rail. A drag that starts on the edge of that box moves the bar.
 * With the bar before the first feature, the box clears the chip and the
 * chip still opens.
 *
 * Shots: 390×844 and 1280×900, under GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global window */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { createServer as createVite } from 'vite';
import { markerWithId } from '../../src/utils/featureBlockId.js';
import {
  CUBE_BEGIN,
  CUBE_END,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
  SHELL_BEGIN,
  SHELL_END,
} from '../../src/utils/helperPaletteSnippets.js';

const shotDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'surfcad-golden-shots');
mkdirSync(shotDir, { recursive: true });

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function region(begin, end, id, body) {
  return `${markerWithId(begin, id)}\n${body}\n${markerWithId(end, id)}`;
}

const SCRIPT = [
  region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true);'),
  region(FILLET_MODE_BEGIN, FILLET_MODE_END, 'fillet1', 'part = filletAlongPath(part, path, 2);'),
  region(SHELL_BEGIN, SHELL_END, 'shell1', "part = hollow(part, 2, 'z');"),
  'return part;',
  '',
].join('\n');

const htmlFor = (compact) => `<!doctype html><meta charset="utf-8">
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
import { renderRollbackHitShot } from '/scripts/golden/rollback_hit_shot.js';
renderRollbackHitShot(document.getElementById('root'), {
  compact: ${compact ? 'true' : 'false'},
  script: ${JSON.stringify(SCRIPT)},
});
window.__READY__ = true;
</script>`;

const vite = await createVite({
  root: new URL('../..', import.meta.url).pathname,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
const server = createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url.startsWith('/?')) {
    const compact = url.includes('compact=1');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(htmlFor(compact));
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end('no');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader'],
});

async function dragFromHitEdge(page, orientation, point) {
  const hit = page.locator(`[data-feature-strip-orientation="${orientation}"] [data-rollback-hit]`);
  const box = await hit.boundingBox();
  if (!box) throw new Error(`${orientation} hit box missing`);
  const start = orientation === 'vertical'
    ? { x: box.x + 1, y: box.y + box.height / 2 }
    : { x: box.x + box.width / 2, y: box.y + 1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 16 });
  await page.mouse.up();
}

async function runSize(label, compact, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const row = window.document.querySelector('[data-feature-strip-orientation="horizontal"] [data-rollback-hit]');
    const rail = window.document.querySelector('[data-feature-strip-orientation="vertical"] [data-rollback-hit]');
    const bar = window.document.querySelector('[data-feature-strip-orientation="horizontal"] [data-rollback-bar]');
    return row && rail && bar && bar.getAttribute('data-rollback-anchor') === 'end';
  }, null, { timeout: 30000 });

  const sized = await page.evaluate(() => {
    const read = (orientation) => {
      const root = window.document.querySelector(`[data-feature-strip-orientation="${orientation}"]`);
      const hit = root?.querySelector('[data-rollback-hit]')?.getBoundingClientRect();
      const mark = root?.querySelector('[data-rollback-mark]')?.getBoundingClientRect();
      return {
        hitW: hit ? hit.width : 0,
        hitH: hit ? hit.height : 0,
        markW: mark ? mark.width : 0,
        markH: mark ? mark.height : 0,
      };
    };
    return { row: read('horizontal'), rail: read('vertical') };
  });
  check(`${label}: strip hit box is at least 44×44`,
    sized.row.hitW >= 44 && sized.row.hitH >= 44, JSON.stringify(sized.row));
  check(`${label}: rail hit box is at least 44×44`,
    sized.rail.hitW >= 44 && sized.rail.hitH >= 44, JSON.stringify(sized.rail));
  check(`${label}: drawn triangle stays small`,
    sized.row.markW < 20 && sized.row.markH < 20 && sized.rail.markW < 20 && sized.rail.markH < 20,
    JSON.stringify(sized));

  const mid = await page.evaluate(() => {
    const root = window.document.querySelector('[data-feature-strip-orientation="horizontal"]');
    const fillet = root.querySelector('[data-feature-id="fillet1"]').getBoundingClientRect();
    const shell = root.querySelector('[data-feature-id="shell1"]').getBoundingClientRect();
    return { x: (fillet.right + shell.left) / 2, y: (fillet.top + fillet.bottom) / 2 };
  });
  await page.evaluate(() => { window.__ROLLBACK_DONE__ = ''; });
  await dragFromHitEdge(page, 'horizontal', mid);
  await page.waitForFunction(() => window.__ROLLBACK_DONE__ && window.__ROLLBACK_DONE__ !== 'end', null, { timeout: 10000 });
  const afterRow = await page.evaluate(() => window.__ROLLBACK_DONE__);
  check(`${label}: drag from the strip hit edge moves the bar`,
    afterRow === 'fillet1', afterRow);

  const end = await page.evaluate(() => {
    const root = window.document.querySelector('[data-feature-strip-orientation="vertical"]');
    const shell = root.querySelector('[data-feature-id="shell1"]').getBoundingClientRect();
    return { x: shell.left + shell.width / 2, y: shell.bottom + 24 };
  });
  await page.evaluate(() => { window.__ROLLBACK_DONE__ = ''; });
  await dragFromHitEdge(page, 'vertical', end);
  await page.waitForFunction(() => window.__ROLLBACK_DONE__ === 'end', null, { timeout: 10000 });
  check(`${label}: drag from the rail hit edge moves the bar`,
    await page.evaluate(() => window.__ROLLBACK_DONE__) === 'end');

  const start = await page.evaluate(() => {
    const root = window.document.querySelector('[data-feature-strip-orientation="horizontal"]');
    const cube = root.querySelector('[data-feature-id="cube1"]').getBoundingClientRect();
    return { x: Math.max(2, cube.left - 30), y: (cube.top + cube.bottom) / 2 };
  });
  await page.evaluate(() => { window.__ROLLBACK_DONE__ = ''; });
  await dragFromHitEdge(page, 'horizontal', start);
  await page.waitForFunction(() => window.__ROLLBACK_DONE__ === 'start', null, { timeout: 10000 });

  const cleared = await page.evaluate((overlapPad) => {
    const overlap = (a, b) => {
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return x > overlapPad && y > overlapPad;
    };
    const read = (orientation) => {
      const root = window.document.querySelector(`[data-feature-strip-orientation="${orientation}"]`);
      const hit = root.querySelector('[data-rollback-hit]').getBoundingClientRect();
      const chip = root.querySelector('[data-feature-id="cube1"]').getBoundingClientRect();
      const lead = root.querySelector('[data-rollback-lead]');
      return {
        overlap: overlap(hit, chip),
        lead: !!lead,
        anchor: root.querySelector('[data-rollback-bar]')?.getAttribute('data-rollback-anchor') || '',
        gap: orientation === 'vertical' ? chip.top - hit.bottom : chip.left - hit.right,
      };
    };
    return { row: read('horizontal'), rail: read('vertical') };
  }, 0.5);
  check(`${label}: start gap clears the strip hit box`,
    cleared.row.anchor === 'start' && cleared.row.lead && !cleared.row.overlap && cleared.row.gap >= 1,
    JSON.stringify(cleared.row));
  check(`${label}: start gap clears the rail hit box`,
    cleared.rail.anchor === 'start' && cleared.rail.lead && !cleared.rail.overlap && cleared.rail.gap >= 1,
    JSON.stringify(cleared.rail));

  await page.evaluate(() => { window.__JUMPED__ = ''; });
  await page.locator('[data-feature-strip-orientation="horizontal"] [data-feature-id="cube1"]').click();
  const rowJump = await page.evaluate(() => window.__JUMPED__);
  check(`${label}: first strip chip still taps open`, rowJump === 'cube1', rowJump);

  await page.evaluate(() => { window.__JUMPED__ = ''; });
  await page.locator('[data-feature-strip-orientation="vertical"] [data-feature-id="cube1"]').click();
  const railJump = await page.evaluate(() => window.__JUMPED__);
  check(`${label}: first rail chip still taps open`, railJump === 'cube1', railJump);

  const shotPath = join(shotDir, `rollback-hit-${label}.png`);
  await page.screenshot({ path: shotPath });
  console.log(`  shot ${shotPath}`);
  if (errors.length) console.log(`  ${label} page errors`, errors.slice(0, 4).join('\n'));
  await page.close();
}

try {
  await runSize('390', true, 390, 844);
  await runSize('1280', false, 1280, 900);
} finally {
  await browser.close();
  server.close();
  await vite.close();
}

if (failed) {
  console.log(`\nrollback hit: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nrollback hit: all checks passed');
process.exit(0);
