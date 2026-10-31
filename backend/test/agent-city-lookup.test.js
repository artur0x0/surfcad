import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cityLabel, createCityLookup, isPublicIp } from '../agent/cityLookup.js';

describe('city lookup', () => {
  test('private and loopback addresses are not looked up', async () => {
    assert.equal(isPublicIp('127.0.0.1'), false);
    assert.equal(isPublicIp('10.1.2.3'), false);
    assert.equal(isPublicIp('192.168.1.9'), false);
    assert.equal(isPublicIp('::1'), false);
    let calls = 0;
    const lookup = createCityLookup({
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, json: async () => ({ city: 'Lisbon' }) };
      },
    });
    assert.equal(await lookup('127.0.0.1'), null);
    assert.equal(calls, 0);
  });

  test('a city with a comma is flattened and a miss stays empty', async () => {
    const lookup = createCityLookup({
      fetchImpl: async (url) => {
        assert.match(String(url), /203\.0\.113\.5/);
        return { ok: true, json: async () => ({ city: 'Lisbon, Portugal' }) };
      },
    });
    assert.equal(await lookup('203.0.113.5'), 'Lisbon Portugal');
    assert.equal(cityLabel('  Berlin,  Mitte '), 'Berlin Mitte');
    const miss = createCityLookup({
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    });
    assert.equal(await miss('203.0.113.9'), null);
  });

  test('a thrown lookup does not throw', async () => {
    const lookup = createCityLookup({
      fetchImpl: async () => { throw new Error('down'); },
    });
    assert.equal(await lookup('203.0.113.7'), null);
  });
});
