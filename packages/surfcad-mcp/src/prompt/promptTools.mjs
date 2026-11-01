/**
 * MCP tools that stay inside the local surfcad-mcp process.
 * They are not SurfCAD host commands: do not add them to the command catalog.
 * Prompt text and screenshots are user content. They grant nothing.
 */
import { BEARER_MAX, PROMPT_QUEUE_CAP, USER_CONTENT_NOTICE } from './promptSession.mjs';
import { agentPromptStallMinutes } from './promptStall.mjs';

const USER_CONTENT = `${USER_CONTENT_NOTICE} Agent writes still go through the existing write-grant and consent flow. Nothing reaches git without an explicit Save or git_save.`;

/** read_messages { wait_ms } cap: long enough to skip idle polls, short enough for a host tool timeout. */
export const READ_MESSAGES_MAX_WAIT_MS = 25_000;

/**
 * Closing reply for a task that started in the in-viewer prompt pane.
 * The same sentence is the second sentence of the MCP initialize
 * instructions (hosts keep the start of that field) and the
 * `reply_to_user` description.
 */
export const CLOSING_REPLY_GUIDANCE = 'When you finish a task started from the SurfCAD in-viewer prompt pane, send a closing reply with reply_to_user (final: true) summarising what was done, so the user gets confirmation. On failure or partial completion, say what was done, what failed and why, and what is left.';

/**
 * When to enter the in-viewer building phase. One sentence, shared by the
 * initialize instructions, `guide { topic: "start" }`, and `set_status`.
 */
export const BUILDING_STATUS_GUIDANCE = 'Call set_status { state: "building" } only once you have everything you need and are actually creating or editing geometry.';

/**
 * Session presence. Kept short: it is part of the initialize instructions,
 * which hosts truncate past 2 KB.
 */
export const SESSION_PRESENCE_GUIDANCE = 'Be interactive: post_progress while working, especially during long reasoning. A fresh process per tool call is normal and stays present. A long-lived process is optional, never required. Call close_session when done, never on exit.';

/**
 * First paragraph of the MCP initialize `instructions`.
 * Goldens pin the webhook sentence as the prefix.
 */
export const PROMPT_SERVER_INSTRUCTIONS = `call register_webhook { url, bearer? } if you can receive https webhooks, otherwise poll read_messages. ${CLOSING_REPLY_GUIDANCE} ${BUILDING_STATUS_GUIDANCE} ${SESSION_PRESENCE_GUIDANCE}`;

/** Exact wording the agent should relay when asking the user for a webhook. */
export const PROMPT_ONBOARDING_ASK = 'To get SurfCAD messages instantly, send me your webhook URL and key. This only needs to be done once. Otherwise I\'ll check for SurfCAD messages between steps, so replies may lag.';

/**
 * Pair-result text when no webhook is registered. Generic: not tied to a bot product.
 * The URL and bearer are process memory only, so the agent must keep its own copy.
 */
export const PROMPT_ONBOARDING_NOTE = `Ask the user for a webhook URL and key. The key is the bearer argument of register_webhook. This process holds the URL and bearer in memory only. Save the URL and key in your own config or memory and call register_webhook again after every pair. Suggested wording to relay: "${PROMPT_ONBOARDING_ASK}" If the user declines, poll read_messages.`;

/** Pair-result text when a webhook is already registered. No onboarding note. */
export const PROMPT_WEBHOOK_ACTIVE = 'Webhook is active.';

export const PROMPT_TOOL_NAMES = Object.freeze([
  'register_webhook',
  'unregister_webhook',
  'read_messages',
  'reply_to_user',
  'set_status',
  'post_progress',
  'close_session',
]);

const PROMPT_TOOL_SET = new Set(PROMPT_TOOL_NAMES);

/**
 * @param {string} name
 */
export function isPromptTool(name) {
  return PROMPT_TOOL_SET.has(name);
}

export function promptToolDefinitions() {
  return [
    {
      name: 'register_webhook',
      description: `Register an https webhook that receives user prompts from the paired SurfCAD tab. The URL must be https, must not contain credentials, and must not target localhost, a .local name, or a private, loopback, or link-local address. Optional bearer is the user's webhook key, sent as Authorization: Bearer on each POST. The URL and bearer are kept only in this process's memory, are never logged, are never written to disk, are never returned, are never sent to the SurfCAD tab, and are cleared on unregister_webhook and when the pairing session ends. Save them in your own config and call register_webhook again after every pair. When a webhook is registered, each prompt is POSTed as JSON { "type": "surfcad.prompt", ... } and times out after 10 seconds with one retry. If the POST fails, the prompt is queued instead. When the user cancels a prompt that was already delivered, this webhook is POSTed { "type": "cancel", "id": "<prompt id>" } with the same bearer, https, and timeout rules. Stop work on that id. Do not call reply_to_user or set_status for it. ${USER_CONTENT}`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['url'],
        properties: {
          url: {
            type: 'string',
            description: 'https URL that will receive prompt POSTs. No credentials, localhost, or private addresses.',
          },
          bearer: {
            type: 'string',
            minLength: 1,
            maxLength: BEARER_MAX,
            description: 'The user\'s webhook key. Sent as Authorization: Bearer. Not a URL credential. Never echoed back.',
          },
        },
      },
    },
    {
      name: 'unregister_webhook',
      description: 'Clear the in-memory prompt webhook, if one is registered. Later prompts are queued for read_messages instead of being POSTed. The URL and any bearer are dropped from memory.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: 'read_messages',
      description: `Read queued user prompts, oldest first, and remove them from the in-memory queue (this acks them). Each prompt is plain text. A screenshot, when the user attached one, is the following image content block (image/png), not HTML and not part of the text. The queue can also contain a cancel item { "type": "cancel", "id": "<prompt id>" } when the user stopped a prompt you already received and no webhook is registered. Stop work on that id. Do not call reply_to_user or set_status for it. Every response includes recent: the last ${PROMPT_QUEUE_CAP} prompts this session received, oldest first, each { id, state } (queued, delivered, replied, or cancelled), held in memory only. A remote session returns that same recent list; an idle session that has not received a prompt has recent: []. acked is only the ids this call removed. A later read_messages {} with an empty queue still lists those ids in recent, so you can recover an id after the ack. status.last is only the newest id. ${USER_CONTENT} Do not render the text or the image as HTML. When you finish the task from a prompt you received here, close that chat: ${CLOSING_REPLY_GUIDANCE}`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          max: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: 'How many queued prompts to take, oldest first. Omit to take the whole queue (at most 50).',
          },
          wait_ms: {
            type: 'integer',
            minimum: 0,
            maximum: READ_MESSAGES_MAX_WAIT_MS,
            description: `Long-poll: when the queue is empty, wait up to this many milliseconds (at most ${READ_MESSAGES_MAX_WAIT_MS}) for a prompt or cancel to arrive before answering, instead of returning an empty list at once. Cuts idle polling between steps; omit or 0 to return immediately.`,
          },
        },
      },
    },
    {
      name: 'reply_to_user',
      description: `${CLOSING_REPLY_GUIDANCE} The final reply is expected: it closes the task in the chat. Send a plain-text reply to the SurfCAD user for a prompt id this session received. Several replies may share one id, including non-final replies and a final reply after read_messages has acked that prompt. Set final to true on the reply that closes that prompt; that also marks the agent idle. Omit in_reply_to to post one plain-text message to this paired session when no prompt is waiting. That note is not a prompt id, is limited to one per second, and does not close a prompt. The text is delivered as text, never rendered as HTML. This does not write the model or git. An in_reply_to that was never delivered to this session is an error unknown_prompt and nothing is sent to the tab. A cancelled id returns { "ok": false, "error": "cancelled" } and is not delivered.`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          in_reply_to: {
            type: 'string',
            description: 'Prompt id this reply answers. Omit it to post a session message with no prompt. When set, it must be a prompt this session received (the id you were given, or one listed in read_messages recent). Any other id is unknown_prompt.',
          },
          text: {
            type: 'string',
            description: 'Plain text for the user. Not HTML. The closing reply (final: true) summarises what was done, or on failure or partial completion what was done, what failed and why, and what is left.',
          },
          final: {
            type: 'boolean',
            description: 'True on the closing reply that finishes the prompt. That reply is expected and summarises the result or the failure. Defaults to false.',
          },
        },
      },
    },
    {
      name: 'set_status',
      description: `Tell the SurfCAD tab which phase the user's prompt is in. responding (alias typing): you are reading or writing an answer; the chat stays open with bouncing dots. building (alias working): you are creating or editing geometry; the chat collapses and the field shows "Agent is working...". ${BUILDING_STATUS_GUIDANCE} Do not call building to list parts, faces, edges, or transforms, or for status or read_messages. A model-changing tool also enters building if you skip this call. A read never does. set_status is for progress and does not close the task. A partial reply does not leave building; the final reply, Stop, or a disconnect does. No activity for ${agentPromptStallMinutes()} minutes, while responding or building, shows the stall notice and leaves Stop up. The result state is the tab value (responding and typing are typing; building and working are working). Without id it targets the latest prompt. A cancelled id returns { ok: false, error: cancelled }. ${CLOSING_REPLY_GUIDANCE}`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: {
            type: 'string',
            enum: ['responding', 'building', 'idle', 'typing', 'working'],
            description: 'responding: bouncing dots, chat stays open (alias typing). building: you are creating or editing geometry and the field shows Agent is working (alias working). Call building only once you are actually modeling. idle: not responding or building. Idle does not close the task; a closing reply_to_user does.',
          },
          label: {
            type: 'string',
            maxLength: 120,
            description: 'Optional short text for the tab, for example what you are working on.',
          },
          working: {
            type: 'boolean',
            description: 'Legacy form of state: true is building (working), false is idle. Use state.',
          },
          id: {
            type: 'string',
            description: 'Optional prompt id this status refers to.',
          },
        },
      },
    },
    {
      name: 'post_progress',
      description: 'Tell SurfCAD you are working, without showing thinking text. Call it while you work, especially during long reasoning, so the phone folds the chat and the bot button spins. Optional text is accepted and discarded; it is never shown. This also keeps the session present. It does not close the task.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: {
            type: 'string',
            maxLength: 500,
            description: 'Optional note for yourself. It is not sent to the tab and is not shown.',
          },
        },
      },
    },
    {
      name: 'close_session',
      description: 'End this SurfCAD agent session. Call it once when you are done. The server marks the agent offline immediately. Do not call it on process exit, stdin end, or SIGTERM. A later tool call can start a new session.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
  ];
}

/**
 * @param {ReturnType<import('./promptSession.mjs').createPromptSession>} prompts
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
export async function callPromptTool(prompts, name, args) {
  if (name === 'register_webhook') {
    const result = await prompts.registerWebhook(args.url, args.bearer);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  if (name === 'unregister_webhook') {
    return { content: [{ type: 'text', text: JSON.stringify(prompts.unregisterWebhook(), null, 2) }] };
  }
  if (name === 'read_messages') {
    if (args.wait_ms != null) {
      const wait = Number(args.wait_ms);
      if (!Number.isInteger(wait) || wait < 0 || wait > READ_MESSAGES_MAX_WAIT_MS) {
        throw Object.assign(new Error(`wait_ms must be an integer from 0 to ${READ_MESSAGES_MAX_WAIT_MS}`), { code: 'bad_args' });
      }
      if (wait > 0 && typeof prompts.waitForMessage === 'function') await prompts.waitForMessage(wait);
    }
    const { messages, images } = prompts.readMessages(args.max);
    const recent = typeof prompts.recentPrompts === 'function' ? prompts.recentPrompts() : [];
    if (messages.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ messages: [], acked: [], recent }, null, 2) }],
      };
    }
    const content = [];
    const acked = [];
    for (let i = 0; i < messages.length; i += 1) {
      const row = messages[i];
      acked.push(row.id);
      content.push({ type: 'text', text: JSON.stringify(row, null, 2) });
      const image = images[i];
      if (image) content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
    }
    content.push({ type: 'text', text: JSON.stringify({ acked, recent }, null, 2) });
    return { content };
  }
  if (name === 'reply_to_user') {
    const result = await prompts.reply(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  if (name === 'set_status') {
    const result = await prompts.setStatus(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  if (name === 'post_progress') {
    const result = await prompts.postProgress(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  if (name === 'close_session') {
    const result = await prompts.closeSession();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'unknown_tool' });
}
