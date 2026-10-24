import assert from 'node:assert/strict';
import test from 'node:test';
import { insertPartCommand } from './document.js';

/**
 * insert_part { part_id, instance: true }: the host mints a part instance.
 * The arg needs a part_id; position is validated like create_part's.
 */

const ID = '2026-10-24-19-00-00-0004-r001';

test('instance:true needs part_id and a sane position', () => {
  assert.equal(insertPartCommand.checkArgs({ instance: true })?.code, 'bad_args');
  assert.equal(insertPartCommand.checkArgs({ instance: true, part_id: ID }), null);
  assert.equal(insertPartCommand.checkArgs({ instance: true, part_id: ID, position: [1, 2, 3] }), null);
  assert.equal(insertPartCommand.checkArgs({ instance: true, part_id: ID, position: [1, 2] })?.code, 'bad_args');
  assert.equal(insertPartCommand.checkArgs({ instance: true, part_id: 'parts/Roller.js' })?.code, 'unknown_part');
  assert.ok(insertPartCommand.schema.properties.instance);
  assert.ok(insertPartCommand.schema.properties.position);
});

test('instance:true reaches the host as agentInsertPart with the instance flag, not the vault insert', async () => {
  const calls = [];
  const ctx = {
    async agentInsertPart(args) {
      calls.push(args);
      return { result: { partId: 'i2', instanceOf: ID, added: ['i2'], partCount: 2 } };
    },
  };
  const out = await insertPartCommand.run(ctx, { part_id: ID, instance: true, position: [40, 0, 0] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { partId: ID, instance: true, position: [40, 0, 0] });
  assert.equal(out.result.instanceOf, ID);
  const plain = await insertPartCommand.run(ctx, { part_id: ID });
  assert.deepEqual(calls[1], { partId: ID, assemblyId: null, copy: false });
  assert.equal(plain.result.partId, 'i2');
});
