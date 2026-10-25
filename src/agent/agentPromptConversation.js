/**
 * Conversation shown in the floating agent prompt's pane: the user's
 * messages and the agent's replies, in order, for one agent connection.
 *
 * Nothing here is stored. The list lives in component state, hides on
 * Dismiss (and comes back with the next message), and is dropped on
 * disconnect. A reply's id is the prompt id it answers, so a user message
 * and its reply share an id and sit next to each other. A reply is shown
 * when this conversation already has that user message, or when this page
 * sent that prompt on another transport (there is no user row yet). Any
 * other id is ignored.
 */
import { pageSentPrompt } from './agentPromptTransport.js';

export const CONVERSATION_EMPTY = Object.freeze({ messages: Object.freeze([]), hidden: false });

/**
 * @typedef {{ key: string, id: string, role: 'user' | 'agent', text: string, thumb: string | null }} ChatMessage
 */

/**
 * @param {{ messages: ChatMessage[], hidden: boolean }} state
 * @param {{ type: string, id?: string, text?: string, thumb?: string | null, final?: boolean }} event
 */
export function conversationReducer(state, event) {
  const cur = state || CONVERSATION_EMPTY;
  switch (event?.type) {
    case 'sent': {
      if (typeof event.id !== 'string' || !event.id) return cur;
      const text = typeof event.text === 'string' ? event.text : '';
      const thumb = typeof event.thumb === 'string' && event.thumb ? event.thumb : null;
      return {
        hidden: false,
        messages: [...cur.messages, { key: `u:${event.id}`, id: event.id, role: 'user', text, thumb }],
      };
    }
    case 'reply': {
      if (typeof event.id !== 'string' || !event.id) return cur;
      const chunk = typeof event.text === 'string' ? event.text : '';
      const key = `a:${event.id}`;
      const index = cur.messages.findIndex((row) => row.key === key);
      if (index >= 0) {
        const messages = cur.messages.slice();
        messages[index] = { ...messages[index], text: messages[index].text + chunk };
        return { hidden: false, messages };
      }
      const known = cur.messages.some((row) => row.role === 'user' && row.id === event.id);
      if (!known && !pageSentPrompt(event.id)) return cur;
      return {
        hidden: false,
        messages: [...cur.messages, { key, id: event.id, role: 'agent', text: chunk, thumb: null }],
      };
    }
    case 'dismiss':
      return cur.hidden || !cur.messages.length ? cur : { ...cur, hidden: true };
    case 'show':
      return cur.hidden ? { ...cur, hidden: false } : cur;
    case 'disconnect':
      return cur.messages.length || cur.hidden ? { messages: [], hidden: false } : cur;
    default:
      return cur;
  }
}

/** Demo seed: `messages` rows `{ role, text, thumb? }` or one agent `reply`. */
export function conversationSeed({ messages = null, reply = '' } = {}) {
  const rows = Array.isArray(messages) && messages.length
    ? messages
    : (reply ? [{ role: 'agent', text: reply }] : []);
  return {
    hidden: false,
    messages: rows.map((row, i) => ({
      key: `${row.role === 'user' ? 'u' : 'a'}:demo-${i}`,
      id: `demo-${i}`,
      role: row.role === 'user' ? 'user' : 'agent',
      text: String(row.text || ''),
      thumb: typeof row.thumb === 'string' && row.thumb ? row.thumb : null,
    })),
  };
}

/** Within `slack` px of the bottom: the pane follows new messages. */
export function stickToBottom({ scrollTop, clientHeight, scrollHeight }, slack = 24) {
  const top = Number(scrollTop) || 0;
  const client = Number(clientHeight) || 0;
  const full = Number(scrollHeight) || 0;
  return full - (top + client) <= slack;
}
