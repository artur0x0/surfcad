import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  PAIRING_TOKEN_ALPHABET,
  PAIRING_TOKEN_LENGTH,
  createPairingToken,
  pairingTokenFromBytes,
} from './pairingToken.js';

const LIMIT = 256 - (256 % PAIRING_TOKEN_ALPHABET.length);

describe('pairingTokenFromBytes', () => {
  test('skips bytes that would make the first symbols more likely', () => {
    const last = PAIRING_TOKEN_ALPHABET.length - 1;
    const biased = pairingTokenFromBytes([
      0,
      last,
      LIMIT - 1,
      LIMIT,
      255,
      1,
    ], 6);
    assert.equal(biased, [
      PAIRING_TOKEN_ALPHABET[0],
      PAIRING_TOKEN_ALPHABET[last],
      PAIRING_TOKEN_ALPHABET[(LIMIT - 1) % PAIRING_TOKEN_ALPHABET.length],
      PAIRING_TOKEN_ALPHABET[1],
    ].join(''));
    assert.equal((LIMIT - 1) % PAIRING_TOKEN_ALPHABET.length, last);
  });

  test('a buffer of only rejected bytes yields nothing', () => {
    assert.equal(pairingTokenFromBytes([LIMIT, 255, 240, 232], 4), '');
  });

  test('each symbol appears equally often across one unbiased byte range', () => {
    const counts = new Map(PAIRING_TOKEN_ALPHABET.split('').map((ch) => [ch, 0]));
    for (let start = 0; start < LIMIT; start += 12) {
      const slice = [];
      for (let i = start; i < Math.min(start + 12, LIMIT); i += 1) slice.push(i);
      for (const ch of pairingTokenFromBytes(slice, 12)) {
        counts.set(ch, counts.get(ch) + 1);
      }
    }
    for (const count of counts.values()) assert.equal(count, LIMIT / PAIRING_TOKEN_ALPHABET.length);
  });
});

describe('createPairingToken', () => {
  test('defaults to eight characters from the unambiguous alphabet', () => {
    const token = createPairingToken();
    assert.equal(token.length, PAIRING_TOKEN_LENGTH);
    assert.equal(PAIRING_TOKEN_LENGTH, 8);
    for (const ch of token) {
      assert.equal(PAIRING_TOKEN_ALPHABET.includes(ch), true);
    }
  });

  test('still accepts an explicit shorter length', () => {
    assert.equal(createPairingToken(6).length, 6);
  });

  test('two draws are not the same code', () => {
    const seen = new Set();
    for (let i = 0; i < 20; i += 1) seen.add(createPairingToken());
    assert.equal(seen.size, 20);
  });
});
