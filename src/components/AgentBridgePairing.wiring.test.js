import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'AgentBridgePairing.jsx'), 'utf8');

test('Allow/Deny portals onto document.body so it cannot vanish with the menu', () => {
  assert.match(SRC, /approvalPopupPortalTarget/);
  assert.match(SRC, /createPortal\(/);
  assert.match(SRC, /<AgentBridgeApprovalPopup/);
  assert.match(SRC, /bodyTarget/);
  assert.match(SRC, /embedded=\{false\}/);
});

test('unmount cleanup disposes the socket and poller so the connection cannot leak', () => {
  assert.match(SRC, /disposePairingHost\(\{ conn: connRef\.current, poller: pollerRef\.current \}\)/);
  assert.match(SRC, /disposePairingHost\(\{ conn: connRef\.current \}\)/);
});
