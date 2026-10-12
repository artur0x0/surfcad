import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CUBE_BEGIN,
  CUBE_END,
  CYLINDER_BEGIN,
  CYLINDER_END,
  CUT_BEGIN,
  CUT_END,
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
  CONTOUR_PROFILE_BEGIN,
  CONTOUR_PROFILE_END,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
  MOVE_FACE_BEGIN,
  MOVE_FACE_END,
  newPartStarterScript,
  shouldClearViewportScript,
} from '../src/utils/helperPaletteSnippets.js';
import { parseFeatureMarkers } from '../src/utils/featureMarkers.js';
import { deleteFeatureEdit, dependentToastLines, featureDeletePlan, featureDependents } from '../src/utils/featureEdit.js';
import {
  emptyPartHistory,
  historyForPart,
  pushPartHistory,
  undoPartHistory,
} from '../src/utils/partHistory.js';

function marked(begin, end, body) {
  return `${begin}\n${body}\n${end}`;
}

const cube = marked(
  CUBE_BEGIN,
  CUBE_END,
  'const span = 40;\nlet box1 = Manifold.cube([span, 30, 20], true);\nlet part = box1;',
);
const extrude = marked(
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
  'part = part.add(placeInFrame(section.plane, makeExtrude(section.contours, 14)));',
);
const fillet = marked(
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
  'const selEdges = edgesBetween(part, 0, 2);\nconst path = makeSweepPath(selEdges);\npart = filletAlongPath(part, path, 2);',
);
const filletB = marked(
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
  'const selEdgesB = edgesBetween(part, 1, 4);\nconst pathB = makeSweepPath(selEdgesB);\npart = filletAlongPath(part, pathB, 1);',
);
const cut = marked(
  CUT_BEGIN,
  CUT_END,
  "part = cut(part, { center: [0, 0, 5], normal: [0, 0, 1] }, { keep: 'both' });",
);
const moveFace = marked(
  MOVE_FACE_BEGIN,
  MOVE_FACE_END,
  'part = moveFace(part, [{ center: [0, 0, 10], normal: [0, 0, 1] }], 3);',
);
const cylinder = marked(
  CYLINDER_BEGIN,
  CYLINDER_END,
  'let cyl1 = Manifold.cylinder(12, span, span, 16);\npart = part.add(cyl1);',
);
const profile = marked(
  CONTOUR_PROFILE_BEGIN,
  CONTOUR_PROFILE_END,
  'const contours = makeCrossSection([]);',
);

function scriptOf(parts) {
  return `${parts.join('\n')}\n`;
}

const script = scriptOf([
  '// header comment',
  cube,
  '// between cube and extrude',
  extrude,
  '// between extrude and fillet',
  fillet,
  '// between fillet and cut',
  cut,
  '// between cut and move face',
  moveFace,
  '// tail comment',
  'return part;',
]);

function byKind(text, kind, nth = 0) {
  return parseFeatureMarkers(text).filter((feature) => feature.kind === kind)[nth];
}

function blockText(text, feature) {
  return text.slice(feature.startOffset, feature.endOffset);
}

/** The removal rule: the marked span, plus one bordering newline. */
function expectedWithout(text, feature) {
  let before = text.slice(0, feature.startOffset);
  let after = text.slice(feature.endOffset);
  if (/(?:\r?\n)[ \t]*$/u.test(before) && /^(?:\r?\n)/u.test(after)) {
    after = after.replace(/^(?:\r?\n)/u, '');
  }
  if (!after) before = before.replace(/(?:\r?\n){2,}$/u, '\n');
  else if (!before) after = after.replace(/^(?:\r?\n)+/u, '');
  return before + after;
}

function assertRemovedOnly(text, feature) {
  const result = deleteFeatureEdit(text, feature);
  assert.equal(result.ok, true, result.message);
  const before = parseFeatureMarkers(text);
  const after = parseFeatureMarkers(result.buffer);
  assert.equal(after.length, before.length - 1);
  const kept = before.filter((item) => item.startOffset !== feature.startOffset);
  kept.forEach((item, i) => {
    assert.equal(blockText(result.buffer, after[i]), blockText(text, item));
  });
  assert.equal(result.buffer, expectedWithout(text, feature));
  assert.match(result.buffer, /\/\/ header comment/);
  assert.match(result.buffer, /\/\/ tail comment/);
  assert.equal(result.buffer.includes(blockText(text, feature)), false);
  return result;
}

test('block removal drops exactly one feature in first, middle, and last positions', () => {
  const kinds = ['cube', 'extrude', 'fillet', 'cut', 'moveFace'];
  const features = parseFeatureMarkers(script);
  assert.deepEqual(features.map((feature) => feature.kind), kinds);
  for (const feature of features) {
    const result = assertRemovedOnly(script, feature);
    const left = parseFeatureMarkers(result.buffer).map((item) => item.kind);
    assert.deepEqual(left, kinds.filter((kind) => kind !== feature.kind));
  }
  assert.match(script, /\/\/ between cube and extrude/);
  const middle = assertRemovedOnly(script, byKind(script, 'fillet'));
  assert.match(middle.buffer, /\/\/ between extrude and fillet/);
  assert.match(middle.buffer, /\/\/ between fillet and cut/);
  assert.match(middle.buffer, /const span = 40/);
  assert.match(middle.buffer, /moveFace\(part/);
});

test('a second block of the same kind is left untouched', () => {
  const text = scriptOf(['// header comment', cube, '// gap', fillet, '// gap', filletB, '// tail comment', 'return part;']);
  const first = byKind(text, 'fillet', 0);
  const second = byKind(text, 'fillet', 1);
  const result = deleteFeatureEdit(text, first);
  assert.equal(result.ok, true, result.message);
  const left = parseFeatureMarkers(result.buffer);
  assert.equal(left.filter((feature) => feature.kind === 'fillet').length, 1);
  assert.equal(blockText(result.buffer, left.find((feature) => feature.kind === 'fillet')), blockText(text, second));
  assert.match(result.buffer, /selEdgesB/);
  assert.equal(result.buffer.includes('selEdges ='), false);
});

test('dependents are later edge, face, and variable references', () => {
  const text = scriptOf([
    '// header comment',
    cube,
    '// gap',
    fillet,
    '// gap',
    filletB,
    '// gap',
    cut,
    '// gap',
    moveFace,
    '// gap',
    cylinder,
    '// tail comment',
    'const extra = span * 2;',
    'return part;',
  ]);
  const host = byKind(text, 'cube');
  const deps = featureDependents(text, host);
  const messages = deps.map((item) => item.message);
  assert.ok(messages.includes("Fillet 1 uses this feature's edges and may fail"), messages.join(' | '));
  assert.ok(messages.includes("Fillet 2 uses this feature's edges and may fail"), messages.join(' | '));
  assert.ok(messages.includes("Cut uses this feature's faces and may fail"), messages.join(' | '));
  assert.ok(messages.includes("Move face uses this feature's faces and may fail"), messages.join(' | '));
  assert.ok(messages.includes('Cylinder uses span from this feature and may fail'), messages.join(' | '));
  assert.ok(messages.includes('Later code uses span from this feature and may fail'), messages.join(' | '));
  assert.equal(deps.some((item) => item.kind === 'cube'), false);
  assert.equal(deps.some((item) => /uses part from this feature/.test(item.message)), false);

  const secondFillet = byKind(text, 'fillet', 1);
  const afterSecond = featureDependents(text, secondFillet).map((item) => item.label);
  assert.equal(afterSecond.includes('Fillet 1'), false);
  assert.equal(afterSecond.includes('Cube'), false);

  const profileScript = scriptOf([profile, fillet]);
  assert.deepEqual(featureDependents(profileScript, byKind(profileScript, 'profile')), []);

  const axisCut = scriptOf([
    cube,
    marked(CUT_BEGIN, CUT_END, 'part = cut(part, { normal: [0, 0, 1], originOffset: 0 });'),
  ]);
  assert.equal(
    featureDependents(axisCut, byKind(axisCut, 'cube')).some((item) => item.reason === 'faces'),
    false,
  );
});

test('one undo restores the identical script', () => {
  const feature = byKind(script, 'extrude');
  const deleted = deleteFeatureEdit(script, feature);
  assert.equal(deleted.ok, true, deleted.message);
  assert.notEqual(deleted.buffer, script);

  let history = pushPartHistory(emptyPartHistory(), script, 'Part');
  history = pushPartHistory(history, deleted.buffer, 'Delete Extrude');
  assert.equal(history.head, 1);
  const undone = undoPartHistory(history);
  assert.equal(undone.code, script);
  assert.equal(undone.history.head, 0);

  const seeded = historyForPart({}, 'part-1', script);
  const pushed = pushPartHistory(seeded, deleted.buffer, 'Delete Extrude');
  assert.equal(pushed.head, seeded.head + 1);
  assert.equal(undoPartHistory(pushed).code, script);
});

test('delete waits on the assembly open lock and does not take it', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');
  const view = readFileSync(join(root, 'src/components/Viewport.jsx'), 'utf8');
  const dialog = readFileSync(join(root, 'src/components/FeatureEditDelete.jsx'), 'utf8');
  const start = app.indexOf('const handleDeleteFeatureEdit');
  const end = app.indexOf('const handleFeatureSheetDelete');
  assert.ok(start > 0 && end > start);
  const fn = app.slice(start, end);
  assert.ok(fn.includes('assemblyOpenLockRef.current'));
  assert.ok(fn.indexOf('assemblyOpenLockRef.current') < fn.indexOf('applyBuffer?.'));
  assert.equal(/assemblyOpenLockRef\.current\s*=/.test(fn), false);
  assert.match(fn, /deleteFeatureEdit/);
  assert.match(fn, /withDependents/);
  assert.match(view, /featureDeletePlan/);
  assert.match(view, /FeatureDeleteConfirm/);
  assert.match(view, /onDeleteFeatureEditRef/);
  assert.match(view, /deleteFeatureFromEdit/);
  assert.match(view, /Deleted\./);
  assert.match(dialog, /data-feature-edit-delete/);
  assert.match(dialog, /data-feature-edit-delete-toast/);
  assert.match(dialog, /FeatureDeleteConfirm/);
  assert.match(dialog, /testId="feature-edit"/);
  assert.equal(/assemblyOpenLockRef\.current\s*=/.test(view), false);
});

test('a marker nested in another feature deletes instead of refusing', () => {
  const nested = [
    CUBE_BEGIN,
    'let box1 = Manifold.cube([40, 30, 20], true);',
    'let part = box1;',
    FILLET_MODE_BEGIN,
    'const selEdges = edgesBetween(part, 0, 2);',
    FILLET_MODE_END,
    CUBE_END,
    'return part;',
    '',
  ].join('\n');
  const result = deleteFeatureEdit(nested, byKind(nested, 'cube'));
  assert.equal(result.ok, true, result.message);
  assert.doesNotMatch(String(result.message || ''), /refusing/);
  assert.equal(result.buffer.includes('cube begin'), false);
  assert.equal(result.buffer.includes('fillet-mode begin'), false);
  assert.equal(/\breturn\s+part\s*;/.test(result.buffer), false);
  assert.equal(shouldClearViewportScript(result.buffer), true);
});

test('deleting the only feature leaves an empty part, in one undo step', () => {
  const starter = newPartStarterScript();
  assert.match(starter, /let part = box1;/);
  assert.match(starter, /return part;/);
  const feature = byKind(starter, 'cube');
  const result = deleteFeatureEdit(starter, feature);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.buffer, '');
  assert.equal(shouldClearViewportScript(result.buffer), true);
  assert.equal(/\bpart\b/.test(result.buffer), false);
  assert.equal(parseFeatureMarkers(result.buffer).length, 0);

  const commented = scriptOf(['// header comment', starter.trimEnd()]);
  const commentedResult = deleteFeatureEdit(commented, byKind(commented, 'cube'));
  assert.equal(commentedResult.ok, true, commentedResult.message);
  assert.match(commentedResult.buffer, /\/\/ header comment/);
  assert.equal(/\breturn\s+part\s*;/.test(commentedResult.buffer), false);
  assert.equal(shouldClearViewportScript(commentedResult.buffer), true);

  const studied = `${starter}// --- fea-study begin ---\n// @fea-study {"id":"s1"}\n// --- fea-study end ---\n`;
  const studiedResult = deleteFeatureEdit(studied, byKind(studied, 'cube'));
  assert.equal(studiedResult.ok, true, studiedResult.message);
  assert.match(studiedResult.buffer, /fea-study begin/);
  assert.equal(/\breturn\s+part\s*;/.test(studiedResult.buffer), false);
  assert.equal(shouldClearViewportScript(studiedResult.buffer), true);

  const plane = scriptOf([
    'const fr = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };',
    starter.trimEnd(),
  ]);
  const planeResult = deleteFeatureEdit(plane, byKind(plane, 'cube'));
  assert.equal(planeResult.ok, true, planeResult.message);
  assert.match(planeResult.buffer, /const fr =/);
  assert.equal(/\breturn\s+part\s*;/.test(planeResult.buffer), false);
  assert.equal(shouldClearViewportScript(planeResult.buffer), true);

  let history = pushPartHistory(emptyPartHistory(), starter, 'Part');
  history = pushPartHistory(history, result.buffer, 'Delete Cube');
  assert.equal(history.head, 1);
  assert.equal(undoPartHistory(history).code, starter);

  const seeded = historyForPart({}, 'part-1', starter);
  const pushed = pushPartHistory(seeded, result.buffer, 'Delete Cube');
  assert.equal(pushed.head, seeded.head + 1);
  assert.equal(undoPartHistory(pushed).code, starter);
});

test('feature-block dependents confirm and delete together', () => {
  const text = scriptOf([cube, fillet, cut, 'const extra = span * 2;', 'return part;']);
  const host = byKind(text, 'cube');
  const plan = featureDeletePlan(text, host);
  assert.equal(plan.ok, false);
  assert.equal(plan.confirm, true);
  assert.equal(plan.count, 2);
  assert.equal(plan.message, 'Delete along with 2 features');
  const last = featureDeletePlan(text, byKind(text, 'cut'));
  assert.equal(last.ok, true);
  assert.equal(last.confirm, false);
  const kept = deleteFeatureEdit(text, host);
  assert.equal(kept.ok, true, kept.message);
  assert.match(kept.buffer, /fillet-mode begin/);
  assert.match(kept.buffer, /cut begin/);
  const gone = deleteFeatureEdit(text, host, { withDependents: true });
  assert.equal(gone.ok, true, gone.message);
  assert.doesNotMatch(String(gone.message || ''), /refusing/);
  assert.doesNotMatch(gone.buffer, /cube begin/);
  assert.doesNotMatch(gone.buffer, /fillet-mode begin/);
  assert.doesNotMatch(gone.buffer, /cut begin/);
  assert.match(gone.buffer, /const extra = span \* 2;/);
  assert.match(gone.buffer, /return part;/);
  let history = pushPartHistory(emptyPartHistory(), text, 'Part');
  history = pushPartHistory(history, gone.buffer, 'Delete Cube');
  assert.equal(undoPartHistory(history).code, text);
});

test('a dependent warning is toast copy, and no dependents means no toast', () => {
  const host = byKind(script, 'cube');
  const lines = dependentToastLines(featureDependents(script, host));
  assert.ok(lines.some((line) => /uses this feature's edges and may fail/.test(line)));
  assert.ok(lines.some((line) => /uses this feature's faces and may fail/.test(line)));
  assert.deepEqual(dependentToastLines([]), []);
  assert.deepEqual(dependentToastLines(null), []);
  const last = byKind(script, 'moveFace');
  assert.deepEqual(dependentToastLines(featureDependents(script, last)), []);
});
