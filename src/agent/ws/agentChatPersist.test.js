import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_PROMPT_FOLD_KEY } from '../agentPromptFold.js';
import {
  AGENT_CHAT_CLEAR_EVENT,
  AGENT_CHAT_PERSIST_KEY,
  agentChatUserId,
  clearAgentChatPersist,
  forgetAgentChat,
  forgetAgentChatSession,
  nextAgentChatShell,
  readAgentChatPersist,
  stepAgentReport,
  writeAgentChatPersist,
} from './agentChatPersist.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function mem() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

function withWindow(window, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prev = globalThis.window;
  globalThis.window = window;
  try {
    return fn();
  } finally {
    if (had) globalThis.window = prev;
    else delete globalThis.window;
  }
}

const record = { open: true, userId: 'user-1' };
const collapsed = { open: false, userId: 'user-1' };

test('restore-open paints the saved open shell before the socket, then adopts it', () => {
  const pending = nextAgentChatShell({
    record,
    userId: '',
    authPending: true,
    forcedServer: true,
    report: 'pending',
    live: false,
  });
  assert.equal(pending.hold, true);
  assert.equal(pending.open, true);
  assert.equal(pending.gone, false);
  assert.equal(pending.clear, false);
  assert.equal(pending.adopt, false);

  const confirmed = nextAgentChatShell({
    record,
    userId: 'user-1',
    authPending: false,
    forcedServer: true,
    report: 'up',
    live: true,
  });
  assert.equal(confirmed.adopt, true);
  assert.equal(confirmed.hold, false);
  assert.equal(confirmed.open, true);
  assert.equal(confirmed.gone, false);
  assert.equal(confirmed.clear, false);
});

test('restore-collapsed stays collapsed and does not expand when the agent is back', () => {
  const held = nextAgentChatShell({
    record: collapsed,
    userId: 'user-1',
    authPending: false,
    forcedServer: true,
    report: 'grace',
    live: false,
  });
  assert.equal(held.hold, true);
  assert.equal(held.open, false);
  assert.equal(held.gone, false);

  const adopted = nextAgentChatShell({
    record: collapsed,
    userId: 'user-1',
    authPending: false,
    forcedServer: true,
    report: 'up',
    live: true,
  });
  assert.equal(adopted.adopt, true);
  assert.equal(adopted.open, false);
  assert.equal(adopted.hold, false);
  assert.equal(adopted.gone, false);
});

test('agent-gone fallback waits out a false registered snapshot, then clears', () => {
  assert.equal(stepAgentReport('pending', 'registered-down'), 'grace');
  assert.equal(stepAgentReport('grace', 'registered-down'), 'grace');
  assert.equal(stepAgentReport('up', 'registered-down'), 'up');
  assert.equal(stepAgentReport('grace', 'agent-up'), 'up');
  assert.equal(stepAgentReport('grace', 'grace-elapsed'), 'down');
  assert.equal(stepAgentReport('down', 'agent-up'), 'up');
  assert.equal(stepAgentReport('cleared', 'agent-up'), 'cleared');
  assert.equal(stepAgentReport('up', 'clear'), 'cleared');

  const duringGrace = nextAgentChatShell({
    record,
    userId: 'user-1',
    forcedServer: true,
    report: 'grace',
    live: false,
  });
  assert.equal(duringGrace.hold, true);
  assert.equal(duringGrace.gone, false);
  assert.equal(duringGrace.clear, false);

  const goneOpen = nextAgentChatShell({
    record,
    userId: 'user-1',
    forcedServer: true,
    report: 'down',
    live: false,
  });
  assert.equal(goneOpen.gone, true);
  assert.equal(goneOpen.open, true);
  assert.equal(goneOpen.hold, false);
  assert.equal(goneOpen.clear, true);
  assert.equal(goneOpen.adopt, false);

  const goneCollapsed = nextAgentChatShell({
    record: collapsed,
    userId: 'user-1',
    forcedServer: true,
    report: 'down',
    live: false,
  });
  assert.equal(goneCollapsed.gone, false);
  assert.equal(goneCollapsed.open, false);
  assert.equal(goneCollapsed.clear, true);
  assert.equal(goneCollapsed.hold, false);
});

test('desktop Chrome does not restore, and a different user clears the bit', () => {
  const chrome = nextAgentChatShell({
    record,
    userId: 'user-1',
    forcedServer: false,
    report: 'pending',
    live: false,
  });
  assert.deepEqual(chrome, { hold: false, adopt: false, open: false, gone: false, clear: false });

  const mismatch = nextAgentChatShell({
    record,
    userId: 'user-2',
    authPending: false,
    forcedServer: true,
    report: 'pending',
    live: false,
  });
  assert.equal(mismatch.clear, true);
  assert.equal(mismatch.hold, false);
  assert.equal(mismatch.gone, false);

  const signedOut = nextAgentChatShell({
    record,
    userId: '',
    authPending: false,
    forcedServer: true,
    report: 'pending',
  });
  assert.equal(signedOut.clear, true);
  assert.equal(signedOut.hold, false);
});

test('the stored record is the open bit and the user id only', () => {
  const storage = mem();
  writeAgentChatPersist(storage, 'user-1', true);
  const parsed = JSON.parse(storage.getItem(AGENT_CHAT_PERSIST_KEY));
  assert.deepEqual(Object.keys(parsed).sort(), ['open', 'userId', 'v']);
  assert.equal(parsed.open, true);
  assert.equal(parsed.userId, 'user-1');
  assert.equal(parsed.v, 1);
  assert.equal(JSON.stringify(parsed).includes('token'), false);
  assert.deepEqual(readAgentChatPersist(storage), { open: true, userId: 'user-1' });

  writeAgentChatPersist(storage, 'user-1', false);
  assert.equal(readAgentChatPersist(storage).open, false);
  writeAgentChatPersist(storage, '', true);
  assert.equal(readAgentChatPersist(storage).open, false);
  storage.setItem(AGENT_CHAT_PERSIST_KEY, JSON.stringify({ v: 1, userId: 'user-1', open: true, token: 'secret' }));
  const read = readAgentChatPersist(storage);
  assert.deepEqual(read, { open: true, userId: 'user-1' });
  assert.equal(Object.hasOwn(read, 'token'), false);

  storage.setItem(AGENT_CHAT_PERSIST_KEY, '{');
  assert.equal(readAgentChatPersist(storage), null);
  storage.setItem(AGENT_CHAT_PERSIST_KEY, JSON.stringify({ v: 2, userId: 'user-1', open: true }));
  assert.equal(readAgentChatPersist(storage), null);
  clearAgentChatPersist(storage);
  assert.equal(storage.getItem(AGENT_CHAT_PERSIST_KEY), null);
  assert.equal(agentChatUserId({ id: 'abc' }), 'abc');
  assert.equal(agentChatUserId({ _id: 'hex' }), 'hex');
  assert.equal(agentChatUserId(null), '');
});

test('forget drops the record and the fold; close is optional for revoke', () => {
  const session = mem();
  const local = mem();
  writeAgentChatPersist(session, 'user-1', true);
  local.setItem(AGENT_PROMPT_FOLD_KEY, '1');
  const events = [];
  withWindow({
    localStorage: local,
    dispatchEvent(event) { events.push(event); },
  }, () => {
    forgetAgentChat(session, { close: false });
  });
  assert.equal(session.getItem(AGENT_CHAT_PERSIST_KEY), null);
  assert.equal(local.getItem(AGENT_PROMPT_FOLD_KEY), null);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, AGENT_CHAT_CLEAR_EVENT);
  assert.equal(events[0].detail.close, false);

  writeAgentChatPersist(session, 'user-1', false);
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'sessionStorage');
  const prev = globalThis.sessionStorage;
  globalThis.sessionStorage = session;
  try {
    withWindow({
      localStorage: local,
      dispatchEvent(event) { events.push(event); },
    }, () => {
      forgetAgentChatSession();
    });
  } finally {
    if (had) globalThis.sessionStorage = prev;
    else delete globalThis.sessionStorage;
  }
  assert.equal(session.getItem(AGENT_CHAT_PERSIST_KEY), null);
  assert.equal(events.at(-1).detail.close, true);
});

test('revoke, logout, Disconnect, and delete-account clear the persisted chat', () => {
  const auth = readFileSync(join(root, 'src/hooks/useAuth.jsx'), 'utf8');
  const relay = readFileSync(join(root, 'src/components/AgentRelayAccount.jsx'), 'utf8');
  const pairing = readFileSync(join(root, 'src/components/AgentBridgePairing.jsx'), 'utf8');
  const chip = readFileSync(join(root, 'src/components/ProfileChip.jsx'), 'utf8');
  const host = readFileSync(join(root, 'src/components/AgentBridgeHost.jsx'), 'utf8');
  const prompt = readFileSync(join(root, 'src/components/PromptInput.jsx'), 'utf8');

  assert.match(auth, /forgetAgentChatSession\(\)/);
  assert.match(relay, /forgetAgentChatSession\(\{ close: false \}\)/);
  const disconnect = pairing.slice(pairing.indexOf('const disconnectFromUser'));
  assert.match(disconnect.slice(0, 400), /forgetAgentChatSession\(\)/);
  assert.match(chip, /forgetAgentChatSession\(\)/);
  assert.match(host, /AGENT_CHAT_CLEAR_EVENT/);
  assert.match(host, /nextAgentChatShell/);
  assert.match(host, /detail\?\.close !== false/);
  assert.match(prompt, /holding \|\| agentGone \? null : stubRef\.current/);
  assert.match(prompt, /agentGone && agentChatOpen/);
  assert.match(prompt, /preserveFoldRef/);
  assert.match(prompt, /sawLiveRef/);
  assert.match(prompt, /delivery: 'failed', error: 'not_paired'/);
  assert.doesNotMatch(prompt, /localStorage|sessionStorage|indexedDB/);
  const reportAt = pairing.indexOf("onAgentReportRef.current?.('agent-up')");
  const latchAt = pairing.indexOf("applyJoinEvent('agent-up')");
  assert.ok(reportAt !== -1 && latchAt !== -1 && reportAt < latchAt);
});
