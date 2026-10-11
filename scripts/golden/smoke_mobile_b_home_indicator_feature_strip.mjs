#!/usr/bin/env node
/**
 * Slice Mobile B — home-indicator stage pill + Script-stage feature strip.
 *
 * Top CAD|Script text chrome is gone. Bottom glass pill with two icons
 * switches CAD ↔ Parts (session sticky). The script editor opens from a
 * part pencil, not this pill. Script stage shows a chip strip
 * over marked Contour/Extrude/Fillet/… blocks; chips jump Monaco caret.
 * AI-on-pill-tap is hook-only (not wired). Desktop + game unchanged.
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

console.log('mobile B: home-indicator + feature strip');

{
  const app = read('../../src/App.jsx');
  const toggle = read('../../src/components/MobileStageToggle.jsx');
  const strip = read('../../src/components/FeatureStrip.jsx');
  const markers = read('../../src/utils/featureMarkers.js');
  const editor = read('../../src/components/CodeEditor.jsx');
  const filletChip = read('../../src/components/FilletModeChip.jsx');

  check(
    'top stage chrome bar is gone',
    !/data-mobile-stage-chrome/.test(app),
  );
  check(
    'home-indicator mount site exists at bottom of stage shell',
    /data-mobile-stage-home-indicator/.test(app) &&
      /<MobileStageToggle stage=\{mobileStage\} onChange=\{setMobileStageSticky\} \/>/.test(app),
  );
  check(
    'pill is a home-indicator with glass chip + CAD and Parts icons',
    /data-home-indicator/.test(toggle) &&
      /data-home-indicator-pill/.test(toggle) &&
      /surface-glass-chip/.test(toggle) &&
      /data-stage-dot="cad"/.test(toggle) &&
      /data-stage-dot="parts"/.test(toggle) &&
      !/data-stage-dot="script"/.test(toggle),
  );
  check(
    'pill keeps CAD/Parts hit targets + pressed a11y, and no script button',
    /data-stage-btn="cad"/.test(toggle) &&
      /data-stage-btn="parts"/.test(toggle) &&
      !/data-stage-btn="script"/.test(toggle) &&
      /aria-pressed=\{isCad\}/.test(toggle) &&
      /aria-pressed=\{isParts\}/.test(toggle),
  );
  check(
    'safe-area inset padding on home indicator',
    /safe-area-inset-bottom/.test(toggle),
  );
  check(
    'AI prompt hook is present but inert (comment + data attr; no AI onClick)',
    /data-ai-prompt-hook/.test(toggle) &&
      /Future AI prompt/.test(toggle) &&
      !/import\s+.*PromptInput/.test(toggle) &&
      !/onClick=\{[^}]*[Aa][Ii]/.test(toggle),
  );
  check(
    'session sticky key unchanged',
    /3dculos\.mobileStage/.test(app),
  );
  check(
    'FeatureStrip mounts in Script stage (caret jump)',
    /isScriptStage && \(/.test(app) &&
      /handleFeatureStripJump/.test(app) &&
      /<FeatureStrip[\s\S]*?script=\{currentScript\}/.test(app),
  );
  check(
    'feature marker parser covers Contour/Extrude/Fillet kinds',
    /CONTOUR_EXTRUDE_BEGIN/.test(markers) &&
      /FILLET_MODE_BEGIN/.test(markers) &&
      /parseFeatureMarkers/.test(markers) &&
      /FEATURE_MARKER_KINDS/.test(markers),
  );
  check(
    'FeatureStrip merges named contours onto the marker chips',
    /featuresWithContours/.test(strip) &&
      /data-feature-strip/.test(strip) &&
      /data-feature-chip/.test(strip) &&
      /data-contour-id/.test(strip),
  );
  check(
    'CodeEditor exposes revealRange for strip jumps',
    /revealRange:\s*\(startOffset,\s*endOffset\)/.test(editor) &&
      /revealRangeInCenter/.test(editor),
  );
  check(
    'App wires strip jump → revealRange',
    /handleFeatureStripJump/.test(app) &&
      /codeEditorRef\.current\?\.revealRange\?/.test(app),
  );
  const sheetLayout = read('../../src/utils/featureSheetLayout.js');
  check(
    'Contour and Fillet cards dock to the pane bottom while open',
    /FEATURE_SHEET_BOTTOM_PHONE_DOCKED = '0px'/.test(sheetLayout)
      && /compact \? FEATURE_SHEET_BOTTOM_PHONE_DOCKED/.test(sheetLayout)
      && /30px \+ max\(8px, env\(safe-area-inset-bottom, 0px\)\) \+ 10px/.test(sheetLayout)
      && /<FeatureSheet\b/.test(filletChip),
  );
  check(
    'FeatureStrip mobile mounts intact (2 stage mounts + optional desktop seam)',
    // Slice C: CAD + Script = 2. Desktop seam may add a 3rd mount outside mobile.
    (() => {
      const n = (app.match(/<FeatureStrip\b/g) || []).length;
      const hasMobileCad = /data-cad-feature-strip/.test(app);
      const hasMobileScript = /data-script-feature-strip/.test(app);
      return n >= 2 && n <= 3 && hasMobileCad && hasMobileScript;
    })(),
  );
  check(
    'game branch has no home-indicator (useStages-gated)',
    /data-mobile-stage-home-indicator/.test(app) &&
      /useStages \? \(/.test(app),
  );
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll mobile B home-indicator + feature strip checks passed.');
