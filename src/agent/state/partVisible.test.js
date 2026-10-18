import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { COMMAND_META } from '../export/commandMeta.js';
import { decidePartVisible } from './partVisible.js';

function doc() {
  return {
    name: 'Asm',
    activeId: 'active-id',
    source: 'local',
    parts: [
      { id: 'active-id', name: 'Active', visible: true, path: 'assemblies/Box/Active.js' },
      { id: 'other-id', name: 'Other', visible: true, path: 'assemblies/Box/Other.js' },
    ],
  };
}

test('decidePartVisible hides and shows by exact id only', () => {
  const hidden = decidePartVisible(doc(), 'other-id', false);
  assert.equal(hidden.error, undefined);
  assert.equal(hidden.changed, true);
  assert.deepEqual(hidden.result, { partId: 'other-id', visible: false });
  const rows = hidden.doc.parts;
  assert.equal(rows.find((row) => row.id === 'other-id').visible, false);
  assert.equal(rows.find((row) => row.id === 'active-id').visible, true);

  const shown = decidePartVisible(hidden.doc, 'other-id', true);
  assert.equal(shown.result.visible, true);
  assert.equal(shown.doc.parts.find((row) => row.id === 'other-id').visible, true);
});

test('decidePartVisible does not accept a path or fall back to the active part', () => {
  const byPath = decidePartVisible(doc(), 'assemblies/Box/Other.js', false);
  assert.equal(byPath.error.code, 'unknown_part');
  assert.match(byPath.error.message, /opaque id/);
  assert.match(byPath.error.details.hint, /does not fall back to the active part/);
  assert.equal(byPath.doc, undefined);

  const missing = decidePartVisible(doc(), 'missing-id', false);
  assert.equal(missing.error.code, 'unknown_part');
  assert.equal(missing.doc, undefined);

  const same = decidePartVisible(doc(), 'other-id', true);
  assert.equal(same.changed, false);
  assert.equal(same.doc, undefined);
});

test('set_part_visible makes no git calls', async () => {
  const calls = [];
  const host = new Proxy({
    setPartVisible(args) {
      calls.push(['setPartVisible', args.partId, args.visible]);
      return { result: { partId: args.partId, visible: args.visible } };
    },
  }, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /git|commit|vault|flush/i.test(prop)) {
        return () => { calls.push([prop]); };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const api = createSurfcadBridge({ resolve: () => host });
  const hidden = await api.call('set_part_visible', { part_id: 'other-id', visible: false });
  assert.equal(hidden.ok, true);
  assert.deepEqual(hidden.result, { partId: 'other-id', visible: false });
  assert.deepEqual(calls, [['setPartVisible', 'other-id', false]]);

  const path = await api.call('set_part_visible', { part_id: 'assemblies/Box/Other.js', visible: false });
  assert.equal(path.ok, false);
  assert.equal(path.error.code, 'unknown_part');
  assert.deepEqual(calls, [['setPartVisible', 'other-id', false]]);
});

test('App setPartVisible host does not call git', () => {
  const src = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8');
  const start = src.indexOf('async setPartVisible(');
  assert.ok(start > 0);
  const end = src.indexOf('\n    },', start);
  const body = src.slice(start, end);
  assert.match(body, /decidePartVisible/);
  assert.match(body, /rememberAssembly/);
  assert.doesNotMatch(body, /enqueueGit|flushGitOps|commitFiles|gitSave|enqueueAssemblySave|prepareAssemblySurfWrite|agentGit/);
});

test('status, parts, set_script, and run describe the new contracts', () => {
  assert.match(COMMAND_META.status.description, /featureCount counts insert_\* feature blocks, so a freehand set_script is one feature/);
  assert.match(COMMAND_META.status.description, /bodyCount is null until the first run/);
  assert.match(COMMAND_META.parts.description, /featureCount counts insert_\* feature blocks, so a freehand set_script is one feature/);
  assert.match(COMMAND_META.parts.description, /bodyCount is null until the first run/);
  assert.match(COMMAND_META.set_script.description, /reserved SurfCAD helper/);
  assert.match(COMMAND_META.set_script.description, /\bcut\b/);
  assert.match(COMMAND_META.run.description, /reserved SurfCAD helper/);
  assert.match(COMMAND_META.set_part_visible.description, /agent_set_visible/);
});
