import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalPopupReducer,
  shouldShowAgentBridgeRing,
} from './agentBridgeChrome.js';

test('connection ring follows paired state', () => {
  assert.equal(shouldShowAgentBridgeRing({ connected: false }), false);
  assert.equal(shouldShowAgentBridgeRing({ connected: true }), true);
});

test('approval popup closes on allow or deny', () => {
  const open = { open: true };
  assert.deepEqual(approvalPopupReducer(open, 'allow'), { open: false });
  assert.deepEqual(approvalPopupReducer(open, 'deny'), { open: false });
  assert.deepEqual(approvalPopupReducer({ open: false }, 'pair_request'), { open: true });
});
