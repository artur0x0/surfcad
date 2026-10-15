#!/usr/bin/env node
/**
 * Part rename with two parts: the rename lands on the part that was clicked.
 *
 * Picking a face, edge or body on another part in the viewer moves the CAD
 * selection (cadPartId) and the viewer title to that part, but leaves the
 * editor's activeId on the first part. The title chip's rename wrote to
 * activeId, so renaming "Beta" from the title renamed "Alpha" instead.
 *
 * Checks the pure target / rename helpers on a two-part doc, replays the
 * reported sequence through them, and checks the wiring: the viewer title
 * renames renameTargetId(doc, cadPartId); a Parts feed row renames its own id;
 * clicking the active row brings the title back to that part.
 */
import { readFileSync } from 'node:fs';
import {
  feedRows,
  formatViewerTitle,
  renamePart,
  renameTargetId,
  sanitizePartName,
  serializeAssembly,
} from '../../src/utils/assembly.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}
const names = (doc) => doc.parts.map((p) => `${p.id}:${p.name}`).join(' ');

console.log('part rename target — two parts, rename lands on the clicked part');

const base = serializeAssembly({
  version: 1,
  source: 'local',
  name: 'Asm',
  activeId: 'p1',
  parts: [
    { id: 'p1', name: 'Alpha', visible: true, order: 0, position: [-20, 0, 0] },
    { id: 'p2', name: 'Beta', visible: true, order: 1, position: [20, 0, 0] },
  ],
});

// ── Target ─────────────────────────────────────────────────────
check('nothing picked → the active part', renameTargetId(base, null) === 'p1');
check('Beta picked in the viewer (active stays Alpha) → Beta', renameTargetId(base, 'p2') === 'p2');
check('Alpha picked → Alpha', renameTargetId(base, 'p1') === 'p1');
check('a stale pick (deleted part) → the active part', renameTargetId(base, 'gone') === 'p1');
check('no doc → null', renameTargetId(null, 'p2') === null);

// ── Rename one part by id ──────────────────────────────────────
{
  const out = renamePart(base, 'p2', 'Bracket');
  check('renaming p2 changes only p2', names(out) === 'p1:Alpha p2:Bracket', names(out));
  check('activeId and assembly name untouched', out.activeId === 'p1' && out.name === 'Asm');
  check('the input doc is not mutated', names(base) === 'p1:Alpha p2:Beta');
  const out1 = renamePart(base, 'p1', 'Base');
  check('renaming p1 changes only p1', names(out1) === 'p1:Base p2:Beta', names(out1));
  check('a blank name is a no-op', renamePart(base, 'p2', '   ') === base);
  check('an unknown id is a no-op', renamePart(base, 'nope', 'X') === base);
  check('names are sanitized like the title chip', renamePart(base, 'p2', ' a/b:c  d ').parts[1].name === 'abc d'
    && sanitizePartName('x'.repeat(80)).length === 60);
}

// ── The reported sequence, through the helpers ─────────────────
{
  // App state: doc + cadPartId (what the title shows) + currentFilename.
  let doc = base;
  let cadPartId = null;
  const title = () => formatViewerTitle(
    doc.parts.find((p) => p.id === renameTargetId(doc, cadPartId))?.name, doc.name,
  ).text;
  const renameFromTitle = (name) => { doc = renamePart(doc, renameTargetId(doc, cadPartId), name); };
  const renameRow = (id, name) => { doc = renamePart(doc, id, name); };

  renameFromTitle('Alpha 2');
  check('title rename with nothing picked → Alpha', names(doc) === 'p1:Alpha 2 p2:Beta', names(doc));
  cadPartId = 'p2'; // pick Beta in the viewer; activeId stays p1
  check('title shows Beta after the pick', /^Beta\b/.test(title()), title());
  renameFromTitle('Beta 2');
  check('title rename after picking Beta → Beta (Alpha kept)', names(doc) === 'p1:Alpha 2 p2:Beta 2', names(doc));
  cadPartId = 'p1';
  renameFromTitle('Alpha 3');
  check('back on Alpha → Alpha', names(doc) === 'p1:Alpha 3 p2:Beta 2', names(doc));
  renameRow('p2', 'Beta 3');
  check('feed row rename on Beta → Beta whatever is active', names(doc) === 'p1:Alpha 3 p2:Beta 3', names(doc));
  check('feed rows show both names', feedRows(doc, {}, {}).map((r) => r.name).join(',') === 'Alpha 3,Beta 3');
}

// ── Wiring ─────────────────────────────────────────────────────
{
  const app = read('src/App.jsx');
  const i = app.indexOf('const handleRenamePart');
  const block = app.slice(i, app.indexOf('const handleRenameAssembly', i));
  check('App has handleRenamePart(id, name) using renamePart', i > 0 && /renamePart\(doc, id, nextName\)/.test(block));
  check('title rename targets the shown part (cadPartId)',
    /const handleRenameFile[\s\S]{0,300}renameTargetId\(doc, cadPartIdRef\.current\)[\s\S]{0,300}handleRenamePart\(id, name\)/.test(block));
  check('title rename no longer writes to activeId',
    !/part\.id === doc\.activeId \? \{ \.\.\.part, name/.test(app));
  check('the title follows a rename of the part it shows',
    /renameTargetId\(nextDoc, cadPartIdRef\.current\) === id\)[\s\S]{0,120}setCurrentFilename/.test(block));
  const sel = app.slice(app.indexOf('const handleSelectPart'), app.indexOf('const handlePickRetarget'));
  check('clicking the active row brings the title back to it',
    /if \(id === doc\.activeId\) \{[\s\S]{0,200}setCurrentFilename\(partNow\?\.name/.test(sel));
  check('App passes onRenamePart to the Parts feed', /onRenamePart=\{handleRenamePart\}/.test(app));
  check('the viewer title chip renames on double-click via onRenameFile',
    /onRename=\{onRenameFile\}/.test(read('src/components/Viewport.jsx'))
    && /renameOnDoubleClick/.test(read('src/components/Viewport.jsx')));
  check('the viewer assembly chip enters assembly mode, not rename',
    /onTitleAssemblyActivate/.test(read('src/components/Viewport.jsx'))
    && /onTitleAssemblyActivate=\{handleTitleAssemblyActivate\}/.test(read('src/App.jsx')));
  const feed = read('src/components/PartFeed.jsx');
  check('feed row name is a rename control for that row',
    /function RowPartName/.test(feed) && /onRename\?\.\(id, next\)/.test(feed)
      && /<RowPartName\s+id=\{row\.id\}/.test(feed));
  check('double-click / F2 edits, single click still selects',
    /onDoubleClick=\{onRename \?/.test(feed) && /event\.key === 'F2'/.test(feed)
      && /onClick=\{\(\) => onSelect\?\.\(row\.id\)\}/.test(feed));
  check('typing in the row input does not select, drag or leak hotkeys',
    /data-part-name-input=\{id\}/.test(feed) && /draggable=\{renamingId !== row\.id\}/.test(feed));
  const arch = read('docs/architecture.md');
  check('architecture.md documents rename targeting', /renameTargetId/.test(arch)
    && /golden:part-rename-target/.test(arch));
}

if (failed) {
  console.log(`\npart rename target: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\npart rename target: all checks passed');
process.exit(0);
