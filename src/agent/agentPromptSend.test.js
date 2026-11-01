import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_PROMPT_SEND_TIMEOUT_MS,
  promptDraftText,
  shouldClearPromptOnSend,
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
