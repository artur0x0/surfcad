/**
 * M3: escape + greeting sanitize. This file imports only htmlSafe.js
 * (no Azure / dotenv) so root CI can run it.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  PERSON_NAME_MAX,
  addressBlockHtml,
  escapeHtml,
  sanitizePersonName,
  verificationGreeting,
} from '../backend/services/htmlSafe.js';

describe('escapeHtml / sanitizePersonName', () => {
  test('escapes a <script> payload', () => {
    const out = escapeHtml('<script>alert(1)</script>');
    assert.equal(out.includes('<script>'), false);
    assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  test('rejects a script name on length and charset', () => {
    assert.equal(sanitizePersonName('<script>alert(1)</script>'), '');
    assert.equal(sanitizePersonName('x'.repeat(PERSON_NAME_MAX + 1)), '');
    assert.equal(sanitizePersonName('Jean-Luc Picard'), 'Jean-Luc Picard');
    assert.equal(sanitizePersonName("O'Brien"), "O'Brien");
    assert.equal(sanitizePersonName('Smith & Sons'), '');
    assert.equal(sanitizePersonName('c/o Jane'), '');
  });
});

describe('verification greeting vs address names', () => {
  test('a <script> greeting name is omitted, not interpolated', () => {
    const greet = verificationGreeting('<script>alert(1)</script>');
    assert.equal(greet, '');
    assert.equal(`<p>Hi${greet},</p>`, '<p>Hi,</p>');
  });

  test('address names keep Smith & Sons and c/o; only escape', () => {
    const html = addressBlockHtml({
      name: 'Smith & Sons',
      street: 'c/o Jane <office>',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
    });
    assert.match(html, /Smith &amp; Sons/);
    assert.match(html, /c\/o Jane &lt;office&gt;/);
    assert.doesNotMatch(html, /<office>/);
  });

  test('address block escapes a <script> name without dropping the text', () => {
    const html = addressBlockHtml({
      name: '<script>alert(1)</script>',
      street: '<img src=x onerror=alert(1)>',
      city: 'Austin & Dallas',
      state: 'TX',
      zip: '78701',
    });
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x/);
    assert.match(html, /Austin &amp; Dallas/);
  });
});
