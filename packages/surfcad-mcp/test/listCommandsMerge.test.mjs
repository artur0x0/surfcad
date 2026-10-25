import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeRegisteredIntoListCommands, MCP_ONLY_GROUP } from '../src/listCommandsMerge.mjs';

const registered = [
  { name: 'pair', description: 'Pair', inputSchema: { type: 'object', properties: { code: { type: 'string' } } } },
  { name: 'reply_to_user', description: 'Reply', inputSchema: { type: 'object' } },
  { name: 'set_status', description: 'Status', inputSchema: { type: 'object' } },
  { name: 'status', description: 'Bridge status', inputSchema: { type: 'object' } },
];
const bridgeNames = new Set(['status', 'list_commands']);

function page(extra = {}) {
  return {
    commands: [{ name: 'status', schema: { type: 'object' }, example: {}, group: 'core' }],
    total: 2,
    groups: { core: 2 },
    ...extra,
  };
}

test('list_commands gains every registered tool that is not a bridge command', () => {
  const out = mergeRegisteredIntoListCommands(page(), { registered, bridgeNames, args: {} });
  assert.deepEqual(out.commands.map((row) => row.name), ['status', 'pair', 'reply_to_user', 'set_status']);
  assert.equal(out.total, 5);
  assert.equal(out.groups.agent, 3);
  assert.equal(out.groups.core, 2);
  assert.equal(out.commands[1].group, MCP_ONLY_GROUP);
  assert.equal(out.commands[1].schema.properties.code.type, 'string');
  assert.equal(out.commands.filter((row) => row.name === 'status').length, 1);
});

test('a names filter fills reply_to_user and drops it from missing', () => {
  const out = mergeRegisteredIntoListCommands(page({
    commands: [],
    missing: ['reply_to_user', 'nope'],
  }), { registered, bridgeNames, args: { names: ['reply_to_user', 'nope'] } });
  assert.deepEqual(out.commands.map((row) => row.name), ['reply_to_user']);
  assert.deepEqual(out.missing, ['nope']);
  assert.equal(out.total, 5);
});

test('a non-agent group does not include the MCP-only tools', () => {
  const out = mergeRegisteredIntoListCommands(page(), {
    registered,
    bridgeNames,
    args: { group: 'core' },
  });
  assert.deepEqual(out.commands.map((row) => row.name), ['status']);
  assert.equal(out.total, 5);
  assert.equal(out.groups.agent, 3);
});
