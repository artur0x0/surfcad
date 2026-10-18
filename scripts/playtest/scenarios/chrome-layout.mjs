/** Desktop branch chip placement + equal feature-ribbon height. */
/* global document, window */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { agentCall, savePageScreenshot } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';

const USER_ID = 'user-playtest-chrome-layout';
const VAULT = 'playtest-chrome-layout-vault';
const HEIGHT_TOL = 0.5;
const SHIFT_TOL = 1;

export const id = 'chrome-layout';
export const title = 'Parts-header branch chip and feature ribbon height';
export const userId = USER_ID;

const EMPTY_SCRIPT = 'return Manifold.cube([8, 8, 8], true);\n';

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-chrome-layout',
    activeId: 'local:seed',
    source: 'local',
    parts: [{ id: 'local:seed', name: 'Seed', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{
    id: 'local:seed',
    script: `// --- cube begin ---
let part = Manifold.cube([20, 20, 10], true);
// --- cube end ---
return part;
`,
  }];
}

async function metrics(page) {
  return page.evaluate(() => {
    const strip = document.querySelector(
      '[data-desktop-feature-strip] [data-feature-strip], [data-cad-feature-strip] [data-feature-strip]',
    );
    const shell = document.querySelector('.viewport-shell');
    const leftRail = document.querySelector('[data-rail-pair="left"]');
    const rightRail = document.querySelector('[data-rail-pair="right"]');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom };
    };
    const gap = (rail) => {
      if (!strip || !rail) return null;
      return rail.getBoundingClientRect().top - strip.getBoundingClientRect().bottom;
    };
    return {
      strip: box(strip),
      shell: box(shell),
      joints: !!document.querySelector('[data-assembly-joints]'),
      empty: document.querySelector('[data-feature-strip]')?.hasAttribute('data-feature-strip-empty') === true,
      chips: document.querySelectorAll('[data-feature-chip]').length,
      viewerBranch: !!document.querySelector('[data-viewer-git-branch]'),
      ribbonBranch: !!document.querySelector('[data-parts-ribbon-branch]'),
      assemblyBranch: !!document.querySelector('[data-parts-ribbon-center] [data-assembly-branch]'),
      paneOpen: !!document.querySelector('[data-git-branch-pane]'),
      leftGap: gap(leftRail),
      rightGap: gap(rightRail),
      leftBottom: leftRail ? leftRail.getBoundingClientRect().bottom : null,
      rightBottom: rightRail ? rightRail.getBoundingClientRect().bottom : null,
      viewportH: window.innerHeight,
    };
  });
}

function equalHeights(rows) {
  const hs = rows.map((r) => r.strip?.h).filter((n) => typeof n === 'number');
  if (hs.length !== rows.length) return { ok: false, detail: `missing strip ${JSON.stringify(rows)}` };
  const span = Math.max(...hs) - Math.min(...hs);
  return { ok: span <= HEIGHT_TOL, detail: hs.join(',') };
}

function noShift(rows) {
  const tops = rows.map((r) => r.shell?.top).filter((n) => typeof n === 'number');
  if (tops.length !== rows.length) return { ok: false, detail: `missing shell ${JSON.stringify(rows)}` };
  const span = Math.max(...tops) - Math.min(...tops);
  return { ok: span <= SHIFT_TOL, detail: tops.join(',') };
}

function railsClearRibbon(rows) {
  const gaps = [];
  for (const row of rows) {
    for (const key of ['leftGap', 'rightGap']) {
      const g = row[key];
      if (typeof g !== 'number') continue;
      if (g + 0.5 < 10) return { ok: false, detail: `${key}=${g}` };
      gaps.push(`${key}:${g.toFixed(1)}`);
    }
    const floor = (row.viewportH || 0) - 8;
    if (row.leftBottom != null && row.leftBottom > floor) {
      return { ok: false, detail: `leftBottom=${row.leftBottom}` };
    }
    if (row.rightBottom != null && row.rightBottom > floor) {
      return { ok: false, detail: `rightBottom=${row.rightBottom}` };
    }
  }
  return { ok: true, detail: gaps.join(',') };
}

async function showCad(page) {
  const btn = page.locator('[data-stage-btn="cad"]');
  if (await btn.count()) {
    await btn.click().catch(() => {});
    await page.waitForSelector('[data-stage-pane="cad"]:not(.invisible)', { timeout: 8000 }).catch(() => {});
  }
}

async function showParts(page) {
  const btn = page.locator('[data-stage-btn="parts"]');
  if (await btn.count()) {
    await btn.click().catch(() => {});
    await page.waitForSelector('[data-stage-pane="parts"]:not(.invisible)', { timeout: 8000 }).catch(() => {});
  }
}

export async function run(ctx) {
  const { page, outDir } = ctx;
  const runner = createStepRunner();
  const shotDir = join(outDir, 'chrome-layout');
  mkdirSync(shotDir, { recursive: true });
  let blankId = null;
  let seedId = 'local:seed';

  await runner.runStep('insert_cube on seed (part features)', async () => {
    const parts = await agentCall(page, 'parts', {});
    seedId = parts.result?.activeId || seedId;
    const inserted = await agentCall(page, 'insert_cube', { width: 20, depth: 20, height: 10 });
    const run = await agentCall(page, 'run', {});
    return {
      ok: inserted.ok === true && run.ok === true,
      call: 'insert_cube',
      envelope: run,
    };
  });

  await runner.runStep('create empty part', async () => {
    const env = await agentCall(page, 'create_part', { name: 'Blank', script: EMPTY_SCRIPT });
    const parts = await agentCall(page, 'parts', {});
    blankId = env.result?.partId
      || parts.result?.parts?.find((p) => p.name === 'Blank')?.id
      || parts.result?.activeId;
    return {
      ok: !!blankId,
      call: 'create_part',
      args: { name: 'Blank' },
      envelope: env,
    };
  });

  async function cycleStates() {
    await agentCall(page, 'set_active_part', { part_id: seedId });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-feature-chip]').length > 0,
      { timeout: 15000 },
    ).catch(() => {});
    const part = await metrics(page);
    await page.locator('[data-title-role="assembly"][data-title-chip="button"]').first().click({ timeout: 8000 });
    await page.waitForFunction(
      () => !!document.querySelector('[data-assembly-joints]'),
      { timeout: 15000 },
    ).catch(() => {});
    const assembly = await metrics(page);
    await agentCall(page, 'set_active_part', { part_id: blankId });
    await page.waitForFunction(
      () => document.querySelector('[data-feature-strip]')?.hasAttribute('data-feature-strip-empty') === true,
      { timeout: 15000 },
    ).catch(() => {});
    const empty = await metrics(page);
    return { part, assembly, empty };
  }

  let desktop = null;
  await runner.runStep('1280 ribbon height equal, viewport unshifted', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(120);
    await showCad(page);
    desktop = await cycleStates();
    const h = equalHeights([desktop.part, desktop.assembly, desktop.empty]);
    const s = noShift([desktop.part, desktop.assembly, desktop.empty]);
    const g = railsClearRibbon([desktop.part, desktop.assembly, desktop.empty]);
    await savePageScreenshot(page, join(shotDir, 'after-1280-empty.png'));
    return {
      ok: h.ok && s.ok && g.ok && desktop.part.chips > 0 && desktop.assembly.joints && desktop.empty.empty,
      detail: `h=${h.detail} shift=${s.detail} gap=${g.detail} chips=${desktop.part.chips}`,
    };
  });

  await runner.runStep('git_move_to_repo then desktop branch in parts header', async () => {
    const moved = await agentCall(page, 'git_move_to_repo', { vault_name: VAULT });
    await page.waitForSelector('[data-parts-ribbon-branch]', { timeout: 15000 }).catch(() => {});
    const m = await metrics(page);
    let pane = false;
    if (m.ribbonBranch) {
      await page.locator('[data-parts-ribbon-branch]').first().click({ timeout: 5000 }).catch(() => {});
      pane = await page.locator('[data-git-branch-pane]').isVisible().catch(() => false);
      const cancel = page.locator('[data-git-branch-cancel], [data-git-dialog-close]').first();
      if (await cancel.count()) await cancel.click().catch(() => {});
    }
    await savePageScreenshot(page, join(shotDir, 'after-1280-branch.png'));
    return {
      ok: moved.ok === true && m.ribbonBranch === true && m.viewerBranch === false && pane === true,
      call: 'git_move_to_repo',
      args: { vault_name: VAULT },
      envelope: moved,
      detail: JSON.stringify({
        ribbonBranch: m.ribbonBranch,
        viewerBranch: m.viewerBranch,
        pane,
      }),
    };
  });

  await runner.runStep('390 ribbon height equal, mobile branch unchanged', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => window.matchMedia('(max-width: 768px)').matches,
      { timeout: 5000 },
    );
    await page.waitForTimeout(120);
    await showCad(page);
    const mobile = await cycleStates();
    const h = equalHeights([mobile.part, mobile.assembly, mobile.empty]);
    const s = noShift([mobile.part, mobile.assembly, mobile.empty]);
    const g = railsClearRibbon([mobile.part, mobile.assembly, mobile.empty]);
    await savePageScreenshot(page, join(shotDir, 'after-390-cad.png'));
    await showParts(page);
    const header = await metrics(page);
    await savePageScreenshot(page, join(shotDir, 'after-390-parts-header.png'));
    const mobileBranchOk = header.assemblyBranch === true
      && header.viewerBranch === false
      && header.ribbonBranch === false;
    return {
      ok: h.ok && s.ok && g.ok && mobileBranchOk,
      detail: `h=${h.detail} shift=${s.detail} gap=${g.detail} assemblyBranch=${header.assemblyBranch} ribbon=${header.ribbonBranch} viewer=${header.viewerBranch}`,
    };
  });

  return {
    id,
    title,
    ok: runner.failed === 0,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots: [
      join(shotDir, 'after-1280-empty.png'),
      join(shotDir, 'after-1280-branch.png'),
      join(shotDir, 'after-390-cad.png'),
      join(shotDir, 'after-390-parts-header.png'),
    ],
  };
}
