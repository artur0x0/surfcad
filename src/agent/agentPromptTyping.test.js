import assert from 'node:assert/strict';
import test from 'node:test';
import { TYPING_IDLE, typingReducer, typingSeed, typingShown } from './agentPromptTyping.js';

const run = (events, start = TYPING_IDLE) => events.reduce(typingReducer, start);

test('the indicator shows only while the sent prompt is in progress', () => {
  assert.equal(typingShown(TYPING_IDLE), false);
  const sent = run([{ type: 'sent', id: 'p1' }]);
  assert.equal(typingShown(sent), true);
  const chunk = run([{ type: 'reply', id: 'p1', text: 'Adding', final: false }], sent);
  assert.equal(typingShown(chunk), true);
  assert.equal(chunk.streaming, true);
});

test('it clears on the final reply, on status done, on a failed delivery, on Stop, and on disconnect', () => {
  const sent = run([{ type: 'sent', id: 'p1' }, { type: 'working', on: true }]);
  for (const closer of [
    { type: 'reply', id: 'p1', text: 'Done.', final: true },
    { type: 'working', on: false },
    { type: 'ack', id: 'p1', delivery: 'failed', error: 'not_paired' },
    { type: 'stop' },
    { type: 'disconnect' },
    { type: 'timeout' },
  ]) {
    const after = run([closer], sent);
    assert.equal(typingShown(after), false, JSON.stringify(closer));
    assert.equal(after.pendingId, null, JSON.stringify(closer));
    assert.equal(after.working, false);
    assert.equal(after.streaming, false);
  }
});

test('a late, duplicate, or out-of-order status does not bring it back', () => {
  const done = run([
    { type: 'sent', id: 'p1' },
    { type: 'working', on: true },
    { type: 'reply', id: 'p1', text: 'Yes, I got it.', final: true },
  ]);
  assert.equal(typingShown(done), false);
  // Late working: true after the final reply (the agent's next tool call).
  assert.equal(typingShown(run([{ type: 'working', on: true }], done)), false);
  // The same status twice.
  assert.equal(typingShown(run([{ type: 'working', on: true }, { type: 'working', on: true }], done)), false);
  // Out of order: a non-final chunk for the closed prompt arrives after the final one.
  assert.equal(typingShown(run([{ type: 'reply', id: 'p1', text: 'tail', final: false }], done)), false);
  // Status for a prompt that was never sent from this tab.
  assert.equal(typingShown(run([{ type: 'working', on: true }])), false);
  // A reply for another id does not count against the pending prompt.
  const pending = run([{ type: 'sent', id: 'p2' }]);
  const other = run([{ type: 'reply', id: 'p1', text: 'old', final: true }], pending);
  assert.equal(typingShown(other), true);
  assert.equal(other.pendingId, 'p2');
});

test('status done followed by a stray final reply stays cleared; a new prompt starts fresh', () => {
  const idle = run([
    { type: 'sent', id: 'p1' },
    { type: 'working', on: false },
    { type: 'reply', id: 'p1', text: 'late answer', final: true },
  ]);
  assert.equal(typingShown(idle), false);
  const next = run([{ type: 'sent', id: 'p2' }], idle);
  assert.equal(typingShown(next), true);
  assert.equal(next.pendingId, 'p2');
  assert.equal(next.streaming, false);
});

test('a failed ack for another prompt id is ignored; an ack without an id applies', () => {
  const sent = run([{ type: 'sent', id: 'p2' }]);
  assert.equal(typingShown(run([{ type: 'ack', id: 'p1', delivery: 'failed' }], sent)), true);
  assert.equal(typingShown(run([{ type: 'ack', delivery: 'failed' }], sent)), false);
  assert.equal(typingShown(run([{ type: 'ack', id: 'p2', delivery: 'queued' }], sent)), true);
});

test('demo seeds mirror the working and streaming states', () => {
  assert.equal(typingSeed({}), TYPING_IDLE);
  assert.equal(typingShown(typingSeed({ working: true })), true);
  assert.equal(typingShown(typingSeed({ streaming: true })), true);
  assert.equal(typingSeed({ streaming: true }).pendingId, 'demo');
});
