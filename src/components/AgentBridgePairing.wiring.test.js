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

test('the body-portal Allow/Deny is bottom-right, not stacked on profile menu rows', () => {
  const popup = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'AgentBridgeApprovalPopup.jsx'),
    'utf8',
  );
  assert.match(popup, /fixed bottom-20 right-3 z-\[130\]/);
  assert.match(popup, /data-agent-bridge-approval-portal=\{embedded \? undefined : ''\}/);
});

test('Allow/Deny copy uses chrome text tokens, not black on dark surface', () => {
  const popup = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'AgentBridgeApprovalPopup.jsx'),
    'utf8',
  );
  assert.match(popup, /text-chrome-text/);
  assert.match(popup, /text-chrome-secondary/);
  assert.doesNotMatch(popup, /text-chrome-text-secondary/);
  assert.doesNotMatch(popup, /text-black|text-gray-900|text-gray-950|#000\b/);
  assert.doesNotMatch(SRC, /text-chrome-text-secondary/);
});

test('unmount cleanup disposes the socket and poller so the connection cannot leak', () => {
  assert.match(SRC, /disposePairingHost\(\{ conn: connRef\.current, poller: pollerRef\.current \}\)/);
  assert.match(SRC, /disposePairingHost\(\{ conn: connRef\.current \}\)/);
});

