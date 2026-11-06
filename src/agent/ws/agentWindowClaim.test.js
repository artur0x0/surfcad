import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_WINDOW_CLAIM_KEY,
  TAB_CLAIM,
  TAB_CLAIMED,
  claimFrameOnRegister,
  createAgentWindowClaimStore,
} from './agentWindowClaim.js';
import { TAB_CLAIM as SERVER_TAB_CLAIM, TAB_CLAIMED as SERVER_TAB_CLAIMED, TAB_CLAIM_MAX } from '../../../backend/agent/tabPrompt.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    map,
  };
}

test('the claim id lives in this tab only and round-trips', () => {
  const storage = fakeStorage();
  const store = createAgentWindowClaimStore(storage);
  assert.equal(store.read(), null);
  store.write('2f0c5b8e-4a55-4f0a-9c1c-0d5f5b1f2a11');
  assert.equal(storage.map.get(AGENT_WINDOW_CLAIM_KEY), '2f0c5b8e-4a55-4f0a-9c1c-0d5f5b1f2a11');
  assert.equal(store.read(), '2f0c5b8e-4a55-4f0a-9c1c-0d5f5b1f2a11');
  store.clear();
  assert.equal(store.read(), null);
  // Not a claim id: ignored on write and on read.
  store.write('');
  store.write('x'.repeat(TAB_CLAIM_MAX + 1));
  assert.equal(store.read(), null);
  storage.setItem(AGENT_WINDOW_CLAIM_KEY, 'y'.repeat(TAB_CLAIM_MAX + 1));
  assert.equal(store.read(), null);
});

test('a missing or throwing storage is a no-op, not a crash', () => {
  const none = createAgentWindowClaimStore(null);
  none.write('abc');
  assert.equal(none.read(), null);
  none.clear();
  const broken = createAgentWindowClaimStore({
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  });
  broken.write('abc');
  assert.equal(broken.read(), null);
  broken.clear();
  // Node has no window: the default store is the no-op.
  assert.equal(createAgentWindowClaimStore().read(), null);
});

test('on registration: a fresh claim wins, else the stored one resumes, else nothing', () => {
  assert.deepEqual(claimFrameOnRegister({ wanted: true, stored: 'old' }), { type: 'tab.claim', v: 1 });
  assert.deepEqual(claimFrameOnRegister({ wanted: false, stored: 'old' }), { type: 'tab.claim', v: 1, claim: 'old' });
  assert.equal(claimFrameOnRegister({ wanted: false, stored: null }), null);
});

test('the tab and the server agree on the frame names, and the claim is per tab (sessionStorage)', () => {
  assert.equal(TAB_CLAIM, SERVER_TAB_CLAIM);
  assert.equal(TAB_CLAIMED, SERVER_TAB_CLAIMED);
  const src = readFileSync(join(root, 'src/agent/ws/agentWindowClaim.js'), 'utf8');
  assert.match(src, /window\.sessionStorage/);
  assert.doesNotMatch(src, /localStorage/);
  // Connect agent claims; Disconnect releases; a socket made after the click still claims.
  const pairing = readFileSync(join(root, 'src/components/AgentBridgePairing.jsx'), 'utf8');
  assert.match(pairing, /claimWindowRef\.current = true;\s*if \(serverModeRef\.current\) connRef\.current\?\.claim\?\.\(\);/);
  assert.match(pairing, /if \(claimWindowRef\.current\) conn\.claim\(\);/);
  assert.match(pairing, /claimWindowRef\.current = false;\s*connRef\.current\?\.release\?\.\(\);/);
});

test('the Disconnect menu handler revokes the agent before it releases and closes; no other path does', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../components/AgentBridgePairing.jsx', import.meta.url), 'utf8');
  const start = src.indexOf('const disconnectFromUser = useCallback(');
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf('}, [disconnectPairing]);', start));
  const revoke = body.indexOf('connRef.current?.revokeAgent?.()');
  const release = body.indexOf('connRef.current?.release?.()');
  const close = body.indexOf('disconnectPairing()');
  assert.ok(revoke > 0 && release > revoke && close > release, 'revoke, then release, then close');
  // Only the user's Disconnect revokes: reconnects, errors and unmounts do not.
  assert.equal(src.split('revokeAgent').length - 1, 1);
});
