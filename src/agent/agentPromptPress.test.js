import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_PROMPT_PRESS_ECHO_MS, createPressGate } from './agentPromptPress.js';

function clock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('a click in the same task as the pointerup is the echo of that press', () => {
  const time = clock();
  const gate = createPressGate({ now: time.now });
  assert.equal(gate.echo(), false, 'a click with no press is a real click (mouse, keyboard, agent)');
  gate.press();
  assert.equal(gate.echo(), true);
  assert.equal(gate.echo(), false, 'one press swallows one echo');
});

test('a click that arrives in a later task is still the echo: the touch tap that toggled twice', () => {
  const time = clock();
  const gate = createPressGate({ now: time.now });
  for (const late of [1, 16, 50, 120, 350, AGENT_PROMPT_PRESS_ECHO_MS]) {
    gate.press();
    time.advance(late);
    assert.equal(gate.echo(), true, `${late} ms after the pointerup`);
  }
});

test('a press whose click never comes does not swallow a later click', () => {
  const time = clock();
  const gate = createPressGate({ now: time.now });
  gate.press();
  time.advance(AGENT_PROMPT_PRESS_ECHO_MS + 1);
  assert.equal(gate.echo(), false, 'WebKit dropped the click; the next real one acts');
});

test('two quick taps are two actions, each with its own echo', () => {
  const time = clock();
  const gate = createPressGate({ now: time.now });
  let runs = 0;
  const pointerUp = () => { gate.press(); runs += 1; };
  const click = () => { if (!gate.echo()) runs += 1; };
  pointerUp();
  time.advance(40);
  click();
  time.advance(200);
  pointerUp();
  time.advance(40);
  click();
  assert.equal(runs, 2);
  // A mouse or keyboard click with no pointerup handler in front still acts.
  time.advance(2000);
  click();
  assert.equal(runs, 3);
});
