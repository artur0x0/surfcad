import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { persistAfterAgentRevoke } from '../agent/credentialRevoke.js';

describe('persistAfterAgentRevoke', () => {
  test('revokes agent tokens before the new credentials are saved', async () => {
    const order = [];
    const user = {
      _id: 'user-1',
      async save() { order.push('save'); },
    };
    await persistAfterAgentRevoke(user, async (id) => {
      assert.equal(id, 'user-1');
      order.push('revoke');
    });
    assert.deepEqual(order, ['revoke', 'save']);
  });

  test('a failed revoke does not save the new credentials', async () => {
    let saved = false;
    const user = {
      _id: 'user-1',
      async save() { saved = true; },
    };
    await assert.rejects(
      () => persistAfterAgentRevoke(user, async () => {
        throw new Error('token store down');
      }),
      /token store down/,
    );
    assert.equal(saved, false);
  });
});
