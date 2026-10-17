import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('gitleaks allowlists CONSENT_STORAGE_KEY / surfcad.consent.v1', () => {
  const toml = readFileSync(new URL('../.gitleaks.toml', import.meta.url), 'utf8');
  assert.match(toml, /CONSENT_STORAGE_KEY/);
  assert.match(toml, /surfcad\.consent\.v1/);
  assert.match(toml, /src\/utils\/consent/);
  assert.match(toml, /presetConsentInit/);
  assert.match(toml, /\[allowlist\]/);
});
