import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_PROMPT_FOLD_KEY,
  readFolded,
  writeFolded,
  clearFolded,
  foldBadge,
  stateAnnouncement,
} from './agentPromptFold.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    map,
  };
}

test('the folded choice is remembered, read back, and cleared on disconnect', () => {
  const storage = memoryStorage();
  assert.equal(readFolded({ storage }), false);
  writeFolded(true, { storage });
  assert.equal(storage.getItem(AGENT_PROMPT_FOLD_KEY), '1');
  assert.equal(readFolded({ storage }), true);
  writeFolded(false, { storage });
  assert.equal(readFolded({ storage }), false);
  writeFolded(true, { storage });
  clearFolded({ storage });
  assert.equal(readFolded({ storage }), false);
});

test('blocked storage never throws', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readFolded({ storage: broken }), false);
  writeFolded(true, { storage: broken });
  clearFolded({ storage: broken });
  assert.equal(readFolded({ storage: null }), false);
});

test('the folded badge follows the mode, and an unread reply wins', () => {
  assert.equal(foldBadge({ mode: 'idle' }), '');
  assert.equal(foldBadge({ mode: 'typing' }), 'typing');
  assert.equal(foldBadge({ mode: 'working' }), 'working');
  assert.equal(foldBadge({ mode: 'working', unread: true }), 'unread');
  assert.equal(foldBadge(), '');
});

test('state announcements', () => {
  assert.equal(stateAnnouncement('typing'), 'Agent is typing');
  assert.equal(stateAnnouncement('working'), 'Agent is working');
  assert.equal(stateAnnouncement('idle'), '');
  assert.equal(stateAnnouncement('idle', { replied: true }), 'Agent replied');
});
