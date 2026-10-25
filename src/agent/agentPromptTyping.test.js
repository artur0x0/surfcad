import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TYPING_IDLE,
  modeFromStatus,
  pendingShown,
  typingReducer,
  typingSeed,
  typingShown,
  workingShown,
} from './agentPromptTyping.js';

const run = (events, start = TYPING_IDLE) => events.reduce(typingReducer, start);

test('a partial reply leaves building in place and keeps responding on the dots', () => {
  const building = run([{ type: 'sent', id: 'p1' }, { type: 'state', state: 'working' }]);
  const chunk = run([{ type: 'reply', id: 'p1', text: 'Still ', final: false }], building);
  assert.equal(workingShown(chunk), true);
  assert.equal(typingShown(chunk), false);
  assert.equal(chunk.mode, 'working');
  const responding = run([{ type: 'sent', id: 'p2' }]);
  const answered = run([{ type: 'reply', id: 'p2', text: 'Here ', final: false }], responding);
  assert.equal(typingShown(answered), true);
  assert.equal(workingShown(answered), false);
});

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
  ]) {
    const after = run([closer], sent);
    assert.equal(typingShown(after), false, JSON.stringify(closer));
    assert.equal(after.pendingId, null, JSON.stringify(closer));
    assert.equal(after.working, false);
    assert.equal(after.streaming, false);
  }
});

test('a missed deadline stalls in place: Stop stays, and the next activity clears it', () => {
  const sent = run([{ type: 'sent', id: 'p1' }, { type: 'state', state: 'working' }]);
  const stalled = run([{ type: 'stall' }], sent);
  assert.equal(stalled.stalled, true);
  assert.equal(pendingShown(stalled), true);
  assert.equal(workingShown(stalled), true);
  assert.equal(stalled.pendingId, 'p1');
  assert.equal(run([{ type: 'timeout' }], stalled), stalled);
  const resumed = run([{ type: 'activity' }], stalled);
  assert.equal(resumed.stalled, false);
  assert.equal(workingShown(resumed), true);
  assert.equal(run([{ type: 'state', state: 'working' }], stalled).stalled, false);
  assert.equal(run([{ type: 'reply', id: 'p1', text: 'Done.', final: true }], stalled).pendingId, null);
  assert.equal(run([{ type: 'stop' }], stalled).mode, 'idle');
  assert.equal(run([{ type: 'disconnect' }], stalled).mode, 'idle');
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

test('demo seeds mirror the working, streaming, and mode states', () => {
  assert.equal(typingSeed({}), TYPING_IDLE);
  assert.equal(workingShown(typingSeed({ working: true })), true);
  assert.equal(typingShown(typingSeed({ working: true })), false);
  assert.equal(typingShown(typingSeed({ streaming: true })), true);
  assert.equal(typingSeed({ streaming: true }).pendingId, 'demo');
  assert.equal(typingSeed({ mode: 'typing' }).mode, 'typing');
  assert.equal(workingShown(typingSeed({ mode: 'working' })), true);
});

test('two modes: a sent prompt waits as typing, a working status collapses to the spinner, a partial reply stays there', () => {
  const sent = run([{ type: 'sent', id: 'p1' }]);
  assert.equal(sent.mode, 'typing');
  assert.equal(typingShown(sent), true);
  assert.equal(workingShown(sent), false);
  assert.equal(pendingShown(sent), true);
  const working = run([{ type: 'state', state: 'working' }], sent);
  assert.equal(working.mode, 'working');
  assert.equal(working.working, true);
  assert.equal(typingShown(working), false);
  assert.equal(workingShown(working), true);
  // The legacy boolean maps the same way.
  assert.equal(run([{ type: 'working', on: true }], sent).mode, 'working');
  // An explicit typing state leaves building. A partial reply does not.
  assert.equal(run([{ type: 'state', state: 'typing' }], working).mode, 'typing');
  const streamed = run([{ type: 'reply', id: 'p1', text: 'Adding', final: false }], working);
  assert.equal(streamed.mode, 'working');
  assert.equal(streamed.streaming, false);
  assert.equal(workingShown(streamed), true);
  // Idle closes; an unknown state is ignored; a state for no prompt is ignored.
  assert.equal(run([{ type: 'state', state: 'idle' }], working).pendingId, null);
  assert.equal(run([{ type: 'state', state: 'bogus' }], working).mode, 'working');
  assert.equal(run([{ type: 'state', state: 'working' }]).mode, 'idle');
  // Stop in either mode goes back to idle.
  assert.equal(run([{ type: 'stop' }], working).mode, 'idle');
  assert.equal(run([{ type: 'stop' }], streamed).mode, 'idle');
});

test('modeFromStatus reads state first, then the legacy boolean', () => {
  assert.equal(modeFromStatus({ working: true, state: 'typing' }), 'typing');
  assert.equal(modeFromStatus({ working: true }), 'working');
  assert.equal(modeFromStatus({ working: false }), 'idle');
  assert.equal(modeFromStatus({ state: 'nope' }), null);
  assert.equal(modeFromStatus(null), null);
});
