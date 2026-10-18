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
/** Surf-id so leftover git_move_to_repo keeps the row id (not a vault path). */
const SEED_ID = '2026-10-18-20-00-00-0002-c4ad';

export const id = 'chrome-layout';
export const title = 'Parts-header branch chip and feature ribbon height';
export const userId = USER_ID;

/** Empty source: unmarked cubes wrap into Code/Cube chips after parse. */
const EMPTY_SCRIPT = '';

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-chrome-layout',
    activeId: SEED_ID,
    source: 'local',
    parts: [{ id: SEED_ID, name: 'Seed', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{
    id: SEED_ID,
    script: `// @surf-id ${SEED_ID}
// @name Seed
// --- cube begin ---
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
      empty: strip?.hasAttribute('data-feature-strip-empty') === true,
      chips: strip ? strip.querySelectorAll('[data-feature-chip]').length : document.querySelectorAll('[data-feature-chip]').length,
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

async function waitRecorded(page, name, fn, timeout = 15000) {
  try {
    await page.waitForFunction(fn, null, { timeout });
    return { name, ok: true };
  } catch (err) {
    return { name, ok: false, error: err?.message || String(err) };
  }
}

function waitDetail(pass, waits) {
  return waits.map((w) => {
    if (w.ok) return `${pass}.${w.name}=ok`;
    const err = String(w.error || 'timeout').replace(/\s+/g, ' ').slice(0, 120);
    return `${pass}.${w.name}=timeout (${err})`;
  }).join(' ');
}

function partIdByName(partsEnv, name) {
  return partsEnv.result?.parts?.find((p) => p.name === name)?.id || null;
}

async function resolveNamedPartIds(page) {
  const parts = await agentCall(page, 'parts', {});
  return {
    seedId: partIdByName(parts, 'Seed'),
    blankId: partIdByName(parts, 'Blank'),
    parts,
  };
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
  let seedId = SEED_ID;

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
    const resolved = await resolveNamedPartIds(page);
    blankId = env.result?.partId || resolved.blankId || resolved.parts.result?.activeId;
    seedId = resolved.seedId || seedId;
    if (blankId) await agentCall(page, 'set_active_part', { part_id: blankId });
    // create_part treats a blank script as the marked cube starter; clear it.
    const cleared = await agentCall(page, 'set_script', { source: EMPTY_SCRIPT });
    const tree = await agentCall(page, 'feature_tree', {});
    const featureCount = Array.isArray(tree.result?.features) ? tree.result.features.length : -1;
    return {
      ok: !!blankId && cleared.ok === true && featureCount === 0,
      call: 'create_part',
      args: { name: 'Blank' },
      envelope: env,
      detail: `blankId=${blankId} features=${featureCount}`,
    };
  });

  async function activateBlankEmpty() {
    const switched = await agentCall(page, 'set_active_part', { part_id: blankId });
    const now = await resolveNamedPartIds(page);
    const active = now.parts.result?.activeId;
    const onBlank = active === blankId || active === now.blankId;
    if (onBlank) {
      // After git_move the editor buffer can still hold Seed; that keeps Code/Cube
      // chips on the ribbon even though Blank's stored script is header-only.
      await agentCall(page, 'set_script', { source: EMPTY_SCRIPT });
    }
    return { switched, onBlank, active };
  }

  async function cycleStates(pass) {
    const resolved = await resolveNamedPartIds(page);
    if (resolved.seedId) seedId = resolved.seedId;
    if (resolved.blankId) blankId = resolved.blankId;
    await agentCall(page, 'set_active_part', { part_id: seedId });
    const waitPartChips = await waitRecorded(
      page,
      'partChips',
      () => {
        const strip = document.querySelector(
          '[data-desktop-feature-strip] [data-feature-strip], [data-cad-feature-strip] [data-feature-strip]',
        );
        const n = strip
          ? strip.querySelectorAll('[data-feature-chip]').length
          : document.querySelectorAll('[data-feature-chip]').length;
        return n > 0;
      },
    );
    const part = await metrics(page);
    await page.locator('[data-title-role="assembly"][data-title-chip="button"]').first().click({ timeout: 8000 });
    const waitJoints = await waitRecorded(
      page,
      'joints',
      () => !!document.querySelector('[data-assembly-joints]'),
    );
    const assembly = await metrics(page);
    const blank = await activateBlankEmpty();
    const waitEmpty = await waitRecorded(
      page,
      'empty',
      () => {
        const strip = document.querySelector(
          '[data-desktop-feature-strip] [data-feature-strip], [data-cad-feature-strip] [data-feature-strip]',
        );
        return strip?.hasAttribute('data-feature-strip-empty') === true;
      },
    );
    const empty = await metrics(page);
    const waits = [waitPartChips, waitJoints, waitEmpty];
    return {
      part,
      assembly,
      empty,
      seedId,
      blankId,
      waits,
      waitDetail: `${waitDetail(pass, waits)} blankActive=${blank.onBlank}`,
    };
  }

  let desktop = null;
  await runner.runStep('1280 ribbon height equal, viewport unshifted', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(120);
    await showCad(page);
    desktop = await cycleStates('1280');
    const h = equalHeights([desktop.part, desktop.assembly, desktop.empty]);
    const s = noShift([desktop.part, desktop.assembly, desktop.empty]);
    const g = railsClearRibbon([desktop.part, desktop.assembly, desktop.empty]);
    await savePageScreenshot(page, join(shotDir, 'after-1280-empty.png'));
    const statesOk = desktop.part.chips > 0 && desktop.assembly.joints && desktop.empty.empty;
    return {
      ok: h.ok && s.ok && g.ok && statesOk,
      detail: `${desktop.waitDetail} h=${h.detail} shift=${s.detail} gap=${g.detail} chips=${desktop.part.chips} joints=${desktop.assembly.joints} empty=${desktop.empty.empty} seed=${desktop.seedId} blank=${desktop.blankId}`,
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
    const mobile = await cycleStates('390');
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
    const statesOk = mobile.part.chips > 0 && mobile.assembly.joints && mobile.empty.empty;
    return {
      ok: h.ok && s.ok && g.ok && statesOk && mobileBranchOk,
      detail: `${mobile.waitDetail} h=${h.detail} shift=${s.detail} gap=${g.detail} chips=${mobile.part.chips} joints=${mobile.assembly.joints} empty=${mobile.empty.empty} seed=${mobile.seedId} blank=${mobile.blankId} assemblyBranch=${header.assemblyBranch} ribbon=${header.ribbonBranch} viewer=${header.viewerBranch}`,
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
