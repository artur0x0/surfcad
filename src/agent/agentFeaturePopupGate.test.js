import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allowAgentWorkSurface,
  allowFeaturePopup,
  registerFeaturePopupDismiss,
  resetAgentFeaturePopupGateForTests,
  setAgentPromptWorking,
  setAuthorizedFeatureEdit,
  withAgentDrivenChange,
} from './agentFeaturePopupGate.js';

const root = dirname(fileURLToPath(import.meta.url));

test('agent feature popups stay closed only while the prompt is working', async () => {
  resetAgentFeaturePopupGateForTests();
  try {
    assert.equal(allowFeaturePopup(), true);
    setAgentPromptWorking(true);
    assert.equal(allowFeaturePopup(), true);
    let suppressed = false;
    await withAgentDrivenChange(() => {
      suppressed = allowFeaturePopup() === false;
    });
    assert.equal(suppressed, true);
    setAgentPromptWorking(false);
    let opened = false;
    await withAgentDrivenChange(() => {
      opened = allowFeaturePopup() === true;
    });
    assert.equal(opened, true);
  } finally {
    resetAgentFeaturePopupGateForTests();
  }
});

test('working dismisses an agent-owned card and leaves a user card', async () => {
  resetAgentFeaturePopupGateForTests();
  try {
    allowFeaturePopup();
    let dismissed = 0;
    const off = registerFeaturePopupDismiss(() => { dismissed += 1; });
    setAgentPromptWorking(true);
    assert.equal(dismissed, 0);
    setAgentPromptWorking(false);
    off();

    resetAgentFeaturePopupGateForTests();
    await withAgentDrivenChange(() => { allowFeaturePopup(); });
    let agentDismissed = 0;
    registerFeaturePopupDismiss(() => { agentDismissed += 1; });
    setAgentPromptWorking(true);
    assert.equal(agentDismissed, 1);
    setAgentPromptWorking(true);
    assert.equal(agentDismissed, 1);
  } finally {
    resetAgentFeaturePopupGateForTests();
  }
});

test('an in-flight edit launch does not retake ownership or mount after working starts', async () => {
  resetAgentFeaturePopupGateForTests();
  try {
    await withAgentDrivenChange(() => { allowFeaturePopup(); });
    setAuthorizedFeatureEdit(true);
    assert.equal(allowFeaturePopup(), true);
    setAgentPromptWorking(true);
    assert.equal(allowFeaturePopup(), false);
    setAuthorizedFeatureEdit(false);
  } finally {
    resetAgentFeaturePopupGateForTests();
  }
});

test('bridge commands run inside the agent-driven scope', () => {
  const bridge = readFileSync(join(root, '../utils/agentBridge.js'), 'utf8');
  assert.match(bridge, /withAgentDrivenChange\(runBody\)/);
  const app = readFileSync(join(root, '../App.jsx'), 'utf8');
  assert.match(app, /featurePopupOpen=\{featurePopupOpen\}/);
  assert.match(app, /onFeatureCardChange=\{setFeaturePopupOpen\}/);
});

test('the agent\'s sketch and slot card open while the session is working; a user tap keeps the gate', async () => {
  resetAgentFeaturePopupGateForTests();
  try {
    setAgentPromptWorking(true);
    let surface = null;
    let popup = null;
    await withAgentDrivenChange(() => {
      surface = allowAgentWorkSurface();
      popup = allowFeaturePopup();
    });
    assert.equal(surface, true, 'sketch_begin / slot_open get their card');
    assert.equal(popup, false, 'a side-effect feature card is still held');
    // The card is agent-owned: a new prompt starting to work dismisses it.
    let dismissed = 0;
    registerFeaturePopupDismiss(() => { dismissed += 1; });
    setAgentPromptWorking(false);
    setAgentPromptWorking(true);
    assert.equal(dismissed, 1);
    // No agent on the stack: the same call is a user tap.
    assert.equal(allowAgentWorkSurface(), true);
  } finally {
    resetAgentFeaturePopupGateForTests();
  }
});

test('the viewport routes the agent sketch and slot entries through the work-surface gate', () => {
  const view = readFileSync(join(root, '../components/Viewport.jsx'), 'utf8');
  assert.match(view, /agentSurface \? allowAgentWorkSurface\(\) : allowFeaturePopup\(\)/);
  assert.match(view, /enterContourMode\(\{ entry, agentSurface: true \}\)/);
  assert.match(view, /openFeatureSlots\(kind, null, \{ agentSurface: true \}\)/);
  assert.match(view, /code: 'sketch_blocked'/);
  assert.match(view, /code: 'slot_blocked'/);
});
