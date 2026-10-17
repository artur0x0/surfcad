import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(dir, 'AgentBridgePairing.jsx'), 'utf8');
const DIALOG = readFileSync(join(dir, 'AgentBridgePairingDialog.jsx'), 'utf8');
const POPUP = readFileSync(join(dir, 'AgentBridgeApprovalPopup.jsx'), 'utf8');
const CSS = readFileSync(join(dir, '../index.css'), 'utf8');
const CHIP = readFileSync(join(dir, 'ProfileChip.jsx'), 'utf8');
const TAB = readFileSync(join(dir, '../agent/ws/tabConnection.js'), 'utf8');

test('Connect Agent opens a body-portal dialog and closes the profile menu', () => {
  assert.match(SRC, /onBeginFlow\?\.\(\)/);
  assert.match(SRC, /<AgentBridgePairingDialog/);
  assert.match(DIALOG, /data-agent-bridge-dialog=""/);
  assert.match(DIALOG, /data-agent-bridge-transport=\{transport\}/);
  assert.match(DIALOG, /createPortal\(/);
  assert.match(DIALOG, /pb-14/);
  assert.match(DIALOG, /items-center justify-center/);
  assert.doesNotMatch(DIALOG, /items-end/);
});

test('popup mode starts pairing from the Connect Agent click', () => {
  assert.match(SRC, /onBeginFlow\?\.\(\)/);
  assert.match(SRC, /if \(popupMode\) startPairing\('popup'\)/);
  assert.match(SRC, /<AgentBridgePopupStatus/);
  assert.match(SRC, /issue !== 'bridge_closed' && issue !== 'popup_blocked'/);
  assert.match(SRC, /setFlowOpen\(true\)/);
  assert.match(SRC, /Keep the SurfCAD local agent bridge window open/);
});

test('Esc and backdrop tap before pairing cancel the attempt', () => {
  assert.match(SRC, /event\.key === 'Escape'/);
  assert.match(SRC, /handleDialogDismiss/);
  assert.match(DIALOG, /event\.target === event\.currentTarget/);
});

test('the setup prompt is hidden once a relay is up', () => {
  assert.match(SRC, /shouldShowPairingPrompt\(stage\)/);
  assert.match(SRC, /showPrompt \?/);
  assert.doesNotMatch(SRC, /Relay connected/);
});

test('Allow/Deny replaces the pairing code in the same dialog', () => {
  assert.match(SRC, /shouldShowPairingCode\(stage\)/);
  assert.match(SRC, /shouldShowPairingApproval\(stage\)/);
  assert.match(SRC, /<AgentBridgeApprovalPopup/);
  assert.doesNotMatch(SRC, /embedded=\{false\}/);
  assert.doesNotMatch(POPUP, /fixed bottom-/);
  assert.doesNotMatch(POPUP, /approvalPopupPositionClass/);
});

test('Allow/Deny copy uses shared surface/text classes, not black on dark surface', () => {
  assert.match(POPUP, /text-ui-xs text-on-dark/);
  assert.match(POPUP, /surface-glass font-ui/);
  assert.match(POPUP, /surface-success text-on-dark/);
  assert.match(POPUP, /surface-quiet text-on-dark/);
  assert.doesNotMatch(POPUP, /hover:bg-emerald-500|bg-emerald-/);
  assert.doesNotMatch(POPUP, /text-chrome-text-secondary/);
  assert.doesNotMatch(POPUP, /text-black|text-gray-900|text-gray-950|#000\b/);
  assert.doesNotMatch(SRC, /text-chrome-text-secondary/);
});

test('popup auto-closes when connected and the toast lives 5 s with an X', () => {
  assert.match(SRC, /shouldClosePairingDialogOnConnect/);
  assert.match(SRC, /setToastOpen\(true\)/);
  assert.match(SRC, /AGENT_CONNECTED_TOAST_MS/);
  assert.match(SRC, /data-agent-bridge-connected-toast=""/);
  assert.match(SRC, /AGENT_CONNECTED_TOAST_COPY/);
  assert.match(SRC, /onDismiss=\{\(\) => setToastOpen\(false\)\}/);
});

test('connection ring is a wrap sibling with a glow, not a rotated child of the glass chip', () => {
  assert.match(CHIP, /data-profile-chip-wrap=""/);
  assert.match(CHIP, /agent-bridge-profile-ring agent-bridge-profile-ring--\$\{agentRing\}/);
  assert.match(CHIP, /overflow-visible/);
  const buttonBlock = CHIP.slice(CHIP.indexOf('<button'), CHIP.indexOf('</button>'));
  assert.equal(buttonBlock.includes('agent-bridge-profile-ring'), false);
  assert.match(CSS, /agent-bridge-ring-glow/);
  assert.match(CSS, /agent-bridge-profile-ring--connected/);
  assert.doesNotMatch(CSS, /@keyframes agent-bridge-ring-spin/);
  assert.doesNotMatch(CSS, /animation: agent-bridge-ring-spin/);
});

test('unmount cleanup disposes the socket and poller so the connection cannot leak', () => {
  assert.match(SRC, /disposePairingHost\(\{ conn: connRef\.current, poller: pollerRef\.current \}\)/);
  assert.match(SRC, /disposePairingHost\(\{ conn: connRef\.current \}\)/);
});

test('resume key stays in relay/tab memory and is not persisted', () => {
  assert.match(TAB, /let resumeKey = null/);
  assert.doesNotMatch(TAB, /localStorage/);
  assert.doesNotMatch(TAB, /sessionStorage/);
});

test('Disconnect during an Allow prompt rejects the peer instead of dropping the socket silently', () => {
  assert.match(SRC, /stateRef\.current === 'pending'/);
  assert.match(SRC, /rejectPair\(\)/);
});
