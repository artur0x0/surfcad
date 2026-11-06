import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_PROMPT_ACK_HOLD_MS,
  autoFoldTarget,
  initialPromptFlow,
  promptFlowView,
  scheduleAckHold,
  stepPromptFlow,
} from './agentPromptFlow.js';

function run(events, now = 0) {
  let state = initialPromptFlow();
  for (const event of events) state = stepPromptFlow(state, event, now);
  return state;
}

test('a queued send stays on Waiting for agent until set_status responding, then the dots', () => {
  const queued = run([
    { type: 'sent' },
    { type: 'delivery', delivery: 'queued' },
  ]);
  assert.equal(promptFlowView(queued, 0).waiting, true);
  assert.equal(promptFlowView(queued, 0).dots, false);
  assert.equal(promptFlowView(queued, 0).chatOpen, true);

  const acked = stepPromptFlow(queued, { type: 'status', state: 'typing' }, 0);
  const view = promptFlowView(acked, 0);
  assert.equal(view.waiting, false);
  assert.equal(view.dots, true);
  assert.equal(view.folded, false);
  assert.equal(view.spinner, false);

  const workingAck = stepPromptFlow(queued, { type: 'status', state: 'working' }, 0);
  assert.equal(promptFlowView(workingAck, 0).waiting, false);
});

test('the ack reply holds for 10s, then a queued build folds on phone and desktop, and final reopens', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  assert.equal(AGENT_PROMPT_ACK_HOLD_MS, 10_000);

  let state = run([
    { type: 'sent' },
    { type: 'delivery', delivery: 'queued' },
    { type: 'status', state: 'typing' },
    { type: 'reply', final: false },
  ], 0);
  assert.equal(state.holdUntil, 10_000);
  assert.equal(promptFlowView(state, Date.now()).chatOpen, true);
  assert.equal(promptFlowView(state, Date.now()).dots, true);
  assert.equal(promptFlowView(state, Date.now()).folded, false);

  state = stepPromptFlow(state, { type: 'work' }, Date.now());
  assert.equal(state.foldQueued, true);
  assert.equal(promptFlowView(state, Date.now()).folded, false);
  assert.equal(promptFlowView(state, Date.now()).chatOpen, true);
  assert.equal(promptFlowView(state, Date.now()).holdActive, true);

  const stop = scheduleAckHold(state.holdUntil, Date.now(), () => {
    state = stepPromptFlow(state, { type: 'tick' }, Date.now());
  });
  t.mock.timers.tick(9999);
  assert.equal(promptFlowView(state, Date.now()).folded, false, 'still inside the hold');
  assert.equal(promptFlowView(state, Date.now()).chatOpen, true);

  t.mock.timers.tick(1);
  const folded = promptFlowView(state, Date.now());
  assert.equal(folded.folded, true);
  assert.equal(folded.chatOpen, false);
  assert.equal(folded.spinner, true);
  assert.equal(folded.dots, false);
  assert.equal(folded.holdActive, false);
  // Phone auto-folds the same way desktop does. The chevron stays desktop-only.
  assert.equal(autoFoldTarget(true), 'bot');
  assert.equal(autoFoldTarget(false), 'prompt');

  state = stepPromptFlow(state, { type: 'reply', final: true }, Date.now());
  const done = promptFlowView(state, Date.now());
  assert.equal(done.folded, false);
  assert.equal(done.chatOpen, true);
  assert.equal(done.spinner, false);
  assert.equal(done.dots, false);
  assert.equal(done.waiting, false);
  assert.equal(autoFoldTarget(true) === 'bot' && done.chatOpen, true);
  stop();
  t.mock.timers.reset();
});

test('building with no ack reply folds immediately, and a final reply still reopens', () => {
  const built = run([
    { type: 'sent' },
    { type: 'delivery', delivery: 'queued' },
    { type: 'status', state: 'working' },
  ]);
  assert.equal(promptFlowView(built, 0).waiting, false);
  assert.equal(promptFlowView(built, 0).folded, true);
  assert.equal(promptFlowView(built, 0).spinner, true);
  const done = stepPromptFlow(built, { type: 'reply', final: true }, 0);
  assert.equal(promptFlowView(done, 0).chatOpen, true);
  assert.equal(promptFlowView(done, 0).spinner, false);
});
