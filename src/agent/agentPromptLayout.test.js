import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_PROMPT_DESKTOP_MAX_W,
  AGENT_PROMPT_IDLE_H,
  AGENT_PROMPT_INPUT_MAX,
  AGENT_PROMPT_REPLY_DESKTOP_MAX,
  AGENT_PROMPT_REPLY_MOBILE_MAX,
  OVERLAP_FIXTURES,
  agentPromptBox,
  agentPromptHits,
  boxesOverlap,
  measureAgentPromptOverlap,
} from './agentPromptLayout.js';

test('desktop idle prompt stays between the rails and below the feature strip', () => {
  const { desktop } = OVERLAP_FIXTURES;
  const box = agentPromptBox({ viewport: desktop.viewport, height: AGENT_PROMPT_IDLE_H });
  assert.ok(box.w <= AGENT_PROMPT_DESKTOP_MAX_W);
  assert.deepEqual(agentPromptHits(box, desktop), []);
  assert.equal(boxesOverlap(box, desktop.strip[0]), false);
  assert.equal(boxesOverlap(box, desktop.railL[0]), false);
  assert.equal(boxesOverlap(box, desktop.railR[0]), false);
});

test('iPhone 390 idle prompt clears the rails, strip, and home pill', () => {
  const { iphone } = OVERLAP_FIXTURES;
  const box = agentPromptBox({
    viewport: iphone.viewport,
    compact: true,
    height: AGENT_PROMPT_IDLE_H,
  });
  assert.deepEqual(agentPromptHits(box, iphone), []);
  assert.equal(boxesOverlap(box, iphone.pill[0]), false);
  assert.equal(boxesOverlap(box, iphone.railL[0]), false);
  assert.equal(boxesOverlap(box, iphone.railR[0]), false);
});

test('grown reply + input still miss chrome at desktop and 390', () => {
  const tallDesktop = agentPromptBox({
    viewport: OVERLAP_FIXTURES.desktop.viewport,
    height: AGENT_PROMPT_INPUT_MAX + AGENT_PROMPT_REPLY_DESKTOP_MAX + 80,
  });
  assert.deepEqual(agentPromptHits(tallDesktop, OVERLAP_FIXTURES.desktop), []);

  const tallPhone = agentPromptBox({
    viewport: OVERLAP_FIXTURES.iphone.viewport,
    compact: true,
    height: AGENT_PROMPT_INPUT_MAX + AGENT_PROMPT_REPLY_MOBILE_MAX + 80,
  });
  assert.deepEqual(agentPromptHits(tallPhone, OVERLAP_FIXTURES.iphone), []);
});

test('measureAgentPromptOverlap reports hidden when the card is absent', () => {
  const missing = {
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  assert.deepEqual(measureAgentPromptOverlap(missing), { ok: true, hidden: true, hit: [] });
});
