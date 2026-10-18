import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('User.consent schema', () => {
  test('declares analytics default true and updatedAt', () => {
    const src = readFileSync(new URL('../backend/db/models/User.js', import.meta.url), 'utf8');
    assert.match(src, /consent:\s*\{/);
    assert.match(src, /analytics:\s*\{[^}]*default:\s*true/);
    assert.match(src, /updatedAt:\s*\{/);
  });

  test('auth route exposes PUT /consent', () => {
    const src = readFileSync(new URL('../backend/routes/auth.js', import.meta.url), 'utf8');
    assert.match(src, /router\.put\('\/consent'/);
    assert.match(src, /requireAuth/);
  });

  test('GET /me includes isInternal', () => {
    const src = readFileSync(new URL('../backend/routes/auth.js', import.meta.url), 'utf8');
    assert.match(src, /user\.isInternal\s*=/);
    assert.match(src, /isInternalUser/);
  });
});
