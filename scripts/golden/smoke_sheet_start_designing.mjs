#!/usr/bin/env node
/**
 * Start designing in sheet-metal mode writes a base flange, not a cube,
 * on a fresh part (the 20 mm starter). A busy part is left byte-for-byte
 * alone. Both at 390px and on desktop.
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
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { newPartStarterScript } from '../../src/utils/helperPaletteSnippets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const shotDir = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SHEET_START_PORT || 4331);
const catalog = read('scripts/golden/fixtures/scs/catalog.json');
const specs = read('scripts/golden/fixtures/scs/specs.json');

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

console.log('sheet start designing — flange, not a cube');

{
  const app = read('src/App.jsx');
  const script = read('src/utils/sheetMetal/sheetMetalScript.js');
  check('Start designing builds a sheet starter', /export function sheetStarterScript/.test(script)
    && /sheetStarterScript\(record\)/.test(app));
  check('a new Sheet part is created from that flange', /handleAddPart\(sheetName, \{ script: starter\.script \}\)/.test(app));
  check('a pending cube auto-run is dropped before the flange is written',
    /refreshGenRef\.current \+= 1;[\s\S]{0,240}applyBuffer\?\.\(starter\.script/.test(app));
}

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
check('system Chrome available', !!exe, 'set CHROME_PATH');

function plateOk(probe) {
  const size = probe?.bbox?.size;
  if (!size) return false;
  const sorted = [...size].sort((a, b) => a - b);
  const thin = sorted[0] > 1.5 && sorted[0] < 3.2;
  const plate = sorted[1] > 40 && sorted[2] > 40 && sorted[0] < sorted[1] * 0.2;
  const notCube = Math.abs(sorted[2] - sorted[0]) > 20;
  return thin && plate && notCube && probe.hasSheet && !probe.hasCube && probe.chip === 'sheetBase';
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
      bbox = { size: min.map((v, i) => max[i] - v) };
    }
    const chips = [...document.querySelectorAll('[data-feature-chip]')].map((el) => el.getAttribute('data-feature-chip'));
    return {
      stage: document.querySelector('[data-sheet-metal-mode]')?.getAttribute('data-sheet-metal-mode') || '',
      chips,
      chip: chips[0] || '',
      parts: [...document.querySelectorAll('[data-part-name]')].map((el) => (el.textContent || '').trim()),
      script,
      hasSheet: /sheet-metal begin/.test(script) && /sheetMetalSolid/.test(script),
      hasCube: /Manifold\.cube/.test(script),
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
attachConsentPresetToBrowser(browser);
      const cases = [
        ['fresh desktop', false, 1280, 900],
        ['fresh 390', false, 390, 844],
        ['busy desktop', true, 1280, 900],
        ['busy 390', true, 390, 844],
      ];
      for (const [label, busy, width, height] of cases) {
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
        const planted = busy
          ? 'let part = Manifold.sphere(8, 32);\nreturn part;\n'
          : newPartStarterScript();
        await page.evaluate((text) => {
          window.monaco.editor.getModels()[0].setValue(text);
        }, planted);
        await page.waitForFunction((needle) => {
          const model = window.monaco?.editor?.getModels?.()?.[0];
          return !!model && model.getValue().includes(needle);
        }, busy ? 'Manifold.sphere(8, 32)' : 'Manifold.cube([20, 20, 20]', { timeout: 5000 });
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
        const ready = busy
          ? await page.waitForFunction(() => {
            const stage = document.querySelector('[data-sheet-metal-mode]')?.getAttribute('data-sheet-metal-mode') || '';
            const script = (window.monaco?.editor?.getModels?.() || []).map((m) => m.getValue()).join('\n');
            return stage === 'plane' && script.includes('Manifold.sphere(8, 32)') && !/sheetMetalSolid/.test(script);
          }, null, { timeout: 15000 }).then(() => true).catch(() => false)
          : await page.waitForFunction(() => {
            const models = window.monaco?.editor?.getModels?.() || [];
            const script = models.map((m) => m.getValue()).join('\n');
            if (!/sheetMetalSolid/.test(script) || /Manifold\.cube/.test(script)) return false;
            const mesh = window.__MANIFOLD_CONTEXT__?.lastResult?.mesh;
            if (!mesh?.vertProperties) return false;
            const stride = mesh.numProp || 3;
            const min = [Infinity, Infinity, Infinity];
            const max = [-Infinity, -Infinity, -Infinity];
            for (let i = 0; i < mesh.vertProperties.length; i += stride) {
              for (let a = 0; a < 3; a++) {
                const v = mesh.vertProperties[i + a];
                if (v < min[a]) min[a] = v;
                if (v > max[a]) max[a] = v;
              }
            }
            const sorted = min.map((v, i) => max[i] - v).sort((a, b) => a - b);
            return sorted[0] > 1.5 && sorted[0] < 3.2 && sorted[1] > 40 && sorted[0] < sorted[1] * 0.2;
          }, null, { timeout: 45000 }).then(() => true).catch(() => false);
        const after = await page.evaluate(probe);
        const shot = join(shotDir, `sheet-start-${label.replace(/\s+/g, '-')}.png`);
        await page.screenshot({ path: shot });
        console.log(`  shot ${shot}`);
        const sorted = after.bbox?.size ? [...after.bbox.size].sort((a, b) => a - b) : [];
        if (busy) {
          check(`${label}: Start leaves the open part's script in place`,
            ready && after.script === planted && after.stage === 'plane'
            && !after.parts.some((name) => name.startsWith('Sheet')),
            JSON.stringify({ after, errors: errors.slice(0, 3) }));
        } else {
          check(`${label}: Start designing produced a sheet plate`, ready && plateOk(after) && after.stage === 'plane',
            JSON.stringify({ after, errors: errors.slice(0, 3), sorted }));
          if (after.volume != null) {
            const vol = Number(after.volume);
            check(`${label}: volume is a 100×60×t plate, not an 8000 mm³ cube`,
              vol > 12000 && vol < 16000, `volume ${vol}`);
          }
        }
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
console.log('\nStart designing produces a sheet flange.');
