import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_PROMPT_WORKING_TIMEOUT_MS, agentPromptStallCopy } from './agentPromptLive.js';
import {
  TYPING_IDLE,
  pendingShown,
  stallShown,
  typingShown,
  workingShown,
} from './agentPromptTyping.js';
import { createPromptWatch, stepPromptWatch } from './agentPromptWatch.js';

function clock() {
  let now = 0;
  const timers = new Set();
  return {
    now: () => now,
    setTimer(fn, ms) {
      const timer = { at: now + ms, fn, cleared: false, fired: false };
      timers.add(timer);
      return timer;
    },
    clearTimer(timer) {
      if (timer) timer.cleared = true;
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let next = null;
        for (const timer of timers) {
          if (timer.cleared || timer.fired) continue;
          if (timer.at <= until && (!next || timer.at < next.at)) next = timer;
        }
        if (!next) break;
        now = next.at;
        next.fired = true;
        next.fn();
      }
      now = until;
    },
  };
}

function session() {
  const time = clock();
  let typing = TYPING_IDLE;
  let stalls = 0;
  const watch = createPromptWatch({
    timeoutMs: AGENT_PROMPT_WORKING_TIMEOUT_MS,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    onStall() {
      stalls += 1;
      typing = stepPromptWatch(typing, watch, { type: 'stall' });
    },
  });
  function step(event) {
    typing = stepPromptWatch(typing, watch, event);
  }
  function begin() {
    step({ type: 'sent', id: 'p1' });
    step({ type: 'state', state: 'working' });
  }
  return {
    time,
    step,
    begin,
    get typing() { return typing; },
    get stalls() { return stalls; },
  };
}

test('tool calls longer than the old timeout keep working', () => {
  const run = session();
  run.begin();
  for (let i = 0; i < 5; i += 1) {
    run.time.advance(90_000);
    run.step({ type: 'activity' });
  }
  assert.ok(5 * 90_000 > AGENT_PROMPT_WORKING_TIMEOUT_MS);
  assert.equal(run.stalls, 0);
  assert.equal(workingShown(run.typing), true);
  assert.equal(stallShown(run.typing), false);
  assert.equal(pendingShown(run.typing), true);
});

test('a bridge call that outlasts the timeout holds working until it returns', () => {
  const run = session();
  run.begin();
  run.step({ type: 'hold', on: true });
  run.time.advance(AGENT_PROMPT_WORKING_TIMEOUT_MS * 4);
  assert.equal(run.stalls, 0);
  assert.equal(workingShown(run.typing), true);
  run.step({ type: 'hold', on: false });
  run.time.advance(AGENT_PROMPT_WORKING_TIMEOUT_MS - 1);
  assert.equal(stallShown(run.typing), false);
  run.time.advance(1);
  assert.equal(run.stalls, 1);
  assert.equal(stallShown(run.typing), true);
  assert.equal(pendingShown(run.typing), true);
  assert.equal(agentPromptStallCopy(), 'No activity from the agent for 2 min — it may have stalled');
});

test('activity refreshes the deadline; a true stall keeps Stop and says why', () => {
  const run = session();
  run.begin();
  run.time.advance(100_000);
  run.step({ type: 'state', state: 'working' });
  run.time.advance(100_000);
  run.step({ type: 'activity' });
  run.time.advance(100_000);
  run.step({ type: 'reply', id: 'p1', text: 'still going', final: false });
  run.time.advance(AGENT_PROMPT_WORKING_TIMEOUT_MS - 1);
  assert.equal(run.stalls, 0);
  assert.equal(typingShown(run.typing), true);
  run.time.advance(1);
  assert.equal(run.stalls, 1);
  assert.equal(stallShown(run.typing), true);
  assert.equal(pendingShown(run.typing), true, 'Stop stays available');
  assert.equal(run.typing.pendingId, 'p1');
  run.step({ type: 'activity' });
  assert.equal(stallShown(run.typing), false);
  assert.equal(pendingShown(run.typing), true);
  run.time.advance(AGENT_PROMPT_WORKING_TIMEOUT_MS);
  assert.equal(run.stalls, 2);
  assert.equal(stallShown(run.typing), true);
});

test('a final reply, Stop, and disconnect each end working, including after a stall', () => {
  for (const end of [
    { type: 'reply', id: 'p1', text: 'Done.', final: true },
    { type: 'stop' },
    { type: 'disconnect' },
    { type: 'state', state: 'idle' },
  ]) {
    const run = session();
    run.begin();
    run.time.advance(AGENT_PROMPT_WORKING_TIMEOUT_MS);
    assert.equal(stallShown(run.typing), true);
    run.step(end);
    assert.equal(run.typing.pendingId, null, JSON.stringify(end));
    assert.equal(run.typing.mode, 'idle', JSON.stringify(end));
    assert.equal(workingShown(run.typing), false, JSON.stringify(end));
    assert.equal(stallShown(run.typing), false, JSON.stringify(end));
    const stalls = run.stalls;
    run.time.advance(AGENT_PROMPT_WORKING_TIMEOUT_MS * 2);
    assert.equal(run.stalls, stalls, JSON.stringify(end));
  }
});
