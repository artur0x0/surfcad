/**
 * The agent window: with several SurfCAD windows or devices open on one
 * account, the agent's activity (status, progress, replies, session notes)
 * and its commands go to one tab, the one that paired it or that the user
 * last sent a prompt from. Other tabs hear presence only.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, test } from 'node:test';
import express from 'express';
import { WebSocket } from 'ws';
import { createManualClock } from '../agent/clock.js';
import { createAgentRelay } from '../agent/createRelay.js';
import { MAX_PROMPT_TABS } from '../agent/limits.js';
import { createMemoryTabRegistry } from '../agent/registry.js';
import { attachAgentWebSocket } from '../agent/wsServer.js';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

function setup() {
  const clock = createManualClock(5_000);
  let n = 0;
  const registry = createMemoryTabRegistry({ clock, newClaim: () => `claim-${(n += 1)}` });
  const a = [];
  const b = [];
  registry.registerTab({ userId: 'u', tabId: 'A', send: (frame) => a.push(frame) });
  clock.advance(10);
  registry.registerTab({ userId: 'u', tabId: 'B', send: (frame) => b.push(frame) });
  return { clock, registry, a, b };
}

/** Frames that are agent activity, not presence. */
function activity(frames) {
  return frames.filter((frame) => frame.type !== 'agent' && typeof frame.command !== 'string');
}

describe('agent window (registry)', () => {
  test('with no claim an agent frame goes to one tab, the most recently active, never to every tab', () => {
    const { registry, a, b } = setup();
    registry.registerAgent({ userId: 'u', agentId: 'ag', send() {} });
    // Presence is the one frame every tab hears.
    assert.deepEqual(a, [{ type: 'agent', v: 1, connected: true }]);
    assert.deepEqual(b, [{ type: 'agent', v: 1, connected: true }]);
    assert.equal(registry.forwardToTabs('u', { type: 'agent.status', v: 1, working: true, state: 'working' }), 1);
    assert.equal(activity(a).length, 0);
    assert.equal(activity(b).length, 1);
    assert.equal(registry.agentWindowId('u'), 'B');
  });

  test('the tab that claimed is the agent window: activity and commands go there, the other window stays quiet', () => {
    const { clock, registry, a, b } = setup();
    registry.registerAgent({ userId: 'u', agentId: 'ag', send() {} });
    const claim = registry.claimAgentWindow('u', 'A');
    assert.equal(claim, 'claim-1');
    assert.equal(registry.agentWindowId('u'), 'A');
    assert.deepEqual(registry.listTabs('u').map((tab) => [tab.id, tab.agentWindow]).sort(), [['A', true], ['B', false]]);

    // B is the newer tab and is touched later: it still does not take the agent.
    clock.advance(10);
    registry.touchTab('u', 'B');
    for (const frame of [
      { type: 'agent.status', v: 1, working: true, state: 'typing' },
      { type: 'agent.status', v: 1, working: true, state: 'working' },
      { type: 'agent.activity', v: 1 },
      { type: 'agent.message', v: 1, text: 'note' },
      { type: 'agent.status', v: 1, working: false, state: 'idle' },
    ]) registry.forwardToTabs('u', frame);
    registry.noteAgentProgress('u');
    registry.submit({ userId: 'u', frame: { id: 'c1', command: 'insert_cube', args: {} } });
    assert.equal(activity(a).length, 6, 'status, activity, note and progress reached the agent window');
    assert.equal(a.filter((frame) => frame.command === 'insert_cube').length, 1, 'the command ran in the agent window');
    assert.deepEqual(activity(b), [], 'window B saw no dots, spinner, fold or reply');
    assert.equal(b.some((frame) => typeof frame.command === 'string'), false);
    // B still knows the agent is connected.
    assert.equal(b.filter((frame) => frame.type === 'agent' && frame.connected === true).length, 1);

    // A second claim of the same tab keeps its claim id.
    assert.equal(registry.claimAgentWindow('u', 'A'), 'claim-1');
    // An explicit tab select still wins for commands and frames.
    assert.equal(registry.selectTab('u', 'B'), true);
    assert.equal(registry.agentWindowId('u'), 'B');
    registry.selectTab('u', null);
    assert.equal(registry.agentWindowId('u'), 'A');
  });

  test('frames about a prompt go to the tab that sent it; the rest follow the agent window', () => {
    const { registry, a, b } = setup();
    registry.registerAgent({ userId: 'u', agentId: 'ag', send() {} });
    registry.claimAgentWindow('u', 'A');
    assert.equal(registry.notePromptTab('u', P1, 'A'), true);
    // The user then talks to the agent from B: B is the agent window now.
    assert.equal(registry.notePromptTab('u', P2, 'B'), true);
    assert.equal(registry.claimAgentWindow('u', 'B'), 'claim-2');
    assert.equal(registry.agentWindowId('u'), 'B');

    registry.forwardToTabs('u', { type: 'agent.reply', v: 1, id: P1, text: 'done in A', final: true });
    registry.forwardToTabs('u', { type: 'agent.status', v: 1, id: P1, working: false, state: 'idle' });
    registry.forwardToTabs('u', { type: 'agent.prompt.ack', id: P2, delivery: 'queued' });
    registry.forwardToTabs('u', { type: 'agent.reply', v: 1, id: P2, text: 'on it', final: false });
    registry.forwardToTabs('u', { type: 'agent.progress', v: 1, working: true });
    assert.deepEqual(activity(a).map((frame) => [frame.type, frame.id]), [['agent.reply', P1], ['agent.status', P1]]);
    assert.deepEqual(activity(b).map((frame) => [frame.type, frame.id]), [
      ['agent.prompt.ack', P2], ['agent.reply', P2], ['agent.progress', undefined],
    ]);

    // The sender closed: a late frame for its prompt falls back to the agent window.
    registry.unregisterTab('u', 'A');
    registry.forwardToTabs('u', { type: 'agent.reply', v: 1, id: P1, text: 'late', final: true });
    assert.equal(b.at(-1).text, 'late');
    assert.equal(registry.notePromptTab('u', P1, 'A'), false, 'a closed tab is not remembered');
    assert.equal(registry.notePromptTab('u', '', 'B'), false);
  });

  test('a reload resumes the claim; a window whose claim was superseded cannot take the agent back', () => {
    const { registry, a } = setup();
    const claim = registry.claimAgentWindow('u', 'A');
    // A reloads: a new socket, a new tab id, the same claim.
    registry.unregisterTab('u', 'A');
    assert.equal(registry.agentWindowId('u'), 'B', 'while it is away the most recent tab stands in');
    const a2 = [];
    registry.registerTab({ userId: 'u', tabId: 'A2', send: (frame) => a2.push(frame) });
    assert.equal(registry.claimAgentWindow('u', 'A2', claim), claim);
    assert.equal(registry.agentWindowId('u'), 'A2');

    // The user pairs from B: a fresh claim always wins.
    const other = registry.claimAgentWindow('u', 'B');
    assert.notEqual(other, claim);
    assert.equal(registry.agentWindowId('u'), 'B');
    // A2 reloads again and offers its old claim: refused, B keeps the agent.
    registry.unregisterTab('u', 'A2');
    registry.registerTab({ userId: 'u', tabId: 'A3', send: () => {} });
    assert.equal(registry.claimAgentWindow('u', 'A3', claim), null);
    assert.equal(registry.agentWindowId('u'), 'B');
    // Once B is gone nobody holds the role, so the old claim is honoured again.
    registry.unregisterTab('u', 'B');
    assert.equal(registry.claimAgentWindow('u', 'A3', claim), claim);
    assert.equal(registry.agentWindowId('u'), 'A3');
    // An unknown tab or account cannot claim.
    assert.equal(registry.claimAgentWindow('u', 'nope'), null);
    assert.equal(registry.claimAgentWindow('someone-else', 'A3'), null);
    assert.equal(a.length, 0);
  });

  test('a command no tab has taken goes to the tab that claims; the prompt-to-tab map is bounded', () => {
    const clock = createManualClock(0);
    const registry = createMemoryTabRegistry({ clock });
    registry.submit({ userId: 'u', frame: { id: 'c1', command: 'status', args: {} } });
    const a = [];
    const b = [];
    registry.registerTab({ userId: 'u', tabId: 'A', send: (frame) => a.push(frame) });
    assert.equal(a.length, 1, 'the waiting command went to the only tab');
    registry.registerTab({ userId: 'u', tabId: 'B', send: (frame) => b.push(frame) });
    registry.claimAgentWindow('u', 'A');
    registry.submit({ userId: 'u', frame: { id: 'c2', command: 'status', args: {} } });
    assert.equal(a.length, 2);
    assert.equal(b.length, 0);

    for (let i = 0; i < MAX_PROMPT_TABS + 5; i += 1) registry.notePromptTab('u', `p-${i}`, 'B');
    registry.forwardToTabs('u', { type: 'agent.reply', v: 1, id: 'p-0', text: 'old', final: true });
    assert.equal(a.at(-1).text, 'old', 'an id that fell off the map follows the agent window');
    registry.forwardToTabs('u', { type: 'agent.reply', v: 1, id: `p-${MAX_PROMPT_TABS + 4}`, text: 'new', final: true });
    assert.equal(b.at(-1).text, 'new');
  });
});

/** @type {import('node:http').Server[]} */
const servers = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function listen(relay) {
  const app = express();
  app.use(express.json());
  app.use('/agent', relay.router);
  const server = http.createServer(app);
  attachAgentWebSocket(server, relay, {
    authenticateUpgrade: async (req) => {
      const id = req.headers['x-test-user'];
      return typeof id === 'string' ? { id } : null;
    },
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

/** A socket that keeps every frame, so "nothing arrived" can be asserted. */
function connect(url, headers) {
  const ws = new WebSocket(url, { headers });
  const seen = [];
  const waiters = [];
  ws.on('message', (data) => {
    seen.push(JSON.parse(data.toString()));
    for (const tick of waiters.splice(0)) tick();
  });
  const opened = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws,
    seen,
    opened,
    send(frame) { ws.send(JSON.stringify(frame)); },
    waitFor(pred, what) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}: ${JSON.stringify(seen)}`)), 2000);
        const tick = () => {
          const hit = seen.find(pred);
          if (hit) { clearTimeout(timer); resolve(hit); } else waiters.push(tick);
        };
        tick();
      });
    },
  };
}

const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

describe('agent window (websocket)', () => {
  test('pair from window A: dots, spinner and replies show on A only; window B stays quiet; a prompt from B moves the agent there', async () => {
    const relay = createAgentRelay();
    const port = await listen(relay);
    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const url = `ws://127.0.0.1:${port}/agent`;
    const tabHeaders = { origin: 'https://surfcad.com', 'x-test-user': 'user-a' };

    const a = connect(url, tabHeaders);
    await a.opened;
    await a.waitFor((m) => m.type === 'registered', 'A registered');
    // B opens later (the phone and the desktop both open): it is the newer tab.
    const b = connect(url, tabHeaders);
    await b.opened;
    await b.waitFor((m) => m.type === 'registered', 'B registered');

    // The user starts pairing in A.
    a.send({ type: 'tab.claim', v: 1 });
    const claimed = await a.waitFor((m) => m.type === 'tab.claimed', 'A claimed');
    assert.equal(typeof claimed.claim, 'string');
    assert.ok(claimed.claim.length >= 8);

    const agent = connect(url, { authorization: `Bearer ${issued.token}` });
    await agent.opened;
    agent.send({ type: 'hello', v: 1 });
    await agent.waitFor((m) => m.type === 'hello', 'agent hello');
    // Both windows learn the agent is connected.
    await a.waitFor((m) => m.type === 'agent' && m.connected === true, 'A presence');
    await b.waitFor((m) => m.type === 'agent' && m.connected === true, 'B presence');
    const quiet = () => b.seen.filter((m) => m.type !== 'registered' && m.type !== 'agent');

    // A prompt from A, then the whole turn.
    a.send({ type: 'agent.prompt', v: 1, id: P1, text: 'draw a box' });
    await agent.waitFor((m) => m.type === 'agent.prompt' && m.id === P1, 'prompt at the agent');
    agent.send({ type: 'agent.prompt.ack', id: P1, delivery: 'queued' });
    agent.send({ type: 'agent.status', v: 1, id: P1, working: true, state: 'typing' });
    agent.send({ type: 'agent.reply', v: 1, id: P1, text: 'Got it.', final: false });
    agent.send({ type: 'agent.status', v: 1, id: P1, working: true, state: 'working' });
    agent.send({ type: 'agent.progress', v: 1, working: true });
    agent.send({ id: 'c1', command: 'insert_cube', args: {} });
    const command = await a.waitFor((m) => m.command === 'insert_cube', 'the command in A');
    a.send({ id: command.id, ok: true, result: { ok: true } });
    agent.send({ type: 'agent.reply', v: 1, id: P1, text: 'Box added.', final: true });
    agent.send({ type: 'agent.status', v: 1, id: P1, working: false, state: 'idle' });
    await a.waitFor((m) => m.type === 'agent.status' && m.state === 'idle', 'idle on A');
    await settle();
    assert.deepEqual(
      a.seen.filter((m) => typeof m.type === 'string' && m.type.startsWith('agent.')).map((m) => m.type),
      ['agent.prompt.ack', 'agent.status', 'agent.reply', 'agent.status', 'agent.progress', 'agent.reply', 'agent.status'],
    );
    assert.deepEqual(quiet(), [], 'window B saw no ack, dots, spinner, fold, command or reply');

    // A session-level frame with no prompt id (a build the agent started itself).
    agent.send({ type: 'agent.status', v: 1, working: true, state: 'working' });
    agent.send({ type: 'agent.message', v: 1, text: 'Starting the next part.', ts: new Date().toISOString() });
    await a.waitFor((m) => m.type === 'agent.message', 'note on A');
    await settle();
    assert.deepEqual(quiet(), []);

    // The user now sends a prompt from B: B becomes the agent window.
    const beforeA = a.seen.length;
    b.send({ type: 'agent.prompt', v: 1, id: P2, text: 'and a hole' });
    await agent.waitFor((m) => m.type === 'agent.prompt' && m.id === P2, 'B prompt at the agent');
    agent.send({ type: 'agent.status', v: 1, id: P2, working: true, state: 'typing' });
    agent.send({ type: 'agent.progress', v: 1, working: true });
    agent.send({ type: 'agent.reply', v: 1, id: P2, text: 'Hole added.', final: true });
    await b.waitFor((m) => m.type === 'agent.reply' && m.id === P2, 'reply on B');
    await settle();
    assert.deepEqual(quiet().map((m) => m.type), ['agent.status', 'agent.progress', 'agent.reply']);
    assert.deepEqual(a.seen.slice(beforeA), [], 'A is quiet once the agent is working for B');

    // A reloads and offers its old claim: B keeps the agent.
    a.ws.close();
    const a2 = connect(url, tabHeaders);
    await a2.opened;
    await a2.waitFor((m) => m.type === 'registered', 'A2 registered');
    a2.send({ type: 'tab.claim', v: 1, claim: claimed.claim });
    const refused = await a2.waitFor((m) => m.type === 'tab.claimed', 'A2 claim answer');
    assert.equal(refused.claim, null);
    const progressOnB = b.seen.filter((m) => m.type === 'agent.progress').length;
    agent.send({ type: 'agent.progress', v: 1, working: true });
    await b.waitFor(() => b.seen.filter((m) => m.type === 'agent.progress').length > progressOnB, 'progress on B');
    await settle();
    assert.equal(a2.seen.some((m) => typeof m.type === 'string' && m.type.startsWith('agent.')), false);

    agent.ws.close();
    a2.ws.close();
    b.ws.close();
  });
});
