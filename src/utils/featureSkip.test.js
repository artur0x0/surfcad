import assert from 'node:assert/strict';
import test from 'node:test';
import { markerWithId } from './featureBlockId.js';
import { featureDependents } from './featureEdit.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { serializeAssembly } from './assembly.js';
import { deleteFeatureBlock } from './featureSheetWriteback.js';
import {
  CUBE_BEGIN,
  CUBE_END,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
  SHELL_BEGIN,
  SHELL_END,
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
  CONTOUR_PROFILE_BEGIN,
  CONTOUR_PROFILE_END,
  composeHelperInsert,
} from './helperPaletteSnippets.js';
import { SHEET_METAL_BEGIN, SHEET_METAL_END } from './sheetMetal/sheetMeshFlag.js';
import { composeFilletCommit } from './filletMode.js';
import {
  clampRollbackAnchor,
  commitScriptAtRollback,
  evaluationScript,
  hardSkipIds,
  insertedFeature,
  rolledBackFeatureIds,
  rollbackAnchorAfterInsert,
  rollbackAnchorAtGap,
  rollbackAnchorsAfterOpen,
  rollbackGapIndex,
  rollbackInsertCaret,
  resolveRollback,
} from './featureSkip.js';

function region(begin, end, id, body) {
  return `${markerWithId(begin, id)}\n${body}\n${markerWithId(end, id)}`;
}

/**
 * Cube, a fillet that can run, a fillet that declares `badContour`, a later
 * fillet and a shell that only touch `part`, and an extrude that names
 * `badContour`.
 */
function midChain() {
  return [
    region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true);'),
    region(
      FILLET_MODE_BEGIN,
      FILLET_MODE_END,
      'fillet1',
      [
        'const selEdges = edgesBetween(part, 0, 6);',
        'const path = makeSweepPath(selEdges);',
        'part = filletAlongPath(part, path, 2);',
      ].join('\n'),
    ),
    region(
      FILLET_MODE_BEGIN,
      FILLET_MODE_END,
      'fillet2',
      [
        'const selEdges2 = edgesBetween(part, 90, 91);',
        'const badContour = { plane: {}, contours: [] };',
        'const path2 = makeSweepPath(selEdges2);',
        'part = filletAlongPath(part, path2, 2);',
      ].join('\n'),
    ),
    region(
      FILLET_MODE_BEGIN,
      FILLET_MODE_END,
      'fillet3',
      [
        'const selEdges3 = edgesBetween(part, 1, 2);',
        'part = filletAlongPath(part, selEdges3, 1);',
      ].join('\n'),
    ),
    region(SHELL_BEGIN, SHELL_END, 'shell1', 'part = hollow(part, 1);'),
    'const leak = 1;',
    region(
      CONTOUR_EXTRUDE_BEGIN,
      CONTOUR_EXTRUDE_END,
      'extrude1',
      'part = part.add(placeInFrame(badContour.plane, makeExtrude(badContour.contours, 10), [0, 0, 0]));',
    ),
    'return part;',
    '// --- fea-study begin ---',
    '// @fea-study {"v":1}',
    '// --- fea-study end ---',
    '',
  ].join('\n');
}

function lineOf(text, needle) {
  const at = text.indexOf(needle);
  assert.notEqual(at, -1, needle);
  return text.slice(0, at).split('\n').length;
}

function runCopy(copy) {
  let fillets = 0;
  const fn = new Function(
    'Manifold',
    'edgesBetween',
    'makeSweepPath',
    'filletAlongPath',
    'hollow',
    'placeInFrame',
    'makeExtrude',
    `"use strict";\n${copy}`,
  );
  const result = fn(
    { cube: () => ({ tag: 'cube' }) },
    () => [],
    (edges) => edges,
    (part) => {
      fillets += 1;
      return part;
    },
    (part) => ({ ...part, shelled: true }),
    (solid) => solid,
    () => ({ extruded: true }),
  );
  return { result, fillets };
}

test('a mid-chain failure skips the bad fillet and its contour user, not part', () => {
  const script = midChain();
  const cube = parseFeatureMarkers(script).find((feature) => feature.id === 'cube1');
  const edgeUsers = featureDependents(script, cube)
    .filter((dep) => dep.reason === 'edges')
    .map((dep) => dep.id);
  assert.ok(edgeUsers.includes('fillet1'));
  assert.deepEqual(hardSkipIds(script, 'cube1'), ['cube1']);
  assert.deepEqual(hardSkipIds(script, 'fillet1'), ['fillet1']);
  assert.deepEqual(hardSkipIds(script, 'fillet2'), ['fillet2', 'extrude1']);
  assert.deepEqual(hardSkipIds(script, 'missing'), []);

  const copy = evaluationScript(script, { skipIds: hardSkipIds(script, 'fillet2') });
  assert.equal(script.includes('const badContour'), true);
  assert.equal(copy.includes('const badContour'), false);
  assert.equal(copy.includes('selEdges2'), false);
  assert.equal(copy.includes('makeExtrude'), false);
  assert.equal(copy.includes('const leak = 1;'), true);
  assert.equal(copy.includes('part = hollow(part, 1);'), true);
  assert.equal(copy.includes('edgesBetween(part, 1, 2)'), true);
  assert.equal(copy.includes('Manifold.cube'), true);
  assert.equal(copy.split('\n').length, script.split('\n').length);
  assert.equal(lineOf(copy, 'return part;'), lineOf(script, 'return part;'));
  assert.equal(lineOf(copy, 'part = hollow(part, 1);'), lineOf(script, 'part = hollow(part, 1);'));
  assert.deepEqual(
    parseFeatureMarkers(copy).map((feature) => feature.id),
    parseFeatureMarkers(script).map((feature) => feature.id),
  );
  assert.match(copy, /fillet-mode begin id=fillet2/);
  assert.match(copy, /fillet-mode end id=fillet2/);

  const ran = runCopy(copy);
  assert.equal(ran.fillets, 2);
  assert.equal(ran.result.tag, 'cube');
  assert.equal(ran.result.shelled, true);
  assert.equal(ran.result.extruded, undefined);
});

test('a sheet refKey pulls the contour and the extrude that names it', () => {
  const script = [
    region(SHEET_METAL_BEGIN, SHEET_METAL_END, 'sheet1', 'const sheetSpec = { edge: "wall:base:v-:w0" };\nlet part = sheetSpec;'),
    region(CONTOUR_PROFILE_BEGIN, CONTOUR_PROFILE_END, 'profile1', "const c1 = { refKey: 'wall:base:v-:w0' };"),
    region(CONTOUR_EXTRUDE_BEGIN, CONTOUR_EXTRUDE_END, 'extrude1', 'part = part.add(c1);'),
    'return part;',
    '',
  ].join('\n');
  assert.deepEqual(hardSkipIds(script, 'sheet1'), ['sheet1', 'profile1', 'extrude1']);

  const earlier = [
    region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = "wall:base:v-:w0";'),
    script,
  ].join('\n');
  assert.deepEqual(hardSkipIds(earlier, 'sheet1'), ['sheet1']);
});

test('the rollback anchor blanks the tail and keeps return part and line numbers', () => {
  const script = midChain();
  const copy = evaluationScript(script, { anchorId: 'fillet1' });
  assert.equal(copy.includes('Manifold.cube'), true);
  assert.equal(copy.includes('edgesBetween(part, 0, 6)'), true);
  assert.equal(copy.includes('const badContour'), false);
  assert.equal(copy.includes('edgesBetween(part, 1, 2)'), false);
  assert.equal(copy.includes('part = hollow(part, 1);'), false);
  assert.equal(copy.includes('const leak = 1;'), false);
  assert.equal(copy.includes('makeExtrude'), false);
  assert.match(copy, /return part;/);
  assert.match(copy, /\/\/ @fea-study/);
  assert.match(copy, /shell begin id=shell1/);
  assert.equal(copy.split('\n').length, script.split('\n').length);
  assert.equal(lineOf(copy, 'return part;'), lineOf(script, 'return part;'));

  const ran = runCopy(copy);
  assert.equal(ran.fillets, 1);
  assert.equal(ran.result.shelled, undefined);
  assert.equal(ran.result.tag, 'cube');

  assert.equal(evaluationScript(script, { anchorId: 'extrude1' }), script);
  assert.equal(evaluationScript(script, { anchorId: 'missing' }), script);
  assert.equal(evaluationScript(script), script);

  const beforeAll = evaluationScript(script, { anchorId: null });
  assert.equal(beforeAll.includes('Manifold.cube'), false);
  assert.match(beforeAll, /return part;/);
  assert.equal(beforeAll.split('\n').length, script.split('\n').length);
  assert.throws(() => runCopy(beforeAll), /part/);

  const both = evaluationScript(script, { skipIds: ['cube1'], anchorId: 'fillet1' });
  assert.equal(both.includes('Manifold.cube'), false);
  assert.equal(both.includes('edgesBetween(part, 0, 6)'), true);
  assert.equal(both.includes('part = hollow(part, 1);'), false);
});

test('the rollback bar gap is the feature it sits after', () => {
  const ids = ['cube1', 'fillet1', 'shell1'];
  assert.equal(rollbackGapIndex(ids, undefined), 3);
  assert.equal(rollbackGapIndex(ids, null), 0);
  assert.equal(rollbackGapIndex(ids, 'fillet1'), 2);
  assert.equal(rollbackGapIndex(ids, 'missing'), 3);
  assert.equal(rollbackAnchorAtGap(ids, 0), null);
  assert.equal(rollbackAnchorAtGap(ids, 2), 'fillet1');
  assert.equal(rollbackAnchorAtGap(ids, 3), undefined);
});

test('insert lands on the bar; undo, delete, and reload reclamp it', () => {
  const script = [
    region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true);'),
    region(FILLET_MODE_BEGIN, FILLET_MODE_END, 'fillet1', 'part = filletAlongPath(part, path, 2);'),
    region(SHELL_BEGIN, SHELL_END, 'shell1', "part = hollow(part, 2, 'z');"),
    'return part;',
    '',
  ].join('\n');
  const caret = rollbackInsertCaret(script, 'fillet1');
  const fillet = parseFeatureMarkers(script).find((feature) => feature.id === 'fillet1');
  assert.equal(caret, fillet.endOffset);
  assert.equal(rollbackInsertCaret(script, null), 0);
  assert.equal(rollbackInsertCaret(script, undefined), null);
  assert.equal(rollbackInsertCaret(script, 'missing'), null);

  const inserted = composeHelperInsert(script, 'cube', caret, {
    width: 14,
    depth: 14,
    height: 14,
    center: true,
  });
  assert.equal(typeof inserted, 'string');
  const added = insertedFeature(script, inserted);
  assert.equal(added?.kind, 'cube');
  assert.ok(added.startOffset >= caret);
  const shell = parseFeatureMarkers(inserted).find((feature) => feature.id === 'shell1');
  assert.ok(shell && added.endOffset <= shell.startOffset);
  const moved = rollbackAnchorAfterInsert(script, inserted, 'fillet1');
  assert.equal(moved, added.id);
  const live = evaluationScript(inserted, { anchorId: moved });
  assert.match(live, /\[14,\s*14,\s*14\]/);
  assert.equal(live.includes("hollow(part, 2, 'z')"), false);
  assert.match(live, /return part;/);
  assert.equal(rollbackAnchorAfterInsert(script, inserted, undefined), undefined);

  assert.equal(clampRollbackAnchor(script, moved), undefined);
  assert.equal(clampRollbackAnchor(script, 'fillet1'), 'fillet1');
  assert.equal(clampRollbackAnchor(inserted, 'fillet1'), 'fillet1');

  const features = parseFeatureMarkers(script);
  const droppedAnchor = deleteFeatureBlock(script, features.find((feature) => feature.id === 'fillet1'));
  assert.equal(droppedAnchor.ok, true);
  assert.equal(clampRollbackAnchor(droppedAnchor.buffer, 'fillet1'), undefined);
  const droppedTail = deleteFeatureBlock(script, features.find((feature) => feature.id === 'shell1'));
  assert.equal(clampRollbackAnchor(droppedTail.buffer, 'fillet1'), 'fillet1');
  const droppedHead = deleteFeatureBlock(script, features.find((feature) => feature.id === 'cube1'));
  assert.equal(clampRollbackAnchor(droppedHead.buffer, 'fillet1'), 'fillet1');

  const edited = script.replace("hollow(part, 2, 'z')", "hollow(part, 3, 'z')");
  assert.equal(clampRollbackAnchor(edited, 'fillet1'), 'fillet1');
  const appended = script.replace(
    'return part;',
    `${region(CUBE_BEGIN, CUBE_END, 'cube2', 'part = part.add(Manifold.cube([4, 4, 4], true));')}\nreturn part;`,
  );
  assert.equal(clampRollbackAnchor(appended, 'fillet1'), 'fillet1');
  assert.equal(rollbackAnchorAfterInsert(script, appended, 'fillet1'), 'cube2');

  const saved = serializeAssembly({
    name: 'Bracket',
    parts: [{ id: 'p1', name: 'Part', rollbackAnchor: 'fillet1' }],
    rollbackAnchors: { p1: 'fillet1' },
  });
  assert.equal(saved.parts[0].id, 'p1');
  assert.equal(Object.prototype.hasOwnProperty.call(saved.parts[0], 'rollbackAnchor'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'rollbackAnchors'), false);
  assert.notEqual(evaluationScript(script, { anchorId: 'fillet1' }), script);
  assert.deepEqual(rollbackAnchorsAfterOpen(), {});
  assert.deepEqual(rolledBackFeatureIds(script, 'fillet1'), ['shell1']);
  assert.deepEqual(rolledBackFeatureIds(script, undefined), []);
  assert.deepEqual(rolledBackFeatureIds(script, null), ['cube1', 'fillet1', 'shell1']);
});

test('an appended accept moves to the rollback bar', () => {
  const script = [
    region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true);'),
    region(FILLET_MODE_BEGIN, FILLET_MODE_END, 'fillet1', 'part = filletAlongPath(part, path, 2);'),
    region(SHELL_BEGIN, SHELL_END, 'shell1', "part = hollow(part, 2, 'z');"),
    'return part;',
    '',
  ].join('\n');
  const appended = script.replace(
    'return part;',
    `${region(CUBE_BEGIN, CUBE_END, 'cube2', 'part = part.add(Manifold.cube([4, 4, 4], true));')}\nreturn part;`,
  );
  const placed = commitScriptAtRollback(script, appended, 'fillet1');
  assert.equal(placed.anchor, 'cube2');
  const ids = parseFeatureMarkers(placed.buffer).map((feature) => feature.id);
  assert.deepEqual(ids, ['cube1', 'fillet1', 'cube2', 'shell1']);
  const live = evaluationScript(placed.buffer, { anchorId: placed.anchor });
  assert.match(live, /\[4,\s*4,\s*4\]/);
  assert.equal(live.includes("hollow(part, 2, 'z')"), false);
  const edited = commitScriptAtRollback(script, script.replace('[20, 20, 20]', '[22, 22, 22]'), 'fillet1');
  assert.equal(edited.anchor, 'fillet1');
  assert.equal(edited.buffer.includes('[22, 22, 22]'), true);
  assert.deepEqual(parseFeatureMarkers(edited.buffer).map((feature) => feature.id), ['cube1', 'fillet1', 'shell1']);
});

test('a fillet accept at mid-bar lands in the gap and reports the tail', () => {
  const script = [
    region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true);'),
    region(SHELL_BEGIN, SHELL_END, 'shell1', "part = hollow(part, 2, 'z');"),
    'return part;',
    '',
  ].join('\n');
  const composed = composeFilletCommit(script, {
    edges: [{
      a: 0,
      b: 1,
      va: [0, 0, 0],
      vb: [0, 0, 20],
      boundaryId: 0,
      faceA: 0,
      faceB: 6,
      pairCount: 1,
    }],
    params: { radius: 2, strategy: 'sweep' },
    commitMode: 'append',
    filletClass: 'easy',
  });
  assert.equal(composed.ok, true);
  const placed = commitScriptAtRollback(script, composed.buffer, 'cube1');
  const ids = parseFeatureMarkers(placed.buffer).map((feature) => feature.id);
  assert.deepEqual(ids, ['cube1', 'fillet1', 'shell1']);
  assert.equal(placed.anchor, 'fillet1');
  assert.match(placed.buffer, /fillet-mode begin id=fillet1 ---/);
  const live = evaluationScript(placed.buffer, { anchorId: placed.anchor });
  assert.match(live, /filletAlongPath\(/);
  assert.equal(live.includes("hollow(part, 2, 'z')"), false);
  assert.deepEqual(rolledBackFeatureIds(placed.buffer, placed.anchor), ['shell1']);
  assert.deepEqual(rolledBackFeatureIds(script, 'cube1'), ['shell1']);
  const plan = resolveRollback(placed.buffer, placed.anchor);
  assert.equal(plan.anchor, 'fillet1');
  assert.deepEqual(plan.skipIds, ['shell1']);
});

test('a missing rollback id is the end for the bar and the run', () => {
  const script = [
    region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true);'),
    region(SHELL_BEGIN, SHELL_END, 'shell1', "part = hollow(part, 2, 'z');"),
    'return part;',
    '',
  ].join('\n');
  const missing = resolveRollback(script, 'fillet-9');
  assert.equal(missing.anchor, undefined);
  assert.equal(missing.index, 2);
  assert.deepEqual(missing.skipIds, []);
  assert.equal(evaluationScript(script, { anchorId: missing.anchor }), script);
  const empty = resolveRollback('', 'fillet-1');
  assert.equal(empty.index, 0);
  assert.equal(empty.anchor, undefined);
  assert.deepEqual(empty.skipIds, []);
  assert.equal(rollbackAnchorAtGap(empty.ids, empty.index), null);
  const start = resolveRollback(script, null);
  assert.equal(start.anchor, null);
  assert.equal(start.index, 0);
  assert.deepEqual(start.skipIds, ['cube1', 'shell1']);
});

test('a shifted positional id stays on the same block', () => {
  const cube = (body) => `${CUBE_BEGIN}\n${body}\n${CUBE_END}`;
  const before = [
    cube('let part = Manifold.cube([20, 20, 20], true);'),
    cube('part = part.add(Manifold.cube([4, 4, 4], true));'),
    'return part;',
    '',
  ].join('\n');
  assert.deepEqual(parseFeatureMarkers(before).map((feature) => feature.id), ['cube-0', 'cube-1']);
  const prepended = [
    cube('part = part.add(Manifold.cube([1, 1, 1], true));'),
    cube('let part = Manifold.cube([20, 20, 20], true);'),
    cube('part = part.add(Manifold.cube([4, 4, 4], true));'),
    'return part;',
    '',
  ].join('\n');
  const placed = commitScriptAtRollback(before, prepended, 'cube-1');
  const ids = parseFeatureMarkers(placed.buffer).map((feature) => feature.id);
  assert.deepEqual(ids, ['cube-0', 'cube-1', 'cube-2']);
  assert.equal(placed.anchor, 'cube-2');
  const host = parseFeatureMarkers(placed.buffer).find((feature) => feature.id === placed.anchor);
  assert.match(placed.buffer.slice(host.startOffset, host.endOffset), /\[4,\s*4,\s*4\]/);
  const aliased = parseFeatureMarkers(placed.buffer).find((feature) => feature.id === 'cube-1');
  assert.match(placed.buffer.slice(aliased.startOffset, aliased.endOffset), /\[20,\s*20,\s*20\]/);
  const plan = resolveRollback(placed.buffer, placed.anchor);
  assert.equal(plan.anchor, 'cube-2');
  assert.deepEqual(plan.skipIds, []);
});

test('a missing anchor does not pull a new fillet to the start', () => {
  const script = [
    region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true);'),
    region(SHELL_BEGIN, SHELL_END, 'shell1', "part = hollow(part, 2, 'z');"),
    'return part;',
    '',
  ].join('\n');
  const composed = composeFilletCommit(script, {
    edges: [{
      a: 0,
      b: 1,
      va: [0, 0, 0],
      vb: [0, 0, 20],
      boundaryId: 0,
      faceA: 0,
      faceB: 6,
      pairCount: 1,
    }],
    params: { radius: 2, strategy: 'sweep' },
    commitMode: 'append',
    filletClass: 'easy',
  });
  assert.equal(composed.ok, true);
  const placed = commitScriptAtRollback(script, composed.buffer, 'fillet-9');
  const ids = parseFeatureMarkers(placed.buffer).map((feature) => feature.id);
  assert.equal(ids[0], 'cube1');
  assert.equal(ids[ids.length - 1].startsWith('fillet'), true);
  assert.equal(placed.anchor, undefined);
  const plan = resolveRollback(placed.buffer, 'fillet-9');
  assert.equal(plan.anchor, undefined);
  assert.notEqual(plan.anchor, null);
  assert.deepEqual(plan.skipIds, []);
  assert.equal(plan.index, ids.length);
});
