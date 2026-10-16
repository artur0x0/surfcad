/**
 * Regression: typing 0 after clear keeps 0 visible on blur (#484, #486).
 */
import { join } from 'node:path';
import { newPartStarterScript } from '../../../src/utils/helperPaletteSnippets.js';

export const id = 'regression-number-zero-blur';
export const title = 'Number box shows 0 after clear, type 0, blur (#484/#486)';
export const userId = 'user-bug-hunter-zero';
export const fixedIn = 'PR #484, #486';

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'bug-hunter-zero',
    activeId: 'local:part1',
    source: 'git',
    parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{ id: 'local:part1', script: newPartStarterScript() }];
}

export async function run(ctx) {
  const { page, outDir } = ctx;
  const steps = [];
  let ok = true;
  let detail = '';

  try {
    await page.locator('button[aria-label^="Insert Cube:"]').click();
    await page.waitForSelector('[data-popup-number="width"]', { timeout: 20000 });
    const width = page.locator('[data-popup-number="width"]');
    await width.fill('');
    await width.blur();
    await width.fill('0');
    await width.blur();
    const shown = await width.inputValue();
    const showsZero = shown === '0' || shown === '0.0' || shown === '0.00';
    steps.push({ id: 'width_shows_zero', ok: showsZero, detail: shown });
    if (!showsZero) ok = false;

    const shot = join(outDir, 'screenshots', `${id}.png`);
    await page.screenshot({ path: shot });
    return { id, title, ok, steps, screenshots: [shot], detail };
  } catch (err) {
    detail = err?.message || String(err);
    ok = false;
    return { id, title, ok, steps, detail };
  }
}
