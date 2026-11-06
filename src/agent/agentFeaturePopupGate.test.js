import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allowAgentWorkSurface,
  allowFeaturePopup,
  featurePopupOwner,
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
    assert.equal(featurePopupOwner(), 'agent-surface');
    // No agent on the stack: the same call is a user tap.
    setAgentPromptWorking(false);
    assert.equal(allowAgentWorkSurface(), true);
    assert.equal(featurePopupOwner(), 'user');
  } finally {
    resetAgentFeaturePopupGateForTests();
  }
});

test('the agent\'s open sketch survives the session going back to working (sketch_begin, then post_progress, then sketch_add)', async () => {
  resetAgentFeaturePopupGateForTests();
  try {
    let dismissed = 0;
    registerFeaturePopupDismiss(() => { dismissed += 1; });
    // The session is idle (60 s since the last model change, or a build the
    // agent starts itself). sketch_begin opens the sketch.
    await withAgentDrivenChange(() => { assert.equal(allowAgentWorkSurface(), true); });
    // post_progress, set_status building, or the next model change: working starts.
    setAgentPromptWorking(true);
    assert.equal(dismissed, 0, 'the sketch the agent is drawing in is not dismissed');
    // Idle again after 60 s, then working again: still open.
    setAgentPromptWorking(false);
    setAgentPromptWorking(true);
    assert.equal(dismissed, 0);
    assert.equal(featurePopupOwner(), 'agent-surface');

    // A feature card an agent command popped as a side effect is still
    // dismissed when working starts.
    setAgentPromptWorking(false);
    await withAgentDrivenChange(() => { assert.equal(allowFeaturePopup(), true); });
    assert.equal(featurePopupOwner(), 'agent');
    setAgentPromptWorking(true);
    assert.equal(dismissed, 1);
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
