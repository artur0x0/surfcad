import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_PROMPT_TAIL_BASE,
  AGENT_PROMPT_TAIL_HEIGHT,
  agentPromptBubblePath,
  agentPromptTailLayout,
  agentPromptTailTipAngle,
} from './agentPromptTail.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Phone layout the stage pill actually uses: prompt centred, rail-capped,
 * Bot button the middle third of the 168px connected pill.
 */
function phoneScene(viewportWidth, { lift = 0, promptHeight = 140 } = {}) {
  const promptW = Math.min(256, viewportWidth - 9.5 * 16);
  const promptLeft = (viewportWidth - promptW) / 2;
  const restBottom = 620;
  const promptBottom = restBottom - lift;
  const promptTop = promptBottom - promptHeight;
  const pillW = 168;
  const pillLeft = (viewportWidth - pillW) / 2;
  const buttonW = pillW / 3;
  const buttonLeft = pillLeft + pillW / 3;
  // Prompt rests 56px up. The pill is 30px with 8px of bottom padding, so
  // its top (the button top) is 38px up. Room under the box is 18px.
  // A keyboard lift moves the prompt only; the button stays put.
  const buttonTop = restBottom + 18;
  return agentPromptTailLayout({
    prompt: {
      left: promptLeft,
      top: promptTop,
      bottom: promptBottom,
      width: promptW,
      height: promptHeight,
      visualWidth: promptW,
      visualHeight: promptHeight,
    },
    button: { left: buttonLeft, top: buttonTop, width: buttonW },
  });
}

test('the tail tip is an obtuse triangle', () => {
  const angle = agentPromptTailTipAngle(AGENT_PROMPT_TAIL_BASE, AGENT_PROMPT_TAIL_HEIGHT);
  assert.ok(angle > 90 && angle < 150, `tip angle ${angle}`);
});

test('at 390px the tip x is within 2px of the bot button centre and does not touch it', () => {
  const layout = phoneScene(390);
  assert.ok(layout, 'tail should fit in the gap above the button');
  assert.ok(Math.abs(layout.tipViewportX - layout.buttonCx) <= 2, `dx ${layout.tipViewportX - layout.buttonCx}`);
  assert.ok(layout.gap > 0, `gap ${layout.gap}`);
  assert.ok(layout.gap >= 4, `gap ${layout.gap} should stay visible`);
  const path = agentPromptBubblePath(layout);
  assert.match(
    path,
    new RegExp(`H ${layout.baseRight} L ${layout.tipX} ${layout.tipY} L ${layout.baseLeft}`),
  );
  assert.equal(path.includes(`L ${layout.baseLeft} L ${layout.baseRight}`), false);
  assert.equal(path.includes(`H ${layout.baseLeft} H ${layout.baseRight}`), false);
});

test('the tip stays on the button centre at phone widths, after a lift, and when the gap shrinks', () => {
  for (const width of [320, 375, 390, 430]) {
    const layout = phoneScene(width);
    assert.ok(layout, `missing tail at ${width}`);
    assert.ok(Math.abs(layout.tipViewportX - layout.buttonCx) <= 2, `${width} dx ${layout.tipViewportX - layout.buttonCx}`);
    assert.ok(layout.gap > 0, `${width} touched the button`);
    assert.ok(agentPromptTailTipAngle(AGENT_PROMPT_TAIL_BASE, layout.tailH) > 90);
  }

  const lifted = phoneScene(390, { lift: 220 });
  assert.ok(Math.abs(lifted.tipViewportX - lifted.buttonCx) <= 2);
  assert.equal(lifted.tailH, AGENT_PROMPT_TAIL_HEIGHT);
  assert.ok(lifted.gap > 200);

  const tight = agentPromptTailLayout({
    prompt: { left: 76, top: 400, bottom: 520, width: 238, height: 120, visualWidth: 238, visualHeight: 120 },
    button: { left: 167, top: 530, width: 56 },
  });
  assert.ok(tight);
  assert.ok(tight.gap >= 6 - 0.05, `tight gap ${tight.gap}`);
  assert.ok(Math.abs(tight.tipViewportX - (167 + 28)) <= 2);

  const touching = agentPromptTailLayout({
    prompt: { left: 76, top: 400, bottom: 520, width: 238, height: 120, visualWidth: 238, visualHeight: 120 },
    button: { left: 167, top: 522, width: 56 },
  });
  assert.equal(touching, null);
});

test('the tail is phone-only and uses the glass fill, not a new colour', () => {
  const prompt = readFileSync(join(root, 'src/components/PromptInput.jsx'), 'utf8');
  const tail = readFileSync(join(root, 'src/components/AgentPromptTail.jsx'), 'utf8');
  const css = readFileSync(join(root, 'src/index.css'), 'utf8');
  assert.match(prompt, /isMobile \? 'agent-prompt--compact' : 'surface-glass'/);
  assert.match(prompt, /<AgentPromptFrame isMobile=\{isMobile\} rootRef=\{rootRef\}>/);
  assert.match(tail, /surface-glass/);
  assert.doesNotMatch(tail, /#[0-9a-fA-F]{3,8}|text-black|bg-gray-|text-gray-/);
  assert.match(css, /\.agent-prompt\.agent-prompt--compact \{[^}]*overflow: visible;[^}]*border: none;/s);
  assert.match(css, /\.agent-prompt-bubble-stroke path \{[^}]*stroke: currentColor;/s);
  assert.match(css, /color: rgb\(var\(--agent-prompt-border\)\)/);
});
