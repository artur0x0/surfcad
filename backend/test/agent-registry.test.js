import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { commandResponse } from '../../packages/surfcad-mcp/src/commandProtocol.mjs';
import { createManualClock } from '../agent/clock.js';
import { RESULT_RETENTION_MS, TAB_ASLEEP_MS } from '../agent/limits.js';
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
});
