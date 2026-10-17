/**
 * Partner form Turnstile timeouts, errors, and submit state.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  PARTNER_FETCH_TIMEOUT_MS,
  PARTNER_SUBMIT_ERROR,
  TURNSTILE_VERIFY_ERROR,
  acquireTurnstileToken,
  buildTurnstileRenderConfig,
  postPartnerLead,
  promiseWithTimeout,
  readTurnstileToken,
  runPartnerFormSubmit,
  waitForTurnstileExecute,
} from '../src/utils/partnerTurnstileFlow.js';

describe('buildTurnstileRenderConfig', () => {
  test('uses flexible size and wires all callbacks', () => {
    const events = [];
    const cfg = buildTurnstileRenderConfig('site-key', {
      onToken: (t) => events.push(['token', t]),
      onError: () => events.push(['error']),
      onExpired: () => events.push(['expired']),
      onTimeout: () => events.push(['timeout']),
    });
    assert.equal(cfg.sitekey, 'site-key');
    assert.equal(cfg.size, 'flexible');
    assert.notEqual(cfg.size, 'invisible');
    cfg.callback('tok-1');
    cfg['error-callback']();
    cfg['expired-callback']();
    cfg['timeout-callback']();
    assert.deepEqual(events, [
      ['token', 'tok-1'],
      ['error'],
      ['expired'],
      ['timeout'],
    ]);
  });
});

describe('promiseWithTimeout', () => {
  test('rejects when the inner promise is slower than the limit', async () => {
    await assert.rejects(
      () => promiseWithTimeout(
        new Promise((resolve) => setTimeout(() => resolve('late'), 50)),
        5,
        'timed out',
      ),
      (err) => err.message === 'timed out',
    );
  });

  test('resolves when the inner promise finishes first', async () => {
    const value = await promiseWithTimeout(Promise.resolve('ok'), 100, 'timed out');
    assert.equal(value, 'ok');
  });
});

describe('readTurnstileToken', () => {
  test('returns getResponse when present', () => {
    const turnstile = { getResponse: () => 'ready-token' };
    assert.equal(readTurnstileToken(turnstile, 'w1'), 'ready-token');
  });

  test('returns null when getResponse is empty', () => {
    const turnstile = { getResponse: () => '' };
    assert.equal(readTurnstileToken(turnstile, 'w1'), null);
  });
});

describe('acquireTurnstileToken', () => {
  test('uses getResponse without calling execute', async () => {
    let executed = false;
    const turnstile = {
      getResponse: () => 'cached-token',
      execute() { executed = true; },
    };
    const token = await acquireTurnstileToken(turnstile, 'w1', { timeoutMs: 50 });
    assert.equal(token, 'cached-token');
    assert.equal(executed, false);
  });
});

describe('waitForTurnstileExecute', () => {
  test('resolves with the token from execute callback', async () => {
    const turnstile = {
      execute(_id, opts) {
        opts.callback('execute-token');
      },
    };
    const token = await waitForTurnstileExecute(turnstile, 'w1', { timeoutMs: 200 });
    assert.equal(token, 'execute-token');
  });

  test('rejects on error-callback', async () => {
    const turnstile = {
      execute(_id, opts) {
        opts['error-callback']();
      },
    };
    await assert.rejects(
      () => waitForTurnstileExecute(turnstile, 'w1', { timeoutMs: 200 }),
      (err) => err.message === TURNSTILE_VERIFY_ERROR,
    );
  });

  test('rejects when execute never calls back', async () => {
    const turnstile = { execute() {} };
    await assert.rejects(
      () => waitForTurnstileExecute(turnstile, 'w1', { timeoutMs: 15 }),
      (err) => err.message === TURNSTILE_VERIFY_ERROR,
    );
  });
});

describe('postPartnerLead', () => {
  test('aborts slow fetch and surfaces a submit error', async () => {
    const fetch = (_url, opts) => new Promise((resolve, reject) => {
      opts?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
    await assert.rejects(
      () => postPartnerLead({ name: 'a' }, {
        requestTurnstileToken: async () => 'tok',
        fetch,
        fetchTimeoutMs: 10,
      }),
      (err) => err.message === PARTNER_SUBMIT_ERROR,
    );
  });

  test('maps non-OK API bodies to an error message', async () => {
    const fetch = async () => ({
      ok: false,
      json: async () => ({ error: 'Rate limited' }),
    });
    await assert.rejects(
      () => postPartnerLead({ name: 'a' }, {
        requestTurnstileToken: async () => 'tok',
        fetch,
      }),
      (err) => err.message === 'Rate limited',
    );
  });
});

describe('runPartnerFormSubmit', () => {
  test('clears submitting after success', async () => {
    const flags = [];
    const result = await runPartnerFormSubmit({
      payload: { name: 'Pat' },
      requestTurnstileToken: async () => 'tok',
      postLead: async () => ({ ok: true }),
      setSubmitting: (v) => flags.push(v),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(flags, [true, false]);
  });

  test('clears submitting after Turnstile failure', async () => {
    const flags = [];
    const result = await runPartnerFormSubmit({
      payload: { name: 'Pat' },
      requestTurnstileToken: async () => {
        throw new Error(TURNSTILE_VERIFY_ERROR);
      },
      setSubmitting: (v) => flags.push(v),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, TURNSTILE_VERIFY_ERROR);
    assert.deepEqual(flags, [true, false]);
  });

  test('clears submitting after backend failure', async () => {
    const flags = [];
    const result = await runPartnerFormSubmit({
      payload: { name: 'Pat' },
      requestTurnstileToken: async () => 'tok',
      postLead: async () => {
        throw new Error('Server error');
      },
      setSubmitting: (v) => flags.push(v),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Server error');
    assert.deepEqual(flags, [true, false]);
  });
});

test('default fetch timeout constant is about 20 seconds', () => {
  assert.equal(PARTNER_FETCH_TIMEOUT_MS, 20_000);
});
