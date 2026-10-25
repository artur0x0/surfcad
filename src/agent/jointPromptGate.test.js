import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v1Registry } from './commands/index.js';
import {
  featurePopupAllowed,
  resetAgentFeaturePopupGateForTests,
  setAgentPromptWorking,
  withAgentDrivenChange,
} from './agentFeaturePopupGate.js';
import { beginAgentJointSession } from './jointPromptGate.js';

const root = dirname(fileURLToPath(import.meta.url));
const create = v1Registry.get('joint_create');
const FACE_KEY = { at: [0, 0, 10], n: [0, 0, 1], area: 1200 };
const PICKS = [
  { part_id: 'frame', face_id: 'f4', key: FACE_KEY },
  { part_id: 'wheel', face_id: 'f1', key: { at: [0, 0, 0], n: [0, 0, -1], area: 1200 } },
];

function host() {
  let card = null;
  const open = () => {
    if (!beginAgentJointSession({ game: false, featureSession: false })) {
      return { result: { open: false, suppressed: true } };
    }
    card = { type: null };
    return { result: { open: true } };
  };
  return {
    jointOpen: open,
    jointApplyPicks({ picks }) {
      return { result: { picked: picks.map((row) => row.part_id), count: picks.length, pickCount: picks.length } };
    },
    jointSetParams({ patch }) {
      card = { ...card, ...patch };
      return { result: { ok: true, type: card.type, name: card.name ?? 'seat', valueMm: null, sense: 1, opposed: true, mode: 'create', pickCount: 2 } };
    },
    prepareJointCommit() {
      return { ok: true, jointId: 'j7', jointCount: 1, unchanged: false };
    },
    finishJointCommit() { card = null; },
    jointCancel() { card = null; return { result: { cancelled: true } }; },
    agentGetPartTransform({ partId }) {
      return { result: { position: [0, 0, 0], rotation: [0, 0, 0], partId } };
    },
  };
}

test('a joint is created while the prompt gate is closed for building', async () => {
  resetAgentFeaturePopupGateForTests();
  try {
    setAgentPromptWorking(true);
    let popupAtOpen = true;
    const out = await withAgentDrivenChange(async () => {
      popupAtOpen = featurePopupAllowed();
      return create.run(host(), { type: 'coincident', picks: PICKS });
    });
    assert.equal(popupAtOpen, false);
    assert.equal(out.error, undefined, JSON.stringify(out));
    assert.equal(out.result.ok, true);
    assert.equal(out.result.jointId, 'j7');
  } finally {
    resetAgentFeaturePopupGateForTests();
  }
});

test('game mode and another feature session still refuse a joint session', () => {
  assert.equal(beginAgentJointSession({ game: true }), false);
  assert.equal(beginAgentJointSession({ featureSession: true }), false);
  assert.equal(beginAgentJointSession({}), true);
});

test('the joint opener in the app uses the prompt-gate exception', () => {
  const app = readFileSync(join(root, '../App.jsx'), 'utf8');
  assert.match(app, /beginAgentJointSession\(\{/);
  assert.doesNotMatch(
    app.slice(app.indexOf('const handleOpenJoints'), app.indexOf('const handleCadEmptyClick')),
    /allowFeaturePopup\(\)/,
  );
});
