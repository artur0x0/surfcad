import assert from 'node:assert/strict';
import test from 'node:test';
import { commitPartCreate, createPartQueue, createdPartFromDocs, partCreateKey } from './createPart.js';
import { nextNumberedName } from '../../utils/assembly.js';
import { mintSurfId, withSurfId } from '../../utils/git/surfId.js';
import { newPartStarterScript } from '../../utils/helperPaletteSnippets.js';
import { wrapRawScript } from '../../utils/wrapRawScript.js';

const deps = {
  mintId: () => mintSurfId(),
  nextNumberedName,
  wrapRawScript,
  starterScript: newPartStarterScript,
  withSurfId,
};

function freshState() {
  return {
    doc: {
      activeId: 'base',
      source: 'git',
      parts: [{ id: 'base', name: 'Base' }],
    },
    scripts: { base: 'let part = kept();\nreturn part;\n' },
    editorText: '',
    flushEditor: true,
  };
}

test('concurrent creates of the same name and script add one part and keep the script', async () => {
  const queue = createPartQueue();
  let state = freshState();
  const script = 'let part = fastener();\nreturn part;\n';
  const name = 'Screw M3x10 SHCS';
  const key = partCreateKey(name, script);
  let entered = 0;
  const once = () => queue(key, async () => {
    entered += 1;
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    const planned = commitPartCreate(state, name, { script, fromAgent: true, rowPosition: undefined }, deps);
    state = {
      doc: planned.doc,
      scripts: planned.scripts,
      editorText: planned.starter,
      flushEditor: true,
    };
    return planned.part;
  });
  const [a, b] = await Promise.all([once(), once()]);
  assert.equal(entered, 1);
  assert.equal(a.id, b.id);
  assert.equal(state.doc.parts.filter((row) => row.name === name).length, 1);
  assert.match(state.scripts[a.id], /fastener\(\)/);
  assert.match(state.scripts.base, /kept\(\)/);
  const again = await once();
  assert.notEqual(again.id, a.id);
  assert.equal(again.name, `${name} (2)`);
  assert.match(state.scripts[again.id], /fastener\(\)/);
  assert.match(state.scripts[a.id], /fastener\(\)/);
});

test('concurrent creates with different scripts each keep their script', async () => {
  const queue = createPartQueue();
  let state = freshState();
  const run = (name, script) => queue(partCreateKey(name, script), async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    const planned = commitPartCreate(state, name, { script, fromAgent: true, rowPosition: undefined }, deps);
    state = {
      doc: planned.doc,
      scripts: planned.scripts,
      editorText: planned.starter,
      flushEditor: true,
    };
    return planned.part;
  });
  const [bracket, cover] = await Promise.all([
    run('Bracket', 'let part = bracket();\nreturn part;\n'),
    run('Cover', 'let part = cover();\nreturn part;\n'),
  ]);
  assert.notEqual(bracket.id, cover.id);
  assert.match(state.scripts[bracket.id], /bracket\(\)/);
  assert.match(state.scripts[cover.id], /cover\(\)/);
  assert.match(state.scripts.base, /kept\(\)/);
  assert.equal(state.doc.parts.length, 3);
});

test('an empty editor does not replace a stored script', () => {
  const state = freshState();
  const planned = commitPartCreate(state, 'Bracket', {
    script: 'let part = bracket();\nreturn part;\n',
    fromAgent: true,
    rowPosition: undefined,
  }, deps);
  assert.match(planned.scripts.base, /kept\(\)/);
  assert.match(planned.scripts[planned.part.id], /bracket\(\)/);
});

test('createdPartFromDocs returns the new row when activeId stayed on the old part', () => {
  const before = {
    activeId: 'old',
    parts: [{ id: 'old', name: 'Base' }],
  };
  const after = {
    activeId: 'old',
    parts: [
      { id: 'old', name: 'Base' },
      { id: 'new-part', name: 'Cube' },
    ],
  };
  const created = createdPartFromDocs(before, after);
  assert.equal(created?.id, 'new-part');
  assert.notEqual(created?.id, after.activeId);
});

test('createdPartFromDocs returns the new row when it was activated', () => {
  const before = { parts: [{ id: 'old' }] };
  const after = { activeId: 'new-part', parts: [{ id: 'old' }, { id: 'new-part' }] };
  assert.equal(createdPartFromDocs(before, after)?.id, 'new-part');
});

test('createdPartFromDocs does not guess when no single new row exists', () => {
  const before = { parts: [{ id: 'old' }] };
  assert.equal(createdPartFromDocs(before, before), null);
  assert.equal(createdPartFromDocs(before, { parts: [] }), null);
  assert.equal(createdPartFromDocs(null, null), null);
  const two = {
    parts: [{ id: 'old' }, { id: 'a' }, { id: 'b' }],
  };
  assert.equal(createdPartFromDocs(before, two), null);
});
