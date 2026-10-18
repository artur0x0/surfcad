import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'PromptInput.jsx'),
  'utf8',
);

test('PromptInput tags send/stop/dismiss/screenshot and uses the outline send + camera toggle', () => {
  assert.match(SRC, /data-ui-action="data-agent-prompt-send"/);
  assert.match(SRC, /data-ui-action="data-agent-prompt-stop"/);
  assert.match(SRC, /data-ui-action="data-agent-prompt-dismiss"/);
  assert.match(SRC, /data-ui-action="data-agent-prompt-screenshot"/);
  assert.match(SRC, /<Camera /);
  assert.match(SRC, /<Send /);
  assert.match(SRC, /shotCue \? 'text-success' : 'text-on-dark'/);
  assert.match(SRC, /Screenshot attached/);
  assert.match(SRC, /discardShot\(\)/);
  assert.match(SRC, /sendAgentPromptText\(/);
  assert.match(SRC, /attachViewerShot/);
  assert.doesNotMatch(SRC, /data: '',/);
  assert.match(SRC, /disabled=\{!canCapture && !shotCue\}/);
  assert.match(SRC, /shouldShowAgentPrompt/);
  assert.match(SRC, /shouldShowAgentBridgeDisconnect/);
  assert.match(SRC, /demoAllowed/);
  assert.match(SRC, /agentPromptDemoAllowed/);
  assert.doesNotMatch(SRC, /\/api\/generate/);
});

test('demo states seed idle, typing, replies, working, and camera on/off', () => {
  assert.match(SRC, /state === 'shot-on'/);
  assert.match(SRC, /state === 'working'/);
  assert.match(SRC, /state === 'reply-long'/);
  assert.match(SRC, /state === 'reply-short'/);
  assert.match(SRC, /state === 'typing'/);
  assert.match(SRC, /AGENT_PROMPT_TYPED/);
  assert.match(SRC, /Agent is working/);
  assert.match(SRC, /aria-pressed=\{shotCue\}/);
  assert.match(SRC, /aria-label=\{shotCue \? 'Discard screenshot' : 'Attach screenshot'\}/);
});
