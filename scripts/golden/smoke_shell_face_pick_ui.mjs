#!/usr/bin/env node
/**
 * Shell face-pick UI — Contour/Loft-style chip; opening = face (not axis).
 *
 * - shellMode enter / validate / compose → hollow() + SHELL markers
 * - Face pick emits { center, normal }; several taps emit one hollow([...]); Closed emits 'none'
 * - Tap-to-add (no shift). Undo drops only the last face. Clear drops all.
 * - A later Shell replaces the block (no second hollow())
 * - HelperInsertPalette routes Shell into onEnterShellMode (not axis modal)
 * - ShellModeChip + Viewport / App wiring
 * - docs/ui-style-guide + ui-map mention ShellModeChip
 * - Strip chip kind `shell` still registered
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  composeHelperInsert,
  SHELL_BEGIN,
  SHELL_END,
} from '../../src/utils/helperPaletteSnippets.js';
import { parseFeatureMarkers, FEATURE_MARKER_KINDS } from '../../src/utils/featureMarkers.js';
import { classifySelectedFace } from '../../src/utils/faceFeaturePlacement.js';
import {
  enterShellState,
  validateShellAccept,
  composeShellCommit,
  hasShellBlock,
  isShellEntry,
  stripShellBlock,
  toggleShellFaceSelection,
  popLastShellFace,
  shellFaceKey,
} from '../../src/utils/shellMode.js';

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

console.log('shell face-pick UI');

{
  check('shell is a shell entry', isShellEntry('shell'));
  const markers = FEATURE_MARKER_KINDS.some((k) => k.kind === 'shell' && k.label === 'Shell');
  check('FEATURE_MARKER_KINDS has shell', markers);
  const strip = read('../../src/components/FeatureStrip.jsx');
  check('FeatureStrip icon PackageOpen', /shell:\s*PackageOpen/.test(strip));
}

{
  const pick = classifySelectedFace({
    center: [0, 0, 10],
    normal: [0, 0, 1],
    area: 400,
    triangleCount: 2,
    selectionMode: 'coplanar',
  });
  let state = enterShellState(pick);
  check('enter seeds face', state.lastFace?.normal?.[2] === 1);
  check('enter wall default 2.5', state.params.wall === 2.5);

  const empty = validateShellAccept(null, { wall: 2, openingMode: 'face' });
  check('face mode without pick refuses', !empty.ok);

  const closed = validateShellAccept(null, { wall: 2, openingMode: 'none' });
  check('Closed validates without face', closed.ok && closed.openScope === 'none');

  const faceGate = validateShellAccept(pick, { wall: 2.5, openingMode: 'face' });
  check('face pick validates', faceGate.ok && faceGate.openScope === 'selected');

  const faceCommit = composeShellCommit('', {
    face: pick,
    params: { wall: 2.5, openingMode: 'face' },
  });
  check('compose face ok', faceCommit.ok && faceCommit.run);
  check('compose has SHELL markers', faceCommit.buffer.includes(SHELL_BEGIN) && faceCommit.buffer.includes(SHELL_END));
  check(
    'compose emits face literal opening',
    /hollow\(\s*\w+,\s*2\.5,\s*\{\s*center:\s*\[0,\s*0,\s*10\],\s*normal:\s*\[0,\s*0,\s*1\]\s*\}\s*\)/.test(faceCommit.buffer),
    faceCommit.buffer,
  );
  const feats = parseFeatureMarkers(faceCommit.buffer);
  check(
    'parseFeatureMarkers → shell chip',
    feats.some((f) => f.kind === 'shell' && f.chipLabel === 'Shell'),
    `kinds=${feats.map((f) => f.kind).join(',')}`,
  );

  const closedCommit = composeShellCommit('', {
    params: { wall: 3, openingMode: 'none' },
  });
  check("Closed emits 'none'", /hollow\(\s*\w+,\s*3,\s*'none'\s*\)/.test(closedCommit.buffer), closedCommit.buffer);

  const appended = composeShellCommit(faceCommit.buffer, {
    face: pick,
    params: { wall: 1.5, openingMode: 'face' },
    commitMode: 'append',
  });
  check('later Shell replaces, does not append a second hollow',
    appended.ok && hasShellBlock(appended.buffer)
    && (appended.buffer.match(/hollow\s*\(/g) || []).length === 1
    && /hollow\(\s*\w+,\s*1\.5,/.test(appended.buffer),
    appended.buffer);

  const multi = classifySelectedFace({
    center: [0, 15, 0],
    normal: [0, 1, 0],
    area: 800,
    triangleCount: 2,
    selectionMode: 'coplanar',
    group: [
      { center: [0, 0, 10], normal: [0, 0, 1] },
      { center: [0, 15, 0], normal: [0, 1, 0] },
    ],
  });
  const multiCommit = composeShellCommit('', {
    face: multi,
    params: { wall: 2.5, openingMode: 'face' },
  });
  check('several picks are one Shell feature', multiCommit.ok
    && (multiCommit.buffer.match(/hollow\s*\(/g) || []).length === 1
    && (multiCommit.buffer.match(/shell begin/g) || []).length === 1);
  check(
    'several picks emit one hollow() array',
    /hollow\(\s*\w+,\s*2\.5,\s*\[\s*\{ center: \[0, 0, 10\], normal: \[0, 0, 1\] \},\s*\{ center: \[0, 15, 0\], normal: \[0, 1, 0\] \}\s*\]\s*\)/.test(multiCommit.buffer),
    multiCommit.buffer || multiCommit.message,
  );

  const replaced = composeShellCommit(faceCommit.buffer, {
    params: { wall: 4, openingMode: 'none' },
    commitMode: 'replace',
  });
  check('replace strips prior shell', (replaced.buffer.match(/hollow\s*\(/g) || []).length === 1
    && /hollow\(\s*\w+,\s*4,\s*'none'\s*\)/.test(replaced.buffer));
  check('stripShellBlock clears', !hasShellBlock(stripShellBlock(faceCommit.buffer)));
}

{
  const A = { center: [0, 0, 10], normal: [0, 0, 1], indices: [1] };
  const B = { center: [0, 15, 0], normal: [0, 1, 0], indices: [4, 5] };
  const C = { center: [20, 0, 0], normal: [1, 0, 0], indices: [8] };
  let picks = toggleShellFaceSelection([], A);
  picks = toggleShellFaceSelection(picks, B);
  picks = toggleShellFaceSelection(picks, C);
  check('tap adds without a modifier', picks.length === 3
    && shellFaceKey(picks[0]) === shellFaceKey(A)
    && shellFaceKey(picks[2]) === shellFaceKey(C));
  const toggled = toggleShellFaceSelection(picks, B);
  check('tap on a selected face removes only that face',
    toggled.length === 2
    && shellFaceKey(toggled[0]) === shellFaceKey(A)
    && shellFaceKey(toggled[1]) === shellFaceKey(C));
  const undone = popLastShellFace(picks);
  check('Undo drops only the last face',
    undone.length === 2
    && shellFaceKey(undone[0]) === shellFaceKey(A)
    && shellFaceKey(undone[1]) === shellFaceKey(B));
  check('second Undo leaves the first face',
    popLastShellFace(undone).length === 1
    && shellFaceKey(popLastShellFace(undone)[0]) === shellFaceKey(A));
}

{
  // Axis form still composes (worker API / goldens) — UI just does not offer it.
  const axis = composeHelperInsert('', 'shell', null, { wall: 2, openScope: 'z' });
  check("axis compose still works for API", /hollow\(\s*\w+,\s*2,\s*'z'\s*\)/.test(axis));
}

{
  const palette = read('../../src/components/HelperInsertPalette.jsx');
  check(
    'palette routes shell into shell mode',
    /item\.id === 'shell'/.test(palette)
      && /onEnterShellMode\(\{\s*entry:\s*'shell'\s*\}\)/.test(palette),
  );
  const chip = read('../../src/components/ShellModeChip.jsx');
  check('ShellModeChip exists', /data-shell-mode/.test(chip) && /shell-wall/.test(chip));
  check('shell card is the shared feature card; Face and Closed stay cyan',
    /<FeatureSheet\b/.test(chip)
    && /bg-cyan-600/.test(chip)
    && /onCancel=\{onDismiss\}/.test(chip)
    && /onConfirm=\{onConfirm\}/.test(chip)
    && /compact=\{compact\}/.test(chip));
  check('chip has Face / Closed segmented', /Opening/.test(chip) && /Closed/.test(chip));
  check('chip Undo drops the last face', /data-shell-undo/.test(chip) && />\s*Undo\s*</.test(chip));
  check('chip Clear drops every face', /data-shell-clear/.test(chip) && />\s*Clear\s*</.test(chip));
  check('shell chip does not ask for shift-click', !/shift-click/.test(chip) && !/shiftKey/.test(chip));

  const view = read('../../src/components/Viewport.jsx');
  check('game mounts no shell card', /shellMode && mode !== 'game'/.test(view));
  check('Viewport imports ShellModeChip', /import ShellModeChip/.test(view));
  check('Viewport enterShellMode', /enterShellMode/.test(view) && /onEnterShellMode=\{enterShellMode\}/.test(view));
  check('Viewport onCommitShell', /onCommitShell/.test(view) && /acceptShell/.test(view));
  check('Viewport shell confirm does not append another hollow',
    !/hasShellBlock\(buf\) \? 'append'/.test(view)
    && /commitMode: 'replace'/.test(view));
  check('shell taps use toggleShellFaceSelection, not shift',
    /toggleShellFaceSelection\(facePickGroupRef\.current\?\.picks/.test(view)
    && /popLastShellFace\(facePickGroupRef\.current\?\.picks\)/.test(view)
    && /Preserve shell face selection/.test(view));
  check('Clear publishes an empty face list',
    /onClearFace=\{\(\) => \{\s*publishFacePicks\(\[\]/.test(view));
  check('palette hidden in shell mode', /!shellMode/.test(view));

  const app = read('../../src/App.jsx');
  check('App handleCommitShell', /composeShellCommit/.test(app) && /onCommitShell=\{handleCommitShell\}/.test(app));

  const docs = read('../../docs/ui-style-guide.md');
  check('ui-style-guide documents ShellModeChip', /ShellModeChip/.test(docs));
  const uiMap = read('../../docs/ui-map.md');
  check('ui-map mentions ShellModeChip', /ShellModeChip/.test(uiMap));
}

if (failed) {
  console.log(`\n${failed} shell face-pick check(s) failed`);
  process.exit(1);
}
console.log('\nAll shell face-pick UI checks passed.');
