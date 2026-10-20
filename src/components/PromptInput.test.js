import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importJsx } from '../../test/jsxTestModule.js';
import { AGENT_PROMPT_TYPED } from '../agent/agentPromptDemo.js';

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
  assert.match(SRC, /promptContext/);
  assert.match(SRC, /bindAgentPromptTransport/);
  assert.match(SRC, /AGENT_PROMPT_WORKING_TIMEOUT_MS/);
  assert.doesNotMatch(SRC, /data: '',/);
  assert.doesNotMatch(SRC, /innerHTML/);
  assert.doesNotMatch(SRC, /dangerouslySetInnerHTML/);
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
  assert.match(SRC, /Waiting for agent/);
  assert.match(SRC, /data-agent-prompt-ack="failed"/);
  assert.match(SRC, /data-agent-prompt-ack="queued"/);
  assert.match(SRC, /aria-pressed=\{shotCue\}/);
  assert.match(SRC, /aria-label=\{shotCue \? 'Discard screenshot' : 'Attach screenshot'\}/);
  assert.match(SRC, /Agent is working\.\.\./);
  assert.match(SRC, /agent-prompt-spinner/);
  assert.match(SRC, /data-agent-reply-dots/);
  assert.match(SRC, /agent-prompt--away/);
  assert.match(SRC, /featurePopupOpen/);
  assert.doesNotMatch(SRC, /abort/);
  assert.match(SRC, /const id = pendingIdRef\.current;/);
  assert.match(SRC, /void transport\.cancel\(id\)/);
  // The dots, Stop, and the working hint follow one pending prompt (agentPromptTyping.js).
  assert.match(SRC, /dispatchTyping\(\{ type: 'stop' \}\)/);
  assert.match(SRC, /dispatchTyping\(\{ type: 'sent', id: sent\.id \}\)/);
  assert.match(SRC, /dispatchTyping\(\{ type: 'disconnect' \}\)/);
  assert.match(SRC, /const responding = typingShown\(typing\);/);
  assert.doesNotMatch(SRC, /setWorking\(/);
  assert.doesNotMatch(SRC, /setStreaming\(/);
});

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');

test('prompt motion is CSS-only and respects reduced motion', () => {
  assert.match(css, /@keyframes agent-prompt-bounce/);
  assert.match(css, /@keyframes agent-prompt-spin/);
  assert.match(css, /\.agent-prompt--away/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.agent-prompt-spinner/);
  assert.match(css, /\.agent-prompt-dots span/);
});

const DEV = { DEV: true };

function renderPrompt(search, props = {}) {
  return renderToStaticMarkup(React.createElement(PromptInput, {
    demoSearch: search,
    promptEnv: DEV,
    ...props,
  }));
}

let PromptInput;

test('working state shows the spinner hint, Stop, and reply dots', async () => {
  ({ default: PromptInput } = await importJsx(new URL('./PromptInput.jsx', import.meta.url)));
  const working = renderPrompt('?agentPromptDemo=1&agentPromptState=working');
  assert.match(working, /agent-prompt-spinner/);
  assert.match(working, /Agent is working\.\.\./);
  assert.match(working, /data-agent-prompt-working="1"/);
  assert.match(working, /aria-label="Stop agent"/);
  assert.match(working, /data-agent-prompt-stop=""/);
  assert.match(working, /data-agent-reply-dots=""/);
  assert.match(working, /Updating the cube/);
  assert.doesNotMatch(working, /data-agent-prompt-send=""/);
  assert.match(working, /data-agent-reply-body="">Updating the cube/);

  const streaming = renderPrompt('?agentPromptDemo=1&agentPromptState=reply-streaming');
  assert.match(streaming, /data-agent-reply-dots=""/);
  assert.match(streaming, /Adding the holes/);
  assert.match(streaming, /data-agent-prompt-working="0"/);
  assert.match(streaming, /data-agent-prompt-send=""/);
  assert.doesNotMatch(streaming, /Agent is working/);

  const idle = renderPrompt('?agentPromptDemo=1&agentPromptState=idle');
  assert.match(idle, /Message your agent/);
  assert.match(idle, /aria-label="Send"/);
  assert.match(idle, /data-agent-prompt-away="0"/);
  assert.doesNotMatch(idle, /data-agent-reply-dots/);
  assert.doesNotMatch(idle, /Agent is working/);
});

test('a feature popup slides the prompt away without dropping the draft or camera', async () => {
  if (!PromptInput) {
    ({ default: PromptInput } = await importJsx(new URL('./PromptInput.jsx', import.meta.url)));
  }
  const away = renderPrompt('?agentPromptDemo=1&agentPromptState=typing', { featurePopupOpen: true });
  assert.match(away, /agent-prompt--away/);
  assert.match(away, /data-agent-prompt-away="1"/);
  assert.match(away, new RegExp(AGENT_PROMPT_TYPED.split('\n')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(away, /data-agent-prompt-shot="0"/);

  const shot = renderPrompt('?agentPromptDemo=1&agentPromptState=shot-on', { featurePopupOpen: true });
  assert.match(shot, /data-agent-prompt-shot="1"/);
  assert.match(shot, /data-agent-prompt-away="1"/);

  const back = renderPrompt('?agentPromptDemo=1&agentPromptState=typing', { featurePopupOpen: false });
  assert.match(back, /data-agent-prompt-away="0"/);
  assert.doesNotMatch(back, /agent-prompt--away/);
  assert.match(back, new RegExp(AGENT_PROMPT_TYPED.split('\n')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('the pane reads like a chat: both senders in order, user bubbles right with a thumbnail, dots at the bottom', async () => {
  if (!PromptInput) {
    ({ default: PromptInput } = await importJsx(new URL('./PromptInput.jsx', import.meta.url)));
  }
  const chat = renderPrompt('?agentPromptDemo=1&agentPromptState=chat');
  const roles = [...chat.matchAll(/data-agent-msg="(user|agent)"/g)].map((m) => m[1]);
  assert.deepEqual(roles, ['user', 'agent', 'user', 'agent']);
  assert.ok(chat.indexOf('Did you get the reference photo') < chat.indexOf('Yes, I got it.'));
  assert.ok(chat.indexOf('Yes, I got it.') < chat.indexOf('Rebuild the bike'));
  assert.match(chat, /agent-prompt-msg--user surface-quiet/);
  assert.match(chat, /data-agent-msg-thumb=""/);
  assert.match(chat, /data-agent-chat-count="4"/);
  assert.match(chat, /aria-label="Dismiss conversation"/);
  assert.doesNotMatch(chat, /data-agent-typing/);

  const working = renderPrompt('?agentPromptDemo=1&agentPromptState=working');
  // The dots sit at the bottom of the conversation, after the last message.
  assert.ok(working.indexOf('data-agent-reply-body=""') < working.indexOf('data-agent-typing=""'));
  assert.doesNotMatch(working, /data-agent-prompt-dismiss/);

  // The history is component state only: nothing is stored.
  assert.doesNotMatch(SRC, /localStorage|sessionStorage|indexedDB/);
  assert.match(SRC, /dispatchChat\(\{ type: 'disconnect' \}\)/);
  assert.match(SRC, /dispatchChat\(\{ type: 'dismiss' \}\)/);
  assert.match(SRC, /stickToBottom\(el\)/);
  assert.match(SRC, /data-agent-prompt-jump=""/);
});

test('the pane caps its height and scrolls inside; user bubbles are right-aligned', () => {
  assert.match(css, /--agent-prompt-max-reply: min\(200px, 40vh\);/);
  assert.match(css, /--agent-prompt-max-reply-mobile: min\(160px, 32vh\);/);
  assert.match(css, /\.agent-prompt-reply \{[^}]*max-height: var\(--agent-prompt-max-reply\);[^}]*overflow-y: auto;/s);
  assert.match(css, /\.agent-prompt-msg--user \{[^}]*align-self: flex-end;/s);
  assert.match(css, /\.agent-prompt-msg--agent \{[^}]*align-self: stretch;/s);
  assert.match(css, /\.agent-prompt-jump \{[^}]*position: sticky;/s);
});
