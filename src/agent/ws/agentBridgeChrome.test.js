import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOOTER_PRIVACY_HEIGHT_PX,
  PAIRING_DIALOG_PAD_BOTTOM_PX,
  PAIRING_DIALOG_PAD_TOP_PX,
  agentBridgeRingLabel,
  agentBridgeRingState,
  approvalPopupPortalTarget,
  approvalPopupReducer,
  footerPrivacyChoicesBox,
  pairingDialogBox,
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

test('pairing dialog portals onto document.body, not the profile menu', () => {
  const body = { nodeType: 1 };
  assert.equal(approvalPopupPortalTarget({ body }), body);
  assert.equal(approvalPopupPortalTarget({ body: null }), null);
  assert.equal(approvalPopupPortalTarget(null), null);
});

test('a click on the pairing dialog does not dismiss the profile panel', () => {
  const panel = { contains: () => false };
  const approval = { closest: (sel) => (sel === '[data-agent-bridge-approval]' ? approval : null) };
  const dialog = { closest: (sel) => (sel === '[data-agent-bridge-dialog]' ? dialog : null) };
  const account = { closest: (sel) => (sel === '[data-git-dialog="account"]' ? account : null) };
  const outside = { closest: () => null };
  assert.equal(shouldDismissProfilePanelOnPointer({ target: approval }, panel), false);
  assert.equal(shouldDismissProfilePanelOnPointer({ target: dialog }, panel), false);
  assert.equal(shouldDismissProfilePanelOnPointer({ target: account }, panel), false);
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

test('the old bottom-6 Allow/Deny pill overlapped the footer Privacy choices at 1280', () => {
  const footer = footerPrivacyChoicesBox({ width: 1280, height: 800 });
  const oldPill = { x: 530, y: 728, width: 220, height: 48 };
  assert.equal(footer.y, 772);
  assert.equal(FOOTER_PRIVACY_HEIGHT_PX, 28);
  assert.equal(oldPill.y + oldPill.height, 776);
  assert.ok(footer.y <= 776, `footer top ${footer.y}`);
  assert.equal(rectsOverlap(oldPill, footer), true, 'regressed overlap from #556 playtest');
});

test('pairing dialog never overlaps footer Privacy choices at 390, 768, or 1280', () => {
  for (const { width, height } of [
    { width: 390, height: 844 },
    { width: 768, height: 800 },
    { width: 1280, height: 800 },
  ]) {
    const footer = footerPrivacyChoicesBox({ width, height });
    const dialog = pairingDialogBox({ width, height }, { height: 420 });
    const approval = pairingDialogBox({ width, height }, { width: 220, height: 48 });
    const tall = pairingDialogBox({ width, height }, { height: 2000 });
    assert.equal(
      rectsOverlap(dialog, footer),
      false,
      `dialog covers footer Privacy at ${width}: dialog=${JSON.stringify(dialog)} footer=${JSON.stringify(footer)}`,
    );
    assert.equal(
      rectsOverlap(approval, footer),
      false,
      `approval covers footer Privacy at ${width}`,
    );
    assert.equal(
      rectsOverlap(tall, footer),
      false,
      `max-height dialog covers footer Privacy at ${width}: tall=${JSON.stringify(tall)} footer=${JSON.stringify(footer)}`,
    );
    assert.ok(
      tall.y + tall.height <= footer.y,
      `tall dialog bottom ${tall.y + tall.height} must sit above footer top ${footer.y} at ${width}`,
    );
    assert.equal(tall.height, height - PAIRING_DIALOG_PAD_TOP_PX - PAIRING_DIALOG_PAD_BOTTOM_PX);
    const chrome = typicalProfileChrome(width, height);
    assert.equal(rectsOverlap(dialog, chrome.chip), false, `covers chip at ${width}`);
  }
});

test('pairing dialog stays off footer Privacy with typical chrome at 390, 768, and 1280', () => {
  for (const width of [390, 768, 1280]) {
    const chrome = typicalProfileChrome(width, 800);
    const footer = footerPrivacyChoicesBox({ width, height: 800 });
    const dialog = pairingDialogBox({ width, height: 800 }, { height: 280 });
    assert.equal(rectsOverlap(dialog, footer), false, `covers footer Privacy at ${width}`);
    assert.equal(rectsOverlap(dialog, chrome.chip), false, `covers chip at ${width}`);
  }
});

test('approval popup closes on allow or deny', () => {
  const open = { open: true };
  assert.deepEqual(approvalPopupReducer(open, 'allow'), { open: false });
  assert.deepEqual(approvalPopupReducer(open, 'deny'), { open: false });
  assert.deepEqual(approvalPopupReducer({ open: false }, 'pair_request'), { open: true });
});
