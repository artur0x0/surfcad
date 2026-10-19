import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentSnapshotDocKey,
  editedPartIdsSinceSnapshot,
  extendPartScriptSnapshot,
  liveEditorOverride,
  snapshotPartScripts,
} from './editedSinceLoad.js';

test('snapshotPartScripts folds the live editor buffer for the active part', () => {
  assert.deepEqual(snapshotPartScripts({ a: 'old' }, { liveId: 'a', liveScript: 'new' }), { a: 'new' });
});

test('editedPartIdsSinceSnapshot lists changed and new parts', () => {
  const snap = snapshotPartScripts({ a: 'one', b: 'two' });
  const edited = editedPartIdsSinceSnapshot(snap, { a: 'one!', b: 'two', c: 'three' }, {
    partIds: ['a', 'b', 'c'],
  });
  assert.deepEqual(edited, ['a', 'c']);
});

test('open_assembly snapshot ignores a stale editor buffer until the editor is live', () => {
  const opened = { a: 'return cube;' };
  const staleEditor = 'return previous assembly;';
  const poisoned = snapshotPartScripts(opened, liveEditorOverride({
    editorLive: true,
    activeId: 'a',
    script: staleEditor,
  }) || {});
  assert.equal(poisoned.a, staleEditor);
  assert.deepEqual(
    editedPartIdsSinceSnapshot(poisoned, opened, { liveId: 'a', liveScript: opened.a }),
    ['a'],
  );

  assert.equal(liveEditorOverride({
    editorLive: false,
    activeId: 'a',
    script: staleEditor,
  }), null);
  const clean = snapshotPartScripts(opened, liveEditorOverride({
    editorLive: false,
    activeId: 'a',
    script: staleEditor,
  }) || {});
  assert.equal(clean.a, opened.a);
  assert.deepEqual(
    editedPartIdsSinceSnapshot(clean, opened, liveEditorOverride({
      editorLive: true,
      activeId: 'a',
      script: opened.a,
    }) || {}),
    [],
  );
});

test('adding a part keeps the parts already edited (Pi 5 C1)', () => {
  const snap = snapshotPartScripts({ base: 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n' });
  const scripts = {
    base: 'let part = Manifold.cube([40, 30, 20], true);\npart = part.add(Manifold.cube([5, 5, 50], true));\nreturn part;\n',
    lid: 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;\n',
  };
  // The old key included the part ids, so the lid re-baselined everything.
  const extended = extendPartScriptSnapshot(snap, scripts, ['base', 'lid']);
  assert.deepEqual(extended, { base: snap.base, lid: scripts.lid });
  assert.deepEqual(editedPartIdsSinceSnapshot(extended, scripts, { partIds: ['base', 'lid'] }), ['base']);
  scripts.lid = 'let part = Manifold.cube([20, 20, 4], true);\nreturn part;\n';
  assert.deepEqual(editedPartIdsSinceSnapshot(extended, scripts, { partIds: ['base', 'lid'] }), ['base', 'lid']);
  assert.equal(snap.lid, undefined, 'input snapshot is not mutated');
});

test('agentSnapshotDocKey is the document identity, not its part list', () => {
  const a = agentSnapshotDocKey({ id: 'asm-1', name: 'Assembly', source: 'local', parts: [{ id: 'base' }] });
  const b = agentSnapshotDocKey({ id: 'asm-1', name: 'Assembly', source: 'local', parts: [{ id: 'base' }, { id: 'lid' }] });
  assert.equal(a, b);
  assert.notEqual(a, agentSnapshotDocKey({ id: 'asm-2', name: 'Assembly', source: 'local' }));
  assert.notEqual(a, agentSnapshotDocKey({ id: 'asm-1', name: 'Assembly', source: 'git' }));
  assert.equal(agentSnapshotDocKey({ name: 'Bracket', source: 'git' }), 'name:Bracket\0git');
  assert.equal(agentSnapshotDocKey(null), '');
});
