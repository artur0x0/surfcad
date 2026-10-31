import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { cityFromRequest } from '../agent/approvalCopy.js';
import { createManualClock } from '../agent/clock.js';
import {
  MAX_WRONG_TRIES,
  PAIR_ENTRY_WINDOW_MS,
  PAIR_RETENTION_MS,
  PAIR_TTL_MS,
} from '../agent/limits.js';
import {
  createPairingService,
  formatUserCode,
  hashDeviceSecret,
  USER_CODE_ALPHABET,
} from '../agent/pairing.js';
import { createMemoryTokenStore, createTokenService, hashToken } from '../agent/tokens.js';

function setup(overrides = {}) {
  const clock = overrides.clock || createManualClock(1_700_000_000_000);
  const store = overrides.store || createMemoryTokenStore();
  const tokens = createTokenService({
    store,
    now: () => clock.now(),
    ttlMs: overrides.tokenTtlMs,
  });
  const pairing = createPairingService({
    entryLimit: 100,
    startLimit: 100,
    pollLimit: 100,
    ...overrides.pairing,
    tokens,
    now: () => clock.now(),
  });
  const start = pairing.start.bind(pairing);
  pairing.start = (fields = {}) => {
    const bytes = randomBytes(32);
    const deviceSecret = bytes.toString('base64url');
    const started = start({
      ...fields,
      deviceSecretHash: fields.deviceSecretHash
        || createHash('sha256').update(bytes).digest('hex'),
    });
    if (!started.ok) return started;
    return { ...started, deviceSecret };
  };
  return { clock, store, tokens, pairing };
}

describe('device-code pairing', () => {
  test('user code alphabet has no look-alikes and is shown as ABCD-EFGH', () => {
    for (const ch of '0O1IL') assert.equal(USER_CODE_ALPHABET.includes(ch), false);
    assert.equal(formatUserCode('ABCDEFGH'), 'ABCD-EFGH');
    const { pairing } = setup();
    const started = pairing.start({ name: 'Cursor', machine: 'laptop', ip: '203.0.113.5' });
    assert.equal(started.ok, true);
    assert.match(started.userCode, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    assert.equal(Buffer.from(started.deviceSecret, 'base64url').length, 32);
    const saved = pairing.snapshot()[0];
    assert.equal(saved.deviceSecretHash, hashDeviceSecret(started.deviceSecret));
    assert.equal(Object.prototype.hasOwnProperty.call(started, 'deviceSecret'), true);
    assert.equal(JSON.stringify(pairing.snapshot()).includes(started.deviceSecret), false);
    assert.equal(pairing.plaintextHeld().includes(started.deviceSecret), false);
  });

  test('city is optional and the sentence uses "in", never a comma', async () => {
    assert.equal(cityFromRequest({ ip: '203.0.113.5', headers: {} }), null);
    const { pairing, tokens } = setup();
    const withCity = pairing.start({
      name: 'Cursor',
      machine: 'laptop',
      city: 'Berlin',
      ip: '203.0.113.8',
    });
    const shown = pairing.claim({ userCode: withCity.userCode, userId: 'user-a', ip: '198.51.100.8' });
    assert.equal(shown.sentence, 'Allow Cursor on laptop in Berlin to connect?');
    assert.equal(shown.sentence.includes(','), false);
    await pairing.approve({ userCode: withCity.userCode, userId: 'user-a', ip: '198.51.100.8' });
    const listed = await tokens.list('user-a');
    assert.equal(listed[0].machine, 'laptop');
    assert.equal(listed[0].city, 'Berlin');
    assert.equal(listed[0].label, 'Cursor on laptop');

    const bare = pairing.start({ name: 'Cursor', machine: 'laptop', ip: '203.0.113.9' });
    const noCity = pairing.claim({ userCode: bare.userCode, userId: 'user-b', ip: '198.51.100.9' });
    assert.equal(noCity.sentence, 'Allow Cursor on laptop to connect?');
    assert.equal(noCity.sentence.includes(' in '), false);

    const comma = pairing.start({
      name: 'Cursor',
      machine: 'laptop',
      city: 'Berlin, Mitte',
      ip: '203.0.113.10',
    });
    const cleaned = pairing.claim({ userCode: comma.userCode, userId: 'user-c', ip: '198.51.100.10' });
    assert.equal(cleaned.sentence, 'Allow Cursor on laptop in Berlin Mitte to connect?');
    assert.equal(cleaned.sentence.includes(','), false);
  });

  test('a code expires after 10 minutes', async () => {
    const { clock, pairing } = setup();
    const started = pairing.start({ name: 'Cursor', machine: 'laptop', ip: '203.0.113.5' });
    clock.advance(PAIR_TTL_MS - 1);
    assert.equal(pairing.claim({
      userCode: started.userCode,
      userId: 'user-a',
      ip: '198.51.100.5',
    }).ok, true);
    assert.equal(pairing.poll({ deviceSecret: started.deviceSecret, ip: '203.0.113.5' }).status, 'pending');
    clock.advance(1);
    assert.equal(pairing.claim({
      userCode: started.userCode,
      userId: 'user-a',
      ip: '198.51.100.6',
    }).error, 'expired');
    assert.equal(pairing.poll({ deviceSecret: started.deviceSecret, ip: '203.0.113.5' }).status, 'expired');
    const approved = await pairing.approve({
      userCode: started.userCode,
      userId: 'user-a',
      ip: '198.51.100.7',
    });
    assert.equal(approved.error, 'expired');
    assert.equal(approved.token, undefined);
  });

  test('a code is single use and the token is handed to the agent once', async () => {
    const { pairing, store } = setup();
    const started = pairing.start({ name: 'Cursor', machine: 'laptop', ip: '203.0.113.5' });
    const before = pairing.poll({ deviceSecret: started.deviceSecret, ip: '203.0.113.5' });
    assert.equal(before.status, 'pending');
    assert.equal(before.token, undefined);

    const approved = await pairing.approve({
      userCode: started.userCode,
      userId: 'user-a',
      ip: '198.51.100.5',
    });
    assert.equal(approved.ok, true);
    assert.equal(approved.token, undefined);
    assert.equal(pairing.plaintextHeld().length, 1);

    const again = await pairing.approve({
      userCode: started.userCode,
      userId: 'user-a',
      ip: '198.51.100.5',
    });
    assert.equal(again.error, 'already_used');

    const first = pairing.poll({ deviceSecret: started.deviceSecret, ip: '203.0.113.5' });
    assert.equal(first.status, 'approved');
    assert.equal(typeof first.token, 'string');
    assert.equal(pairing.plaintextHeld().length, 0);
    assert.equal(JSON.stringify(pairing.snapshot()).includes(first.token), false);
    assert.equal(JSON.stringify(store.dump()).includes(first.token), false);
    assert.equal(store.dump()[0].tokenHash, hashToken(first.token));

    const second = pairing.poll({ deviceSecret: started.deviceSecret, ip: '203.0.113.5' });
    assert.equal(second.status, 'consumed');
    assert.equal(second.token, undefined);
  });

  test('five wrong user codes lock the account and the IP', () => {
    assert.equal(MAX_WRONG_TRIES, 5);
    const { pairing } = setup();
    const started = pairing.start({ name: 'Cursor', machine: 'laptop', ip: '203.0.113.5' });
    for (let i = 0; i < 4; i += 1) {
      const missed = pairing.claim({ userCode: 'ZZZZ-ZZZZ', userId: 'acct-a', ip: '203.0.113.20' });
      assert.equal(missed.error, 'invalid_code');
    }
    assert.equal(pairing.claim({
      userCode: 'ZZZZ-ZZZZ',
      userId: 'acct-a',
      ip: '203.0.113.20',
    }).error, 'too_many_wrong_tries');
    assert.equal(pairing.claim({
      userCode: started.userCode,
      userId: 'acct-a',
      ip: '198.51.100.40',
    }).error, 'too_many_wrong_tries');
    assert.equal(pairing.claim({
      userCode: started.userCode,
      userId: 'acct-b',
      ip: '203.0.113.20',
    }).error, 'too_many_wrong_tries');
    const fresh = pairing.claim({
      userCode: started.userCode,
      userId: 'acct-b',
      ip: '198.51.100.40',
    });
    assert.equal(fresh.ok, true);
    assert.equal(fresh.sentence, 'Allow Cursor on laptop to connect?');
  });

  test('wrong-try lockout lifts after the entry window', () => {
    const { clock, pairing } = setup();
    const started = pairing.start({ name: 'Cursor', machine: 'laptop', ip: '203.0.113.5' });
    for (let i = 0; i < 5; i += 1) {
      pairing.claim({ userCode: 'ZZZZ-ZZZZ', userId: 'acct-a', ip: '203.0.113.20' });
    }
    assert.equal(pairing.claim({
      userCode: started.userCode,
      userId: 'acct-a',
      ip: '203.0.113.20',
    }).error, 'too_many_wrong_tries');
    clock.advance(PAIR_ENTRY_WINDOW_MS);
    const renewed = pairing.start({ name: 'Cursor', machine: 'laptop', ip: '203.0.113.5' });
    assert.equal(pairing.claim({
      userCode: renewed.userCode,
      userId: 'acct-a',
      ip: '203.0.113.20',
    }).ok, true);
  });

  test('five wrong device secrets kill that pairing', () => {
    const { pairing } = setup();
    const started = pairing.start({ name: 'Cursor', machine: 'laptop', ip: '203.0.113.5' });
    for (let i = 0; i < 4; i += 1) {
      const missed = pairing.poll({
        deviceSecret: `wrong-secret-${i}`,
        userCode: started.userCode,
        ip: '198.51.100.8',
      });
      assert.equal(missed.error, 'unknown_device');
    }
    const killed = pairing.poll({
      deviceSecret: 'wrong-secret-last',
      userCode: started.userCode,
      ip: '198.51.100.8',
    });
    assert.equal(killed.status, 'dead');
    const after = pairing.poll({ deviceSecret: started.deviceSecret, ip: '198.51.100.8' });
    assert.equal(after.status, 'dead');
    assert.equal(after.token, undefined);
  });

  test('code entry is rate limited per account and per IP', () => {
    const { pairing } = setup({ pairing: { entryLimit: 2 } });
    const started = pairing.start({ name: 'Cursor', machine: 'laptop', ip: '203.0.113.5' });
    const claim = (userId, ip) => pairing.claim({ userCode: started.userCode, userId, ip });
    assert.equal(claim('acct-a', '203.0.113.1').ok, true);
    assert.equal(claim('acct-a', '203.0.113.1').ok, true);
    assert.equal(claim('acct-a', '203.0.113.1').error, 'rate_limited');
    assert.equal(claim('acct-a', '203.0.113.2').error, 'rate_limited');
    assert.equal(claim('acct-b', '203.0.113.1').error, 'rate_limited');
    const other = pairing.start({ name: 'Other', machine: 'phone', ip: '203.0.113.50' });
    assert.equal(pairing.claim({
      userCode: other.userCode,
      userId: 'acct-b',
      ip: '203.0.113.2',
    }).ok, true);
  });

  test('the first signed-in account owns the device code', async () => {
    const { pairing } = setup();
    const started = pairing.start({ name: 'Cursor', machine: 'laptop', ip: '203.0.113.5' });
    const opened = pairing.claim({
      userCode: started.userCode,
      userId: 'user-a',
      ip: '198.51.100.1',
    });
    assert.equal(opened.ok, true);
    assert.equal(pairing.claim({
      userCode: started.userCode,
      userId: 'user-b',
      ip: '198.51.100.2',
    }).error, 'claimed');
    const raced = await pairing.approve({
      userCode: started.userCode,
      userId: 'user-b',
      ip: '198.51.100.2',
    });
    assert.equal(raced.ok, false);
    assert.equal(raced.error, 'claimed');
    assert.equal(pairing.deny({
      userCode: started.userCode,
      userId: 'user-b',
      ip: '198.51.100.3',
    }).error, 'claimed');
    assert.equal(pairing.poll({
      deviceSecret: started.deviceSecret,
      ip: '203.0.113.5',
    }).status, 'pending');
    const approved = await pairing.approve({
      userCode: started.userCode,
      userId: 'user-a',
      ip: '198.51.100.1',
    });
    assert.equal(approved.ok, true);
    assert.equal(pairing.poll({
      deviceSecret: started.deviceSecret,
      ip: '203.0.113.6',
    }).status, 'approved');
  });

  test('starting a pairing is rate limited per IP', () => {
    const { pairing } = setup({ pairing: { startLimit: 2 } });
    assert.equal(pairing.start({ name: 'A', machine: 'a', ip: '203.0.113.1' }).ok, true);
    assert.equal(pairing.start({ name: 'B', machine: 'b', ip: '203.0.113.1' }).ok, true);
    assert.equal(pairing.start({ name: 'C', machine: 'c', ip: '203.0.113.1' }).error, 'rate_limited');
    assert.equal(pairing.start({ name: 'D', machine: 'd', ip: '203.0.113.2' }).ok, true);
  });

  test('the server stores the client hash and does not return the secret', () => {
    const clock = createManualClock(1_700_000_000_000);
    const tokens = createTokenService({ store: createMemoryTokenStore(), now: () => clock.now() });
    const pairing = createPairingService({
      tokens,
      now: () => clock.now(),
      startLimit: 100,
    });
    const missing = pairing.start({ name: 'Cursor', machine: 'laptop', ip: '203.0.113.5' });
    assert.equal(missing.error, 'bad_device_secret');
    const bytes = randomBytes(32);
    const deviceSecret = bytes.toString('base64url');
    const deviceSecretHash = createHash('sha256').update(bytes).digest('hex');
    const started = pairing.start({
      name: 'Cursor',
      machine: 'laptop',
      ip: '203.0.113.5',
      deviceSecretHash,
    });
    assert.equal(started.ok, true);
    assert.equal(started.deviceSecret, undefined);
    assert.equal(JSON.stringify(started).includes(deviceSecret), false);
    assert.equal(pairing.snapshot()[0].deviceSecretHash, deviceSecretHash);
    assert.equal(pairing.poll({ deviceSecret, ip: '203.0.113.5' }).status, 'pending');
    assert.equal(pairing.poll({
      deviceSecret: randomBytes(32).toString('base64url'),
      userCode: started.userCode,
      ip: '203.0.113.5',
    }).error, 'unknown_device');
  });

  test('pending pairings are capped and terminal records are swept', () => {
    const { clock, pairing } = setup({ pairing: { maxPendingPairings: 2, retentionMs: PAIR_RETENTION_MS } });
    const first = pairing.start({ name: 'A', machine: 'a', ip: '203.0.113.20' });
    assert.equal(pairing.start({ name: 'B', machine: 'b', ip: '203.0.113.21' }).ok, true);
    assert.equal(pairing.start({ name: 'C', machine: 'c', ip: '203.0.113.22' }).error, 'unavailable');
    clock.advance(PAIR_TTL_MS + PAIR_RETENTION_MS);
    assert.equal(pairing.poll({ deviceSecret: first.deviceSecret, ip: '203.0.113.20' }).error, 'unknown_device');
    assert.equal(pairing.snapshot().length, 0);
    assert.equal(pairing.start({ name: 'D', machine: 'd', ip: '203.0.113.23' }).ok, true);
  });
});
