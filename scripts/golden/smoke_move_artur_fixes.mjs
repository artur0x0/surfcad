#!/usr/bin/env node
/* global document, window */
/**
 * Move preview reference + feature-edit Z (Artur iPhone report).
 * Logic checks plus agent-bridge confirm at 390 and 1280.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { attachConsentPresetToBrowser } from './lib/presetConsentInit.mjs';
import { MOVE_BEGIN, MOVE_END } from '../../src/utils/helperPaletteSnippets.js';
import { confirmFeatureEdit, openFeatureEdit } from '../../src/utils/featureEdit.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';
import {
  composeMoveCommit,
  movePreviewOffset,
  moveTargetLabel,
  seedMoveDeltasFromLastMove,
} from '../../src/utils/moveMode.js';

const SHOT_DIR = process.env.GOLDEN_SHOT_DIR || tmpdir();
const PORT = Number(process.env.SMOKE_PORT || 5279);
const APP_URL = `http://127.0.0.1:${PORT}/?agent=1`;
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

console.log('move artur fixes — logic');

{
  const base = `let part = Manifold.cube([10, 10, 10], true);\n`;
  const moved = composeMoveCommit(base, {
    body: 'part',
    target: { at: [0, 0, 0] },
    dx: 0,
    dy: 0,
    dz: 2.625,
  });
  check('compose move z=2.625', moved.ok && moved.buffer.includes('[0, 0, 2.625]'), moved.message || moved.buffer);

  const buf = `${moved.buffer}\nreturn part;\n`;
  const fresh = seedMoveDeltasFromLastMove(
    { direction: 'xyz', dx: 0, dy: 0, dz: 0, target: { at: [0, 0, 0] } },
    buf,
    [0, 0, 0],
  );
  check('re-pick seeds absolute deltas', Math.abs(fresh.dz - 2.625) < 1e-9, JSON.stringify(fresh));

  const preview0 = movePreviewOffset({
    direction: 'xyz',
    dx: fresh.dx,
    dy: fresh.dy,
    dz: fresh.dz,
    target: { at: [0, 0, 0] },
  }, buf);
  check('preview offset is zero at seeded deltas',
    !!preview0 && preview0.every((v) => Math.abs(v) < 1e-9),
    JSON.stringify(preview0));

  const label = moveTargetLabel({ at: [0, 0, 0] }, { buffer: buf, dx: 0, dy: 0, dz: 2.625 });
  check('subtitle shows world centroid', label.includes('[0, 0, 2.625]'), label);

  const block = `${MOVE_BEGIN}\npart = move(part, [0, 0, 2.625], { bodies: [{ at: [0, 0, 0] }] });\n${MOVE_END}\n`;
  const script = `${base}${block}return part;\n`;
  const moveFeat = parseFeatureMarkers(script).find((f) => f.kind === 'move');
  check('move feature marker', !!moveFeat);
  const session = openFeatureEdit(script, moveFeat);
  const edited = confirmFeatureEdit(script, moveFeat, { fields: { ...session.fields, dz: 5 } });
  check('feature edit rewrites dz', edited.ok && edited.changed && /\[0,\s*0,\s*5\]/.test(edited.buffer),
    edited.buffer?.slice(-120) || edited.message);
}

async function agentCall(page, name, args = {}) {
  return page.evaluate(async ({ n, a }) => {
    const raw = await window.surfcad.call(n, JSON.stringify(a));
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }, { n: name, a: args });
}

console.log('\nmove artur fixes — agent bridge 390 / 1280');
mkdirSync(SHOT_DIR, { recursive: true });
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('  (skip browser — no Chrome)');
} else if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  check('dist build for agent bridge', false, 'run npm run build');
} else {
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
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
        if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return true;
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
        await page.waitForFunction(
          () => typeof window.surfcad?.call === 'function' && !document.querySelector('[data-app-loading]'),
          { timeout: 120000 },
        );

        const cube = await agentCall(page, 'insert_cube', { width: 20, depth: 20, height: 10, center: true });
        check(`${vp.name} insert_cube`, cube.ok === true && cube.result?.ok === true, JSON.stringify(cube));

        const moveWrite = composeMoveCommit('', {
          body: 'part',
          target: { at: [0, 0, 0] },
          dx: 0,
          dy: 0,
          dz: 3,
        });
        const parts = await agentCall(page, 'parts', {});
        const partId = parts.result?.activeId;
        check(`${vp.name} parts id`, typeof partId === 'string' && partId.length > 0 && !String(partId).includes('/'), JSON.stringify(parts.result));
        await agentCall(page, 'set_script', {
          part_id: partId,
          source: `// --- cube begin ---\nlet part = Manifold.cube([20, 20, 10], true);\n// --- cube end ---\n${moveWrite.buffer}\nreturn part;\n`,
        });
        const ran = await agentCall(page, 'run', {});
        check(`${vp.name} script with move`, ran.ok === true && ran.result?.ok === true, JSON.stringify(ran));

        const tree1 = await agentCall(page, 'feature_tree', {});
        const moveChip = (tree1.result?.features || []).find((f) => f.kind === 'move');
        check(`${vp.name} move chip`, !!moveChip, JSON.stringify(tree1));

        const open = await agentCall(page, 'open_feature', { id: moveChip.id });
        check(`${vp.name} open_feature move`, open.ok === true, JSON.stringify(open));
        await page.waitForTimeout(400);

        const subtitle = await page.locator('[data-move-mode-chip]').textContent().catch(() => '')
          || await page.getByText(/Body at \[/).textContent().catch(() => '');
        check(`${vp.name} move subtitle shows world z`,
          /Body at \[0, 0, 3\]/.test(subtitle) || /Body at \[0, 0, 3\]/.test(await page.content()),
          subtitle.slice(0, 120));

        const edit = await agentCall(page, 'edit_feature', { params: { dz: 6 } });
        check(`${vp.name} edit_feature dz`, edit.ok === true, JSON.stringify(edit));
        const confirm = await agentCall(page, 'confirm_feature', {});
        check(`${vp.name} confirm_feature move`, confirm.ok === true && confirm.result?.ok === true, JSON.stringify(confirm));
        const scriptAfter = await agentCall(page, 'get_script', {});
        const source = scriptAfter.result?.source || '';
        check(`${vp.name} script stores dz=6 after confirm`,
          /move\([^,]+,\s*\[0,\s*0,\s*6\]/.test(source),
          source.slice(-200));
        const rerun = await agentCall(page, 'run', {});
        check(`${vp.name} run after edit`, rerun.ok === true && rerun.result?.ok === true, JSON.stringify(rerun));

        const shot = join(SHOT_DIR, `move-artur-fix-${vp.name}.png`);
        await page.screenshot({ path: shot });
        check(`${vp.name} shot saved`, existsSync(shot), shot);

        await context.close();
      }
    } finally {
      await browser.close();
    }
  } else {
    check('preview server', false, APP_URL);
  }
  stop();
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
