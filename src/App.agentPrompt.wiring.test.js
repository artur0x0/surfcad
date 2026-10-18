import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8');

test('both shells mount the floating prompt on the CAD viewer, not the hidden editor row', () => {
  assert.match(APP, /const agentPromptNode = appMode !== 'game'/);
  assert.match(APP, /<PromptInput isMobile=\{isMobile\} captureViewer=\{captureViewerShot\} \/>/);
  assert.match(APP, /capturePng\?\.\(\{ format: 'png' \}\)/);
  assert.equal((APP.match(/\{agentPromptNode\}/g) || []).length, 2);
  assert.doesNotMatch(APP, /data-ai-prompt-row/);
  assert.doesNotMatch(APP, /onCodeGenerated/);
  assert.doesNotMatch(APP, /handleCodeGenerated/);
});

test('the agent_prompt host handler is published on the bridge', () => {
  assert.match(APP, /import \{ runAgentPrompt \} from '\.\/agent\/agentPromptHost\.js'/);
  assert.match(APP, /agentPrompt: runAgentPrompt/);
});
