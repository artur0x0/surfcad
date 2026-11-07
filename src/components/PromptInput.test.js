import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importJsx } from '../../test/jsxTestModule.js';
import { AGENT_PROMPT_SESSION_NOTE, AGENT_PROMPT_TYPED } from '../agent/agentPromptDemo.js';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'PromptInput.jsx'),
  'utf8',
);
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');

test('PromptInput tags send/stop/dismiss/screenshot and uses the outline send + camera toggle', () => {
  assert.match(SRC, /data-ui-action="data-agent-prompt-send"/);
  assert.match(SRC, /data-ui-action="data-agent-prompt-stop"/);
  assert.match(SRC, /data-ui-action="data-agent-prompt-dismiss"/);
  assert.match(SRC, /data-ui-action="data-agent-prompt-screenshot"/);
  assert.match(SRC, /<Camera /);
  assert.match(SRC, /<Send /);
  // Engaged: a filled success button with the light icon. Idle: the light icon alone.
  assert.match(SRC, /agent-prompt-icon-btn agent-prompt-camera text-on-dark\$\{\s*shotCue \? ' surface-success' : ''\s*\}/);
  assert.match(SRC, /data-agent-prompt-shot-on=\{shotCue \? '1' : '0'\}/);
  assert.match(css, /\.agent-prompt-icon-btn\.surface-success \{\s*background-color: rgb\(var\(--agent-prompt-success\)\);/);
  // One tap is one action: the click that follows a handled pointerup is its echo, however late.
  assert.match(SRC, /createPressGate\(\)/);
  // The image button: nothing attached opens the drawer; an attached image is discarded.
  assert.match(SRC, /cameraGateRef\.current\.press\(\);\s*onAttachPress\(\);/);
  assert.match(SRC, /const onAttachPress = \(\) => \{\s*if \(shotOn \|\| shot\) \{\s*discardShot\(\);\s*return;\s*\}\s*setAttachOpen\(\(open\) => !open\);/);
  assert.match(SRC, /<ImagePlus /);
  // The drawer: Screenshot (the viewer capture, the agent's `screenshot` action) and Photo (the device picker).
  assert.match(SRC, /data-ui-action="data-agent-prompt-attach-screenshot"/);
  assert.match(SRC, /data-ui-action="data-agent-prompt-attach-photo"/);
  assert.match(SRC, /<Monitor /);
  assert.match(SRC, /attachShotGateRef\.current\.press\(\);\s*if \(!shotOn && !shot\) toggleShot\(\);/);
  assert.match(SRC, /attachPhotoGateRef\.current\.press\(\);\s*openPhotoPicker\(\);/);
  assert.match(SRC, /photoInputRef\.current\?\.click\?\.\(\);/);
  assert.match(SRC, /type="file"\s*accept=\{AGENT_PROMPT_PHOTO_ACCEPT\}/);
  assert.match(SRC, /data-agent-prompt-photo-input=""/);
  assert.match(SRC, /if \(input\) input\.value = '';/);
  assert.match(SRC, /out = await photoFileToShot\(file\);/);
  assert.match(SRC, /setShotSource\('photo'\)/);
  assert.match(SRC, /if \(action === 'screenshot'\) return toggleShot\(\);/);
  // The drawer closes on Escape and on a tap elsewhere.
  assert.match(SRC, /if \(event\.key === 'Escape' && attachOpen\)/);
  assert.match(SRC, /document\.addEventListener\('pointerdown', onDown, true\)/);
  assert.match(css, /\.agent-prompt-attach \{/);
  assert.match(css, /\.agent-prompt-photo-input \{/);
  assert.match(SRC, /if \(cameraGateRef\.current\.echo\(\)\) return;/);
  assert.match(SRC, /event\?\.type === 'submit' && actionGateRef\.current\.echo\(\)/);
  assert.doesNotMatch(SRC, /pressHandledRef|setTimeout\(\(\) => \{ pressHandled/);
  // A capture in flight is not toggled again, and a failed capture says so.
  assert.match(SRC, /if \(shotBusyRef\.current\) return \{ ok: false, reason: 'capture_busy'/);
  assert.match(SRC, /setAck\(\{ delivery: 'failed', error: 'capture_failed' \}\)/);
  assert.match(SRC, /shotSource === 'photo' \? 'Photo attached' : 'Screenshot attached'/);
  assert.match(SRC, /discardShot\(\)/);
  assert.match(SRC, /sendAgentPromptText\(/);
  assert.match(SRC, /reason: 'no_transport'/);
  assert.match(SRC, /delivery: 'failed', error: 'not_paired'/);
  assert.match(SRC, /attachViewerShot/);
  assert.match(SRC, /promptContext/);
  assert.match(SRC, /bindAgentPromptTransport/);
  assert.match(SRC, /AGENT_PROMPT_STALL_MS/);
  assert.match(SRC, /agentPromptStallCopy/);
  assert.match(SRC, /data-agent-prompt-stall=""/);
  assert.match(SRC, /onActivity/);
  assert.doesNotMatch(SRC, /data: '',/);
  assert.doesNotMatch(SRC, /innerHTML/);
  assert.doesNotMatch(SRC, /dangerouslySetInnerHTML/);
  // The image button always opens (a photo needs no viewer capture); only
  // the drawer's Screenshot option waits on the capture function.
  assert.doesNotMatch(SRC, /disabled=\{!canCapture && !shotCue\}/);
  assert.match(SRC, /data-agent-prompt-attach-screenshot=""\s*disabled=\{!canCapture\}/);
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
  assert.match(SRC, /aria-label=\{shotCue \? \(shotSource === 'photo' \? 'Discard photo' : 'Discard screenshot'\) : 'Attach an image'\}/);
  assert.match(SRC, /aria-expanded=\{shotCue \? undefined : attachOpen\}/);
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
  assert.match(SRC, /promptDraftText\(/);
  assert.match(SRC, /shouldClearPromptOnSend\(/);
  assert.match(SRC, /AGENT_PROMPT_SEND_TIMEOUT_MS/);
  assert.match(SRC, /stepPromptFlight\(flightRef\.current, \{ type: 'timeout', id: sentId \}\)/);
  assert.match(SRC, /setAck\(timed\.ack\)/);
  assert.match(SRC, /void transport\?\.cancel\?\.\(sentId\)/);
  assert.match(SRC, /type: 'ack'/);
  assert.match(SRC, /error: 'send_failed'/);
  assert.match(SRC, /onPointerDown=\{keepFieldFocus\}/);
  assert.match(SRC, /onPointerUp=\{onActionPointerUp\}/);
  assert.match(SRC, /featureSheetEditLift\(/);
  assert.match(SRC, /useModalViewport\(/);
  // Phone keyboard: the prompt says so, the pill hides, and the rest bottom
  // drops from the pill margin to the keyboard gap. The pill margin is the
  // pill's own pad and height plus room for the tail, so the tail fits when
  // the pad grows to the home-indicator safe area (2026-11-06). The flag
  // follows the visual viewport (the keyboard), never focus alone: a focus
  // flag moved the prompt under a tap that blurred the field.
  assert.match(SRC, /const up = keyboardOpen\(\{ layoutHeight: window\.innerHeight, vvHeight, vvOffsetTop \}\);\s*root\.setAttribute\('data-agent-prompt-keyboard', up \? '1' : '0'\);/);
  assert.match(SRC, /root\.removeAttribute\('data-agent-prompt-keyboard'\);/);
  assert.doesNotMatch(SRC, /data-agent-prompt-keyboard=\{/);
  assert.match(css, /--agent-prompt-mobile-bottom: calc\(var\(--home-indicator-pill-pad\) \+ var\(--home-indicator-pill-height\) \+ 18px\);/);
  assert.match(css, /--home-indicator-pill-pad: max\(8px, env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(css, /\.agent-prompt--compact\[data-agent-prompt-keyboard="1"\] \{\s*--agent-prompt-rest-bottom: var\(--agent-prompt-keyboard-bottom\);/);
  assert.match(css, /\[data-mobile-stage\]:has\(\.agent-prompt\[data-agent-prompt-keyboard="1"\]\) \[data-mobile-stage-home-indicator\] \{\s*display: none;/);
  assert.match(SRC, /data-agent-prompt-actions=""/);
  assert.match(SRC, /dispatchTyping\(\{ type: 'disconnect' \}\)/);
  assert.match(SRC, /const responding = !live\.waiting && \(live\.dots \|\| typingShown\(typing\) \|\| sessionReplies\);/);
  // Session-level state (no prompt needed): the tab's own model-changing
  // calls, status and progress frames, and one idle timer.
  assert.match(SRC, /sessionReducer\(sessionRef\.current, \{ at: Date\.now\(\), \.\.\.event \}\)/);
  assert.match(SRC, /dispatchSession\(\{ type: 'command', mutates: true \}\)/);
  assert.match(SRC, /dispatchSession\(\{ type: 'progress' \}\)/);
  assert.match(SRC, /dispatchSession\(\{ type: 'status', state: event\?\.mode \}\)/);
  assert.match(SRC, /dispatchSession\(\{ type: 'tick' \}\)/);
  assert.match(SRC, /sessionIdleAt\(session, AGENT_SESSION_IDLE_MS\)/);
  assert.match(SRC, /mobileChatHideReason\(\{ isMobile, workingEdge: started, hold: holdRef\.current \}\)/);
  assert.match(SRC, /autoFoldTarget\(isMobile\)/);
  assert.match(SRC, /scheduleAckHold\(/);
  assert.doesNotMatch(SRC, /promptStarted: started/);
  assert.match(SRC, /const agentBusy = pending \|\| sessionBusy\(session\);/);
  assert.doesNotMatch(SRC, /progressUntil/);
  assert.doesNotMatch(SRC, /setWorking\(/);
  assert.doesNotMatch(SRC, /setStreaming\(/);
});

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

test('working state shows the spinner hint and Stop and collapses the chat; typing keeps the chat with the dots', async () => {
  ({ default: PromptInput } = await importJsx(new URL('./PromptInput.jsx', import.meta.url)));
  const working = renderPrompt('?agentPromptDemo=1&agentPromptState=working');
  assert.match(working, /agent-prompt-spinner/);
  assert.match(working, /Agent is working\.\.\./);
  assert.match(working, /data-agent-prompt-working="1"/);
  assert.match(working, /data-agent-prompt-state="working"/);
  assert.match(working, /aria-label="Stop agent"/);
  assert.match(working, /data-agent-prompt-stop=""/);
  // Working collapses the chat so the viewport is visible: no pane, no dots.
  assert.doesNotMatch(working, /data-agent-reply-dots=""/);
  assert.doesNotMatch(working, /data-agent-reply=""/);
  assert.doesNotMatch(working, /data-agent-prompt-send=""/);

  const typing = renderPrompt('?agentPromptDemo=1&agentPromptState=agent-typing');
  assert.match(typing, /data-agent-prompt-state="typing"/);
  assert.match(typing, /data-agent-reply-dots=""/);
  assert.match(typing, /data-agent-prompt-stop=""/);
  assert.doesNotMatch(typing, /Agent is working/);
  assert.doesNotMatch(typing, /data-agent-prompt-working="1"/);
  // The dots sit at the bottom of the conversation, after the last message.
  assert.ok(typing.lastIndexOf('data-agent-reply-body=""') < typing.indexOf('data-agent-typing=""'));
  // Desktop: the fold chevron is there in every state and the X is gone.
  assert.match(typing, /data-agent-prompt-fold=""/);
  assert.match(typing, /aria-label="Hide agent prompt"/);
  assert.doesNotMatch(typing, /data-agent-prompt-dismiss/);
  assert.match(working, /data-agent-prompt-fold=""/);
  // Folded: the prompt is away and the chevron-up carries the state badge.
  const folded = renderPrompt('?agentPromptDemo=1&agentPromptState=folded');
  assert.match(folded, /agent-prompt--folded/);
  assert.match(folded, /agent-prompt--folded-hidden/);
  assert.match(folded, /data-agent-prompt-unfold=""/);
  assert.match(folded, /aria-label="Show agent prompt"/);
  assert.match(folded, /data-agent-prompt-live=""/);
  assert.match(SRC, /AGENT_PROMPT_FOLD_MS/);
  assert.match(SRC, /transitionend/);
  // The unfold chevron is a sibling, not inside the hidden prompt.
  assert.match(
    folded,
    /agent-prompt--folded-hidden[\s\S]*<\/div><button[\s\S]*data-agent-prompt-fold=""[\s\S]*<\/button><button[\s\S]*data-agent-prompt-unfold=""/,
  );
  // Mobile keeps the X until the fold lands there.
  const compact = renderPrompt('?agentPromptDemo=1&agentPromptState=chat', { isMobile: true });
  assert.match(compact, /data-agent-prompt-dismiss=""/);
  assert.doesNotMatch(compact, /data-agent-prompt-fold=""/);

  const streaming = renderPrompt('?agentPromptDemo=1&agentPromptState=reply-streaming');
  assert.match(streaming, /data-agent-reply-dots=""/);
  assert.match(streaming, /Adding the holes/);
  assert.match(streaming, /data-agent-prompt-working="0"/);
  // A streamed reply is the typing state: Stop stays available, no spinner.
  assert.match(streaming, /data-agent-prompt-state="typing"/);
  assert.match(streaming, /data-agent-prompt-stop=""/);
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
  assert.match(chat, /agent-prompt-msg--user surface-panel/);
  assert.match(chat, /agent-prompt-msg--agent agent-prompt-reply-body surface-dark text-ui text-on-dark/);
  assert.match(chat, /data-agent-msg-thumb=""/);
  assert.match(chat, /data-agent-chat-count="4"/);
  // Desktop: the fold chevron replaced the X.
  assert.match(chat, /aria-label="Hide agent prompt"/);
  assert.doesNotMatch(chat, /aria-label="Dismiss conversation"/);
  assert.doesNotMatch(chat, /data-agent-typing/);

  const typing = renderPrompt('?agentPromptDemo=1&agentPromptState=agent-typing');
  // The dots sit at the bottom of the conversation, after the last message.
  assert.ok(typing.lastIndexOf('data-agent-reply-body=""') < typing.indexOf('data-agent-typing=""'));
  assert.doesNotMatch(typing, /data-agent-prompt-dismiss/);

  // The history is component state only: nothing is stored. The fold
  // choice is the one remembered thing, and it lives in agentPromptFold.js.
  assert.doesNotMatch(SRC, /localStorage|sessionStorage|indexedDB/);
  assert.match(SRC, /dispatchChat\(\{ type: 'disconnect' \}\)/);
  assert.match(SRC, /dispatchChat\(\{ type: 'dismiss' \}\)/);
  assert.match(SRC, /stickToBottom\(el\)/);
  assert.match(SRC, /data-agent-prompt-jump=""/);
});

test('the open chat stacks above the viewer chrome and under the modal layer', () => {
  // Feature strip, rails, mode chips and cards are z-10/20; toasts and the
  // phone stage pill are z-30; the cross-section popup is z-40; modals z-50.
  const z = Number(/--agent-prompt-z: (\d+);/.exec(css)?.[1]);
  assert.ok(z > 30 && z < 40, `--agent-prompt-z is ${z}`);
  assert.match(css, /\n {2}\.agent-prompt \{[^}]*z-index: var\(--agent-prompt-z\);/s);
  // The fold tabs stay one step under the prompt they hang from.
  assert.match(css, /\.agent-prompt-fold,\s*\.agent-prompt-unfold \{[^}]*z-index: calc\(var\(--agent-prompt-z\) - 1\);/s);
  assert.doesNotMatch(css, /\.agent-prompt[\w-]* \{[^}]*z-index: (19|20);/s);
});

test('the composer is a full-width field with the buttons on a row below', () => {
  assert.match(css, /--agent-prompt-btn: 44px;/);
  assert.match(css, /--agent-prompt-max-input: min\(calc\(var\(--agent-prompt-line\) \* 5 \+ 12px\), 40vh\);/);
  assert.match(css, /\.agent-prompt-row \{[^}]*flex-direction: column;/s);
  assert.match(css, /\.agent-prompt-actions \{[^}]*justify-content: flex-end;/s);
  assert.match(css, /\.agent-prompt-input \{[^}]*font-size: 16px;/s);
  assert.match(css, /\.agent-prompt-input \{[^}]*min-height: var\(--agent-prompt-btn\);/s);
  assert.match(css, /--agent-prompt-lift/);
  assert.match(css, /bottom: calc\(var\(--agent-prompt-rest-bottom\) \+ var\(--agent-prompt-lift, 0px\)\)/);
});

test('the pane caps its height and scrolls inside; user bubbles are right-aligned', () => {
  assert.match(css, /--agent-prompt-max-reply: min\(200px, 40vh\);/);
  assert.match(css, /--agent-prompt-max-reply-mobile: min\(160px, 32vh\);/);
  assert.match(css, /\.agent-prompt-reply \{[^}]*max-height: var\(--agent-prompt-max-reply\);[^}]*overflow-y: auto;/s);
  assert.match(css, /\.agent-prompt-msg \{[^}]*max-width: 85%;/s);
  assert.match(css, /\.agent-prompt-msg--user \{[^}]*align-self: flex-end;/s);
  assert.match(css, /\.agent-prompt-msg--agent \{[^}]*align-self: flex-start;/s);
  assert.match(css, /\.agent-prompt-jump \{[^}]*position: sticky;/s);
});

test('a session note renders as text, including markup', async () => {
  if (!PromptInput) {
    ({ default: PromptInput } = await importJsx(new URL('./PromptInput.jsx', import.meta.url)));
  }
  const markup = renderPrompt('?agentPromptDemo=1&agentPromptState=session-note');
  assert.match(markup, /data-agent-msg="agent"/);
  assert.match(markup, /data-agent-chat-count="1"/);
  assert.match(markup, /&lt;b&gt;hello&lt;\/b&gt;/);
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(markup, /<b>hello<\/b>/);
  assert.doesNotMatch(markup, /<img[\s>]/);
  assert.equal(markup.includes(AGENT_PROMPT_SESSION_NOTE), false);
});

test('a working session with no prompt collapses the chat, disables the field, and keeps Send (nothing to Stop)', async () => {
  ({ default: PromptInput } = await importJsx(new URL('./PromptInput.jsx', import.meta.url)));
  const html = renderPrompt('?agentPromptDemo=1&agentPromptState=session-working');
  assert.match(html, /data-agent-session-state="working"/);
  assert.match(html, /data-agent-prompt-state="working"/);
  assert.match(html, /data-agent-prompt-working="1"/);
  assert.match(html, /agent-prompt-spinner/);
  assert.match(html, /Agent is working\.\.\./);
  assert.match(html, /data-agent-prompt-input="" disabled=""/);
  // The chat is collapsed and there is no prompt to stop.
  assert.doesNotMatch(html, /data-agent-reply=""/);
  assert.doesNotMatch(html, /data-agent-prompt-stop=""/);
  assert.match(html, /data-agent-prompt-send="" aria-label="Send" disabled=""/);
  // The idle demo has none of that.
  const idle = renderPrompt('?agentPromptDemo=1&agentPromptState=idle');
  assert.match(idle, /data-agent-session-state="idle"/);
  assert.doesNotMatch(idle, /Agent is working/);
});
