#!/usr/bin/env node
/**
 * Edge identity, part 2 (MVP 3 B8 / B12 / B16): a Fillet or Chamfer Accept
 * writes `edgesNamed(part, "faceA~faceB")`, never an ordinal, a face-id pair
 * or a literal wire; the name still resolves after an upstream edit; and a
 * chamfer card reopened from its chip loads its edges and closes clean.
 *
 * Vite dev server, Chrome from CHROME_PATH or the usual paths, the agent
 * bridge in-page (`window.surfcad.call`).
 */
/* global window */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4383);
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
const note = (text) => console.log(`  · ${text}`);

console.log('edge identity accept golden');

const exe = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!exe) {
  console.log('  ❌ no system Chrome found (set CHROME_PATH)');
  console.log('edge identity accept golden: FAIL (no Chrome)');
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

const PLATE = (width) => `// --- cube begin id=plate ---
let part = Manifold.cube([${width}, 60, 8], true);
// --- cube end id=plate ---
// --- cube begin id=boss ---
part = part.add(Manifold.cube([20, 12, 10], true).translate([30, 0, 9]));
// --- cube end id=boss ---
return part;
`;
const QUARTER = (r, L) => (1 - Math.PI / 4) * r * r * L;

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
      body: JSON.stringify({ authenticated: true, user: { _id: 'user-edge-identity', email: 'agent@test.local' } }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    const agentCall = (name, args) => page.evaluate(
      async ({ name, argsJson }) => window.surfcad.call(name, argsJson),
      { name, argsJson: JSON.stringify(args ?? {}) },
    );
    const script = async () => (await agentCall('get_script', {})).result?.source || '';
    const volume = async () => (await agentCall('status', {})).result?.volume;
    const noOldForms = (src) => !/edgesBetween\(|flatMap\(\(id\) => edge\(|va: \[/.test(src);

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.surfcad?.call === 'function', null, { timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 30000 });

    check('create_assembly', (await agentCall('create_assembly', {})).ok === true);
    const partId = (await agentCall('parts', {})).result?.activeId;
    check('active part', typeof partId === 'string');
    const set = await agentCall('set_script', { part_id: partId, source: PLATE(120), return: 'status' });
    check('plate with boss builds', set.ok === true && set.result?.status?.runState === 'ok', JSON.stringify(set).slice(0, 300));
    const v0 = await volume();

    // Fillet Accept by name (B16): one edge, picked by name, written as edgesNamed.
    const selEdge = await agentCall('select_edges', { names: ['plate.top~plate.right'] });
    check('select_edges by name', selEdge.ok === true && selEdge.result?.count >= 1, JSON.stringify(selEdge).slice(0, 200));
    const fillet = await agentCall('insert_fillet_edges', { use_selection: true, radius: 2, return: 'status' });
    check('insert_fillet_edges with the named pick', fillet.ok === true && fillet.result?.usedSelection === true && fillet.result?.status?.runState === 'ok', JSON.stringify(fillet.result?.errors || fillet.error).slice(0, 300));
    const src1 = await script();
    check('the script holds edgesNamed(part, "plate.right~plate.top")', /edgesNamed\(part, "plate\.right~plate\.top"\)/.test(src1), src1.slice(-500));
    check('no ordinal, face-id pair or literal wire in the script', noOldForms(src1), src1.slice(-500));
    const v1 = await volume();
    const expect1 = QUARTER(2, 60);
    check('the right top edge is filleted', Number.isFinite(v1) && Math.abs((v0 - v1) - expect1) < expect1 * 0.2, `removed ${(v0 - v1)?.toFixed(2)} expected about ${expect1.toFixed(2)}`);

    // B8: an upstream edit (the plate grows) keeps the fillet, since the name
    // still resolves; an ordinal would have renumbered and a wire would have moved.
    const grown = src1.replace('Manifold.cube([120, 60, 8], true)', 'Manifold.cube([140, 60, 8], true)');
    check('the fixture edit found the plate line', grown !== src1);
    const regrow = await agentCall('set_script', { part_id: partId, source: grown, return: 'status' });
    check('the edited plate still builds with its fillet', regrow.ok === true && regrow.result?.status?.runState === 'ok', JSON.stringify(regrow.result?.errors || regrow.error).slice(0, 300));
    const v2 = await volume();
    const grownBase = v0 + 20 * 60 * 8;
    check('the fillet still applies after the edit', Number.isFinite(v2) && Math.abs((grownBase - v2) - expect1) < expect1 * 0.2, `removed ${(grownBase - v2)?.toFixed(2)} expected about ${expect1.toFixed(2)}`);

    // Chamfer by name on the boss, then the card (B12): open loads the edges, cancel closes clean.
    const selBoss = await agentCall('select_edges', { names: ['boss.top~boss.front'] });
    check('select_edges boss.top~boss.front', selBoss.ok === true && selBoss.result?.count >= 1, JSON.stringify(selBoss).slice(0, 200));
    const chamfer = await agentCall('insert_chamfer_edges', { use_selection: true, chamfer: 1, return: 'status' });
    check('insert_chamfer_edges with the named pick', chamfer.ok === true && chamfer.result?.status?.runState === 'ok', JSON.stringify(chamfer.result?.errors || chamfer.error).slice(0, 300));
    const src2 = await script();
    check('the chamfer is edgesNamed(part, "boss.front~boss.top")', /edgesNamed\(part, "boss\.front~boss\.top"\)/.test(src2) && noOldForms(src2), src2.slice(-500));
    const v3 = await volume();
    const expectCh = 0.5 * 1 * 1 * 20;
    check('the boss front top edge is chamfered', Number.isFinite(v3) && Math.abs((v2 - v3) - expectCh) < expectCh * 0.25, `removed ${(v2 - v3)?.toFixed(2)} expected about ${expectCh}`);

    const tree = (await agentCall('feature_tree', {})).result;
    const chamferChip = (tree?.features || []).find((f) => f.kind === 'chamfer');
    check('feature_tree lists the chamfer chip', !!chamferChip, JSON.stringify((tree?.features || []).map((f) => f.kind)));
    const opened = await agentCall('open_feature', { id: chamferChip?.id });
    check('open_feature on the chamfer chip', opened.ok === true, JSON.stringify(opened).slice(0, 200));
    await page.waitForTimeout(800);
    const modeOpen = (await agentCall('mode', {})).result;
    check('the chamfer card opens with its edges loaded (B12)', modeOpen?.featureEdit?.kind === 'chamfer' && (modeOpen?.fillet?.edgeCount ?? 0) >= 1, JSON.stringify({ featureEdit: modeOpen?.featureEdit, fillet: modeOpen?.fillet }));
    const cancelled = await agentCall('cancel_feature', {});
    check('cancel_feature closes the card', cancelled.ok === true, JSON.stringify(cancelled).slice(0, 200));
    await page.waitForTimeout(400);
    const modeClosed = (await agentCall('mode', {})).result;
    check('the viewport leaves chamfer mode on cancel (B12)', modeClosed?.fillet == null && modeClosed?.featureEdit == null, JSON.stringify({ featureEdit: modeClosed?.featureEdit, fillet: modeClosed?.fillet }));
    check('cancel wrote nothing', (await script()) === src2);

    // Edit the chamfer size through the card: the stored name is kept and re-emitted.
    const reopened = await agentCall('open_feature', { id: chamferChip?.id });
    check('open_feature again', reopened.ok === true);
    await page.waitForTimeout(800);
    const edited = await agentCall('edit_feature', { params: { chamfer: 1.5 } });
    check('edit_feature chamfer 1.5', edited.ok === true, JSON.stringify(edited).slice(0, 200));
    const confirmed = await agentCall('confirm_feature', { return: 'status' });
    check('confirm_feature rewrites the chamfer', confirmed.ok === true && confirmed.result?.ok === true, JSON.stringify(confirmed.result?.errors || confirmed.error).slice(0, 300));
    const src3 = await script();
    check('the edited chamfer still names its edge', /edgesNamed\(part, "boss\.front~boss\.top"\)/.test(src3) && /filletAlongPath\([^)]*1\.5/.test(src3) && noOldForms(src3), src3.slice(-500));
    const v4 = await volume();
    const expectCh2 = 0.5 * 1.5 * 1.5 * 20;
    check('the bigger chamfer removed more', Number.isFinite(v4) && Math.abs((v2 - v4) - expectCh2) < expectCh2 * 0.25, `removed ${(v2 - v4)?.toFixed(2)} expected about ${expectCh2}`);
    note(`volumes ${[v0, v1, v2, v3, v4].map((v) => v?.toFixed(1)).join(' → ')}`);

    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

stop();
if (failed) {
  console.log(`edge identity accept golden: FAIL (${failed})`);
  process.exit(1);
}
console.log('edge identity accept golden: ok');
process.exit(0);
