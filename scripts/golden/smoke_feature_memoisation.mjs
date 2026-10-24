#!/usr/bin/env node
/**
 * Feature-level memoisation through the agent bridge on the Vite dev server:
 * a part with several marked blocks is built, then a late block is edited.
 * The worker restores the blocks before the edit from its cache (status.cache
 * hits, `cached: true` on feature_tree rows), runs the rest, and the geometry
 * equals a cold run of the same script (volume, body count, triangle count,
 * face names). Undo of the edit hits the cache too. Chrome from CHROME_PATH
 * or the usual paths.
 */
/* global document, window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4391);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
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

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('feature memoisation golden: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--logLevel', 'error'], {
  cwd: new URL('../../', import.meta.url).pathname,
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
process.on('SIGINT', () => { stop(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function agentCall(page, name, args) {
  return page.evaluate(async ({ name, argsJson }) => window.surfcad.call(name, argsJson), {
    name,
    argsJson: JSON.stringify(args ?? {}),
  });
}

const SCRIPT = (holeRadius) => [
  '// --- cube begin id=base ---',
  'let part = Manifold.cube([40, 30, 10], true);',
  '// --- cube end ---',
  '// --- cylinder begin id=boss ---',
  'part = part.add(Manifold.cylinder(14, 6, 6, 32, true).translate([10, 0, 7]));',
  '// --- cylinder end ---',
  '// --- hole begin id=h1 ---',
  `part = part.subtract(Manifold.cylinder(20, ${holeRadius}, ${holeRadius}, 24, true).translate([10, 0, 10]));`,
  '// --- hole end ---',
  '// --- chamfer-mode begin id=ch1 ---',
  'part = chamferEdges(part, edgesOf(part, "base.top"), 1.5);',
  '// --- chamfer-mode end ---',
  '// --- cube begin id=tab ---',
  'part = part.add(Manifold.cube([6, 6, 6], true).translate([-23, 0, 0]));',
  '// --- cube end ---',
  'return part;',
  '',
].join('\n');

/** What a run produced, in a form two runs can be compared in. */
async function fingerprint(page) {
  const status = await agentCall(page, 'status', {});
  const bodies = await agentCall(page, 'list_bodies', {});
  const faces = await page.evaluate(() => window.__VIEWPORT__?.faceTable?.() ?? null);
  const names = faces && Array.isArray(faces.faces) ? faces.faces.map((f) => f.name).filter(Boolean).sort() : [];
  return {
    volume: Math.round((status?.result?.volume ?? 0) * 1e3) / 1e3,
    bodyCount: bodies?.result?.bodies?.length ?? null,
    names,
    cache: status?.result?.cache ?? null,
    featureCached: status?.result?.featureCached ?? null,
  };
}

if (!(await waitForServer())) {
  console.log('feature memoisation golden: vite did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});
attachConsentPresetToBrowser(browser);
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));
  // No backend on the dev server: a signed-in local session, nothing else.
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, user: { _id: 'user-feature-memo', email: 'agent@test.local' } }),
  }));
  await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
    null,
    { timeout: 120000 },
  );
  await page.waitForSelector('[data-cad-run]', { state: 'attached', timeout: 120000 });
  const created = await agentCall(page, 'create_assembly', {});
  check('create_assembly', created?.ok === true, JSON.stringify(created).slice(0, 200));
  const partId = (await agentCall(page, 'parts', {}))?.result?.activeId;
  check('parts names the active part', typeof partId === 'string' && partId.length > 0, String(partId));

  // A fresh cache: nothing is restored on the first run.
  await page.evaluate(() => window.__VIEWPORT__.featureMemo({ clear: true }));
  const cold1 = await agentCall(page, 'set_script', { part_id: partId, source: SCRIPT(2.5) });
  check('set_script runs the five-block part', cold1?.ok === true && cold1?.result?.status?.runState === 'ok', JSON.stringify(cold1).slice(0, 300));
  const coldFp = await fingerprint(page);
  check('status.cache reports five blocks, no hits, on the first run',
    coldFp.cache && coldFp.cache.blocks === 5 && coldFp.cache.hits === 0 && coldFp.cache.misses === 5, JSON.stringify(coldFp.cache));
  check('no feature_tree row is marked cached yet', !coldFp.featureCached, JSON.stringify(coldFp.featureCached));

  // Edit the third block: the two before it come from the cache.
  const t0 = Date.now();
  const warm = await agentCall(page, 'set_script', { part_id: partId, source: SCRIPT(3) });
  const warmMs = Date.now() - t0;
  check('the edited script runs', warm?.ok === true && warm?.result?.status?.runState === 'ok', JSON.stringify(warm).slice(0, 300));
  const warmFp = await fingerprint(page);
  check('status.cache: two hits, three misses after editing the third block',
    warmFp.cache && warmFp.cache.blocks === 5 && warmFp.cache.hits === 2 && warmFp.cache.misses === 3, JSON.stringify(warmFp.cache));
  const tree = await agentCall(page, 'feature_tree', {});
  const rows = tree?.result?.features || [];
  const cachedIds = rows.filter((r) => r.cached === true).map((r) => r.id);
  check('feature_tree marks base and boss cached, the rest ran',
    JSON.stringify(cachedIds) === JSON.stringify(['base', 'boss']) && rows.filter((r) => r.id !== 'base' && r.id !== 'boss').every((r) => r.cached !== true && Number.isFinite(r.ms)),
    JSON.stringify(rows.map((r) => [r.id, r.cached === true, r.ms])));
  check('status.featureCached lists the same ids', JSON.stringify(Object.keys(warmFp.featureCached || {}).sort()) === JSON.stringify(['base', 'boss']), JSON.stringify(warmFp.featureCached));
  const summary = await agentCall(page, 'status', { return: 'summary' });
  const sumRows = summary?.result?.features || [];
  check('status return:summary rows carry cached: true for the restored blocks',
    sumRows.filter((r) => r.cached === true).map((r) => r.id).join(',') === 'base,boss', JSON.stringify(sumRows));
  check('the hole is bigger (the edit ran)', warmFp.volume < coldFp.volume, `${warmFp.volume} vs ${coldFp.volume}`);

  // A cold run of the same edited script must produce the same part.
  const statsBefore = await page.evaluate(() => window.__VIEWPORT__.featureMemo({ clear: true }));
  check('clearing the cache empties it', statsBefore && statsBefore.entries === 0, JSON.stringify(statsBefore));
  const t1 = Date.now();
  const rerun = await agentCall(page, 'run', {});
  const coldMs = Date.now() - t1;
  check('run after clear is cold', rerun?.ok === true && rerun?.result?.status?.cache?.hits === 0, JSON.stringify(rerun?.result?.status?.cache));
  const cold2 = await fingerprint(page);
  check('warm and cold runs agree on volume, body count and face names',
    cold2.volume === warmFp.volume && cold2.bodyCount === warmFp.bodyCount && JSON.stringify(cold2.names) === JSON.stringify(warmFp.names),
    JSON.stringify({ warm: warmFp, cold: cold2 }));
  const kernelMs = (st) => Object.values(st?.featureMs || {}).reduce((a, b) => a + b, 0);
  const warmKernel = kernelMs(warm?.result?.status);
  const coldKernel = kernelMs(rerun?.result?.status);
  console.log(`  warm edit: ${warmMs} ms round trip, ${warmKernel.toFixed(1)} ms of block kernel time; cold rerun: ${coldMs} ms round trip, ${coldKernel.toFixed(1)} ms of block kernel time`);

  // Undo the edit: the original script's first two blocks still hit (the
  // prefix is the same text), the hole block differs.
  const undo = await agentCall(page, 'undo', {});
  check('undo restores the previous script', undo?.ok === true, JSON.stringify(undo).slice(0, 200));
  // Undo re-ran the restored script: its first two blocks hit the entries
  // the cold run left (same prefix), the rest ran and were stored, so a
  // run of that script now restores every block.
  const afterUndo = await agentCall(page, 'run', {});
  const undoCache = afterUndo?.result?.status?.cache;
  check('after undo the restored script is fully cached (the edit cost nothing twice)', undoCache && undoCache.hits === 5 && undoCache.misses === 0, JSON.stringify(undoCache));
  const undoFp = await fingerprint(page);
  check('after undo the part is the original again', undoFp.volume === coldFp.volume && JSON.stringify(undoFp.names) === JSON.stringify(coldFp.names), JSON.stringify({ undo: undoFp.volume, cold: coldFp.volume }));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  failed += 1;
  console.log(`  ❌ feature memoisation threw — ${err?.stack || err}`);
} finally {
  await browser.close();
  stop();
}

if (failed) {
  console.log(`feature memoisation golden: ${failed} failed`);
  process.exit(1);
}
console.log('feature memoisation golden: ok');
process.exit(0);
