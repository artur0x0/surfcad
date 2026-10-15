#!/usr/bin/env node
/**
 * Slice Mobile C.1 — UI reorg + strip polish.
 *
 * A: face-selected popup gone.
 * B: edge-pick chip centered + raised (clear of right rail / home-indicator).
 * C: left palette height paired to right toolbar (bottom-2.5 + max-h 26rem).
 * D: feature sheets full-width horizontal under part name (CAD + Script).
 * E: per-type index badges; strip on right below ribbon; ribbon bg = editor.
 *
 * Non-goals: PWA (D), Fillet D/speed, AI-on-pill, Monaco replace.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';

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

console.log('mobile C.1: strip polish + UI reorg');

{
  const app = read('../../src/App.jsx');
  const sheet = read('../../src/components/FeatureEditSheet.jsx');
  const strip = read('../../src/components/FeatureStrip.jsx');
  const viewport = read('../../src/components/Viewport.jsx');
  const palette = read('../../src/components/HelperInsertPalette.jsx');
  const contourRail = read('../../src/components/ContourModeRail.jsx');
  const rightRail = read('../../src/components/CrossSectionPanel.jsx');
  const editor = read('../../src/components/CodeEditor.jsx');
  const markers = read('../../src/utils/featureMarkers.js');

  // A
  check(
    'A: face-selected popup removed (no data-face-info-popup / Selected Face chrome)',
    !/data-face-info-popup/.test(viewport) &&
      !/Selected Face/.test(viewport),
  );

  // B
  const edgeBlock = (() => {
    const i = viewport.indexOf("'data-edge-selector': 'standalone'");
    return i < 0 ? '' : viewport.slice(i, i + 450);
  })();
  check(
    'B: edge-pick chip is the feature card, not the old corner chip',
    /'data-edge-selector': 'standalone'/.test(viewport) &&
      /<FeatureSheet\b/.test(viewport) &&
      !/bottom-4 right-2/.test(edgeBlock) &&
      !/bottom-4 left-\[4\.5rem\]/.test(edgeBlock),
  );

  // C — left matches RIGHT toolbar exactly (shared RAIL_PAIR_HEIGHT_CLASS)
  const railPair = read('../../src/utils/railPair.js');
  check(
    'C: left palette bottom matches right rail (bottom-2.5) + content-max height',
    /bottom-2\.5/.test(palette) &&
      /RAIL_PAIR_HEIGHT_CLASS/.test(palette) &&
      /max-h-\[min\(26rem,calc\(100%-5\.5rem\)\)\]/.test(railPair) &&
      /data-rail-pair="left"/.test(palette) &&
      /data-rail-pair="right"/.test(rightRail) &&
      // The right rail is content-height now: 10 tools (~422px) did not fit
      // the shared 26rem cap, so Cross-section was cropped off the bottom.
      !/RAIL_PAIR_HEIGHT_CLASS/.test(rightRail) &&
      /max-h-\[calc\(100%-1\.25rem\)\]/.test(rightRail) &&
      /bottom-2\.5 right-2\.5/.test(rightRail) &&
      !/max-h-\[min\(72%/.test(palette),
  );
  check(
    'C: contour left rail uses the same content-max height',
    /data-rail-pair="left"/.test(contourRail) &&
      /RAIL_PAIR_HEIGHT_CLASS/.test(contourRail) &&
      /bottom-2\.5/.test(contourRail),
  );

  // D
  check(
    'D: feature edit sheet is the shared bottom card',
    /'data-feature-sheet-layout': 'feature-card'/.test(sheet) &&
      /<FeatureSheet\b/.test(sheet) &&
      /data-feature-card/.test(read('../../src/components/FeatureSheet.jsx')) &&
      !/under-title-horizontal/.test(sheet) &&
      !/rounded-t-2xl/.test(sheet),
  );
  check(
    'D: App opens the edit card from the phone and desktop viewers',
    /setFeatureSheet\(\{ mode: 'edit', feature \}\)/.test(app) &&
      /setFeatureSheet\(\{ mode: 'picker' \}\)/.test(app) &&
      !/isCadStage && featureSheet\?\.mode === 'edit'/.test(app) &&
      /featureEdit=\{appMode === 'game' \|\| \(useStages && !isCadStage\) \? null : featureSheet\}/.test(app) &&
      /featureEdit=\{appMode === 'game' \? null : featureSheet\}/.test(app) &&
      /<FeatureEditSheet\b/.test(viewport),
  );
  check(
    'D: Accept / Cancel / Edit script still present',
    /data-feature-sheet-accept/.test(sheet) &&
      /data-feature-sheet-cancel/.test(sheet) &&
      /data-feature-sheet-edit-script/.test(sheet),
  );

  // E
  check(
    'E: per-type index badges on FeatureStrip icons',
    /data-feature-type-badge/.test(strip) &&
      /data-feature-type-index/.test(strip) &&
      /typeIndex/.test(markers),
  );
  check(
    'E: feature strip still exposes vertical/right attrs (Script rail; CAD horizontal is C.2)',
    // Desktop seam uses side={stripSide}; Script default remains 'right'.
    /data-feature-strip-side=\{stripSide\}/.test(strip) &&
      /'right'/.test(strip) &&
      /data-feature-strip-orientation="vertical"/.test(strip) &&
      /data-cad-feature-strip/.test(app) &&
      /border-l border-chrome-border\/40/.test(strip),
  );
  check(
    'E: ribbon / top chrome bg matches code editor (chrome surface token)',
    /data-ribbon-bg="editor"/.test(editor) &&
      /bg-chrome-surface/.test(editor) &&
      /data-ribbon-bg="editor"[\s\S]{0,200}?bg-chrome-surface/.test(editor),
  );
}

{
  const script = `// --- contour-mode extrude begin ---
let part = placeInFrame(xs.plane, makeExtrude(xs.contours, 12), [0, 0, 0]);
// --- contour-mode extrude end ---
// --- contour-mode extrude begin ---
part = placeInFrame(xs.plane, makeExtrude(xs.contours, 5), [0, 0, 0]);
// --- contour-mode extrude end ---
// --- fillet-mode begin ---
part = filletAlongPath(part, path, 2);
// --- fillet-mode end ---
`;
  const features = parseFeatureMarkers(script);
  const extrudes = features.filter((f) => f.kind === 'extrude');
  const fillets = features.filter((f) => f.kind === 'fillet');
  check('typeIndex: two Extrudes are 1 then 2', extrudes[0]?.typeIndex === 1 && extrudes[1]?.typeIndex === 2);
  check('typeIndex: Fillet restarts at 1', fillets[0]?.typeIndex === 1);
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll mobile C.1 strip polish checks passed.');
