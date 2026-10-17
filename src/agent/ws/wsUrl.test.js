import test from 'node:test';
import assert from 'node:assert/strict';
import { agentBridgeTransportOverrideAllowed } from './wsUrl.js';

test('transport override is only for dev and playtest builds', () => {
  assert.equal(agentBridgeTransportOverrideAllowed({}), false);
  assert.equal(agentBridgeTransportOverrideAllowed({ DEV: false }), false);
  assert.equal(agentBridgeTransportOverrideAllowed({ DEV: true }), true);
  assert.equal(agentBridgeTransportOverrideAllowed({ VITE_SURFCAD_PLAYTEST: '1' }), true);
  assert.equal(agentBridgeTransportOverrideAllowed({ VITE_SURFCAD_PLAYTEST: '0' }), false);
});
