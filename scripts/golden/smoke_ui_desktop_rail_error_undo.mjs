#!/usr/bin/env node
/**
 * Desktop + general UI tweaks:
 * 1) Desktop feature strip below top ribbon
 * 2) Left rail content-max height + narrower when fits
 * 3) Every error popup includes Undo
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('ui: desktop ribbon + left rail + error Undo');

{
  const app = read('../../src/App.jsx');
  check(
    '1: desktop feature bar under the title',
    /data-desktop-feature-strip/.test(app) &&
      /data-feature-strip-placement="viewer-under-title-horizontal"/.test(app) &&
      /top-14[\s\S]{0,120}data-desktop-feature-strip/.test(app),
  );
}

{
  const railPair = read('../../src/utils/railPair.js');
  const palette = read('../../src/components/HelperInsertPalette.jsx');
  const contour = read('../../src/components/ContourModeRail.jsx');
  check(
    '2: left rail height is content-max (max-h)',
    /max-h-\[min\(26rem,calc\(100%-5\.5rem\)\)\]/.test(railPair) &&
      /RAIL_PAIR_HEIGHT_ATTR = 'content-max'/.test(railPair) &&
      /useLeftRailFit/.test(railPair) &&
      /RAIL_PAIR_WIDTH_FIT_CLASS = 'w-14'/.test(railPair),
  );
  check(
    '2: helper + contour rails use fit hook + data-rail-fit',
    /useLeftRailFit/.test(palette) &&
      /data-rail-fit=\{fits \? 'fits' : 'scroll'\}/.test(palette) &&
      /useLeftRailFit/.test(contour) &&
      /data-rail-fit=\{fits \? 'fits' : 'scroll'\}/.test(contour),
  );
  const view = read('../../src/components/Viewport.jsx');
  check(
    '2: desktop CAD uses full-length left rail under feature strip',
    /RAIL_FULL_LENGTH_CLASS/.test(railPair) &&
      /leftRailPositionClasses/.test(railPair) &&
      /desktopFullRail/.test(palette) &&
      /desktopFullRail=\{mode !== 'game' && !isMobile\}/.test(view),
  );
}

{
  const popup = read('../../src/components/ErrorPopup.jsx');
  const view = read('../../src/components/Viewport.jsx');
  const app = read('../../src/App.jsx');
  check(
    '3: ErrorPopup always exposes data-error-undo',
    /data-error-undo=""/.test(popup) && /function ErrorPopup/.test(popup),
  );
  check(
    '3: Viewport error/soft-fail sites use ErrorPopup + onUndo',
    (view.match(/<ErrorPopup\b/g) || []).length >= 6 &&
      /onUndo=\{onUndo\}/.test(view) &&
      /canUndo=\{canUndo\}/.test(view),
  );
  check(
    '3: App game/upload error banners use ErrorPopup + handleUndo',
    (app.match(/<ErrorPopup\b/g) || []).length >= 4 &&
      /onUndo=\{handleUndo\}/.test(app) &&
      /canUndo=\{canUndo\(\)\}/.test(app),
  );
}

{
  const pairing = read('../../src/components/AgentBridgePairing.jsx');
  check(
    '4: local agent panel drops loopback helper copy',
    !/Approve each client/.test(pairing) && !/nothing pairs automatically/.test(pairing),
  );
  check(
    '4: pairing start button uses profile-panel text chrome',
    /data-ui-action="data-agent-bridge-start"/.test(pairing)
      && /text-chrome-text[\s\S]{0,400}data-ui-action="data-agent-bridge-start"|data-ui-action="data-agent-bridge-start"[\s\S]{0,400}text-chrome-text/.test(pairing),
  );
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll desktop ribbon / left rail / error Undo checks passed.');
