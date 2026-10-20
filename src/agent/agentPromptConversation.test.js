import assert from 'node:assert/strict';
import test from 'node:test';
import { CONVERSATION_EMPTY, conversationReducer, conversationSeed, stickToBottom } from './agentPromptConversation.js';

const run = (events, start = CONVERSATION_EMPTY) => events.reduce(conversationReducer, start);

test('the pane shows the user and the agent in order, replies appended by prompt id', () => {
  const chat = run([
    { type: 'sent', id: 'p1', text: 'Add four holes' },
    { type: 'reply', id: 'p1', text: 'Adding', final: false },
    { type: 'reply', id: 'p1', text: ' four holes.', final: true },
    { type: 'sent', id: 'p2', text: 'Now fillet them', thumb: 'data:image/png;base64,AAAA' },
    { type: 'reply', id: 'p2', text: 'Done.', final: true },
  ]);
  assert.deepEqual(chat.messages.map((m) => [m.role, m.text]), [
    ['user', 'Add four holes'],
    ['agent', 'Adding four holes.'],
    ['user', 'Now fillet them'],
    ['agent', 'Done.'],
  ]);
  assert.equal(chat.messages[2].thumb, 'data:image/png;base64,AAAA');
  assert.equal(chat.messages[0].thumb, null);
  assert.equal(chat.hidden, false);
});

test('a reply with no matching user message (agent-initiated) still shows', () => {
  const chat = run([{ type: 'reply', id: 'x', text: 'Heads up', final: true }]);
  assert.deepEqual(chat.messages.map((m) => m.role), ['agent']);
});

test('dismiss hides the pane and keeps the history; the next message shows it again', () => {
  const chat = run([{ type: 'sent', id: 'p1', text: 'hi' }, { type: 'reply', id: 'p1', text: 'hello', final: true }]);
  const hidden = conversationReducer(chat, { type: 'dismiss' });
  assert.equal(hidden.hidden, true);
  assert.equal(hidden.messages.length, 2);
  const again = conversationReducer(hidden, { type: 'sent', id: 'p2', text: 'more' });
  assert.equal(again.hidden, false);
  assert.equal(again.messages.length, 3);
  const byReply = conversationReducer(hidden, { type: 'reply', id: 'p1', text: '!', final: true });
  assert.equal(byReply.hidden, false);
  assert.equal(byReply.messages[1].text, 'hello!');
  assert.equal(conversationReducer(CONVERSATION_EMPTY, { type: 'dismiss' }), CONVERSATION_EMPTY);
});

test('disconnect clears the history', () => {
  const chat = run([{ type: 'sent', id: 'p1', text: 'hi' }, { type: 'reply', id: 'p1', text: 'hello', final: true }, { type: 'dismiss' }]);
  const gone = conversationReducer(chat, { type: 'disconnect' });
  assert.deepEqual(gone, { messages: [], hidden: false });
  assert.equal(conversationReducer(CONVERSATION_EMPTY, { type: 'disconnect' }), CONVERSATION_EMPTY);
});

test('the seed builds demo conversations and a lone reply', () => {
  const lone = conversationSeed({ reply: 'Done.' });
  assert.deepEqual(lone.messages.map((m) => [m.role, m.text]), [['agent', 'Done.']]);
  const chat = conversationSeed({ messages: [{ role: 'user', text: 'a', thumb: 'data:x' }, { role: 'agent', text: 'b' }] });
  assert.deepEqual(chat.messages.map((m) => [m.key, m.role, m.thumb]), [['u:demo-0', 'user', 'data:x'], ['a:demo-1', 'agent', null]]);
  assert.deepEqual(conversationSeed({}), { hidden: false, messages: [] });
});

test('the pane follows new messages only while it is at (or near) the bottom', () => {
  assert.equal(stickToBottom({ scrollTop: 0, clientHeight: 200, scrollHeight: 200 }), true);
  assert.equal(stickToBottom({ scrollTop: 300, clientHeight: 200, scrollHeight: 500 }), true);
  assert.equal(stickToBottom({ scrollTop: 280, clientHeight: 200, scrollHeight: 500 }), true);
  assert.equal(stickToBottom({ scrollTop: 100, clientHeight: 200, scrollHeight: 500 }), false);
  assert.equal(stickToBottom({ scrollTop: 0, clientHeight: 200, scrollHeight: 500 }), false);
});
