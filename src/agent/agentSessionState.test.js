import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_SESSION_IDLE_MS,
  SESSION_IDLE,
  sessionBusy,
  sessionIdleAt,
  sessionPromptMode,
  sessionReducer,
  sessionReplying,
  sessionSeed,
  sessionWorking,
} from './agentSessionState.js';

const run = (events, start = SESSION_IDLE) => events.reduce(sessionReducer, start);

test('a model-changing command enters working without a prompt; a read does not', () => {
  const read = run([{ type: 'command', mutates: false, at: 1000 }]);
  assert.equal(read, SESSION_IDLE);
  const write = run([{ type: 'command', mutates: true, at: 1000 }]);
  assert.equal(write.mode, 'working');
  assert.equal(write.explicit, false);
  assert.equal(write.at, 1000);
  assert.equal(sessionWorking(write), true);
  assert.equal(sessionBusy(write), true);
  assert.equal(sessionPromptMode(write), 'working');
  // A later read keeps the mode and does not move the clock.
  const later = run([{ type: 'command', mutates: false, at: 5000 }], write);
  assert.equal(later, write);
});

test('the window restarts on every model change and closes after the idle time', () => {
  const t0 = 10_000;
  let s = run([{ type: 'command', mutates: true, at: t0 }]);
  s = run([{ type: 'tick', at: t0 + AGENT_SESSION_IDLE_MS - 1 }], s);
  assert.equal(s.mode, 'working');
  s = run([{ type: 'command', mutates: true, at: t0 + 30_000 }], s);
  s = run([{ type: 'tick', at: t0 + AGENT_SESSION_IDLE_MS + 1 }], s);
  assert.equal(s.mode, 'working', 'the second command moved the deadline');
  assert.equal(sessionIdleAt(s), t0 + 30_000 + AGENT_SESSION_IDLE_MS);
  s = run([{ type: 'tick', at: t0 + 30_000 + AGENT_SESSION_IDLE_MS }], s);
  assert.equal(s.mode, 'idle');
  assert.equal(sessionBusy(s), false);
  assert.equal(sessionIdleAt(s), null);
  assert.equal(run([{ type: 'tick', at: 1e9 }], s), s, 'idle ticks are no-ops');
});

test('progress is the working signal and times out the same way', () => {
  const s = run([{ type: 'progress', at: 500 }]);
  assert.equal(s.mode, 'working');
  assert.equal(run([{ type: 'tick', at: 500 + AGENT_SESSION_IDLE_MS }], s).mode, 'idle');
});

test('set_status overrides the automatic state: responding, building, and idle', () => {
  const working = run([{ type: 'command', mutates: true, at: 1 }]);
  const replying = run([{ type: 'status', state: 'typing', at: 2 }], working);
  assert.equal(replying.mode, 'replying');
  assert.equal(replying.explicit, true);
  assert.equal(sessionReplying(replying), true);
  assert.equal(sessionPromptMode(replying), 'typing');
  const idle = run([{ type: 'status', state: 'idle', at: 3 }], replying);
  assert.equal(idle.mode, 'idle');
  assert.equal(sessionBusy(idle), false);
  // The next model change starts working again, even after an explicit idle.
  const again = run([{ type: 'command', mutates: true, at: 4 }], idle);
  assert.equal(again.mode, 'working');
  const built = run([{ type: 'status', state: 'working', at: 5 }], SESSION_IDLE);
  assert.equal(built.mode, 'working');
  assert.equal(built.explicit, true);
  assert.equal(run([{ type: 'status', state: 'bogus', at: 6 }], built), built);
  // An explicit state still ends after the idle window.
  assert.equal(run([{ type: 'tick', at: 5 + AGENT_SESSION_IDLE_MS }], built).mode, 'idle');
});

test('a partial reply is replying; a final reply, a session note, Stop, close, and disconnect are idle', () => {
  const working = run([{ type: 'command', mutates: true, at: 1 }]);
  const partial = run([{ type: 'reply', final: false, at: 2 }], working);
  assert.equal(partial.mode, 'replying');
  for (const closer of [
    { type: 'reply', final: true, at: 3 },
    { type: 'reply', at: 3 },
    { type: 'stop' },
    { type: 'closed' },
    { type: 'disconnect' },
  ]) {
    const after = run([closer], partial);
    assert.equal(after.mode, 'idle', JSON.stringify(closer));
    assert.equal(after.explicit, false);
  }
  assert.equal(run([{ type: 'stop' }], SESSION_IDLE), SESSION_IDLE);
  assert.equal(run([{ type: 'nonsense' }], SESSION_IDLE), SESSION_IDLE);
  assert.equal(run([{}], SESSION_IDLE), SESSION_IDLE);
});

test('the demo seed starts a session in a mode with no prompt', () => {
  assert.equal(sessionSeed('working', 7).mode, 'working');
  assert.equal(sessionSeed('working', 7).at, 7);
  assert.equal(sessionSeed('replying', 7).mode, 'replying');
  assert.equal(sessionSeed('idle'), SESSION_IDLE);
  assert.equal(sessionSeed(undefined), SESSION_IDLE);
  assert.equal(AGENT_SESSION_IDLE_MS, 60_000);
});
