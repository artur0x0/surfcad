import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import {
  hashUserId,
  redactUrlQueryAndHash,
  scrubFileAndPartNamesInText,
  scrubMonitoringValue,
  scrubSentryEvent,
} from './sentryPii.js';

describe('sentryPii', () => {
  test('redactUrlQueryAndHash strips query and hash', () => {
    assert.equal(
      redactUrlQueryAndHash('https://surfcad.com/app?token=secret#frag'),
      'https://surfcad.com/app',
    );
    assert.equal(redactUrlQueryAndHash('/api/foo?bar=1'), '/api/foo');
  });

  test('scrubFileAndPartNamesInText redacts cad extensions', () => {
    const out = scrubFileAndPartNamesInText('Opened bracket-v2.step and widget.stl');
    assert.match(out, /\[redacted-file\]/);
    assert.doesNotMatch(out, /\.step/);
  });

  test('scrubMonitoringValue redacts bodies and part name keys', () => {
    const value = scrubMonitoringValue({
      partName: 'secret-part',
      body: { script: 'makeBox()' },
      nested: { fileName: 'x.3mf', ok: true },
    });
    assert.equal(value.partName, '[redacted]');
    assert.equal(value.body, '[redacted]');
    assert.equal(value.nested.fileName, '[redacted]');
    assert.equal(value.nested.ok, true);
  });

  test('scrubSentryEvent strips auth headers and request body', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://api.example.com/v1?key=abc',
        headers: {
          authorization: 'Bearer x',
          cookie: 'sid=1',
          accept: 'application/json',
        },
        data: '{"email":"a@b.c"}',
      },
      user: { id: 'hashed-only', email: 'nope@example.com' },
    });
    assert.equal(event.request.url, 'https://api.example.com/v1');
    assert.equal(event.request.headers.authorization, undefined);
    assert.equal(event.request.headers.cookie, undefined);
    assert.equal(event.request.data, '[redacted]');
    assert.deepEqual(event.user, { id: 'hashed-only' });
  });

  test('hashUserId returns sha256 hex', async () => {
    const expected = createHash('sha256').update('user-42', 'utf8').digest('hex');
    assert.equal(await hashUserId('user-42'), expected);
  });
});
