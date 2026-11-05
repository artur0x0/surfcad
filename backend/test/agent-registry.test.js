import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { commandResponse } from '../../packages/surfcad-mcp/src/commandProtocol.mjs';
import { createManualClock } from '../agent/clock.js';
import { AGENT_PRESENCE_TTL_MS, MAX_PENDING, MOLD_COMMAND_MS, RESULT_RETENTION_MS, TAB_ASLEEP_MS } from '../agent/limits.js';
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

  test('a mold_* command the tab took survives 30 s and resolves when the tab answers at 100 s', async () => {
    const { clock, registry } = setup();
    const seen = [];
    registry.registerTab({ userId: 'user-a', tabId: 't1', send: (frame) => seen.push(frame) });
    const done = registry.submit({
      userId: 'user-a',
      frame: { id: 'm1', command: 'mold_fit', args: {} },
    });
    assert.equal(seen.length, 1);
    clock.advance(TAB_ASLEEP_MS + 1_000);
    const early = await Promise.race([done.then(() => 'done'), Promise.resolve('pending')]);
    assert.equal(early, 'pending');
    clock.advance(100_000 - (TAB_ASLEEP_MS + 1_000));
    registry.complete('user-a', 'm1', commandResponse({ id: 'm1', ok: true, result: { fit: 'good' } }));
    const result = await done;
    assert.equal(result.ok, true);
    assert.equal(result.result.fit, 'good');
  });

  test('a mold_* command the tab took but never answered is command_timeout at 120 s', async () => {
    const { clock, registry } = setup();
    registry.registerTab({ userId: 'user-a', tabId: 't1', send: () => {} });
    const done = registry.submit({
      userId: 'user-a',
      frame: { id: 'm2', command: 'mold_side_actions', args: {} },
    });
    clock.advance(MOLD_COMMAND_MS - 1);
    assert.equal(await Promise.race([done.then(() => 'done'), Promise.resolve('pending')]), 'pending');
    clock.advance(1);
    const result = await done;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'command_timeout');
    assert.equal(result.error.details.command, 'mold_side_actions');
    assert.equal(result.error.details.budgetMs, MOLD_COMMAND_MS);
  });

  test('a mold_* command no tab took is still tab_asleep at 30 s', async () => {
    const { clock, registry } = setup();
    const done = registry.submit({
      userId: 'user-a',
      frame: { id: 'm3', command: 'mold_fit', args: {} },
    });
    clock.advance(TAB_ASLEEP_MS);
    const result = await done;
    assert.equal(result.error.code, 'tab_asleep');
  });

  test('a status command the tab took still times out at 30 s, as command_timeout', async () => {
    const { clock, registry } = setup();
    registry.registerTab({ userId: 'user-a', tabId: 't1', send: () => {} });
    const done = registry.submit({
      userId: 'user-a',
      frame: { id: 's1', command: 'status', args: {} },
    });
    clock.advance(TAB_ASLEEP_MS - 1);
    assert.equal(await Promise.race([done.then(() => 'done'), Promise.resolve('pending')]), 'pending');
    clock.advance(1);
    const result = await done;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'command_timeout');
    assert.equal(result.error.details.budgetMs, TAB_ASLEEP_MS);
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
    assert.equal(tab.filter((frame) => frame.type === 'agent' && frame.connected === false).length, 0);
    assert.equal(registry.agentConnected('user-a'), true);
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
    registry.abortToken('tok-a', 'user-a');
    assert.deepEqual(registry.drainPrompts('user-a'), []);
    assert.deepEqual(expired, ['p3', 'p5']);
    clock.advance(1000);
    assert.deepEqual(expired, ['p3', 'p5']);
    const agent = [];
    registry.registerAgent({ userId: 'user-a', agentId: 'ag', send: (frame) => agent.push(frame) });
    assert.equal(registry.forwardToAgents('user-a', { type: 'agent.prompt', text: 'live' }), 1);
    assert.equal(agent.at(-1).text, 'live');
    assert.equal(registry.forwardToAgents('nobody', { type: 'agent.prompt', text: 'no' }), 0);
  });

  test('a prompt for a present agent is held until taken, offered once per consumer, and fails when presence ends', async () => {
    const clock = createManualClock(0);
    const registry = createMemoryTabRegistry({ clock, promptHoldMs: 1000, presenceTtlMs: 10_000 });
    const tab = [];
    registry.registerTab({ userId: 'user-a', tabId: 't1', send: (frame) => tab.push(frame) });
    const expired = [];
    const prompt = (id) => ({ type: 'agent.prompt', v: 1, id, text: id });
    const expireNote = (id) => ({ onExpire() { expired.push(id); } });

    // Present (a one-shot process stamped last-seen) with no socket open:
    // no short hold, and each new consumer is offered the prompt once.
    registry.noteAgentSeen('user-a');
    assert.deepEqual(registry.deliverPrompt('user-a', prompt('p1'), expireNote('p1')), { delivered: 0, held: true, present: true });
    clock.advance(5000);
    assert.deepEqual(expired, []);
    assert.deepEqual(registry.offerPrompts('user-a', 'sock-1').map((f) => f.id), ['p1']);
    assert.deepEqual(registry.offerPrompts('user-a', 'sock-1'), []);
    assert.deepEqual(registry.offerPrompts('user-a', 'sock-2').map((f) => f.id), ['p1']);
    assert.deepEqual(registry.heldPromptIds('user-a'), ['p1']);
    assert.equal(registry.takeHeldPrompts('user-a', ['nope']), 0);
    assert.equal(registry.takeHeldPrompts('user-a', 'p1'), 0);
    assert.equal(registry.takeHeldPrompts('user-a', ['p1']), 1);
    assert.deepEqual(registry.heldPromptIds('user-a'), []);
    assert.deepEqual(registry.offerPrompts('user-a', 'sock-3'), []);

    // A live socket gets it now and counts as offered; the row is still held
    // for the next socket until that process reports it taken.
    const agent = [];
    registry.registerAgent({ userId: 'user-a', agentId: 'ag1', send: (frame) => agent.push(frame) });
    assert.deepEqual(registry.deliverPrompt('user-a', prompt('p2'), expireNote('p2')), { delivered: 1, held: true, present: true });
    assert.equal(agent.at(-1).id, 'p2');
    assert.deepEqual(registry.offerPrompts('user-a', 'ag1'), []);
    assert.deepEqual(registry.offerPrompts('user-a', 'ag2').map((f) => f.id), ['p2']);

    // The HTTPS pull: offered once per pull session, and a waiting pull
    // session is woken with only the rows it has not seen.
    const first = await registry.waitPrompts('user-a', 5000, 'tok-a', 'pull-1');
    assert.deepEqual(first.messages.map((f) => f.id), ['p2']);
    const pending = registry.waitPrompts('user-a', 5000, 'tok-a', 'pull-1');
    const other = registry.waitPrompts('user-a', 5000, 'tok-a', 'pull-2');
    assert.deepEqual((await other).messages.map((f) => f.id), ['p2']);
    registry.deliverPrompt('user-a', prompt('p3'), expireNote('p3'));
    assert.deepEqual((await pending).messages.map((f) => f.id), ['p3']);
    assert.deepEqual(registry.heldPromptIds('user-a'), ['p2', 'p3']);

    // Presence ends with no activity: every held row fails back to the tab.
    registry.unregisterAgent('user-a', 'ag1');
    clock.advance(10_000);
    assert.equal(registry.agentConnected('user-a'), false);
    assert.deepEqual(expired, ['p2', 'p3']);
    assert.deepEqual(registry.heldPromptIds('user-a'), []);

    // close_session fails them too.
    registry.noteAgentSeen('user-a');
    registry.deliverPrompt('user-a', prompt('p4'), expireNote('p4'));
    registry.endAgentSession('user-a');
    assert.deepEqual(expired, ['p2', 'p3', 'p4']);

    // Not present: the short hold, which an offer cancels.
    assert.deepEqual(registry.deliverPrompt('user-a', prompt('p5'), expireNote('p5')), { delivered: 0, held: true, present: false });
    clock.advance(999);
    assert.deepEqual(registry.offerPrompts('user-a', 'sock-9').map((f) => f.id), ['p5']);
    clock.advance(5000);
    assert.deepEqual(expired, ['p2', 'p3', 'p4'], 'an offered prompt does not time out');
    // An older client with no pull session drains what is left.
    assert.deepEqual(registry.drainPrompts('user-a').map((f) => f.id), ['p5']);
    assert.deepEqual(registry.heldPromptIds('user-a'), []);
    // Not present and nobody comes: the short hold fails it.
    registry.deliverPrompt('user-a', prompt('p6'), expireNote('p6'));
    clock.advance(1000);
    assert.deepEqual(expired, ['p2', 'p3', 'p4', 'p6']);
  });

  test('a session note is one per second per account', () => {
    const clock = createManualClock(0);
    const registry = createMemoryTabRegistry({ clock, sessionMessageGapMs: 1000 });
    assert.equal(registry.allowSessionMessage('user-a'), true);
    assert.equal(registry.allowSessionMessage('user-a'), false);
    assert.equal(registry.allowSessionMessage('user-b'), true);
    clock.advance(999);
    assert.equal(registry.allowSessionMessage('user-a'), false);
    assert.equal(registry.allowSessionMessage('user-b'), false);
    clock.advance(1);
    assert.equal(registry.allowSessionMessage('user-a'), true);
    assert.equal(registry.allowSessionMessage('user-b'), true);
  });

  test('repeated socket closes stay present and a 10 minute lapse goes inactive', () => {
    const clock = createManualClock(0);
    const registry = createMemoryTabRegistry({ clock });
    const tab = [];
    registry.registerTab({ userId: 'user-a', tabId: 't1', send: (frame) => tab.push(frame) });
    for (let i = 0; i < 3; i += 1) {
      registry.registerAgent({ userId: 'user-a', agentId: `ag-${i}`, send() {} });
      registry.unregisterAgent('user-a', `ag-${i}`);
      clock.advance(2000);
    }
    assert.equal(registry.agentConnected('user-a'), true);
    assert.equal(tab.filter((frame) => frame.type === 'agent' && frame.connected === false).length, 0);
    assert.equal(tab.filter((frame) => frame.type === 'agent' && frame.connected === true).length, 1);
    clock.advance(AGENT_PRESENCE_TTL_MS - 2001);
    assert.equal(registry.agentConnected('user-a'), true);
    clock.advance(1);
    assert.equal(registry.agentConnected('user-a'), false);
    assert.deepEqual(tab.at(-1), { type: 'agent', v: 1, connected: false, reason: 'inactive' });
  });

  test('an open idle socket expires without a close', () => {
    const clock = createManualClock(0);
    const registry = createMemoryTabRegistry({ clock });
    const tab = [];
    registry.registerTab({ userId: 'user-a', tabId: 't1', send: (frame) => tab.push(frame) });
    registry.registerAgent({ userId: 'user-a', agentId: 'ag', send() {} });
    clock.advance(AGENT_PRESENCE_TTL_MS);
    assert.equal(registry.agentConnected('user-a'), false);
    assert.equal(tab.at(-1).reason, 'inactive');
    assert.equal(registry.noteAgentSeen('user-a'), true);
    assert.equal(registry.agentConnected('user-a'), true);
  });

  test('an open idle socket expires and a close does not refresh the window', () => {
    const clock = createManualClock(0);
    const registry = createMemoryTabRegistry({ clock });
    const tab = [];
    registry.registerTab({ userId: 'user-a', tabId: 't1', send: (frame) => tab.push(frame) });
    registry.registerAgent({ userId: 'user-a', agentId: 'ag', send() {} });
    clock.advance(AGENT_PRESENCE_TTL_MS - 1000);
    registry.unregisterAgent('user-a', 'ag');
    assert.equal(registry.agentConnected('user-a'), true);
    assert.equal(tab.some((frame) => frame.connected === false), false);
    clock.advance(1000);
    assert.equal(registry.agentConnected('user-a'), false);
    assert.equal(tab.at(-1).reason, 'inactive');
  });

  test('close_session is offline immediately and a following close does not restore it', () => {
    const clock = createManualClock(0);
    const registry = createMemoryTabRegistry({ clock });
    const tab = [];
    registry.registerTab({ userId: 'user-a', tabId: 't1', send: (frame) => tab.push(frame) });
    registry.registerAgent({ userId: 'user-a', agentId: 'ag', send() {} });
    assert.equal(registry.endAgentSession('user-a'), true);
    assert.equal(registry.agentConnected('user-a'), false);
    assert.deepEqual(tab.at(-1), { type: 'agent', v: 1, connected: false, reason: 'closed' });
    registry.unregisterAgent('user-a', 'ag');
    clock.advance(1000);
    assert.equal(registry.agentConnected('user-a'), false);
    assert.equal(tab.filter((frame) => frame.connected === true).length, 1);
    assert.equal(tab.filter((frame) => frame.reason === 'closed').length, 1);
  });

  test('revoke is immediate and progress stamps activity without text', () => {
    const clock = createManualClock(0);
    const registry = createMemoryTabRegistry({ clock });
    const tab = [];
    registry.registerTab({ userId: 'user-a', tabId: 't1', send: (frame) => tab.push(frame) });
    registry.registerAgent({ userId: 'user-a', agentId: 'ag', send() {} });
    const epoch = registry.presenceEpoch('user-a');
    registry.dropAgentPresence('user-a');
    assert.equal(registry.agentConnected('user-a'), false);
    assert.deepEqual(tab.at(-1), { type: 'agent', v: 1, connected: false, reason: 'revoked' });
    registry.unregisterAgent('user-a', 'ag');
    assert.equal(registry.noteAgentSeen('user-a', { clearHold: true, epoch }), false);
    assert.equal(registry.agentConnected('user-a'), false);
    assert.equal(registry.noteAgentSeen('user-a', { clearHold: true, epoch: registry.presenceEpoch('user-a') }), true);
    assert.equal(registry.agentConnected('user-a'), true);

    clock.advance(AGENT_PRESENCE_TTL_MS - 1);
    assert.equal(registry.noteAgentProgress('user-a'), true);
    const progress = tab.at(-1);
    assert.deepEqual(progress, { type: 'agent.progress', v: 1, working: true });
    assert.equal(Object.hasOwn(progress, 'text'), false);
    clock.advance(AGENT_PRESENCE_TTL_MS - 1);
    assert.equal(registry.agentConnected('user-a'), true);
    clock.advance(1);
    assert.equal(tab.at(-1).reason, 'inactive');
  });
});
