import assert from 'node:assert/strict';
import test from 'node:test';
import { agentVisibleEnabled, initialVisibleOptionsFromEnv } from './enabled.js';
import { mergeAgentVisibleOptions, DEFAULT_AGENT_VISIBLE_OPTIONS } from './options.js';
import { resolveUiEntryElement } from './resolveTarget.js';

const storage = (value) => ({
  getItem(key) {
    if (key === 'surfcadAgentVisible') return value;
    return null;
  },
});

test('agentVisibleEnabled reads URL and storage', () => {
  assert.equal(agentVisibleEnabled({
    location: { search: '?agent=1&visible=1' },
    localStorage: storage(null),
  }), true);
  assert.equal(agentVisibleEnabled({
    location: { search: '?agent=visible' },
    localStorage: storage(null),
  }), true);
  assert.equal(agentVisibleEnabled({
    location: { search: '' },
    localStorage: storage('1'),
  }), true);
  assert.equal(agentVisibleEnabled({
    location: { search: '?agent=1' },
    localStorage: storage(null),
  }), false);
  assert.equal(agentVisibleEnabled({
    env: { AGENT_VISIBLE: '1' },
    location: { search: '' },
    localStorage: storage(null),
  }), true);
});

test('mergeAgentVisibleOptions clamps step delay', () => {
  const merged = mergeAgentVisibleOptions({ enabled: true, stepDelayMs: 250 });
  assert.equal(merged.enabled, true);
  assert.equal(merged.stepDelayMs, 250);
  assert.equal(mergeAgentVisibleOptions({ stepDelayMs: -3 }).stepDelayMs,
    DEFAULT_AGENT_VISIBLE_OPTIONS.stepDelayMs);
});

test('initialVisibleOptionsFromEnv picks visibleDelay query', () => {
  const opts = initialVisibleOptionsFromEnv({
    location: { search: '?visible=1&visibleDelay=120' },
    localStorage: storage(null),
  });
  assert.equal(opts.enabled, true);
  assert.equal(opts.stepDelayMs, 120);
});

test('resolveUiEntryElement maps helper id to data-ui-action', () => {
  if (typeof document === 'undefined') return;
  const btn = document.createElement('button');
  btn.setAttribute('data-ui-action', 'cube');
  document.body.appendChild(btn);
  assert.equal(resolveUiEntryElement('cube'), btn);
  btn.remove();
});
