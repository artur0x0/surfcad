import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_EXEMPT } from './exempt.js';
import { fillAgentHost } from './host.js';
import { defineCommands } from './registry.js';
import { v1Registry } from './commands/index.js';
import { AGENT_COMMANDS } from '../utils/agentBridge.js';

test('v1 registry order is the bridge command list, with list_commands appended', () => {
  assert.deepEqual(v1Registry.names, AGENT_COMMANDS);
  assert.equal(Object.isFrozen(v1Registry.names), true);
  assert.deepEqual(AGENT_COMMANDS.slice(0, 7), [
    'get_script',
    'set_script',
    'run',
    'status',
    'errors',
    'screenshot',
    'undo',
  ]);
  assert.equal(AGENT_COMMANDS[7], 'list_commands');
  assert.equal(AGENT_COMMANDS.at(-1), 'camera');
});

test('every v1 command has a schema, an example, and run', () => {
  const catalog = v1Registry.catalog();
  assert.equal(catalog.length, v1Registry.names.length);
  for (const name of v1Registry.names) {
    const command = v1Registry.get(name);
    assert.equal(typeof command.run, 'function');
    assert.equal(command.schema.type, 'object');
    assert.equal(JSON.parse(JSON.stringify(command.example)).constructor, Object);
    const listed = catalog.find((row) => row.name === name);
    assert.deepEqual(listed.schema, JSON.parse(JSON.stringify(command.schema)));
    assert.deepEqual(listed.example, JSON.parse(JSON.stringify(command.example)));
    assert.equal('run' in listed, false);
  }
  assert.equal(v1Registry.get('run').uiEntry, 'data-cad-run');
  assert.equal(v1Registry.get('undo').uiEntry, undefined);
  assert.equal(v1Registry.get('get_script').immediate, true);
  assert.equal(v1Registry.get('list_commands').immediate, true);
  assert.equal(v1Registry.get('feature_tree').immediate, true);
  assert.equal(v1Registry.get('camera').immediate, true);
  assert.equal(v1Registry.get('set_script').immediate, false);
  assert.equal(v1Registry.get('undo').immediate, false);
});

test('a catalog caller cannot change the next catalog', () => {
  const first = v1Registry.catalog();
  first[0].name = 'renamed';
  first[0].schema.type = 'array';
  first[1].example.source = 'mutated';
  const second = v1Registry.catalog();
  assert.equal(second[0].name, 'get_script');
  assert.equal(second[0].schema.type, 'object');
  assert.notEqual(second[1].example.source, 'mutated');
});

test('the registry rejects a command that cannot be listed', () => {
  const ok = {
    name: 'ping',
    schema: { type: 'object', properties: {} },
    example: {},
    run() { return { result: { pong: true } }; },
  };
  assert.throws(() => defineCommands([]), /at least one command/);
  assert.throws(() => defineCommands([ok, ok]), /duplicate agent command: ping/);
  assert.throws(() => defineCommands([{ ...ok, name: 'Ping' }]), /snake_case/);
  assert.throws(() => defineCommands([{ ...ok, schema: { type: 'string' } }]), /schema must be a JSON object schema/);
  assert.throws(() => defineCommands([{ ...ok, example: [] }]), /example must be a JSON object/);
  assert.throws(() => defineCommands([{ ...ok, example: { n: Infinity } }]), /example is not JSON/);
  assert.throws(() => defineCommands([{ ...ok, run: null }]), /needs run/);
  assert.throws(() => defineCommands([{ ...ok, uiEntry: 'click me' }]), /uiEntry/);
  assert.throws(() => defineCommands([{ ...ok, uiEntry: 'data-cad-run=idle' }]), /uiEntry/);
  const helper = defineCommands([{ ...ok, uiEntry: 'fillet' }]);
  assert.equal(helper.get('ping').uiEntry, 'fillet');
  const selector = defineCommands([{ ...ok, uiEntry: 'data-joints-button' }]);
  assert.equal(selector.get('ping').uiEntry, 'data-joints-button');
});

test('quote, order, cart, and checkout stay exempt', () => {
  assert.deepEqual(AGENT_EXEMPT.map((row) => row.id), ['quote', 'order', 'cart', 'checkout']);
  assert.equal(Object.isFrozen(AGENT_EXEMPT), true);
  for (const row of AGENT_EXEMPT) {
    assert.equal(Object.isFrozen(row), true);
    assert.match(row.reason, /permanently exempt/);
    assert.equal(v1Registry.get(row.id), null);
  }
});

test('fillAgentHost merges and does not drop the other side', () => {
  const ref = { current: null };
  fillAgentHost(ref, { getScript: () => 'a', undo() {} });
  fillAgentHost(ref, { screenshot: () => 'png' });
  assert.equal(ref.current.getScript(), 'a');
  assert.equal(typeof ref.current.undo, 'function');
  assert.equal(ref.current.screenshot(), 'png');
  fillAgentHost(ref, { getScript: () => 'b' });
  assert.equal(ref.current.getScript(), 'b');
  assert.equal(ref.current.screenshot(), 'png');
  fillAgentHost(null, { screenshot() {} });
});