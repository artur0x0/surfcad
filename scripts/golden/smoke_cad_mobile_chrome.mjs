#!/usr/bin/env node
/**
 * CAD chrome uses the puzzle shell:
 * viewport on top (phone), Monaco in the bottom budget, keyboard pin for both modes,
 * CAD actions in the mid-strip (not a viewport overlay), right rail vertical.
 * Game strip stays inline in CodeEditor. Desktop CAD now matches phone: the strip
 * is portaled above the editor in BOTH shells and no overlay toolbar is left.
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

console.log('cad mobile chrome harmonized to puzzle');

{
  const app = read('../../src/App.jsx');
  check('phone editor is not a top 33vh pane', !/h-\[33vh\]/.test(app));
  check(
    'keyboard pin is not game-only',
    !/appMode === 'game' && keyboardOpen/.test(app),
  );
  check(
    'shell drops h-dvh only while the keyboard is open',
    /keyboardOpen \? '' : 'h-dvh'/.test(app),
  );
  check(
    'bottom budget matches the puzzle fractions',
    /vv\.height \* 0\.36/.test(app) && /vv\.height \* 0\.32/.test(app),
  );
  check(
    'game still mounts a blank editor',
    /initialScript=\{appMode === 'game' \? '' : editorInitialScript\}/.test(app),
  );
  // The AI row is hidden while a tighter editor integration is designed, but it
  // must stay MOUNTED (state + handlers intact), not deleted.
  check('AI prompt is still mounted on mobile CAD', /<PromptInput/.test(app));
  check(
    'AI prompt is hidden in both shells',
    (app.match(/data-ai-prompt-row="hidden"/g) || []).length === 2,
  );
}

{
  const view = read('../../src/components/Viewport.jsx');
  const editor = read('../../src/components/CodeEditor.jsx');
  const toolbar = read('../../src/components/Toolbar.jsx');
  const panel = read('../../src/components/CrossSectionPanel.jsx');
  const toggle = read('../../src/components/MobileStageToggle.jsx');

  check(
    'phone mode toggle is CAD and Parts, with no script button',
    /data-stage-btn="cad"/.test(toggle)
    && /data-stage-btn="parts"/.test(toggle)
    && !/data-stage-btn="script"/.test(toggle)
    && !/SquareText/.test(toggle),
  );

  check('right rail is vertical in both shells', /verticalRail\s*\n/.test(view));
  check('no CAD overlay toolbar is left anywhere', !/variant="overlay"/.test(view));
  // Gate is the call-site, not the createPortal import. The Toolbar prop list
  // between variant="strip" and the host argument is longer than 400 chars.
  check(
    'CAD portals the strip into the editor host in both shells',
    /mode !== 'game' && cadToolbarHost && createPortal\(/.test(view) &&
    /variant="strip"[\s\S]{0,1200}?cadToolbarHost,?\s*\)/.test(view),
  );
  check('shared title chip', /function ViewportTitleChip/.test(view));
  check(
    'game title still falls back to Puzzle',
    /<ViewportTitleChip>\{gamePuzzleTitle \|\| 'Puzzle'\}<\/ViewportTitleChip>/.test(view),
  );
  check(
    'game strip still inline in the editor',
    /mode="game"/.test(editor) && /variant="strip"/.test(editor),
  );
  check('editor hosts the CAD strip in both shells', /showCadStrip = !isGame && typeof onCadToolbarHost/.test(editor));
  check('CAD strip uses the dark mid-strip shell', /data-toolbar-variant="strip"/.test(toolbar));
  check('CAD has no collapse chevron at all', !/isCollapsed/.test(toolbar));
  check(
    'vertical rail still has Face and Edge',
    /onPickModeChange\('face'\)/.test(panel) && /onPickModeChange\('edge'\)/.test(panel),
  );
  check(
    'vertical rail selector gap',
    /data-selector-group="pick-mode"/.test(panel) && /flex gap-1/.test(panel),
  );
  check(
    'view snaps need no alignment prop — the menu always flies left',
    /<ViewSnapControl onSnap=\{onSnapView\} \/>/.test(panel) && !/popupAlign/.test(panel),
  );
  check(
    'filename chip shows in both CAD shells (no toolbar carries it now)',
    /mode !== 'game' && \([\s\S]{0,900}onRename=\{onRenameFile\}/.test(view)
    && /onTitleAssemblyActivate/.test(view),
  );
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll CAD mobile chrome checks passed.');
