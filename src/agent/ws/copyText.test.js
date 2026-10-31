import test from 'node:test';
import assert from 'node:assert/strict';
import { copyTextWithFallback } from './copyText.js';

function fakeDocument({ result = true, throwExec = false } = {}) {
  const created = [];
  return {
    created,
    body: {
      appendChild(node) { created.push(node); },
    },
    createElement() {
      return {
        value: '',
        style: {},
        attrs: {},
        setAttribute(name, value) { this.attrs[name] = value; },
        focus() { this.focused = true; },
        select() { this.selected = true; },
        remove() { this.removed = true; },
      };
    },
    execCommand(command) {
      if (throwExec) throw new Error('exec failed');
      return command === 'copy' && result;
    },
  };
}

test('clipboard.writeText is used when it exists', async () => {
  const writes = [];
  const doc = fakeDocument();
  const ok = await copyTextWithFallback('hello', {
    navigator: { clipboard: { writeText: async (value) => { writes.push(value); } } },
    document: doc,
  });
  assert.equal(ok, true);
  assert.deepEqual(writes, ['hello']);
  assert.equal(doc.created.length, 0);
});

test('a missing clipboard falls back to a hidden textarea and execCommand', async () => {
  const doc = fakeDocument();
  const ok = await copyTextWithFallback('full prompt', {
    navigator: {},
    document: doc,
  });
  assert.equal(ok, true);
  assert.equal(doc.created.length, 1);
  assert.equal(doc.created[0].value, 'full prompt');
  assert.equal(doc.created[0].selected, true);
  assert.equal(doc.created[0].removed, true);
  assert.equal(doc.created[0].style.left, '-9999px');
});

test('a thrown writeText falls back, and a failed execCommand is not success', async () => {
  const doc = fakeDocument({ result: false });
  const ok = await copyTextWithFallback('prompt', {
    navigator: { clipboard: { writeText: async () => { throw new Error('insecure'); } } },
    document: doc,
  });
  assert.equal(ok, false);
  assert.equal(doc.created.length, 1);
  assert.equal(doc.created[0].removed, true);
});

test('an execCommand throw is not success', async () => {
  const doc = fakeDocument({ throwExec: true });
  const ok = await copyTextWithFallback('prompt', {
    navigator: { clipboard: {} },
    document: doc,
  });
  assert.equal(ok, false);
  assert.equal(doc.created[0].removed, true);
});
