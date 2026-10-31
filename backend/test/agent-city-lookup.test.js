import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cityLabel, cityLookupEnabled, createCityLookup, isPublicIp } from '../agent/cityLookup.js';

describe('city lookup', () => {
  test('AGENT_CITY_LOOKUP defaults off', () => {
    assert.equal(cityLookupEnabled({}), false);
    assert.equal(cityLookupEnabled({ AGENT_CITY_LOOKUP: '' }), false);
    assert.equal(cityLookupEnabled({ AGENT_CITY_LOOKUP: '0' }), false);
    assert.equal(cityLookupEnabled({ AGENT_CITY_LOOKUP: 'false' }), false);
    assert.equal(cityLookupEnabled({ AGENT_CITY_LOOKUP: '1' }), true);
    assert.equal(cityLookupEnabled({ AGENT_CITY_LOOKUP: 'TRUE' }), true);
    assert.equal(cityLookupEnabled({ AGENT_CITY_LOOKUP: 'on' }), true);
  });

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

  test('the cache is capped and a lookup aborts on timeout', async () => {
    const seen = [];
    const lookup = createCityLookup({
      maxEntries: 2,
      fetchImpl: async (url) => {
        seen.push(String(url));
        return { ok: true, json: async () => ({ city: 'Berlin' }) };
      },
    });
    assert.equal(await lookup('203.0.113.1'), 'Berlin');
    assert.equal(await lookup('203.0.113.2'), 'Berlin');
    assert.equal(await lookup('203.0.113.3'), 'Berlin');
    assert.equal(seen.length, 3);
    assert.equal(await lookup('203.0.113.2'), 'Berlin');
    assert.equal(seen.length, 3);
    assert.equal(await lookup('203.0.113.1'), 'Berlin');
    assert.equal(seen.length, 4);

    const slow = createCityLookup({
      timeoutMs: 20,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    });
    // The lookup timer is unref'd so it cannot be the only thing keeping
    // the process alive. Hold the loop until the abort fires.
    const keep = setInterval(() => {}, 1000);
    try {
      assert.equal(await slow('203.0.113.8'), null);
    } finally {
      clearInterval(keep);
    }
  });

  test('a thrown lookup does not throw', async () => {
    const lookup = createCityLookup({
      fetchImpl: async () => { throw new Error('down'); },
    });
    assert.equal(await lookup('203.0.113.7'), null);
  });
});
