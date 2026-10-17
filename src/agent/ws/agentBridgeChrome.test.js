import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentBridgeRingLabel,
  agentBridgeRingState,
  approvalPopupBox,
  approvalPopupPortalTarget,
  approvalPopupPositionClass,
  approvalPopupReducer,
  APPROVAL_POPUP_WIDE_MIN_PX,
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

function typicalProfileChrome(width, height = 800) {
  const chip = { x: width - 16 - 36, y: 16, width: 36, height: 36 };
  const panelW = Math.min(256, Math.max(160, width - 24));
  const panel = {
    x: Math.max(0, width - 16 - panelW),
    y: 56,
    width: panelW,
    height: Math.min(700, height - 56),
  };
  const privacy = {
    x: panel.x + 8,
    y: panel.y + panel.height - 40,
    width: panel.width - 16,
    height: 28,
  };
  return { chip, panel, privacy };
}

test('body-portal Allow/Deny does not overlap the profile chip or menu rows', () => {
  const chip = { x: 1228, y: 16, width: 36, height: 36 };
  const panel = { x: 1040, y: 56, width: 224, height: 360 };
  const privacy = { x: 1048, y: 300, width: 208, height: 28 };
  const inPanelPopup = { x: 1048, y: 280, width: 208, height: 48 };
  const bodyPortal = approvalPopupBox({ width: 1280, height: 800 });
  assert.equal(rectsOverlap(inPanelPopup, privacy), true, '#539 in-panel popup covered Privacy choices');
  assert.equal(rectsOverlap(bodyPortal, privacy), false);
  assert.equal(rectsOverlap(bodyPortal, panel), false);
  assert.equal(rectsOverlap(bodyPortal, chip), false);
  assert.equal(rectsOverlap(null, chip), false);
});

test('Allow/Deny portal stays off Privacy choices at 390, 768, and 1280', () => {
  assert.ok(APPROVAL_POPUP_WIDE_MIN_PX <= 900);
  assert.match(approvalPopupPositionClass(1280), /bottom-6 left-1\/2/);
  assert.match(approvalPopupPositionClass(768), /top-14 left-3/);
  assert.match(approvalPopupPositionClass(390), /top-14 left-3/);
  for (const width of [390, 768, 1280]) {
    const chrome = typicalProfileChrome(width);
    const popup = approvalPopupBox({ width, height: 800 });
    assert.equal(
      rectsOverlap(popup, chrome.privacy),
      false,
      `covers Privacy at ${width} popup=${JSON.stringify(popup)} privacy=${JSON.stringify(chrome.privacy)}`,
    );
    assert.equal(
      rectsOverlap(popup, chrome.chip),
      false,
      `covers chip at ${width}`,
    );
  }
});

test('approval popup closes on allow or deny', () => {
  const open = { open: true };
  assert.deepEqual(approvalPopupReducer(open, 'allow'), { open: false });
  assert.deepEqual(approvalPopupReducer(open, 'deny'), { open: false });
  assert.deepEqual(approvalPopupReducer({ open: false }, 'pair_request'), { open: true });
});
