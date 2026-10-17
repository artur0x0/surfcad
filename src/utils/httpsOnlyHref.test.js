import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { httpsOnlyHref } from './httpsOnlyHref.js';

test('httpsOnlyHref allows https and rejects javascript/http/data', () => {
  assert.equal(
    httpsOnlyHref('https://tools.usps.com/go/TrackConfirmAction?t=1'),
    'https://tools.usps.com/go/TrackConfirmAction?t=1',
  );
  assert.equal(httpsOnlyHref('javascript:alert(1)'), '');
  assert.equal(httpsOnlyHref('http://evil.test/track'), '');
  assert.equal(httpsOnlyHref('data:text/html,x'), '');
  assert.equal(httpsOnlyHref('https://evil.test'), 'https://evil.test/');
  assert.equal(httpsOnlyHref(''), '');
  assert.equal(httpsOnlyHref(null), '');
});

test('AccountModal only links https tracking urls', () => {
  const src = readFileSync(new URL('../components/AccountModal.jsx', import.meta.url), 'utf8');
  assert.match(src, /httpsOnlyHref/);
  assert.equal(/href=\{order\.shipping\['tracking-url'\]\}/.test(src), false);
});
