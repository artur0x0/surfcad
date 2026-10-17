import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelayPoller } from './relayPoller.js';

test('relay poller starts and stops with flow active flag', async () => {
  let active = true;
  let probes = 0;
  let detected = 0;
  const poller = createRelayPoller({
    intervalMs: 20,
    isActive: () => active,
    probe: async () => {
      probes += 1;
      return false;
    },
    onDetected: () => { detected += 1; },
  });
  poller.start();
  assert.equal(poller.isRunning(), true);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(probes, 1);
  active = false;
  poller.stop();
  assert.equal(poller.isRunning(), false);
  const before = probes;
  await poller.tick();
  assert.equal(probes, before);
  assert.equal(detected, 0);
});

test('relay poller calls onDetected when probe succeeds', async () => {
  let active = true;
  let detected = 0;
  const poller = createRelayPoller({
    isActive: () => active,
    probe: async () => true,
    onDetected: () => { detected += 1; },
  });
  poller.start();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(detected, 1);
  poller.stop();
});
