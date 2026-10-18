import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { openPrivacyChoices, onOpenPrivacyChoices } from './privacyChoicesUi.js';

describe('openPrivacyChoices', () => {
  test('notifies subscribers and unsubscribes', () => {
    const seen = [];
    const off = onOpenPrivacyChoices(() => seen.push('open'));
    openPrivacyChoices();
    off();
    openPrivacyChoices();
    assert.deepEqual(seen, ['open']);
  });
});
