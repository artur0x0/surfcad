import assert from 'node:assert/strict';
import test from 'node:test';
import { PROMPT_REPLY_MAX } from '../../packages/surfcad-mcp/src/prompt/promptSession.mjs';
import { sessionMessageProblem } from '../agent/sessionMessage.js';

test('a session note is plain text with no prompt id', () => {
  assert.equal(sessionMessageProblem({ type: 'agent.message', v: 1, text: '<b>hi</b>' }), null);
  assert.equal(sessionMessageProblem({ type: 'agent.reply', v: 1, id: 'p', text: 'ok' }), null);
  assert.equal(sessionMessageProblem({ type: 'agent.message', v: 1, id: 'x', text: 'spoof' }), 'bad_call');
  assert.equal(sessionMessageProblem({ type: 'agent.message', v: 2, text: 'hi' }), 'bad_call');
  assert.equal(sessionMessageProblem({ type: 'agent.message', v: 1, text: '' }), 'bad_call');
  assert.equal(sessionMessageProblem({
    type: 'agent.message',
    v: 1,
    text: 'a'.repeat(PROMPT_REPLY_MAX + 1),
  }), 'reply_too_long');
});
