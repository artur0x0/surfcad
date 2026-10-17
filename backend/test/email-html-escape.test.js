/**
 * M3 email helpers through email.js (Azure is a backend dep).
 * Run: cd backend && node --test test/email-html-escape.test.js
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addressBlockHtml, verificationGreeting } from '../services/email.js';
import { lineTableHtml } from '../services/orderMail.js';

describe('email.js re-exports', () => {
  test('greeting sanitizes; address only escapes', () => {
    assert.equal(verificationGreeting('<script>alert(1)</script>'), '');
    const html = addressBlockHtml({ name: 'Smith & Sons', street: 'c/o Jane', city: 'Austin', state: 'TX', zip: '1' });
    assert.match(html, /Smith &amp; Sons/);
    assert.match(html, /c\/o Jane/);
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
