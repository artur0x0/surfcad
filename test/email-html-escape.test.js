/**
 * M3: outbound email HTML escapes interpolations and rejects a &lt;script&gt; name.
 * Run via root `node --test` (CI).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { escapeHtml, sanitizePersonName, PERSON_NAME_MAX } from '../backend/services/htmlSafe.js';
import { addressBlockHtml, verificationGreeting } from '../backend/services/email.js';
import { lineTableHtml } from '../backend/services/orderMail.js';

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
  });
});

describe('verification and address HTML', () => {
  test('a <script> name is omitted, not interpolated', () => {
    const greet = verificationGreeting('<script>alert(1)</script>');
    assert.equal(greet, '');
    assert.equal(`<p>Hi${greet},</p>`, '<p>Hi,</p>');
  });

  test('address block escapes a <script> name and other fields', () => {
    const html = addressBlockHtml({
      name: '<script>alert(1)</script>',
      street: '<img src=x onerror=alert(1)>',
      city: 'Austin & Dallas',
      state: 'TX',
      zip: '78701',
    });
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x/);
    assert.match(html, /Austin &amp; Dallas/);
  });

  test('line table escapes a script part name', () => {
    const html = lineTableHtml({
      lines: [{
        lineId: '1',
        partName: '<script>steal()</script>',
        process: 'print',
        material: 'PLA',
        infill: 20,
        quantity: 1,
        'unit-subtotal': 1.5,
      }],
    });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;steal\(\)&lt;\/script&gt;/);
  });
});
