import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_CONNECTED_TOAST_COPY,
  AGENT_CONNECTED_TOAST_MS,
  PAIRING_ORIGIN_REJECTED_COPY,
  PAIRING_WAITING_COPY,
  SERVER_PAIRING_WAITING_COPY,
  agentConnectedToastReducer,
  createCloseMenuRegistry,
  disposePairingHost,
  isCurrentPairingConnection,
  isRelayTabConnected,
  pairingDialogStage,
  pairingProbeUserCopy,
  shouldClosePairingDialogOnConnect,
  agentChatToggleAction,
  shouldOpenAgentChatOnConnect,
  stepJoinConnection,
  shouldKeepAgentBridgeHostMounted,
  shouldShowAgentBridgeDisconnect,
  shouldShowLocalAgentConnect,
  serverBlocksLocalPairing,
  shouldPollRelay,
  shouldRevealPairingCode,
  shouldShowPairingApproval,
  shouldShowPairingCode,
  shouldShowPairingPrompt,
} from './pairingFlow.js';

test('the phone bot button opens the chat and the next tap folds it', () => {
  assert.equal(agentChatToggleAction(false), 'open');
  assert.equal(agentChatToggleAction(true), 'close');
});

test('Connect stays up until a server socket is actually open', () => {
  assert.equal(shouldShowLocalAgentConnect({
    relayTarget: 'auto', usingServer: false, serverUnreachable: false,
  }), true);
  assert.equal(shouldShowLocalAgentConnect({
    relayTarget: 'auto', usingServer: true, serverUnreachable: false,
  }), false);
  assert.equal(shouldShowLocalAgentConnect({
    relayTarget: 'server', usingServer: false, serverUnreachable: false,
  }), false);
  assert.equal(shouldShowLocalAgentConnect({
    relayTarget: 'server', usingServer: false, serverUnreachable: true,
  }), true);
  assert.equal(shouldShowLocalAgentConnect({
    flowOpen: true, relayTarget: 'auto', serverUnreachable: true,
  }), false);
  assert.equal(serverBlocksLocalPairing({
    relayTarget: 'server', usingServer: false, serverUnreachable: true,
  }), false);
  assert.equal(serverBlocksLocalPairing({
    relayTarget: 'server', usingServer: true, serverUnreachable: true,
  }), true);
  assert.equal(serverBlocksLocalPairing({ relayTarget: 'local' }), false);
});

test('a forced server client never falls back to local pairing or a localhost probe', () => {
  assert.equal(serverBlocksLocalPairing({
    forcedServer: true, relayTarget: 'server', usingServer: false, serverUnreachable: true,
  }), true);
  assert.equal(shouldShowLocalAgentConnect({
    forcedServer: true, relayTarget: 'server', serverUnreachable: true,
  }), true);
  assert.equal(shouldShowLocalAgentConnect({
    flowOpen: true, forcedServer: true, serverUnreachable: true,
  }), false);
  assert.equal(shouldShowLocalAgentConnect({
    paired: true, forcedServer: true,
  }), false);
  assert.equal(shouldPollRelay({
    flowOpen: true, relayReachable: false, state: 'idle', forcedServer: true,
  }), false);
  assert.equal(SERVER_PAIRING_WAITING_COPY, 'Waiting for your agent…');
  assert.doesNotMatch(SERVER_PAIRING_WAITING_COPY, /Waiting for relay/);
  assert.doesNotMatch(SERVER_PAIRING_WAITING_COPY, /\bEdge\b/);
});

test('shouldPollRelay only while flow is open and relay is not reachable', () => {
  assert.equal(shouldPollRelay({ flowOpen: false, relayReachable: false, state: 'idle' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: true, state: 'idle' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'advertising' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'idle' }), true);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'idle', issue: 'origin_rejected' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'idle', issue: 'browser_blocked' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'idle', issue: 'bridge_closed' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'idle', issue: 'popup_blocked' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'idle', issue: null }), true);
});

test('pairing code stays hidden until relay is reachable', () => {
  assert.equal(shouldRevealPairingCode(false), false);
  assert.equal(shouldRevealPairingCode(true), true);
});

test('isRelayTabConnected tracks live tab session states', () => {
  assert.equal(isRelayTabConnected('idle'), false);
  assert.equal(isRelayTabConnected('advertising'), true);
  assert.equal(isRelayTabConnected('paired'), true);
  assert.equal(isRelayTabConnected('reconnecting'), true);
});

test('close-menu registry keeps every chip callback and drops only the unmounted one', () => {
  const registry = createCloseMenuRegistry();
  const calls = [];
  const a = () => { calls.push('a'); };
  const b = () => { calls.push('b'); };
  const unregA = registry.register(a);
  const unregB = registry.register(b);
  assert.equal(registry.size(), 2);
  registry.closeAll();
  assert.deepEqual(calls.sort(), ['a', 'b']);
  unregA();
  assert.equal(registry.size(), 1);
  calls.length = 0;
  registry.closeAll();
  assert.deepEqual(calls, ['b']);
  unregB();
  assert.equal(registry.size(), 0);
  const noop = registry.register(null);
  assert.equal(registry.size(), 0);
  noop();
});

test('the pairing host stays mounted while the panel is closed', () => {
  assert.equal(shouldKeepAgentBridgeHostMounted({ agentBridgeLive: true, panelOpen: false }), true);
  assert.equal(shouldKeepAgentBridgeHostMounted({ agentBridgeLive: true, panelOpen: true }), true);
  assert.equal(shouldKeepAgentBridgeHostMounted({ agentBridgeLive: false, panelOpen: true }), false);
  assert.equal(shouldKeepAgentBridgeHostMounted({ agentBridgeLive: false, panelOpen: false }), false);
});

test('stale connection callbacks are ignored after a swap', () => {
  const current = { id: 2 };
  assert.equal(isCurrentPairingConnection(current, current), true);
  assert.equal(isCurrentPairingConnection(current, { id: 1 }), false);
  assert.equal(isCurrentPairingConnection(null, current), false);
});

test('disposePairingHost disconnects the socket and stops the poller', () => {
  const conn = { disconnectCalls: 0, disconnect() { this.disconnectCalls += 1; } };
  const poller = { stopCalls: 0, stop() { this.stopCalls += 1; } };
  assert.deepEqual(disposePairingHost({ conn, poller }), { conn: null, poller: null });
  assert.equal(conn.disconnectCalls, 1);
  assert.equal(poller.stopCalls, 1);
  assert.deepEqual(disposePairingHost(null), { conn: null, poller: null });
  assert.deepEqual(disposePairingHost({}), { conn: null, poller: null });
});

test('pairing dialog stages: prompt only before relay; approval replaces the code', () => {
  assert.equal(pairingDialogStage({ flowOpen: false }), 'closed');
  assert.equal(pairingDialogStage({ flowOpen: true, relayReachable: false }), 'prompt');
  assert.equal(pairingDialogStage({ flowOpen: true, relayReachable: true }), 'code');
  assert.equal(pairingDialogStage({
    flowOpen: true, relayReachable: true, pending: true,
  }), 'approval');
  assert.equal(pairingDialogStage({ flowOpen: true, webkitHttpsBlocked: true }), 'unsupported');
  const stages = ['closed', 'unsupported', 'prompt', 'code', 'approval'];
  for (const stage of stages) {
    const together = [shouldShowPairingCode(stage), shouldShowPairingApproval(stage)]
      .filter(Boolean).length;
    assert.ok(together <= 1, `${stage} must not show code and approval together`);
    if (stage !== 'prompt') assert.equal(shouldShowPairingPrompt(stage), false);
  }
  assert.equal(shouldShowPairingPrompt('prompt'), true);
  assert.equal(shouldShowPairingCode('code'), true);
  assert.equal(shouldShowPairingApproval('approval'), true);
});

test('a redeemed join stays connected across socket blips and opens chat once', () => {
  const waiting = { connected: false, waiting: true };
  const redeemed = stepJoinConnection(waiting, 'redeemed');
  assert.deepEqual(redeemed, { connected: true, waiting: false, openChat: true });
  const again = stepJoinConnection(redeemed, 'agent-up');
  assert.deepEqual(again, { connected: true, waiting: false, openChat: false });
  for (const event of ['socket-down', 'socket-up', 'resume-pending']) {
    assert.deepEqual(
      stepJoinConnection(redeemed, event),
      { connected: true, waiting: false, openChat: false },
      event,
    );
  }
  assert.deepEqual(
    stepJoinConnection(waiting, 'resume-pending'),
    { connected: false, waiting: true, openChat: false },
  );
  assert.deepEqual(
    stepJoinConnection(redeemed, 'agent-down'),
    { connected: false, waiting: false, openChat: false },
  );
  assert.deepEqual(
    stepJoinConnection(redeemed, 'user-disconnect'),
    { connected: false, waiting: false, openChat: false },
  );
  assert.equal(shouldOpenAgentChatOnConnect(false, true), true);
  assert.equal(shouldOpenAgentChatOnConnect(true, true), false);
  assert.equal(shouldOpenAgentChatOnConnect(true, false), false);
});

test('dialog auto-closes once Allow has connected the agent', () => {
  assert.equal(shouldClosePairingDialogOnConnect({ paired: true, link: 'connected' }), true);
  assert.equal(shouldClosePairingDialogOnConnect({ paired: true, link: 'reconnecting' }), false);
  assert.equal(shouldClosePairingDialogOnConnect({ paired: false, link: 'connected' }), false);
});

test('Disconnect shows only while the local agent relay is paired or connected', () => {
  assert.equal(shouldShowAgentBridgeDisconnect({}), false);
  assert.equal(shouldShowAgentBridgeDisconnect({ paired: false, link: null }), false);
  assert.equal(shouldShowAgentBridgeDisconnect({ paired: false, link: 'lost' }), false);
  assert.equal(shouldShowAgentBridgeDisconnect({ paired: true }), true);
  assert.equal(shouldShowAgentBridgeDisconnect({ paired: false, link: 'connected' }), true);
  assert.equal(shouldShowAgentBridgeDisconnect({ paired: true, link: 'reconnecting' }), true);
});

test('Agent connected toast auto-dismisses at 5 s and closes with X', () => {
  assert.equal(AGENT_CONNECTED_TOAST_MS, 5000);
  assert.equal(AGENT_CONNECTED_TOAST_COPY, 'Agent connected');
  const shown = agentConnectedToastReducer({ open: false }, 'show', 1000);
  assert.deepEqual(shown, { open: true, hideAt: 6000 });
  assert.deepEqual(agentConnectedToastReducer(shown, 'tick', 5999), shown);
  assert.deepEqual(agentConnectedToastReducer(shown, 'tick', 6000), { open: false, hideAt: 0 });
  assert.deepEqual(agentConnectedToastReducer(shown, 'dismiss', 2000), { open: false, hideAt: 0 });
  assert.deepEqual(agentConnectedToastReducer(shown, 'timeout'), { open: false, hideAt: 0 });
});

test('a 403 origin rejection and a probe timeout have distinct user messages', () => {
  const origin = pairingProbeUserCopy('origin_rejected');
  const timeout = pairingProbeUserCopy(null);
  assert.equal(origin, PAIRING_ORIGIN_REJECTED_COPY);
  assert.equal(timeout, PAIRING_WAITING_COPY);
  assert.notEqual(origin, timeout);
  assert.match(origin, /origin was rejected/i);
  assert.match(timeout, /Waiting for relay/i);
  assert.doesNotMatch(origin, /\bEdge\b/);
  assert.doesNotMatch(timeout, /\bEdge\b/);
  assert.equal(pairingProbeUserCopy('browser_blocked'), null);
});
