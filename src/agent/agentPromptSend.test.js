import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_PROMPT_SEND_TIMEOUT_MS,
  clearAcceptedPrompt,
  emptyPromptFlight,
  promptDraftText,
  restorePromptDraft,
  shouldClearPromptOnSend,
  stepPromptFlight,
} from './agentPromptSend.js';

test('the DOM value wins when React state is behind an IME or autocorrect', () => {
  assert.equal(promptDraftText('seat tube', 'seat tub', false), 'seat tube');
  assert.equal(promptDraftText('シート', '', true), 'シート');
  assert.equal(promptDraftText('same', 'same', false), 'same');
  assert.equal(promptDraftText('', 'kept', false), 'kept');
  assert.equal(promptDraftText('', '', false), '');
});

test('the field clears only after the transport accepts the send', () => {
  assert.equal(shouldClearPromptOnSend({ ok: true, id: 'a' }, null), true);
  assert.equal(
    shouldClearPromptOnSend({ ok: true, id: 'a' }, { id: 'a', delivery: 'failed' }),
    false,
  );
  assert.equal(
    shouldClearPromptOnSend({ ok: true, id: 'a' }, { id: 'b', delivery: 'failed' }),
    true,
  );
  assert.equal(shouldClearPromptOnSend({ ok: false, reason: 'empty' }, null), false);
  assert.equal(shouldClearPromptOnSend(null, null), false);
  assert.equal(AGENT_PROMPT_SEND_TIMEOUT_MS, 12_000);
  assert.ok(AGENT_PROMPT_SEND_TIMEOUT_MS > 8_000);
});

function applyInput(input, effect) {
  if (!effect || effect.ignore || !effect.input) return input;
  if (effect.input.op === 'restore') return restorePromptDraft(input, effect.input.text);
  if (effect.input.op === 'clear') return clearAcceptedPrompt(input, effect.input.text);
  return input;
}

test('a timeout restores the draft and a late ack does not clear it', () => {
  let flight = emptyPromptFlight();
  let input = 'make a bracket';
  flight = stepPromptFlight(flight, { type: 'sent', id: 'a', text: input }).flight;
  input = '';
  const timed = stepPromptFlight(flight, { type: 'timeout', id: 'a' });
  assert.equal(timed.ignore, false);
  assert.equal(timed.cancelId, 'a');
  assert.deepEqual(timed.ack, { delivery: 'failed', error: 'timeout', id: 'a' });
  assert.equal(timed.flight.pendingId, null);
  assert.equal(timed.flight.sent, null);
  input = applyInput(input, timed);
  assert.equal(input, 'make a bracket');
  flight = timed.flight;
  for (const delivery of ['queued', 'webhook']) {
    const late = stepPromptFlight(flight, { type: 'ack', id: 'a', delivery });
    assert.equal(late.ignore, true, delivery);
    assert.equal(late.input, null, delivery);
    input = applyInput(input, late);
    assert.equal(input, 'make a bracket', delivery);
  }
});

test('a timeout keeps an edited draft and a late ack leaves that edit', () => {
  let flight = emptyPromptFlight();
  flight = stepPromptFlight(flight, { type: 'sent', id: 'a', text: 'make a bracket' }).flight;
  let input = 'make a bracket, 4 holes';
  const timed = stepPromptFlight(flight, { type: 'timeout', id: 'a' });
  input = applyInput(input, timed);
  assert.equal(input, 'make a bracket, 4 holes');
  flight = timed.flight;
  for (const delivery of ['queued', 'webhook']) {
    const late = stepPromptFlight(flight, { type: 'ack', id: 'a', delivery });
    assert.equal(late.ignore, true, delivery);
    input = applyInput(input, late);
    assert.equal(input, 'make a bracket, 4 holes', delivery);
  }
  const stale = { ...flight, pendingId: 'a' };
  const forced = stepPromptFlight(stale, { type: 'ack', id: 'a', delivery: 'queued' });
  assert.equal(forced.ignore, true);
  assert.equal(applyInput(input, forced), input);
});

test('re-send after timeout cancels the first prompt and leaves one live id', () => {
  let flight = emptyPromptFlight();
  const cancels = [];
  flight = stepPromptFlight(flight, { type: 'sent', id: 'a', text: 'first' }).flight;
  const timed = stepPromptFlight(flight, { type: 'timeout', id: 'a' });
  assert.equal(timed.cancelId, 'a');
  cancels.push(timed.cancelId);
  flight = timed.flight;
  assert.equal(flight.pendingId, null);
  flight = stepPromptFlight(flight, { type: 'sent', id: 'b', text: 'second' }).flight;
  assert.deepEqual(cancels, ['a']);
  assert.equal(flight.pendingId, 'b');
  assert.equal(flight.timedOutIds.includes('a'), true);
  assert.equal(flight.timedOutIds.includes('b'), false);
  const late = stepPromptFlight(flight, { type: 'ack', id: 'a', delivery: 'webhook' });
  assert.equal(late.ignore, true);
  assert.equal(flight.pendingId, 'b');
  const queued = stepPromptFlight(flight, { type: 'ack', id: 'a', delivery: 'queued' });
  assert.equal(queued.ignore, true);
  const accepted = stepPromptFlight(flight, { type: 'ack', id: 'b', delivery: 'queued' });
  assert.equal(accepted.ignore, false);
  assert.deepEqual(accepted.input, { op: 'clear', text: 'second' });
  assert.equal(applyInput('second', accepted), '');
  assert.equal(stepPromptFlight(flight, { type: 'timeout', id: 'a' }).ignore, true);
  assert.equal(stepPromptFlight(flight, { type: 'timeout', id: 'a' }).cancelId, null);
});

test('an ack is applied only for the current pending id', () => {
  let flight = stepPromptFlight(emptyPromptFlight(), {
    type: 'sent', id: 'a', text: 'seat tube',
  }).flight;
  const other = stepPromptFlight(flight, { type: 'ack', id: 'b', delivery: 'queued' });
  assert.equal(other.ignore, true);
  assert.equal(flight.pendingId, 'a');
  const beforePending = stepPromptFlight(emptyPromptFlight(), {
    type: 'ack', id: 'a', delivery: 'failed',
  });
  assert.equal(beforePending.ignore, true);
  const failed = stepPromptFlight(flight, { type: 'ack', id: 'a', delivery: 'failed' });
  assert.equal(failed.ignore, false);
  assert.equal(applyInput('', failed), 'seat tube');
  assert.equal(failed.flight.pendingId, 'a');
  const webhook = stepPromptFlight(flight, { type: 'ack', id: 'a', delivery: 'webhook' });
  assert.equal(webhook.ignore, false);
  assert.equal(applyInput('seat tube', webhook), '');
});
