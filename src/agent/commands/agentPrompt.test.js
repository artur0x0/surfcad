import assert from 'node:assert/strict';
import test from 'node:test';
import { v1Registry } from './index.js';
import { agentPromptCommand } from './agentPrompt.js';

test('agent_prompt is registered with send/stop/dismiss/screenshot ui entries', () => {
  const command = v1Registry.get('agent_prompt');
  assert.equal(command.name, 'agent_prompt');
  assert.deepEqual(command.uiEntry, [
    'data-agent-prompt-send',
    'data-agent-prompt-stop',
    'data-agent-prompt-dismiss',
    'data-agent-prompt-screenshot',
  ]);
  assert.equal(command.schema.additionalProperties, false);
  assert.deepEqual(command.schema.properties.action.enum, ['send', 'stop', 'dismiss', 'screenshot']);
  assert.equal(command.example.action, 'send');
});

test('agent_prompt run forwards text and action to the host handler', () => {
  const calls = [];
  const ctx = {
    agentPrompt(args) {
      calls.push(args);
      return { ok: true, id: 'prompt-1', attached: args.action === 'screenshot' };
    },
  };
  const sent = agentPromptCommand.run(ctx, { text: 'Add a fillet', action: 'send' });
  assert.deepEqual(sent, { result: { ok: true, id: 'prompt-1', attached: false } });
  const shot = agentPromptCommand.run(ctx, { action: 'screenshot' });
  assert.equal(shot.result.attached, true);
  assert.deepEqual(calls[0], { text: 'Add a fillet', action: 'send' });
  assert.deepEqual(calls[1], { action: 'screenshot' });
});

test('agent_prompt reports unavailable when the host handler is missing', () => {
  const out = agentPromptCommand.run({}, { text: 'hi' });
  assert.equal(out.error.code, 'internal');
});
