/* eslint-env node */
/* global document, window, requestAnimationFrame */
/**
 * Part instances golden (data-model slice 2, runtime by definition).
 *
 * `insert_part { part_id, instance: true }` adds another placement of a
 * part: a row with its own id, name, pose and visibility whose script, run
 * and undo history belong to the definition (`instanceOf`). This golden
 * drives it over the agent bridge:
 *
 *   1. two instances of Roller: parts lists them with instanceOf, both
 *      share the primary's geometry (no new GPU build);
 *   2. part_set_transform moves one instance only;
 *   3. a joint between two instances solves;
 *   4. set_script on an instance rebuilds all three from one run (one GPU
 *      build, renderer geometry count steady) and the primary shows it;
 *   5. deleting an instance keeps the script; deleting the primary keeps
 *      the instances; the last row still edits and runs;
 *   6. hide, undo, status and feature_tree stay sane;
 *   0. (first) the Parts list's Add instance button, the instance caption
 *      and the ×N pill, and the delete dialog's placement copy.
 *
 * Dev server on SMOKE_PORT (default 4393); Chrome from CHROME_PATH.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4393);
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
const short = (value) => JSON.stringify(value).slice(0, 320);

console.log('part instances');

const exe = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!exe) {
  console.log('  ❌ no system Chrome found (set CHROME_PATH)');
  console.log('part instances: FAIL (no Chrome)');
  process.exit(1);
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BROWSER: 'none' },
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d.toString(); });
server.stderr.on('data', (d) => { serverLog += d.toString(); });
const stop = () => {
  try { server.kill('SIGTERM'); } catch { /* already gone */ }
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

const cube = (size) => `// --- cube begin id=cube1 ---\nlet part = Manifold.cube([${size}, ${size}, ${size}], true);\n// --- cube end ---\nreturn part;\n`;
const near = (a, b, eps = 1e-6) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((v, i) => Math.abs(Number(v) - Number(b[i])) < eps);
const facePick = (partId, face) => ({ part_id: partId, face_id: face.id, key: face.key });

if (!(await waitForServer())) {
  check('dev server started', false, serverLog.slice(-400));
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
      body: JSON.stringify({ authenticated: true, user: { _id: 'user-part-instances', email: 'agent@test.local' } }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    const agentCall = (name, args) => page.evaluate(
      async ({ name, argsJson }) => window.surfcad.call(name, argsJson),
      { name, argsJson: JSON.stringify(args ?? {}) },
    );
    const stats = async () => {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      return page.evaluate(() => window.__VIEWPORT__?.gpuStats?.() ?? null);
    };
    const fmt = (s) => (s ? `builds=${s.builds} reuses=${s.reuses} disposed=${s.disposed} live=${s.live} renderer=${s.rendererGeometries}` : 'null');
    const partsOf = async () => (await agentCall('parts', {}))?.result || {};
    const rowOf = (parts, id) => (parts.parts || []).find((row) => row.id === id) || null;
    const volumeOf = async (id) => {
      const sw = await agentCall('set_active_part', { part_id: id });
      if (sw?.ok !== true) return { error: sw };
      const st = await agentCall('status', {});
      return { volume: st?.result?.volume ?? null, status: st?.result || null };
    };

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
      null,
      { timeout: 60000 },
    );
    await page.waitForFunction(() => !!window.__VIEWPORT__?.ready?.(), null, { timeout: 30000 });

    // Setup: one part, Roller, 20 mm.
    const created = await agentCall('create_assembly', {});
    check('create_assembly', created?.ok === true, short(created));
    const p0 = await partsOf();
    const rollerId = p0.activeId;
    check('the active part exists', typeof rollerId === 'string', short(p0));
    const renamed = await agentCall('rename_part', { part_id: rollerId, name: 'Roller' });
    check('rename_part Roller', renamed?.ok === true, short(renamed));
    const set0 = await agentCall('set_script', { part_id: rollerId, source: cube(20) });
    check('set_script on the primary runs', set0?.ok === true && set0?.result?.ok === true, short(set0));

    // 0. The Parts list path: Add instance on the primary row, the caption
    //    and count, then delete that placement through the dialog.
    await page.waitForSelector(`[data-part-add-instance="${rollerId}"]`, { timeout: 15000 });
    await page.click(`[data-part-add-instance="${rollerId}"]`);
    await page.waitForFunction(
      (id) => document.querySelectorAll('[data-part-row]').length === 2 && !!document.querySelector(`[data-part-instance-of="${id}"]`),
      rollerId,
      { timeout: 15000 },
    );
    const pUi = await partsOf();
    const uiRow = (pUi.parts || []).find((row) => row.id !== rollerId) || null;
    check('Add instance adds a row with instanceOf (same path as the agent)', !!uiRow && uiRow.instanceOf === rollerId && uiRow.name === 'Roller (2)', short(pUi.parts));
    const caption = await page.locator(`[data-part-instance-of="${rollerId}"]`).first().innerText();
    check('the instance row says instance of Roller', caption.trim() === 'instance of Roller', caption);
    const count = await page.locator(`[data-part-row="${rollerId}"] [data-part-instance-count]`).first().innerText();
    check('the primary row shows ×2', count.trim() === '×2', count);
    check('the new row is active in the Parts list', uiRow && (await page.getAttribute(`[data-part-row="${uiRow.id}"]`, 'data-part-selected')) === 'true');
    await page.click(`[data-part-delete="${uiRow.id}"]`);
    await page.waitForSelector('[data-part-delete-dialog]', { timeout: 10000 });
    const deleteMessage = await page.locator('[data-part-delete-message]').innerText();
    check('delete copy says the placement goes and the part stays', /Remove this placement of Roller \(2\)\?/.test(deleteMessage) && /1 other instance/.test(deleteMessage) && /script is kept/.test(deleteMessage), deleteMessage);
    check('no repo delete while another row places the part', (await page.locator('[data-part-delete-confirm-repo]').count()) === 0);
    await page.click('[data-part-delete-confirm]');
    await page.waitForFunction(() => document.querySelectorAll('[data-part-row]').length === 1, null, { timeout: 15000 });
    const pUi2 = await partsOf();
    check('the placement is gone and the primary remains', (pUi2.parts || []).length === 1 && (pUi2.parts || [])[0]?.id === rollerId, short(pUi2.parts));
    check('the count pill is gone with the instance', (await page.locator('[data-part-instance-count]').count()) === 0);
    const afterUi = await volumeOf(rollerId);
    check('the primary still runs its script (20³)', Math.abs((afterUi.volume ?? 0) - 20 ** 3) < 1e-3, short(afterUi));

    const s0 = await stats();
    check('gpuStats readable', !!s0 && Number.isFinite(s0.builds), fmt(s0));
    note(`after setup: ${fmt(s0)}`);

    // 1. Two instances.
    const ins1 = await agentCall('insert_part', { part_id: rollerId, instance: true });
    const i1 = ins1?.result?.partId ?? null;
    check('insert_part instance:true returns a new row id', ins1?.ok === true && typeof i1 === 'string' && i1 !== rollerId, short(ins1));
    check('the result names the definition', ins1?.result?.instanceOf === rollerId && ins1?.result?.partCount === 2, short(ins1?.result));
    // Minting from an instance never chains: instanceOf still names the primary.
    const ins2 = await agentCall('insert_part', { part_id: i1, instance: true, position: [0, 60, 0] });
    const i2 = ins2?.result?.partId ?? null;
    check('a second instance minted from the first', ins2?.ok === true && typeof i2 === 'string' && i2 !== i1, short(ins2));
    check('instanceOf resolves to the definition, not the instance row', ins2?.result?.instanceOf === rollerId, short(ins2?.result));
    const p1 = await partsOf();
    check('parts lists three rows', (p1.parts || []).length === 3, short(p1));
    check('instances carry instanceOf; the primary does not', rowOf(p1, i1)?.instanceOf === rollerId && rowOf(p1, i2)?.instanceOf === rollerId && !('instanceOf' in (rowOf(p1, rollerId) || {})), short(p1.parts));
    check('instance names are numbered from the primary', rowOf(p1, i1)?.name === 'Roller (2)' && rowOf(p1, i2)?.name === 'Roller (3)', short(p1.parts?.map((r) => r.name)));
    check('every row ran ok', (p1.parts || []).every((row) => row.runState === 'ok'), short(p1.parts));
    check('the new instance is active', p1.activeId === i2, short(p1.activeId));
    const t2 = (await agentCall('part_get_transform', { part_id: i2 })).result;
    check('position arg placed the second instance', near(t2?.position, [0, 60, 0]), short(t2));
    const t1 = (await agentCall('part_get_transform', { part_id: i1 })).result;
    check('the first instance took the +X stagger', near(t1?.position, [40, 0, 0]), short(t1));
    const s1 = await stats();
    note(`after two instances: ${fmt(s1)}`);
    check('instances share the primary geometry: no new GPU build', s1.builds === s0.builds, `${s0.builds} -> ${s1.builds}`);
    check('renderer geometry count steady with three placements', s1.rendererGeometries === s0.rendererGeometries, `${s0.rendererGeometries} -> ${s1.rendererGeometries}`);

    // 2. Move one instance only.
    const moved = await agentCall('part_set_transform', { part_id: i1, position: [50, 0, 0] });
    check('part_set_transform on an instance', moved?.ok === true, short(moved));
    const t1b = (await agentCall('part_get_transform', { part_id: i1 })).result;
    const t0b = (await agentCall('part_get_transform', { part_id: rollerId })).result;
    check('only that instance moved', near(t1b?.position, [50, 0, 0]) && near(t0b?.position, [0, 0, 0]), short({ t1b, t0b }));

    // 3. Joint between two instances.
    const topFaces = (await agentCall('list_faces', { part_id: i1, filter: { kind: 'planar', normalWithin: { n: [0, 0, 1], deg: 5 } } })).result?.faces || [];
    const bottomFaces = (await agentCall('list_faces', { part_id: i2, filter: { kind: 'planar', normalWithin: { n: [0, 0, -1], deg: 5 } } })).result?.faces || [];
    check('list_faces answers for instance rows', topFaces.length === 1 && bottomFaces.length === 1, short({ top: topFaces.length, bottom: bottomFaces.length }));
    const fixed = await agentCall('joint_create', { type: 'fixed', picks: [{ part_id: i1 }] });
    check('joint_create fixed on an instance', fixed?.ok === true && fixed?.result?.ok === true, short(fixed));
    const joint = await agentCall('joint_create', {
      type: 'coincident',
      name: 'Stack',
      picks: [facePick(i1, topFaces[0]), facePick(i2, bottomFaces[0])],
    });
    check('joint_create between two instances solves', joint?.ok === true && joint?.result?.ok === true && typeof joint?.result?.jointId === 'string', short(joint));
    const placedI2 = joint?.result?.placements?.find((p) => p.part_id === i2);
    check('the second instance landed on top of the fixed first (z 20)', placedI2 && Math.abs(placedI2.position[2] - 20) < 1e-6, short(joint?.result?.placements));

    // 4. Edit the script through an instance: one run, all three rebuild.
    const gw0 = (await agentCall('geometry_workers', {})).result;
    const s3 = await stats();
    const edit = await agentCall('set_script', { part_id: i2, source: cube(26) });
    check('set_script on an instance runs', edit?.ok === true && edit?.result?.ok === true, short(edit));
    check('the script header names the definition, not the instance row', typeof edit?.result?.status?.script === 'string' && edit.result.status.script.startsWith(`// @surf-id ${rollerId}`), short(edit?.result?.status?.script?.split('\n')[0]));
    const gw1 = (await agentCall('geometry_workers', {})).result;
    const s4 = await stats();
    note(`after instance edit: ${fmt(s4)}`);
    check('one GPU build for the edit, not three', s4.builds === s3.builds + 1 && gw1?.gpu?.builds === (gw0?.gpu?.builds ?? 0) + 1, `stats ${s3.builds} -> ${s4.builds}; geometry_workers ${gw0?.gpu?.builds} -> ${gw1?.gpu?.builds}`);
    check('renderer geometry count steady after the edit', s4.rendererGeometries === s3.rendererGeometries, `${s3.rendererGeometries} -> ${s4.rendererGeometries}`);
    const primaryVol = await volumeOf(rollerId);
    check('the primary shows the edited script (volume 26³)', Math.abs((primaryVol.volume ?? 0) - 26 ** 3) < 1e-3, short(primaryVol));
    const instanceVol = await volumeOf(i1);
    check('the other instance shows it too', Math.abs((instanceVol.volume ?? 0) - 26 ** 3) < 1e-3, short(instanceVol));
    const tree = await agentCall('feature_tree', {});
    check('feature_tree on an instance reads the shared script', tree?.ok === true && (tree?.result?.features || tree?.result?.rows || []).length >= 1, short(tree));
    const p4 = await partsOf();
    check('every row is ok after the edit', (p4.parts || []).every((row) => row.runState === 'ok'), short(p4.parts));

    // 5. Hide one instance; the others stay.
    const hid = await agentCall('set_part_visible', { part_id: i1, visible: false });
    check('set_part_visible hides one instance', hid?.ok === true && rowOf(await partsOf(), i1)?.visible === false, short(hid));
    const s5 = await stats();
    check('hiding builds nothing', s5.builds === s4.builds, `${s4.builds} -> ${s5.builds}`);

    // 6. Delete an instance: the script stays with the other rows.
    const delI1 = await agentCall('delete_part', { part_id: i1, scope: 'assembly' });
    check('delete_part on an instance', delI1?.ok === true, short(delI1));
    const p6 = await partsOf();
    check('two rows remain', (p6.parts || []).length === 2 && !rowOf(p6, i1), short(p6.parts));
    const afterDel = await volumeOf(rollerId);
    check('the primary still runs its script after an instance left', Math.abs((afterDel.volume ?? 0) - 26 ** 3) < 1e-3, short(afterDel));

    // 7. Delete the primary: the instance keeps the definition.
    const delPrimary = await agentCall('delete_part', { part_id: rollerId, scope: 'assembly' });
    check('delete_part on the primary', delPrimary?.ok === true, short(delPrimary));
    const p7 = await partsOf();
    check('the instance row remains with instanceOf', (p7.parts || []).length === 1 && rowOf(p7, i2)?.instanceOf === rollerId, short(p7.parts));
    const orphanVol = await volumeOf(i2);
    check('the surviving instance still shows the script', Math.abs((orphanVol.volume ?? 0) - 26 ** 3) < 1e-3, short(orphanVol));
    const edit2 = await agentCall('set_script', { part_id: i2, source: cube(10) });
    check('set_script on the surviving instance runs', edit2?.ok === true && edit2?.result?.ok === true, short(edit2));
    const st2 = (await agentCall('status', {})).result;
    check('status shows the new volume (10³)', Math.abs((st2?.volume ?? 0) - 1000) < 1e-3, short(st2));

    // 8. Undo the script edit on the instance.
    const undo = await agentCall('undo', {});
    check('undo on an instance row', undo?.ok === true, short(undo));
    const st3 = (await agentCall('status', {})).result;
    check('undo restores the previous script (26³)', Math.abs((st3?.volume ?? 0) - 26 ** 3) < 1e-3, short(st3));

    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (err) {
    check('golden threw', false, err?.stack || String(err));
  } finally {
    await browser.close();
  }
}

stop();
if (failed) {
  console.log(`part instances: ${failed} failed`);
  process.exit(1);
}
console.log('part instances golden: ok');
// The dev server child is killed above; exit explicitly so CI's step returns.
process.exit(0);
