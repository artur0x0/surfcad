import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { commandResponse } from '../../packages/surfcad-mcp/src/commandProtocol.mjs';
import { createManualClock } from '../agent/clock.js';
import { MAX_PENDING, RESULT_RETENTION_MS, TAB_ASLEEP_MS } from '../agent/limits.js';
import { TAB_ASLEEP_ERROR, createMemoryTabRegistry } from '../agent/registry.js';

function setup() {
  const clock = createManualClock(5_000);
  const registry = createMemoryTabRegistry({ clock, asleepMs: TAB_ASLEEP_MS });
  return { clock, registry };
}

describe('tab registry', () => {
  test('routes to the most recently active tab unless one is selected', async () => {
    const { clock, registry } = setup();
    const first = [];
    const second = [];
    registry.registerTab({ userId: 'user-a', tabId: 't1', send: (frame) => first.push(frame) });
    clock.advance(10);
    registry.registerTab({ userId: 'user-b', tabId: 'other', send: () => {} });
    registry.registerTab({ userId: 'user-a', tabId: 't2', send: (frame) => second.push(frame) });
    registry.submit({ userId: 'user-a', frame: { id: 'c1', command: 'status', args: {} } });
    assert.equal(first.length, 0);
    assert.equal(second.length, 1);
    assert.equal(second[0].v, 1);
    assert.equal(second[0].command, 'status');

    clock.advance(10);
    registry.touchTab('user-a', 't1');
    registry.submit({ userId: 'user-a', frame: { id: 'c2', command: 'status', args: {} } });
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);

    assert.equal(registry.selectTab('user-a', 't2'), true);
    registry.submit({ userId: 'user-a', frame: { id: 'c3', command: 'status', args: {} } });
    assert.equal(second.length, 2);
    assert.equal(second[2 - 1].id, 'c3');

    registry.unregisterTab('user-a', 't2');
    registry.submit({ userId: 'user-a', frame: { id: 'c4', command: 'status', args: {} } });
    assert.equal(first.at(-1).id, 'c4');
    const listed = registry.listTabs('user-a');
    assert.deepEqual(listed.map((tab) => tab.id), ['t1']);
    assert.equal(registry.listTabs('user-b').length, 1);
  });

  test('a token for one user does not reach another user\'s tab', async () => {
    const { registry } = setup();
    const own = [];
    const other = [];
    registry.registerTab({ userId: 'user-a', tabId: 'ta', send: (frame) => own.push(frame) });
    registry.registerTab({ userId: 'user-b', tabId: 'tb', send: (frame) => other.push(frame) });
    const done = registry.submit({
      userId: 'user-a',
      frame: { id: 'c1', command: 'list_faces', args: { secret: 'only-a' } },
    });
    assert.equal(own.length, 1);
    assert.equal(other.length, 0);
    assert.equal(own[0].args.secret, 'only-a');
    assert.equal(registry.complete('user-b', 'c1', commandResponse({
      id: 'c1',
      ok: true,
      result: { pwned: true },
    })), false);
    registry.complete('user-a', 'c1', commandResponse({ id: 'c1', ok: true, result: { faces: 2 } }));
    const result = await done;
    assert.equal(result.result.faces, 2);
    assert.equal(result.ok, true);
  });

  test('holds a command for 30s, then reports the tab is asleep', async () => {
    const { clock, registry } = setup();
    assert.equal(TAB_ASLEEP_ERROR, 'SurfCAD tab is asleep');
    const done = registry.submit({
      userId: 'user-a',
      frame: { id: 'c1', command: 'status', args: { secret: 'payload-secret' } },
    });
    clock.advance(TAB_ASLEEP_MS - 1);
    const early = await Promise.race([
      done.then(() => 'done'),
      Promise.resolve('pending'),
    ]);
    assert.equal(early, 'pending');
    clock.advance(1);
    const result = await done;
    assert.equal(result.ok, false);
    assert.equal(result.error.message, 'SurfCAD tab is asleep');
    assert.equal(result.error.code, 'tab_asleep');
  });

  test('a tab that reconnects inside the hold receives the command', async () => {
    const { clock, registry } = setup();
    const done = registry.submit({
      userId: 'user-a',
      frame: { id: 'c1', command: 'status', args: {} },
    });
    clock.advance(10_000);
    const seen = [];
    registry.registerTab({
      userId: 'user-a',
      tabId: 't-new',
      send(frame) {
        seen.push(frame);
        registry.complete('user-a', frame.id, commandResponse({
          id: frame.id,
          ok: true,
          result: { resumed: true },
        }));
      },
    });
    const result = await done;
    assert.equal(seen.length, 1);
    assert.equal(result.result.resumed, true);
    assert.notEqual(result.error?.message, 'SurfCAD tab is asleep');
  });

  test('unread results are dropped after the retention window', async () => {
    const clock = createManualClock(5_000);
    const registry = createMemoryTabRegistry({
      clock,
      asleepMs: TAB_ASLEEP_MS,
      retentionMs: RESULT_RETENTION_MS,
    });
    registry.registerTab({
      userId: 'user-a',
      tabId: 't1',
      send(frame) {
        registry.complete('user-a', frame.id, commandResponse({
          id: frame.id,
          ok: true,
          result: { payload: 'payload-secret' },
        }));
      },
    });
    await registry.submit({
      userId: 'user-a',
      frame: { id: 'c1', command: 'status', args: { secret: 'payload-secret' } },
    });
    assert.equal(registry.debugPayloads().includes('payload-secret'), true);
    clock.advance(RESULT_RETENTION_MS);
    assert.equal(registry.debugPayloads().includes('payload-secret'), false);
    assert.equal(await registry.wait('user-a', 'c1', 0), null);
  });

  test('a token cannot hold more than MAX_PENDING commands', async () => {
    const clock = createManualClock(5_000);
    const registry = createMemoryTabRegistry({ clock, maxPending: 2 });
    assert.equal(MAX_PENDING, 32);
    const first = registry.submit({
      userId: 'user-a',
      tokenId: 'tok-a',
      frame: { id: 'c1', command: 'status', args: {} },
    });
    const second = registry.submit({
      userId: 'user-a',
      tokenId: 'tok-a',
      frame: { id: 'c2', command: 'status', args: {} },
    });
    const third = await registry.submit({
      userId: 'user-a',
      tokenId: 'tok-a',
      frame: { id: 'c3', command: 'status', args: {} },
    });
    assert.equal(third.ok, false);
    assert.equal(third.error.code, 'too_many_pending');
    assert.equal(third.error.message, 'Too many commands are waiting');
    assert.equal(registry.pendingCount('tok-a'), 2);
    const other = registry.submit({
      userId: 'user-a',
      tokenId: 'tok-b',
      frame: { id: 'c4', command: 'status', args: {} },
    });
    assert.equal(registry.pendingCount('tok-b'), 1);
    registry.complete('user-a', 'c1', commandResponse({ id: 'c1', ok: true, result: {} }));
    registry.complete('user-a', 'c2', commandResponse({ id: 'c2', ok: true, result: {} }));
    registry.complete('user-a', 'c4', commandResponse({ id: 'c4', ok: true, result: {} }));
    assert.equal((await first).ok, true);
    assert.equal((await second).ok, true);
    assert.equal((await other).ok, true);
    const again = registry.submit({
      userId: 'user-a',
      tokenId: 'tok-a',
      frame: { id: 'c5', command: 'status', args: {} },
    });
    assert.equal(registry.pendingCount('tok-a'), 1);
    registry.complete('user-a', 'c5', commandResponse({ id: 'c5', ok: true, result: {} }));
    assert.equal((await again).ok, true);
  });

  test('a result is readable only by the token that submitted it', async () => {
    const { registry } = setup();
    registry.registerTab({
      userId: 'user-a',
      tabId: 't1',
      send(frame) {
        registry.complete('user-a', frame.id, commandResponse({
          id: frame.id,
          ok: true,
          result: { n: 1 },
        }));
      },
    });
    await registry.submit({
      userId: 'user-a',
      tokenId: 'tok-a',
      frame: { id: 'c1', command: 'status', args: {} },
    });
    assert.equal(await registry.wait('user-a', 'c1', 0, 'tok-b'), null);
    const own = await registry.wait('user-a', 'c1', 0, 'tok-a');
    assert.equal(own.status, 'done');
    assert.equal(own.response.result.n, 1);
    assert.equal(await registry.wait('user-a', 'c1', 0, 'tok-a'), null);
  });

  test('abortToken ends an in-flight wait and drops the result', async () => {
    const { registry } = setup();
    registry.registerTab({ userId: 'user-a', tabId: 't1', send() {} });
    const hanging = registry.submit({
      userId: 'user-a',
      tokenId: 'tok-a',
      frame: { id: 'c2', command: 'status', args: {} },
    });
    const waiting = registry.wait('user-a', 'c2', 5000, 'tok-a');
    registry.abortToken('tok-a');
    assert.equal((await waiting).status, 'revoked');
    assert.equal((await hanging).ok, false);
    assert.equal((await hanging).error.code, 'unauthorized');
    assert.equal(await registry.wait('user-a', 'c2', 0, 'tok-a'), null);
    assert.equal(await registry.wait('user-a', 'c2', 0, 'tok-b'), null);
  });

  test('an agent socket tells that user\'s tabs, and prompt frames stay on that user', () => {
    const { registry } = setup();
    const tab = [];
    const other = [];
    const agent = [];
    registry.registerTab({ userId: 'user-a', tabId: 't1', send: (frame) => tab.push(frame) });
    registry.registerTab({ userId: 'user-b', tabId: 't2', send: (frame) => other.push(frame) });
    assert.equal(tab.length, 0);
    assert.equal(registry.agentConnected('user-a'), false);
    registry.registerAgent({ userId: 'user-a', agentId: 'ag1', send: (frame) => agent.push(frame) });
    assert.equal(tab.length, 1);
    assert.deepEqual(tab[0], { type: 'agent', v: 1, connected: true });
    assert.equal(other.length, 0);
    registry.registerAgent({ userId: 'user-a', agentId: 'ag2', send: () => {} });
    assert.equal(tab.length, 1);
    registry.forwardToTabs('user-a', { type: 'agent.prompt', text: 'hi' });
    assert.equal(tab.at(-1).type, 'agent.prompt');
    assert.equal(tab.at(-1).text, 'hi');
    assert.equal(other.length, 0);
    registry.forwardToAgents('user-a', { type: 'agent.reply', text: 'yo' });
    assert.equal(agent.at(-1).text, 'yo');
    registry.forwardToAgents('user-b', { type: 'agent.reply', text: 'nope' });
    assert.equal(agent.length, 1);
    registry.unregisterAgent('user-a', 'ag1');
    assert.equal(tab.filter((frame) => frame.type === 'agent').at(-1).connected, true);
    registry.unregisterAgent('user-a', 'ag2');
    assert.deepEqual(tab.at(-1), { type: 'agent', v: 1, connected: false });
    assert.equal(registry.agentConnected('user-a'), false);
    assert.equal(other.length, 0);
  });

  test('a tab prompt waits for an HTTPS pull, a cancel, or the hold', async () => {
    const clock = createManualClock(0);
    const registry = createMemoryTabRegistry({ clock, promptHoldMs: 1000 });
    const expired = [];
    registry.holdPrompt('user-a', { type: 'agent.prompt', id: 'p1', text: 'hi' }, {
      onExpire() { expired.push('p1'); },
    });
    const taken = await registry.waitPrompts('user-a', 5000, 'tok-a');
    assert.equal(taken.status, 'messages');
    assert.equal(taken.messages[0].text, 'hi');
    clock.advance(1000);
    assert.deepEqual(expired, []);

    const pending = registry.waitPrompts('user-a', 5000, 'tok-a');
    registry.holdPrompt('user-a', { type: 'agent.prompt', id: 'p2', text: 'wake' }, {
      onExpire() { expired.push('p2'); },
    });
    const woke = await pending;
    assert.equal(woke.status, 'messages');
    assert.equal(woke.messages[0].text, 'wake');
    clock.advance(1000);
    assert.deepEqual(expired, []);

    registry.holdPrompt('user-a', { type: 'agent.prompt', id: 'p3', text: 'later' }, {
      onExpire() { expired.push('p3'); },
    });
    clock.advance(999);
    assert.deepEqual(expired, []);
    clock.advance(1);
    assert.deepEqual(expired, ['p3']);

    registry.holdPrompt('user-a', { type: 'agent.prompt', id: 'p4', text: 'cancel me' }, {
      onExpire() { expired.push('p4'); },
    });
    assert.equal(registry.dropHeldPrompt('user-a', 'p4'), true);
    clock.advance(1000);
    assert.deepEqual(expired, ['p3']);

    const hanging = registry.waitPrompts('user-a', 5000, 'tok-a');
    registry.abortToken('tok-a');
    assert.equal((await hanging).status, 'revoked');

    registry.holdPrompt('user-a', { type: 'agent.prompt', id: 'p5', text: 'flush' }, {
      onExpire() { expired.push('p5'); },
    });
    assert.equal(registry.drainPrompts('user-a')[0].text, 'flush');
    clock.advance(1000);
    assert.deepEqual(expired, ['p3']);
    const agent = [];
    registry.registerAgent({ userId: 'user-a', agentId: 'ag', send: (frame) => agent.push(frame) });
    assert.equal(registry.forwardToAgents('user-a', { type: 'agent.prompt', text: 'live' }), 1);
    assert.equal(agent.at(-1).text, 'live');
    assert.equal(registry.forwardToAgents('nobody', { type: 'agent.prompt', text: 'no' }), 0);
  });
});
