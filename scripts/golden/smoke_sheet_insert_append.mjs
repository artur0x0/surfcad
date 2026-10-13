#!/usr/bin/env node
/**
 * Inserting Sheet Metal into a part that already has a box and a fillet
 * appends one flange block. Earlier feature blocks stay byte-identical
 * and the body still contains the box. 390px and desktop.
 *
 * Screenshots go to GOLDEN_SHOT_DIR or os.tmpdir() only.
 */
/* The evaluate callbacks run in the browser. */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SHEET_INSERT_PORT || 4338);
const catalog = read('scripts/golden/fixtures/scs/catalog.json');
const specs = read('scripts/golden/fixtures/scs/specs.json');

const BOX_FILLET = `// --- cube begin ---
let box1 = Manifold.cube([40, 30, 20], true);
let part = box1;
// --- cube end ---
// --- fillet-mode begin ---
const selEdges = edgesBetween(part, 0, 2); // boundary edge 1
const path = makeSweepPath(selEdges); // edge→sweep path
part = filletAlongPath(part, path, 2); // sweep fillet wedge
// --- fillet-mode end ---
return part;
`;
const KEPT = BOX_FILLET.slice(0, BOX_FILLET.indexOf('// --- fillet-mode end ---') + '// --- fillet-mode end ---'.length);

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
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('sheet insert append — earlier features survive');

{
  const app = read('src/App.jsx');
  const script = read('src/utils/sheetMetal/sheetMetalScript.js');
  check('fresh parts still take the starter flange', /sheetMetalFresh\(live\)/.test(app)
    && /applyBuffer\?\.\(starter\.script/.test(app));
  check('a featured part is appended, not replaced and not a new Sheet part',
    /part = part\.add\(sheetMetalSolid\(sheetSpec\)\)/.test(script)
    && /appendSheetBlock/.test(script)
    && /if \(!doc\.activeId\)/.test(app));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
check('system Chrome available', !!exe, 'set CHROME_PATH');

function spanOf(bbox) {
  if (!bbox?.size) return null;
  return bbox.size;
}

if (exe && failed === 0) {
  const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
  };
  process.on('exit', stop);

  const waitUp = async () => {
    const started = Date.now();
    while (Date.now() - started < 30000) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/`);
        if (res.ok) return true;
      } catch { /* booting */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };

  const probe = () => {
    const models = window.monaco?.editor?.getModels?.() || [];
    const script = models.map((m) => m.getValue()).join('\n');
    const mesh = window.__MANIFOLD_CONTEXT__?.lastResult?.mesh || null;
    let bbox = null;
    if (mesh?.vertProperties) {
      const vp = mesh.vertProperties;
      const stride = mesh.numProp || 3;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < vp.length; i += stride) {
        for (let a = 0; a < 3; a++) {
          const v = vp[i + a];
          if (v < min[a]) min[a] = v;
          if (v > max[a]) max[a] = v;
        }
      }
      bbox = { min, max, size: min.map((v, i) => max[i] - v) };
    }
    const chips = [...document.querySelectorAll('[data-feature-chip]')].map((el) => el.getAttribute('data-feature-chip'));
    return {
      stage: document.querySelector('[data-sheet-metal-mode]')?.getAttribute('data-sheet-metal-mode') || '',
      chips,
      parts: [...document.querySelectorAll('[data-part-name]')].map((el) => (el.textContent || '').trim()),
      script,
      bbox,
      volume: window.__MANIFOLD_CONTEXT__?.lastResult?.volume ?? null,
    };
  };

  let browser;
  try {
    if (!await waitUp()) {
      check('vite started', false, `no response on ${PORT}`);
    } else {
      mkdirSync(shotDir, { recursive: true });
      browser = await chromium.launch({
        executablePath: exe,
        args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
      });
      const cases = [
        ['desktop', 1280, 900],
        ['390', 390, 844],
      ];
      for (const [label, width, height] of cases) {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (err) => errors.push(String(err.message || err)));
        await page.route('**/api/auth/me', (route) => route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }),
        }));
        await page.route('**/api/config', (route) => route.fulfill({
          status: 200, contentType: 'application/json', body: '{}',
        }));
        await page.route('**/sendcutsend-catalog*.json', (route) => route.fulfill({
          status: 200, contentType: 'application/json', body: catalog,
        }));
        await page.route('**/sendcutsend-specs*.json', (route) => route.fulfill({
          status: 200, contentType: 'application/json', body: specs,
        }));
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('[data-sheet-metal-button]', { timeout: 90000 });
        await page.waitForFunction(() => window.monaco?.editor?.getModels?.()?.length > 0, null, { timeout: 30000 });
        await page.evaluate((text) => {
          window.monaco.editor.getModels()[0].setValue(text);
        }, BOX_FILLET);
        await page.evaluate(() => document.querySelector('[data-cad-run]')?.click());
        const ran = await page.waitForFunction(() => {
          const mesh = window.__MANIFOLD_CONTEXT__?.lastResult?.mesh;
          if (!mesh?.vertProperties) return false;
          const vp = mesh.vertProperties;
          const stride = mesh.numProp || 3;
          const min = [Infinity, Infinity, Infinity];
          const max = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < vp.length; i += stride) {
            for (let a = 0; a < 3; a++) {
              const v = vp[i + a];
              if (v < min[a]) min[a] = v;
              if (v > max[a]) max[a] = v;
            }
          }
          const size = min.map((v, i) => max[i] - v).sort((a, b) => a - b);
          return size[0] > 15 && size[0] < 25 && size[2] > 35 && size[2] < 45;
        }, null, { timeout: 45000 }).then(() => true).catch(() => false);
        const beforeShot = join(shotDir, `sheet-insert-before-${label}.png`);
        await page.screenshot({ path: beforeShot });
        console.log(`  shot ${beforeShot}`);
        await page.locator('[data-sheet-metal-button]').click();
        await page.waitForSelector('[data-sheet-metal-picker]', { timeout: 10000 });
        await page.waitForFunction(() => [...document.querySelectorAll('#sm-material option')].some((o) => o.value), null, { timeout: 15000 });
        await page.selectOption('#sm-material', { label: '5052 H32 Aluminum' });
        await page.waitForFunction(() => {
          const gauge = document.querySelector('#sm-gauge option[value="ALU-090"]');
          return !!(gauge && !gauge.disabled);
        }, null, { timeout: 10000 });
        await page.selectOption('#sm-gauge', 'ALU-090');
        await page.locator('[data-sheet-metal-start]').click();
        await page.waitForSelector('[data-sheet-metal-step="plane"]', { timeout: 10000 });
        const afterStart = await page.evaluate(probe);
        check(`${label}: Start does not rewrite a part that already has features`,
          ran && afterStart.script === BOX_FILLET && afterStart.stage === 'plane'
          && !afterStart.parts.some((name) => name.startsWith('Sheet')),
          JSON.stringify({ ran, stage: afterStart.stage, parts: afterStart.parts, same: afterStart.script === BOX_FILLET, errors: errors.slice(0, 3) }));
        await page.locator('[data-sm-plane="XY"]').click();
        await page.waitForSelector('[data-sheet-metal-base]', { timeout: 10000 });
        await page.locator('[data-sheet-metal-base] [data-sm-accept]').click();
        const accepted = await page.waitForFunction((kept) => {
          const script = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
          if (!script.startsWith(kept) || !script.includes('part = part.add(sheetMetalSolid(sheetSpec))')) return false;
          const mesh = window.__MANIFOLD_CONTEXT__?.lastResult?.mesh;
          if (!mesh?.vertProperties) return false;
          const vp = mesh.vertProperties;
          const stride = mesh.numProp || 3;
          const min = [Infinity, Infinity, Infinity];
          const max = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < vp.length; i += stride) {
            for (let a = 0; a < 3; a++) {
              const v = vp[i + a];
              if (v < min[a]) min[a] = v;
              if (v > max[a]) max[a] = v;
            }
          }
          const size = min.map((v, i) => max[i] - v);
          return min[2] < -8 && max[2] > 8 && size[0] > 70 && size[2] > 15;
        }, KEPT, { timeout: 45000 }).then(() => true).catch(() => false);
        const after = await page.evaluate(probe);
        const afterShot = join(shotDir, `sheet-insert-after-${label}.png`);
        await page.screenshot({ path: afterShot });
        console.log(`  shot ${afterShot}`);
        const size = spanOf(after.bbox);
        check(`${label}: Accept appends the flange and keeps earlier blocks`,
          accepted && after.script.startsWith(KEPT)
          && after.script.includes('part = part.add(sheetMetalSolid(sheetSpec))')
          && after.script.includes('"t":2.286')
          && after.script.includes('"plane":"XY"')
          && after.chips.includes('cube') && after.chips.includes('fillet') && after.chips.includes('sheetBase')
          && !after.parts.some((name) => name.startsWith('Sheet')),
          JSON.stringify({ accepted, chips: after.chips, parts: after.parts, size, errors: errors.slice(0, 4), head: after.script.slice(0, 80) }));
        check(`${label}: the body still contains the box`,
          !!size && after.bbox.min[2] < -8 && after.bbox.max[2] > 8 && size[0] > 70 && size[2] > 15
          && Number(after.volume) > 30000,
          JSON.stringify({ size, min: after.bbox?.min, volume: after.volume }));
        await context.close();
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    stop();
  }
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nSheet insert appends onto earlier features.');
