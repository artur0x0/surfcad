#!/usr/bin/env node
/**
 * The rollback line stays clear of count badges and is centred in the gap
 * between chips. After the last chip it sits past that badge.
 *
 * Shots: 390×844 and 1280×900, under GOLDEN_SHOT_DIR or os.tmpdir().
 */
/* global window */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { createServer as createVite } from 'vite';
import { markerWithId } from '../../src/utils/featureBlockId.js';
import {
  CUBE_BEGIN,
  CUBE_END,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
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
  region(FILLET_MODE_BEGIN, FILLET_MODE_END, 'fillet2', 'part = filletAlongPath(part, path, 1);'),
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
import { renderRollbackBadgeShot } from '/scripts/golden/rollback_badge_shot.js';
renderRollbackBadgeShot(document.getElementById('root'), {
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
attachConsentPresetToBrowser(browser);

async function dragTo(page, orientation, point) {
  const bar = page.locator(`[data-feature-strip-orientation="${orientation}"] [data-rollback-bar]`);
  const box = await bar.boundingBox();
  if (!box) throw new Error(`${orientation} bar missing`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 12 });
  await page.mouse.up();
}

async function runSize(label, compact, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${port}/?${compact ? 'compact=1' : 'compact=0'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const row = window.document.querySelector('[data-feature-strip-orientation="horizontal"] [data-rollback-bar]');
    const rail = window.document.querySelector('[data-feature-strip-orientation="vertical"] [data-rollback-bar]');
    const badge = window.document.querySelector('[data-feature-strip-orientation="horizontal"] [data-feature-id="fillet2"] [data-feature-type-badge]');
    return row && rail && badge && badge.textContent === '2'
      && row.getAttribute('data-rollback-anchor') === 'end';
  }, null, { timeout: 30000 });

  const both = await page.evaluate(() => ({
    row: (function read(orientation) {
      const root = window.document.querySelector(`[data-feature-strip-orientation="${orientation}"]`);
      const line = root?.querySelector('[data-rollback-line]');
      const last = root?.querySelector('[data-feature-id="fillet2"]');
      if (!root || !line || !last) return null;
      const vertical = orientation === 'vertical';
      const lineBox = line.getBoundingClientRect();
      const badges = [...root.querySelectorAll('[data-feature-type-badge]')].map((node) => {
        const box = node.getBoundingClientRect();
        const along = vertical
          ? Math.min(lineBox.bottom, box.bottom) - Math.max(lineBox.top, box.top)
          : Math.min(lineBox.right, box.right) - Math.max(lineBox.left, box.left);
        const cross = vertical
          ? Math.min(lineBox.right, box.right) - Math.max(lineBox.left, box.left)
          : Math.min(lineBox.bottom, box.bottom) - Math.max(lineBox.top, box.top);
        return along > 0.5 && cross > 0.5;
      });
      const lastBadge = last.querySelector('[data-feature-type-badge]').getBoundingClientRect();
      const lastBox = last.getBoundingClientRect();
      const trail = vertical ? Math.max(lastBox.bottom, lastBadge.bottom) : Math.max(lastBox.right, lastBadge.right);
      const lead = vertical ? lineBox.top : lineBox.left;
      return {
        anchor: root.querySelector('[data-rollback-bar]').getAttribute('data-rollback-anchor'),
        badge: last.querySelector('[data-feature-type-badge]').textContent,
        hit: badges.some(Boolean),
        endClear: lead - trail,
      };
    })('horizontal'),
    rail: (function read(orientation) {
      const root = window.document.querySelector(`[data-feature-strip-orientation="${orientation}"]`);
      const line = root?.querySelector('[data-rollback-line]');
      const last = root?.querySelector('[data-feature-id="fillet2"]');
      if (!root || !line || !last) return null;
      const vertical = orientation === 'vertical';
      const lineBox = line.getBoundingClientRect();
      const badges = [...root.querySelectorAll('[data-feature-type-badge]')].map((node) => {
        const box = node.getBoundingClientRect();
        const along = vertical
          ? Math.min(lineBox.bottom, box.bottom) - Math.max(lineBox.top, box.top)
          : Math.min(lineBox.right, box.right) - Math.max(lineBox.left, box.left);
        const cross = vertical
          ? Math.min(lineBox.right, box.right) - Math.max(lineBox.left, box.left)
          : Math.min(lineBox.bottom, box.bottom) - Math.max(lineBox.top, box.top);
        return along > 0.5 && cross > 0.5;
      });
      const lastBadge = last.querySelector('[data-feature-type-badge]').getBoundingClientRect();
      const lastBox = last.getBoundingClientRect();
      const trail = vertical ? Math.max(lastBox.bottom, lastBadge.bottom) : Math.max(lastBox.right, lastBadge.right);
      const lead = vertical ? lineBox.top : lineBox.left;
      return {
        anchor: root.querySelector('[data-rollback-bar]').getAttribute('data-rollback-anchor'),
        badge: last.querySelector('[data-feature-type-badge]').textContent,
        hit: badges.some(Boolean),
        endClear: lead - trail,
      };
    })('vertical'),
  }));
  check(`${label}: end line clears the strip badges`,
    both.row && both.row.anchor === 'end' && both.row.badge === '2' && !both.row.hit && both.row.endClear >= 2,
    JSON.stringify(both.row));
  check(`${label}: end line clears the rail badges`,
    both.rail && both.rail.anchor === 'end' && both.rail.badge === '2' && !both.rail.hit && both.rail.endClear >= 2,
    JSON.stringify(both.rail));

  const endShot = join(shotDir, `rollback-badge-end-${label}.png`);
  await page.screenshot({ path: endShot });
  console.log(`  shot ${endShot}`);

  const mid = await page.evaluate(() => {
    const root = window.document.querySelector('[data-feature-strip-orientation="horizontal"]');
    const prev = root.querySelector('[data-feature-id="fillet1"]');
    const next = root.querySelector('[data-feature-id="fillet2"]');
    const prevBox = prev.getBoundingClientRect();
    const nextBox = next.getBoundingClientRect();
    const badge = prev.querySelector('[data-feature-type-badge]')?.getBoundingClientRect();
    return {
      x: (Math.max(prevBox.right, badge?.right || 0) + nextBox.left) / 2,
      y: (prevBox.top + prevBox.bottom) / 2,
    };
  });
  await page.evaluate(() => { window.__ROLLBACK_DONE__ = ''; });
  await dragTo(page, 'horizontal', mid);
  await page.waitForFunction(() => window.__ROLLBACK_DONE__ === 'fillet1', null, { timeout: 10000 });
  const gapped = await page.evaluate(() => {
    const read = (orientation) => {
      const root = window.document.querySelector(`[data-feature-strip-orientation="${orientation}"]`);
      const line = root.querySelector('[data-rollback-line]');
      const prev = root.querySelector('[data-feature-id="fillet1"]');
      const next = root.querySelector('[data-feature-id="fillet2"]');
      const vertical = orientation === 'vertical';
      const lineBox = line.getBoundingClientRect();
      const prevBox = prev.getBoundingClientRect();
      const nextBox = next.getBoundingClientRect();
      const prevBadge = prev.querySelector('[data-feature-type-badge]').getBoundingClientRect();
      const badges = [...root.querySelectorAll('[data-feature-type-badge]')].map((node) => {
        const box = node.getBoundingClientRect();
        const along = vertical
          ? Math.min(lineBox.bottom, box.bottom) - Math.max(lineBox.top, box.top)
          : Math.min(lineBox.right, box.right) - Math.max(lineBox.left, box.left);
        const cross = vertical
          ? Math.min(lineBox.right, box.right) - Math.max(lineBox.left, box.left)
          : Math.min(lineBox.bottom, box.bottom) - Math.max(lineBox.top, box.top);
        return along > 0.5 && cross > 0.5;
      });
      const lineCenter = vertical ? (lineBox.top + lineBox.bottom) / 2 : (lineBox.left + lineBox.right) / 2;
      const gapCenter = vertical
        ? (Math.max(prevBox.bottom, prevBadge.bottom) + nextBox.top) / 2
        : (Math.max(prevBox.right, prevBadge.right) + nextBox.left) / 2;
      const prevTrail = vertical ? Math.max(prevBox.bottom, prevBadge.bottom) : Math.max(prevBox.right, prevBadge.right);
      const lineLead = vertical ? lineBox.top : lineBox.left;
      const lineTrail = vertical ? lineBox.bottom : lineBox.right;
      const nextLead = vertical ? nextBox.top : nextBox.left;
      return {
        anchor: root.querySelector('[data-rollback-bar]').getAttribute('data-rollback-anchor'),
        rolled: next.getAttribute('data-feature-rolled-back') || '',
        live: prev.getAttribute('data-feature-rolled-back') || '',
        hit: badges.some(Boolean),
        centerDelta: lineCenter - gapCenter,
        clearPrev: lineLead - prevTrail,
        clearNext: nextLead - lineTrail,
      };
    };
    return { row: read('horizontal'), rail: read('vertical') };
  });
  check(`${label}: mid gap is centred and clear of strip badges`,
    gapped.row.anchor === 'fillet1'
      && gapped.row.rolled === '1'
      && !gapped.row.live
      && !gapped.row.hit
      && Math.abs(gapped.row.centerDelta) <= 1
      && gapped.row.clearPrev >= 2
      && gapped.row.clearNext >= 2,
    JSON.stringify(gapped.row));
  check(`${label}: mid gap is centred and clear of rail badges`,
    gapped.rail.anchor === 'fillet1'
      && !gapped.rail.hit
      && Math.abs(gapped.rail.centerDelta) <= 1
      && gapped.rail.clearPrev >= 2
      && gapped.rail.clearNext >= 2,
    JSON.stringify(gapped.rail));

  const shotPath = join(shotDir, `rollback-badge-${label}.png`);
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
  console.log(`\nrollback badge: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nrollback badge: all checks passed');
process.exit(0);
