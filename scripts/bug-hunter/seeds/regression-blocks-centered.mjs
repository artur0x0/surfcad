/**
 * Regression: Blocks Centered clears when Pos X is edited (#485).
 */
import { join } from 'node:path';
import { newPartStarterScript } from '../../../src/utils/helperPaletteSnippets.js';

export const id = 'regression-blocks-centered';
export const title = 'Blocks Centered clears on pose edit (#485)';
export const userId = 'user-bug-hunter-centered';
export const fixedIn = 'PR #485';

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'bug-hunter-centered',
    activeId: 'local:part1',
    source: 'git',
    parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{ id: 'local:part1', script: newPartStarterScript() }];
}

/**
 * @param {{ page: import('playwright-core').Page, outDir: string }} ctx
 */
export async function run(ctx) {
  const { page, outDir } = ctx;
  const steps = [];
  let ok = true;
  let detail = '';

  try {
    await page.locator('button[aria-label^="Insert Cube:"]').click();
    await page.waitForSelector('[data-popup-number="x"]', { timeout: 20000 });
    const centered = page.locator('label:has-text("Centered") input[type="checkbox"]');
    const startsOn = await centered.isChecked();
    steps.push({ id: 'centered_default_on', ok: startsOn });
    if (!startsOn) ok = false;

    await page.locator('[data-popup-number="x"]').fill('7');
    await page.locator('[data-popup-number="x"]').blur();
    const cleared = !(await centered.isChecked());
    steps.push({ id: 'centered_clears_after_pos_x', ok: cleared });
    if (!cleared) ok = false;

    const shot = join(outDir, 'screenshots', `${id}.png`);
    await page.screenshot({ path: shot });
    return { id, title, ok, steps, screenshots: [shot], detail };
  } catch (err) {
    detail = err?.message || String(err);
    ok = false;
    return { id, title, ok, steps, detail };
  }
}
