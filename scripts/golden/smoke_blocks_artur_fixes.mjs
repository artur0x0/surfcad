#!/usr/bin/env node
/**
 * Blocks: Centered clears on pose edit, feature-edit pose writeback, Move on
 * overlapping bodies (tri disambiguation). Browser checks at 390 and 1280.
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { register } from 'node:module';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { composeHelperInsert } from '../../src/utils/helperPaletteSnippets.js';
import { confirmFeatureEdit, openFeatureEdit } from '../../src/utils/featureEdit.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';
import { composeMoveCommit } from '../../src/utils/moveMode.js';
import { meshBodyComponents } from '../../src/utils/meshBodyComponents.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 5268);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const VIEWS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 800 },
];
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
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('blocks artur fixes — logic');

{
  const modal = read('src/components/HelperParamModal.jsx');
  check('pose edit clears Centered on block pops',
    /isBlockSolidId\(item\?\.id\)/.test(modal) && /next\.center = false/.test(modal));
  const script = composeHelperInsert('', 'cube', null, { width: 10, depth: 10, height: 10, center: true });
  const cube = parseFeatureMarkers(script).find((f) => f.kind === 'cube');
  const session = openFeatureEdit(script, cube);
  const next = confirmFeatureEdit(script, cube, { fields: { ...session.fields, x: 12, center: false } });
  check('feature edit applies translate', next.ok && next.changed && /\.translate\(\[12, 0, 0\]\)/.test(next.buffer),
    next.buffer?.slice(0, 200) || next.message);
}

const pending = new Map();
let msgId = 0;
globalThis.self = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const w = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.type === 'error') w.reject(new Error(msg.payload?.message || 'worker error'));
    else w.resolve(msg);
  },
};
function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => {
      if (!globalThis.self.onmessage) reject(new Error('no worker'));
      else globalThis.self.onmessage({ data: { type, payload, id } });
    });
  });
}
register('./manifold-resolve-hook.mjs', import.meta.url);
await import('../../src/workers/sandboxWorker.js');
await send('init');

async function exec(script) {
  const res = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
  return res.payload;
}
async function execFail(script) {
  try {
    await exec(script);
    return null;
  } catch (e) {
    return e.message || String(e);
  }
}

{
  const overlap = `
const a = Manifold.cube([10, 10, 10], true);
const b = Manifold.cube([10, 10, 10], true);
let part = Manifold.compose([a, b]);
`;
  const base = await exec(`${overlap}\nreturn part;`);
  const np = base.mesh.numProp || 3;
  const vp = base.mesh.vertProperties;
  const positions = {
    getX: (i) => vp[i * np],
    getY: (i) => vp[i * np + 1],
    getZ: (i) => vp[i * np + 2],
  };
  const bodies = meshBodyComponents(positions, base.mesh.triVerts);
  check('overlapping cubes are two mesh bodies', bodies.length === 2);
  const pick = bodies[1];
  const bare = await execFail(`${overlap}
part = move(part, [0, 0, 5], { bodies: [{ at: [0, 0, 0] }] });
return part;`);
  check('centroid-only move fails when bodies overlap',
    bare && /more than one body/.test(bare), bare || 'no throw');
  const commit = composeMoveCommit(overlap, {
    body: 'part',
    target: { at: pick.at, minTri: pick.minTri },
    dx: 0,
    dy: 0,
    dz: 5,
  });
  check('move commit carries tri', commit.ok && /tri:\s*\d+/.test(commit.buffer), commit.buffer || commit.message);
  const moved = await exec(`${commit.buffer.replace(/\n*return\s+part\s*;?\s*$/i, '')}
const parts = part.decompose();
if (parts.length !== 2) throw new Error('bodies ' + parts.length);
const zs = parts.map((p) => p.boundingBox().min[2]).sort((a, b) => a - b);
if (zs.length !== 2 || Math.abs(zs[0] + 5) > 0.05 || Math.abs(zs[1]) > 0.05) throw new Error('z ' + zs.join(','));
return part;`);
  check('tri move lifts one overlapping body by 5', !!moved);
}

console.log('\nblocks artur fixes — UI 390 / 1280');
mkdirSync(SHOT_DIR, { recursive: true });
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('  (skip browser — no Chrome)');
} else {
  const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('../../', import.meta.url).pathname,
    stdio: 'ignore',
    detached: true,
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ }
    try { server.kill('SIGKILL'); } catch { /* */ }
  };
  process.on('exit', stop);
  const waitForServer = async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      try {
        if ((await fetch(APP_URL)).ok) return true;
      } catch { /* */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };
  if (await waitForServer()) {
    const browser = await chromium.launch({ executablePath: exe, headless: true });
attachConsentPresetToBrowser(browser);
    try {
      for (const vp of VIEWS) {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const page = await context.newPage();
        await page.route('**/api/**', (route) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ authenticated: false }),
        }));
        await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.locator('button[aria-label^="Insert Cube:"]').click();
        await page.waitForSelector('[data-popup-number="x"]', { timeout: 20000 });
        const centered = page.locator('label:has-text("Centered") input[type="checkbox"]');
        check(`${vp.name} Centered starts on`, await centered.isChecked());
        await page.locator('[data-popup-number="x"]').fill('7');
        await page.locator('[data-popup-number="x"]').blur();
        check(`${vp.name} Centered clears after Pos X edit`, !(await centered.isChecked()));
        const shot = join(SHOT_DIR, `blocks-centered-pose-${vp.name}.png`);
        await page.screenshot({ path: shot });
        check(`${vp.name} shot saved`, existsSync(shot), shot);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } else {
    check('dev server for UI', false, APP_URL);
  }
  stop();
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
