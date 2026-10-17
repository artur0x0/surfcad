import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentBridgeRingLabel,
  agentBridgeRingState,
  approvalPopupPortalTarget,
  approvalPopupReducer,
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

test('approval popup closes on allow or deny', () => {
  const open = { open: true };
  assert.deepEqual(approvalPopupReducer(open, 'allow'), { open: false });
  assert.deepEqual(approvalPopupReducer(open, 'deny'), { open: false });
  assert.deepEqual(approvalPopupReducer({ open: false }, 'pair_request'), { open: true });
});
