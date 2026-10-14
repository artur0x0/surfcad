#!/usr/bin/env node
/**
 * Workplane product slice — strip markers + plane-only contour mode + docs.
 *
 * - WORKPLANE begin/end markers + FEATURE_MARKER_KINDS + FeatureStrip Layers3
 * - composeHelperInsert('workplane') wraps markers and stays listable
 * - Contour entry 'workplane' + composeContourCommit plane-only path
 * - HelperInsertPalette routes Workplane into contour mode
 * - ContourModeChip / ContourModeRail expose plane-only UI
 * - docs/POPUP_STYLE.md + UI_MAP link
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  composeHelperInsert,
  WORKPLANE_BEGIN,
  WORKPLANE_END,
  emitPlaneFrameLiteral,
} from '../../src/utils/helperPaletteSnippets.js';
import { parseFeatureMarkers, FEATURE_MARKER_KINDS } from '../../src/utils/featureMarkers.js';
import {
  composeContourCommit,
  enterContourState,
  applyContourPlaneEdit,
  isWorkplaneEntry,
  isContourEntry,
  axisPresetFrame,
  planeCardCommit,
} from '../../src/utils/contourMode.js';
import { listConstructionPlanes } from '../../src/utils/savedContours.js';
import { offsetPlaneFrame } from '../../src/utils/makeLoft.js';

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

console.log('workplane strip + UI');

{
  const markers = read('../../src/utils/featureMarkers.js');
  const strip = read('../../src/components/FeatureStrip.jsx');
  const snippets = read('../../src/utils/helperPaletteSnippets.js');
  check('WORKPLANE markers exported', /export const WORKPLANE_BEGIN/.test(snippets));
  check(
    'FEATURE_MARKER_KINDS has workplane',
    FEATURE_MARKER_KINDS.some((k) => k.kind === 'workplane' && k.label === 'Workplane'),
  );
  check('FeatureStrip icon Layers3', /workplane:\s*Layers3/.test(strip));
  check('markers import WORKPLANE_', /WORKPLANE_BEGIN/.test(markers));
}

{
  const buf = composeHelperInsert('', 'workplane');
  check('insert wraps begin marker', buf.includes(WORKPLANE_BEGIN));
  check('insert wraps end marker', buf.includes(WORKPLANE_END));
  check('insert is literal PlaneFrame', /center:\s*\[/.test(buf) && /normal:\s*\[0,\s*0,\s*1\]/.test(buf));
  const feats = parseFeatureMarkers(buf);
  check(
    'parseFeatureMarkers → workplane chip',
    feats.length === 1 && feats[0].kind === 'workplane' && feats[0].chipLabel === 'Workplane',
    `kinds=${feats.map((f) => f.kind).join(',')}`,
  );
  const planes = listConstructionPlanes(buf);
  check('listed as construction plane', planes.length === 1 && planes[0].plane.normal[2] === 1);
}

{
  check('workplane is a contour entry', isContourEntry('workplane') && isWorkplaneEntry('workplane'));
  let state = enterContourState('workplane', null);
  check('enter state entry=workplane', state.entry === 'workplane' && state.planeOffset === 0);
  state = applyContourPlaneEdit(state, {
    preset: 'z',
    base: axisPresetFrame('z', [0, 0, 10]),
    angles: { x: 0, y: 0, z: 0 },
    offset: 5,
  });
  check('offset applied along normal', Math.abs(state.planeFace.center[2] - 15) < 1e-6);
  const face = state.planeFace;
  const result = composeContourCommit('', { entry: 'workplane', face });
  check('composeContourCommit workplane ok', result.ok && !result.run);
  check('commit has markers', result.buffer.includes(WORKPLANE_BEGIN));
  const planes = listConstructionPlanes(result.buffer);
  check('commit plane pickable', planes.length === 1 && Math.abs(planes[0].plane.center[2] - 15) < 1e-6);
}

{
  const base = axisPresetFrame('z', [1, 2, 3]);
  const off = offsetPlaneFrame(base, 4);
  check('offsetPlaneFrame shared helper', Math.abs(off.center[2] - 7) < 1e-6);
  const lit = emitPlaneFrameLiteral(off);
  check('literal emit has all axes', /center:/.test(lit) && /normal:/.test(lit) && /\bx:/.test(lit) && /\by:/.test(lit));
}

{
  const palette = read('../../src/components/HelperInsertPalette.jsx');
  check(
    'palette routes workplane into contour mode',
    /item\.id === 'workplane'/.test(palette)
      && /onEnterContourMode\(\{\s*entry:\s*'workplane'\s*\}\)/.test(palette),
  );
  const chip = read('../../src/components/ContourModeChip.jsx');
  check('chip has workplane-only branch', /isWorkplane/.test(chip) && /workplane-offset/.test(chip));
  const shell = read('../../src/components/FeatureSheet.jsx');
  const css = read('../../src/index.css');
  check('workplane chip uses the shared feature card', /<FeatureSheet\b/.test(chip) && /isWorkplane/.test(chip));
  check('feature card caps height at 22.5rem', /22\.5rem/.test(css) && /feature-sheet-card/.test(shell));
  const rail = read('../../src/components/ContourModeRail.jsx');
  const mode = read('../../src/utils/contourMode.js');
  const view = read('../../src/components/Viewport.jsx');
  const commit = planeCardCommit('workplane');
  check('Add plane writes from the card',
    commit.label === 'Add plane' && commit.writes === true && commit.rail === false
      && planeCardCommit('crossSection').rail === true
      && planeCardCommit('hole').label === 'Select plane'
      && /export function planeCardCommit/.test(mode)
      && /confirmLabel=\{cardCommit\.label\}/.test(chip));
  check('workplane has no left Plane rail',
    !/workplaneOnly/.test(rail)
      && /planeCardCommit\(contourMode\.entry\)\.rail/.test(view));
  const docs = read('../../docs/POPUP_STYLE.md');
  check('POPUP_STYLE.md documents ContourModeChip', /ContourModeChip/.test(docs) && /FilletModeChip/.test(docs));
  const uiMap = read('../../docs/UI_MAP.md');
  check('UI_MAP links POPUP_STYLE', /POPUP_STYLE\.md/.test(uiMap));
}

if (failed) {
  console.log(`\n${failed} workplane check(s) failed`);
  process.exit(1);
}
console.log('\nAll workplane strip/UI checks passed.');
