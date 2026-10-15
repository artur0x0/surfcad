#!/usr/bin/env node
/**
 * The script editor is hidden on the default CAD layout.
 * A part-row pencil opens it: a right drawer on desktop, a full-screen sheet
 * on the phone. Monaco stays mounted so feature writes still hit the model.
 * Closing uses the existing assembly build and does not schedule a second one.
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

console.log('hidden script editor, pencil drawer and sheet');

{
  const app = read('../../src/App.jsx');
  const feed = read('../../src/components/PartFeed.jsx');
  const drawer = read('../../src/components/ScriptEditorDrawer.jsx');
  const editor = read('../../src/components/CodeEditor.jsx');
  const toolbar = read('../../src/components/Toolbar.jsx');
  const view = read('../../src/components/Viewport.jsx');
  const close = read('../../src/utils/scriptEditorClose.js');
  const desk = app.slice(app.lastIndexOf('flex h-dvh bg-chrome-surface'));

  check('parts feed still precedes the desktop editor',
    (() => {
      const feedAt = desk.indexOf('data-parts-feed-placement="desktop-left"');
      const editorAt = desk.indexOf('<CodeEditor');
      return feedAt >= 0 && editorAt > feedAt;
    })());
  check('desktop CAD editor is not a split column',
    /appMode === 'game' && \([\s\S]{0,120}splitPct/.test(desk)
    && /<ScriptEditorDrawer/.test(desk)
    && !/scriptEditorOpen &&[\s\S]{0,40}<CodeEditor/.test(desk));
  check('drawer is on the right, under the ribbon, and stays mounted',
    /data-script-drawer-side="right"/.test(drawer)
    && /data-script-drawer-clearance="below-feature-ribbon"/.test(drawer)
    && /data-script-drawer-resize/.test(drawer)
    && /invisible pointer-events-none/.test(drawer)
    && /open \? '' : 'invisible/.test(drawer));
  const toggle = read('../../src/components/MobileStageToggle.jsx');
  const stage = read('../../src/utils/mobileStage.js');
  check('phone script stage is a full-screen sheet with an arrow back to parts',
    /data-script-sheet/.test(app)
    && /data-script-editor-close/.test(editor)
    && /isScriptStage \? 'z-40'/.test(app)
    && /aria-label=\{isMobile \? 'Back to parts' : 'Back to CAD'\}/.test(editor)
    && /ArrowLeft/.test(editor)
    && /h-11 w-11/.test(editor)
    && !/font-medium">CAD</.test(editor)
    && /setMobileStageSticky\('parts', \{ sync: false \}/.test(app));
  check('a stored or linked script stage opens Parts, and the pill has no script button',
    /A stored Script stage is not the landing view/.test(app)
    && /landingMobileStage/.test(app)
    && /named === 'script' \|\| named === 'parts'/.test(stage)
    && /data-stage-btn="cad"/.test(toggle)
    && /data-stage-btn="parts"/.test(toggle)
    && !/data-stage-btn="script"/.test(toggle));
  check('pencil on each part row uses the blue accent',
    /data-part-edit-script=\{row\.id\}/.test(feed)
    && /<Pencil size=\{16\}/.test(feed)
    && /text-blue-400/.test(feed)
    && /onEditScript=\{openPartScript\}/.test(app));
  check('open activates the part, close uses the existing build once',
    /const openPartScript = \(id\) => \{[\s\S]*?handleSelectPart\(id\)[\s\S]*?setScriptEditorOpen\(true\)/.test(app)
    && /shouldRebuildOnEditorClose/.test(app)
    && /lastAssemblyScriptRef/.test(app)
    && /pendingAutoRunRef/.test(app)
    && /export function shouldRebuildOnEditorClose/.test(close));
  check('boot guards stay: open lock, editor live flag, 600ms, no demo paint',
    /assemblyOpenLockRef\.current/.test(app)
    && /editorLiveRef\.current/.test(app)
    && /\}, 600\);/.test(app)
    && !/setEditorInitialScript\(DEFAULT_SCRIPT\)/.test(app));
  check('io tray is gone; upload and download are on the parts ribbon; order is the part row',
    !/data-cad-io-tray/.test(view)
    && !/chrome="io"/.test(view)
    && !/chrome === 'io'/.test(toolbar)
    && !/data-script-upload/.test(toolbar)
    && !/data-script-download/.test(toolbar)
    && /data-part-upload/.test(feed)
    && /data-part-download/.test(feed)
    && /data-script-upload/.test(feed)
    && /data-script-download/.test(feed)
    && !/Get Quote/.test(toolbar)
    && !/onQuote/.test(toolbar)
    && /data-part-order=\{row\.id\}/.test(feed)
    && !/Play match-the-part puzzle/.test(toolbar)
    && !/onStartGame/.test(toolbar)
    && /PuzzleUnlock/.test(view)
    && /data-cad-run/.test(toolbar)
    && /data-cad-select-all/.test(toolbar));
  check('editor ribbon still hosts the full CAD strip',
    /data-cad-toolbar-host/.test(editor)
    && /variant="strip"/.test(view));
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nHidden script editor checks passed.');
