import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentBridgeRingLabel,
  agentBridgeRingState,
  approvalPopupPortalTarget,
  approvalPopupReducer,
  rectsOverlap,
  shouldDismissProfilePanelOnPointer,
} from './agentBridgeChrome.js';

test('connection ring follows the link state', () => {
  assert.equal(agentBridgeRingState(null), null);
  assert.equal(agentBridgeRingState(undefined), null);
  assert.equal(agentBridgeRingState('connected'), 'connected');
  assert.equal(agentBridgeRingState('reconnecting'), 'reconnecting');
  assert.equal(agentBridgeRingState('lost'), 'lost');
  assert.equal(agentBridgeRingState('bogus'), null);
  assert.equal(agentBridgeRingState(true), null);
  assert.equal(agentBridgeRingLabel('connected'), 'Local agent connected');
  assert.equal(agentBridgeRingLabel('reconnecting'), 'Local agent reconnecting');
  assert.equal(agentBridgeRingLabel('lost'), 'Local agent connection lost');
  assert.equal(agentBridgeRingLabel(null), '');
  assert.doesNotMatch(agentBridgeRingLabel('lost'), /\bEdge\b/);
});

test('approval popup portals onto document.body, not the profile menu', () => {
  const body = { nodeType: 1 };
  assert.equal(approvalPopupPortalTarget({ body }), body);
  assert.equal(approvalPopupPortalTarget({ body: null }), null);
  assert.equal(approvalPopupPortalTarget(null), null);
});

test('a click on the Allow/Deny portal does not dismiss the profile panel', () => {
  const panel = { contains: () => false };
  const approval = { closest: (sel) => (sel === '[data-agent-bridge-approval]' ? approval : null) };
  const outside = { closest: () => null };
  assert.equal(shouldDismissProfilePanelOnPointer({ target: approval }, panel), false);
  assert.equal(shouldDismissProfilePanelOnPointer({ target: outside }, panel), true);
  assert.equal(shouldDismissProfilePanelOnPointer({ target: outside }, { contains: () => true }), false);
  assert.equal(shouldDismissProfilePanelOnPointer({ target: outside }, null), false);
});

test('body-portal Allow/Deny does not overlap the profile chip or menu rows', () => {
  const chip = { x: 1228, y: 16, width: 36, height: 36 };
  const panel = { x: 1040, y: 56, width: 224, height: 360 };
  const privacy = { x: 1048, y: 300, width: 208, height: 28 };
  const inPanelPopup = { x: 1048, y: 280, width: 208, height: 48 };
  const bodyPortal = { x: 530, y: 720, width: 220, height: 48 };
  assert.equal(rectsOverlap(inPanelPopup, privacy), true, '#539 in-panel popup covered Privacy choices');
  assert.equal(rectsOverlap(bodyPortal, privacy), false);
  assert.equal(rectsOverlap(bodyPortal, panel), false);
  assert.equal(rectsOverlap(bodyPortal, chip), false);
  assert.equal(rectsOverlap(null, chip), false);
});

test('approval popup closes on allow or deny', () => {
  const open = { open: true };
  assert.deepEqual(approvalPopupReducer(open, 'allow'), { open: false });
  assert.deepEqual(approvalPopupReducer(open, 'deny'), { open: false });
  assert.deepEqual(approvalPopupReducer({ open: false }, 'pair_request'), { open: true });
});
