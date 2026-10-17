import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  redactUrlQueryAndHash,
  scrubFileAndPartNamesInText,
  scrubSentryEvent,
} from '../backend/monitoring/sentryScrub.js';

describe('backend sentryScrub', () => {
  test('matches frontend scrub behaviour for urls and filenames', () => {
    assert.equal(redactUrlQueryAndHash('/x?y=1'), '/x');
    assert.match(scrubFileAndPartNamesInText('part.obj'), /\[redacted-file\]/);
  });

  test('scrubSentryEvent removes cookies from request', () => {
    const event = scrubSentryEvent({
      request: {
        url: '/api/auth/me?foo=1',
        headers: { cookie: 'a=b' },
        data: 'raw',
      },
    });
    assert.equal(event.request.url, '/api/auth/me');
    assert.equal(event.request.headers.cookie, undefined);
    assert.equal(event.request.data, '[redacted]');
  });
});
