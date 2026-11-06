import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_PROMPT_TAIL_BASE,
  AGENT_PROMPT_TAIL_HEIGHT,
  agentPromptBubblePath,
  agentPromptTailFillPath,
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
  assert.ok(touching, 'a gap too small for the tail still paints the box');
  assert.equal(touching.hasTail, false);
  assert.equal(touching.tailH, 0);
  assert.equal(touching.totalHeight, touching.height);
  const boxPath = agentPromptBubblePath(touching);
  assert.equal(boxPath.includes(`L ${touching.tipX}`), false);
  assert.match(boxPath, /^M /);
  assert.match(boxPath, /Z$/);
});

test('when the tail cannot be placed the rectangular fill stays', () => {
  const prompt = { left: 10, top: 40, bottom: 180, width: 220, height: 140, visualWidth: 220, visualHeight: 140 };
  const missing = agentPromptTailLayout({ prompt, button: null });
  assert.equal(missing.hasTail, false);
  assert.equal(missing.tailH, 0);
  assert.ok(agentPromptBubblePath(missing).length > 10);

  const narrow = agentPromptTailLayout({
    prompt: { ...prompt, width: 40, visualWidth: 40 },
    button: { left: 0, top: 220, width: 40 },
  });
  assert.equal(narrow.hasTail, false);
  assert.equal(narrow.tailH, 0);
  assert.equal(agentPromptBubblePath(narrow).includes(' L '), false);

  const zero = agentPromptTailLayout({
    prompt: { left: 0, top: 0, bottom: 0, width: 0, height: 0 },
    button: { left: 0, top: 20, width: 40 },
  });
  assert.equal(zero, null);

  const tail = readFileSync(join(root, 'src/components/AgentPromptTail.jsx'), 'utf8');
  const css = readFileSync(join(root, 'src/index.css'), 'utf8');
  assert.match(tail, /layout\.hasTail \? 'tail' : 'box'/);
  assert.match(tail, /surface-glass/);
  assert.match(css, /\.agent-prompt-tail \{[^}]*height: 100%;/s);
  assert.doesNotMatch(
    css,
    /\.agent-prompt-tail\[data-agent-prompt-tail-ready="0"\] \{\s*visibility:\s*hidden/,
  );
  // The pane is a CSS box that is drawn whether or not anything was measured.
  assert.doesNotMatch(css, /data-agent-prompt-tail-ready="0"\][^{]*\.agent-prompt-bubble-fill/);
});

test('the pane always has a border: a CSS border until the outline path is measured, never neither', () => {
  const tail = readFileSync(join(root, 'src/components/AgentPromptTail.jsx'), 'utf8');
  const css = readFileSync(join(root, 'src/index.css'), 'utf8');
  // The box: fill, border and shadow in plain CSS, with no condition on it.
  assert.match(css, /\n {2}\.agent-prompt-bubble-fill \{[^}]*border: 1px solid rgb\(var\(--agent-prompt-outline\)\);[^}]*border-radius: var\(--agent-prompt-radius\);[^}]*box-shadow:/s);
  // Only the measured state hides the CSS border, and it keeps its width.
  assert.match(css, /\.agent-prompt-tail\[data-agent-prompt-tail-ready="1"\] \.agent-prompt-bubble-fill \{\s*border-color: transparent;\s*\}/);
  assert.doesNotMatch(css, /data-agent-prompt-tail-ready="1"\] \.agent-prompt-bubble-fill \{[^}]*border(-width)?: (0|none)/);
  // The unmeasured state hides only the SVG and the tip marker.
  assert.match(css, /data-agent-prompt-tail-ready="0"\] \.agent-prompt-bubble-stroke,\s*\.agent-prompt-tail\[data-agent-prompt-tail-ready="0"\] \.agent-prompt-tail-tip \{\s*visibility: hidden;/);
  // The outline is clearer than the hairline token: 3:1 or better on the viewport ground.
  assert.match(css, /--chrome-border-strong: 107 114 128;/);
  assert.match(css, /--agent-prompt-outline: var\(--chrome-border-strong\);/);
  assert.match(css, /\.agent-prompt-bubble-stroke \{[^}]*width: 100%;[^}]*height: 100%;[^}]*color: rgb\(var\(--agent-prompt-outline\)\);/s);
  // No clip-path over the glass, no viewBox scaling, no separate shadow layer.
  assert.doesNotMatch(tail, /\.clipPath|webkitClipPath|setAttribute\('viewBox'|bubble-shadow/);
  assert.doesNotMatch(css, /agent-prompt-bubble-shadow/);
  assert.match(tail, /agentPromptTailFillPath\(layout\)/);
  assert.match(tail, /className="agent-prompt-bubble-outline"/);
});

test('the tail fill is the triangle alone, with its base on the box edge', () => {
  const prompt = { left: 76, top: 524, bottom: 788, width: 238, height: 264, visualWidth: 238, visualHeight: 264 };
  const withTail = agentPromptTailLayout({ prompt, button: { left: 167, top: 807, width: 56 } });
  assert.equal(withTail.hasTail, true);
  const d = agentPromptTailFillPath(withTail);
  assert.equal(d, `M ${withTail.baseLeft} ${withTail.height} L ${withTail.tipX} ${withTail.tipY} L ${withTail.baseRight} ${withTail.height} Z`);
  // The outline leaves the bottom edge at the same two points, so fill and stroke meet.
  const outline = agentPromptBubblePath(withTail);
  assert.ok(outline.includes(`H ${withTail.baseRight} L ${withTail.tipX} ${withTail.tipY} L ${withTail.baseLeft} ${withTail.height}`));
  assert.equal(agentPromptTailFillPath(agentPromptTailLayout({ prompt, button: null })), '');
  assert.equal(agentPromptTailFillPath(null), '');
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
  assert.match(css, /\.agent-prompt-bubble-outline \{[^}]*stroke: currentColor;/s);
  assert.match(css, /\.agent-prompt-bubble-tail-fill \{[^}]*fill: rgb\(var\(--chrome-surface\) \/ 0\.82\);/s);
  assert.match(css, /color: rgb\(var\(--agent-prompt-outline\)\)/);
});
