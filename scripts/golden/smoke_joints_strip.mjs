#!/usr/bin/env node
/**
 * Joints on the CAD feature strips, the shared sticky-pick card, and
 * the floating tags. Screenshots are not written.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { serializeAssembly } from '../../src/utils/assembly.js';
import { composeMoveCommit } from '../../src/utils/moveMode.js';
import { refreshAssemblyJoints } from '../../src/joints/refreshJoints.js';
import {
  acceptJointPick,
  applyJointCard,
  cardFromJoint,
  dismissJointEdit,
  draftFromPicks,
  emptyClickCadSelection,
  jointChips,
  jointsChromeMounted,
  seedAssemblyHistory,
  stripUndoTarget,
  suggestJointType,
  undoJointStrip,
} from '../../src/joints/jointUi.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const A = '2026-10-10-03-00-00-0001-aaaa';
const B = '2026-10-10-03-00-00-0002-bbbb';
const J = '2026-10-10-03-00-00-0003-cccc';

const planar = (surfId, name, at, n) => ({
  surfId,
  partName: name,
  kind: 'face',
  planar: true,
  key: { at, n, area: 1 },
});
const axle = (surfId, name) => ({
  surfId,
  partName: name,
  kind: 'axis',
  axis: true,
  planar: false,
  key: { at: [0, 0, 0], dir: [0, 0, 1], radius: 2 },
});

const faces = [planar(A, 'Shaft', [0, 0, 1], [0, 0, 1]), planar(B, 'Housing', [0, 0, -1], [0, 0, -1])];
check('two planar faces suggest coincident', suggestJointType(faces) === 'coincident');
check('two axes suggest concentric', suggestJointType([axle(A, 'Shaft'), axle(B, 'Housing')]) === 'concentric');
check('two-face flow does not suggest fixed', suggestJointType(faces) !== 'fixed');
const same = acceptJointPick([faces[0]], planar(A, 'Shaft', [0, 0, -1], [0, 0, -1]));
check('a second face on the same part stays grouped', !same.refuse && same.picks.length === 2 && same.picks.every((pick) => pick.surfId === A));

const parts = [
  { id: 'a.js', name: 'Shaft', visible: true, order: 0, surfId: A, position: [0, 0, 0] },
  { id: 'b.js', name: 'Housing', visible: true, order: 1, surfId: B, position: [0, 0, 5], placement: { t: [0, 0, 5], q: [0, 0, 0, 1] } },
];
const doc = { version: 1, source: 'local', name: 'Assembly', activeId: 'a.js', parts };
const scripts = { 'a.js': 'let part = cube([20, 20, 20]);\nreturn part;\n' };
const card = draftFromPicks(null, [
  planar(A, 'Shaft', [0, 0, 0.5], [0, 0, 1]),
  planar(B, 'Housing', [0, 0, -0.5], [0, 0, -1]),
], { joints: [] });
check('dismiss writes nothing', dismissJointEdit(doc) === doc);
const confirmed = applyJointCard({
  doc,
  scripts,
  card,
  catalogs: {
    [A]: { faces: [{ at: [0, 0, 0.5], n: [0, 0, 1], area: 1 }] },
    [B]: { faces: [{ at: [0, 0, -0.5], n: [0, 0, -1], area: 1 }] },
  },
});
check('confirm writes a joint and no script', confirmed.ok && confirmed.scripts === scripts && confirmed.doc.joints.length === 1, confirmed.message || '');
const removed = applyJointCard({
  doc: confirmed.doc,
  scripts,
  card: { mode: 'edit', id: confirmed.doc.joints[0].id },
  action: 'delete',
});
check('delete removes the joint', removed.ok && removed.scripts === scripts && !serializeAssembly(removed.doc).joints);

const undone = undoJointStrip({
  history: seedAssemblyHistory(doc),
  doc: confirmed.doc,
  scripts,
});
check('undo with no earlier joint step leaves scripts', undone.scripts === scripts && undone.changed === false);
const pushed = {
  commits: [
    { joints: [], placements: {} },
    { joints: confirmed.doc.joints, placements: { [B]: { t: [0, 0, 5], q: [0, 0, 0, 1] } } },
  ],
  head: 1,
};
const back = undoJointStrip({ history: pushed, doc: confirmed.doc, scripts });
check('strip undo while no part is selected restores joints', back.changed && back.scripts === scripts && !back.doc.joints);
check('strip undo with a part selected stays on that stack', stripUndoTarget('a.js') === 'part' && stripUndoTarget(null) === 'joint');
const cleared = emptyClickCadSelection({ cadPartId: 'b.js', activeId: 'a.js' });
check('empty click clears cadPartId and leaves activeId', cleared.cadPartId == null && cleared.activeId === 'a.js');
check('game mode renders no joint card', jointsChromeMounted({ appMode: 'game' }) === false);

const moved = composeMoveCommit(scripts['a.js'], {
  direction: 'xyz', dx: 10, dy: 0, dz: 0, target: { at: [10, 10, 10] }, body: 'part',
});
const joint = {
  id: J, name: 'Coincident 1', type: 'coincident', opposed: true,
  a: { part: A, kind: 'face', key: { at: [0, 0, 0.5], n: [0, 0, 1], area: 1 } },
  b: { part: B, kind: 'face', key: { at: [0, 0, -0.5], n: [0, 0, -1], area: 1 } },
};
const joined = { ...doc, joints: [joint] };
const seedT = joined.parts[1].placement.t.slice();
const broken = refreshAssemblyJoints({
  doc: joined,
  catalogs: {
    [A]: { faces: [{ at: [10, 0, 0.5], n: [0, 0, 1], area: 1 }] },
    [B]: { faces: [{ at: [0, 0, -0.5], n: [0, 0, -1], area: 1 }] },
  },
});
check('Move Body of 10 mm is the only script change', moved.ok && (moved.buffer.match(/\bmove\s*\(/g) || []).length === 1 && !scripts['a.js'].includes('move('));
check('that move marks the joint broken and leaves placement', broken.statuses[J] === 'broken' && broken.doc.parts[1].placement.t.every((n, i) => n === seedT[i]));

const chips = jointChips(joined, {
  statuses: { [J]: 'broken' },
  messages: { [J]: 'Face not found on Housing' },
});
const conflict = jointChips(
  { joints: [{ ...joint, name: 'Angle 1' }] },
  { statuses: { [J]: 'conflict' }, messages: { [J]: 'Joint "Angle 1" conflicts' } },
);

const dir = mkdtempSync(join(tmpdir(), 'joints-strip-'));
const out = join(dir, 'ui.mjs');
const res = await build({
  stdin: {
    contents: `export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
export { default as FeatureStrip } from './src/components/FeatureStrip.jsx';
export { default as JointCard } from './src/components/JointCard.jsx';`,
    resolveDir: ROOT,
    loader: 'jsx',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  jsx: 'automatic',
  loader: { '.css': 'empty', '.svg': 'text', '.png': 'dataurl' },
  logLevel: 'error',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
writeFileSync(out, res.outputFiles[0].text);
const ui = await import(out);
rmSync(dir, { recursive: true, force: true });

const h = (C, props) => {
  const err = console.error;
  console.error = (...args) => {
    if (!/useLayoutEffect does nothing on the server/.test(String(args[0]))) err(...args);
  };
  try { return ui.renderToStaticMarkup(ui.createElement(C, props)); } finally { console.error = err; }
};

const emptyProps = { joints: [], hideWhenEmpty: true, onUndo: () => {}, onRedo: () => {} };
for (const [label, props] of [
  ['mobile CAD strip', { orientation: 'horizontal', ...emptyProps }],
  ['desktop CAD strip', { orientation: 'horizontal', ...emptyProps }],
]) {
  const html = h(ui.FeatureStrip, props);
  check(`${label}: No assembly joints`, html.includes('No assembly joints') && html.includes('data-assembly-joints') && html.includes('data-feature-strip-empty'), html.slice(0, 180));
  check(`${label}: Undo and Redo stay`, html.includes('data-feature-bar-undo') && html.includes('data-feature-bar-redo'));
}
const scriptHtml = h(ui.FeatureStrip, { orientation: 'vertical', script: '', hideWhenEmpty: false });
check('script-stage strip does not show assembly joints', !scriptHtml.includes('No assembly joints') && !scriptHtml.includes('data-assembly-joints'));
const hiddenFeatures = h(ui.FeatureStrip, { orientation: 'horizontal', script: '', hideWhenEmpty: true });
check('part features still hide their empty caption', !hiddenFeatures.includes('No features') && !hiddenFeatures.includes('No assembly joints'));

const chipHtml = h(ui.FeatureStrip, {
  orientation: 'horizontal',
  joints: [...chips, ...conflict],
  hideWhenEmpty: true,
  undoLabel: 'Undo joint',
});
check('a broken chip has the red ring and the joint name', /data-joint-id="/.test(chipHtml) && chipHtml.includes('border-red-400') && chipHtml.includes('feature-failed-ring') && chipHtml.includes('Coincident 1') && chipHtml.includes('aria-invalid'));
check('a conflict chip names the joint', chipHtml.includes('Angle 1') && chipHtml.includes('conflicts'));
check('joint undo title', chipHtml.includes('Undo joint'));

const sheet = h(ui.JointCard, {
  card,
  unit: 'mm',
  onChange: () => {},
  onConfirm: () => {},
  onCancel: () => {},
});
check('the create card is StickyPickApply', sheet.includes('data-sticky-pick-apply') && sheet.includes('data-joint-card') && sheet.includes('data-feature-card-cancel') && sheet.includes('Suggested: Coincident'));
check('Add is the apply label and the card is not fullLeft', sheet.includes('>Add<') && !sheet.includes('>Confirm<') && !sheet.includes('data-feature-card-full-left'));
check('subtitle names both faces', sheet.includes('Shaft') && sheet.includes('Housing'));
const game = jointsChromeMounted({ appMode: 'game' }) ? h(ui.JointCard, { card }) : '';
check('game mode renders no joint card markup', game === '');

const emptyHtml = h(ui.FeatureStrip, { orientation: 'horizontal', ...emptyProps });
const oneHtml = h(ui.FeatureStrip, {
  orientation: 'horizontal',
  joints: chips,
  hideWhenEmpty: true,
  selectedJointId: J,
  undoLabel: 'Undo joint',
});
check('the empty joints caption uses the chip box', emptyHtml.includes('data-assembly-joints-empty') && emptyHtml.includes('feature-strip-chip'));
check('a joint chip uses that same box', oneHtml.includes('data-joint-id') && oneHtml.includes('feature-strip-chip'));
check('the horizontal bar uses the shared height class', emptyHtml.includes('feature-strip-bar') && oneHtml.includes('feature-strip-bar'));
check('a joint chip does not carry its own Delete popup', !oneHtml.includes('data-joint-chip-popup') && !oneHtml.includes('data-joint-chip-delete'));
const edited = cardFromJoint({
  id: J,
  name: 'Angle 1',
  type: 'angle',
  value: 90,
  sense: 1,
  a: { part: A, kind: 'face', key: { at: [0, 0, 1], n: [0, 0, 1], area: 1 } },
  b: { part: B, kind: 'face', key: { at: [0, 0, 1], n: [0, 0, 1], area: 1 } },
}, doc);
const editHtml = h(ui.JointCard, {
  card: edited,
  onChange: () => {},
  onConfirm: () => {},
  onCancel: () => {},
  onDelete: () => {},
});
check('reopening a joint shows its type, value, red Delete, Confirm, and X',
  editHtml.includes('data-joint-card') && editHtml.includes('data-joint-type="angle"')
  && editHtml.includes('data-joint-angle') && editHtml.includes('value="90"')
  && editHtml.includes('data-joint-delete') && editHtml.includes('>Delete<')
  && editHtml.includes('border-red-700/60') && editHtml.includes('bg-red-950/50')
  && editHtml.includes('>Confirm<') && !editHtml.includes('>Add<')
  && editHtml.includes('data-feature-card-cancel'));
const symmetric = cardFromJoint({
  id: J,
  name: 'Symmetric 1',
  type: 'symmetric',
  a: { part: A, kind: 'face', key: { at: [0, 0, 1], n: [0, 0, 1], area: 1 } },
  a2: { part: A, kind: 'face', key: { at: [0, 0, -1], n: [0, 0, -1], area: 1 } },
  b: { part: B, kind: 'face', key: { at: [0, 0, 1], n: [0, 0, 1], area: 1 } },
  b2: { part: B, kind: 'face', key: { at: [0, 0, -1], n: [0, 0, -1], area: 1 } },
}, doc);
const symHtml = h(ui.JointCard, { card: symmetric, onChange: () => {}, onConfirm: () => {}, onCancel: () => {}, onDelete: () => {} });
check('a symmetric joint reopens with both faces and Delete',
  symHtml.includes('data-joint-type="symmetric"') && symHtml.includes('×2') && symHtml.includes('data-joint-delete'));
check('a broken chip has the red ring and the joint name', /data-joint-id="/.test(oneHtml) && oneHtml.includes('border-red-400') && oneHtml.includes('feature-failed-ring') && oneHtml.includes('Coincident 1') && oneHtml.includes('aria-invalid'));

const app = read('src/App.jsx');
const view = read('src/components/Viewport.jsx');
check('App keeps the joint card off in game', app.includes("appMode !== 'game'") && app.includes('jointCard={jointCardNode}') && !app.includes('jointTags='));
check('joint picking follows the open create card', app.includes('jointPicking={jointCreateOpen}'));
check('Blocks opens the joint card', read('src/components/HelperInsertPalette.jsx').includes('data-joints-button'));
check('App empty click does not assign activeId', app.includes('handleCadEmptyClick') && app.includes('emptyClickCadSelection'));
check('a strip chip reopens the joint', app.includes('cardFromJoint') && app.includes('handleSelectJoint') && app.includes('onDelete={() => handleJointDelete') && !app.includes('JointModeChip'));
check('Add keeps the card open and edit Confirm closes it',
  app.includes('resetPicks: true') && app.includes('draftFromPicks(null, []')
  && app.includes("resetPicks: card.mode !== 'edit'"));
check('the joint card slides the camera and floating tags are gone', view.includes("? 'joint'") && !view.includes('JointTags') && view.includes('paintJointHighlight'));

if (failed) {
  console.error(`\n${failed} joints-strip check(s) failed`);
  process.exit(1);
}
console.log('\njoints strip golden passed');
