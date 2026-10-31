#!/usr/bin/env node
/**
 * New assembly after a part was selected in the previous one (MVP 3 bug):
 * with the bike open and its frame selected, New assembly then a tap on the
 * assembly title chip brought a ghost of the frame into the new, otherwise
 * empty, assembly. The selected part id outlived its document, and the
 * title chip re-framed it from the run cache. The chip now focuses only a
 * part of the current document, and a new assembly forgets the previous
 * selection and run meshes.
 *
 * Vite dev server, Chrome from CHROME_PATH or the usual paths, the agent
 * bridge in-page (`window.surfcad.call`). Desktop viewport; the handler is
 * shared with the phone tree.
 */
/* global window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 5342);
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

console.log('new assembly ghost golden');

const exe = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!exe) {
  console.log('  ❌ no system Chrome found (set CHROME_PATH)');
  console.log('new assembly ghost golden: FAIL (no Chrome)');
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
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

const waitForServer = async () => {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};


if (!(await waitForServer())) {
  check('dev server started', false, APP_URL);
} else {
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  attachConsentPresetToBrowser(browser);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/auth/me', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: { _id: 'user-new-assembly-ghost', email: 'agent@test.local' } }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    const agentCall = (name, args) => page.evaluate(
      async ({ name, argsJson }) => window.surfcad.call(name, argsJson),
      { name, argsJson: JSON.stringify(args ?? {}) },
    );

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.surfcad?.call === 'function', null, { timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForTimeout(500);

    const partsOf = (res) => (Array.isArray(res?.result?.parts) ? res.result.parts : []);
    const idsOf = (res) => partsOf(res).map((p) => String(p.id));

    // The bike: one assembly with a part that has geometry, then selected.
    const bike = await agentCall('create_assembly', { name: 'Bike' });
    check('create_assembly Bike', bike.ok === true, JSON.stringify(bike.error || bike.result).slice(0, 200));
    const bikeParts = await agentCall('parts', {});
    const frameId = idsOf(bikeParts)[0] || null;
    check('the bike has a part', !!frameId, JSON.stringify(bikeParts.result).slice(0, 200));
    const set = await agentCall('set_script', { part_id: frameId, source: 'let part = Manifold.cube([30, 30, 30], true);\nreturn part;' });
    check('set_script writes the frame', set.ok === true, JSON.stringify(set.error || set.result).slice(0, 200));
    const ran = await agentCall('run', {});
    check('the frame builds', ran.ok === true, JSON.stringify(ran.error || ran.result).slice(0, 200));
    await page.waitForTimeout(400);
    const bodiesBefore = await agentCall('list_bodies', {});
    check('the frame has a body', (bodiesBefore.result?.bodies || []).length >= 1, JSON.stringify(bodiesBefore.result).slice(0, 200));
    const sel = await agentCall('set_active_part', { part_id: frameId });
    check('the frame is selected', sel.ok === true, JSON.stringify(sel.error || sel.result).slice(0, 200));

    // New assembly, then the assembly title chip.
    const fresh = await agentCall('create_assembly', { name: 'Fresh' });
    check('create_assembly Fresh', fresh.ok === true, JSON.stringify(fresh.error || fresh.result).slice(0, 200));
    await page.waitForTimeout(600);
    const freshParts = await agentCall('parts', {});
    const freshIds = idsOf(freshParts);
    check('the new assembly does not list the frame', freshIds.length >= 1 && !freshIds.includes(String(frameId)), JSON.stringify({ frameId, freshIds }));
    const chip = page.locator('[data-title-chip="button"][data-title-role="assembly"]').first();
    check('the assembly title chip is shown', (await chip.count()) === 1);
    await chip.click();
    await page.waitForTimeout(800);

    const selection = await agentCall('selection', {});
    const activeId = selection.result?.activePartId == null ? null : String(selection.result.activePartId);
    check('the viewport shows a part of the new assembly, not the old frame',
      activeId !== String(frameId) && (activeId == null || freshIds.includes(activeId)),
      JSON.stringify({ activeId, frameId, freshIds }));
    const bodiesAfter = await agentCall('list_bodies', {});
    check('no body of the frame is drawn',
      String(bodiesAfter.result?.partId ?? '') !== String(frameId)
      && !(bodiesAfter.result?.bodies || []).some((b) => b.triangleCount === (bodiesBefore.result?.bodies?.[0]?.triangleCount ?? -1) && String(bodiesAfter.result?.partId) === String(frameId)),
      JSON.stringify(bodiesAfter.result).slice(0, 200));
    check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
    await page.close();
  } finally {
    await browser.close();
  }
}
stop();
console.log(failed ? `new assembly ghost golden: FAIL (${failed})` : 'new assembly ghost golden: ok');
process.exit(failed ? 1 : 0);
