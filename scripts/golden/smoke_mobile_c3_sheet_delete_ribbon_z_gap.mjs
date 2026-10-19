#!/usr/bin/env node
/**
 * Slice Mobile C.3 polish —
 * 1) Feature sheet Delete (remove marked block + Auto-Run + close; stay on stage)
 * 2) Script: ribbon z-order above feature strip
 * 3) CAD: ~2× gap between part name and feature strip (top-14 → top-20)
 * 4) Rail caption Shapes → Block
 * 5) Left/right toolbars exact shared height (RAIL_PAIR_HEIGHT_CLASS)
 *
 * 6) HARD CR sibling: smoke_mobile_c3_roundedbox_fillet_tangent.mjs
 *    (real roundedBox Tangent-on rim flood — do not ship without it).
 *
 * Non-goals: PWA (D), Fillet D/speed, AI-on-pill.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  deleteFeatureBlock,
  writeFeatureSheetParams,
  listFeatureSheetTargets,
} from '../../src/utils/featureSheetWriteback.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';
import {
  RAIL_PAIR_HEIGHT_CLASS,
  RAIL_PAIR_HEIGHT_ATTR,
} from '../../src/utils/railPair.js';

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

console.log('mobile C.3: sheet delete + ribbon z + CAD gap + Block + rail height');

{
  const app = read('../../src/App.jsx');
  const sheet = read('../../src/components/FeatureEditSheet.jsx');
  const writeback = read('../../src/utils/featureSheetWriteback.js');
  const editor = read('../../src/components/CodeEditor.jsx');
  const palette = read('../../src/components/HelperInsertPalette.jsx');
  const contourRail = read('../../src/components/ContourModeRail.jsx');
  const rightRail = read('../../src/components/CrossSectionPanel.jsx');
  const railPair = read('../../src/utils/railPair.js');

  // 1 — Delete
  check(
    'FeatureSheet has Delete control (data-feature-sheet-delete)',
    /data-feature-sheet-delete/.test(sheet) &&
      /Trash2/.test(sheet) &&
      />\s*Delete\s*</.test(sheet) &&
      /onDelete/.test(sheet),
  );
  check(
    'deleteFeatureEdit + App wires onDelete + Auto-Run',
    /export function deleteFeatureBlock/.test(writeback) &&
      // The sheet delete uses deleteFeatureEdit (same as the edit dialog) so a
      // dangling `return part;` is dropped on an empty part.
      /deleteFeatureEdit\(buf, live\)/.test(app) &&
      /handleFeatureSheetDelete/.test(app) &&
      /onFeatureEditDelete=\{handleFeatureSheetDelete\}/.test(app) &&
      /applyBuffer\?\.\(/.test(app) &&
      /handleGameRun/.test(app),
  );
  check(
    'Delete does not force Script stage (Edit script still does)',
    /handleFeatureSheetEditScript/.test(app) &&
      /setMobileStageSticky\('script'\)/.test(app) &&
      !/handleFeatureSheetDelete[\s\S]{0,500}setMobileStageSticky\('script'\)/.test(app),
  );
  check(
    'Accept / Cancel still present',
    /data-feature-sheet-accept/.test(sheet) &&
      /data-feature-sheet-cancel/.test(sheet),
  );

  // 2 — Script ribbon / strip (C.3 z-order; C.4 overflow clip + taller spacer + strip z-20)
  check(
    'Script/desktop strip sits below measured ribbon (C.4 overlay or seam spacer)',
    /data-script-feature-strip/.test(app) &&
      /data-feature-strip-below-ribbon/.test(app) &&
      /data-feature-strip-ribbon-spacer-h="measured"/.test(app) &&
      (/style=\{\{ top: ribbonPx \}\}/.test(app) || /style=\{\{ height: ribbonPx \}\}/.test(app)) &&
      /data-editor-ribbon/.test(editor) &&
      /relative z-30/.test(editor),
  );

  // 3 — CAD gap ~2× (top-20 vs prior top-14)
  check(
    'CAD strip under-ribbon gap doubled (top-20 + name-2x attr)',
    /data-cad-feature-strip/.test(app) &&
      /data-feature-strip-gap="name-2x"/.test(app) &&
      /top-20 z-20/.test(app) &&
      !/left-2 right-2 top-14 z-20/.test(app),
  );

  // 4 — Shapes → Block
  check(
    'Rail caption Primitives → Block (not Shapes)',
    /Primitives:\s*'Block'/.test(palette) &&
      !/Primitives:\s*'Shapes'/.test(palette),
  );

  // 5 — Exact shared rail height
  check(
    'RAIL_PAIR_HEIGHT_CLASS is content-max (max-h, not fixed h)',
    /RAIL_PAIR_HEIGHT_CLASS = 'rail-max-below-strip'/.test(railPair) &&
      !/^export const RAIL_PAIR_HEIGHT_CLASS = 'h-\[/.test(railPair) &&
      RAIL_PAIR_HEIGHT_ATTR === 'content-max' &&
      RAIL_PAIR_HEIGHT_CLASS.includes('rail-max-below-strip'),
  );
  check(
    'Left + contour rails use RAIL_PAIR_HEIGHT_CLASS content-max (right stays free)',
    /leftRailPositionClasses/.test(palette) &&
      /leftRailPositionClasses/.test(contourRail) &&
      !/RAIL_PAIR_HEIGHT_CLASS/.test(rightRail) &&
      /data-rail-height/.test(palette) &&
      /data-rail-height/.test(rightRail),
  );
}

{
  console.log('\ndeleteFeatureBlock behavior');
  const script = `// --- contour-mode profile begin ---
const xs = makeCrossSection({ center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileRectangle(30, 20, true));
// --- contour-mode profile end ---

// --- contour-mode extrude begin ---
let part = placeInFrame(xs.plane, makeExtrude(xs.contours, 12), [0, 0, 0]);
// --- contour-mode extrude end ---

// --- fillet-mode begin ---
part = filletAlongPath(part, path, 2);
// --- fillet-mode end ---

return part;
`;
  const features = parseFeatureMarkers(script);
  const ext = features.find((f) => f.kind === 'extrude');
  const del = deleteFeatureBlock(script, ext);
  check('delete Extrude ok', del.ok === true && del.run === true);
  check('delete removes extrude markers', !/extrude begin/.test(del.buffer) && !/extrude end/.test(del.buffer));
  check('delete keeps profile + fillet + return',
    /profile begin/.test(del.buffer) &&
      /fillet-mode begin/.test(del.buffer) &&
      /return part/.test(del.buffer));
  check('remaining markers are profile+fillet',
    parseFeatureMarkers(del.buffer).map((f) => f.kind).join(',') === 'profile,fillet');

  // Accept still works on a sibling feature after delete path is separate
  const fil = features.find((f) => f.kind === 'fillet');
  const written = writeFeatureSheetParams(script, fil, { radius: 4 });
  check('Accept writeback still works alongside delete util',
    written.ok && /filletAlongPath\([^,]+, [^,]+, 4\)/.test(written.buffer));

  check('listFeatureSheetTargets still parses', listFeatureSheetTargets(script).length === 3);
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll mobile C.3 polish checks passed.');
