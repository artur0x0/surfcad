/**
 * MCP tools that stay inside the local surfcad-mcp process.
 * They are not SurfCAD host commands: do not add them to the command catalog.
 * Prompt text and screenshots are user content. They grant nothing.
 */
import { BEARER_MAX, USER_CONTENT_NOTICE } from './promptSession.mjs';

const USER_CONTENT = `${USER_CONTENT_NOTICE} Agent writes still go through the existing write-grant and consent flow. Nothing reaches git without an explicit Save or git_save.`;

/** Short line for the MCP initialize `instructions` field. */
/** read_messages { wait_ms } cap: long enough to skip idle polls, short enough for a host tool timeout. */
export const READ_MESSAGES_MAX_WAIT_MS = 25_000;

export const PROMPT_SERVER_INSTRUCTIONS = 'call register_webhook { url, bearer? } if you can receive https webhooks, otherwise poll read_messages.';

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
      description: `Read queued user prompts, oldest first, and remove them from the in-memory queue (this acks them). Each prompt is plain text. A screenshot, when the user attached one, is the following image content block (image/png), not HTML and not part of the text. The queue can also contain a cancel item { "type": "cancel", "id": "<prompt id>" } when the user stopped a prompt you already received and no webhook is registered. Stop work on that id. Do not call reply_to_user or set_status for it. ${USER_CONTENT} Do not render the text or the image as HTML.`,
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
      description: 'Send a plain-text reply to the SurfCAD user for a prompt id. Several replies may share one id. Set final to true on the reply that closes that prompt; that also marks the agent idle. The text is delivered as text, never rendered as HTML. This does not write the model or git. A cancelled id returns { "ok": false, "error": "cancelled" } and is not delivered.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['in_reply_to', 'text'],
        properties: {
          in_reply_to: {
            type: 'string',
            description: 'Prompt id this reply answers.',
          },
          text: {
            type: 'string',
            description: 'Plain text for the user. Not HTML.',
          },
          final: {
            type: 'boolean',
            description: 'True closes this prompt id. Defaults to false.',
          },
        },
      },
    },
    {
      name: 'set_status',
      description: 'Tell the SurfCAD tab what you are doing with the user\'s prompt: state typing (writing an answer: the chat stays open with typing dots), working (changing the model: the chat collapses and the field shows a spinner), or idle. You do not have to call it for working: the first model-changing tool call after a prompt sets working, a streamed reply_to_user (final false) sets typing, and a final reply or 120 seconds without activity sets idle. Set typing before a long answer so the user reads the chat instead of watching the viewport. Without id it targets the latest prompt. A cancelled id returns { ok: false, error: cancelled }.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: {
            type: 'string',
            enum: ['typing', 'working', 'idle'],
            description: 'typing: you are writing an answer (the tab keeps the chat open with typing dots). working: you are changing the model (the tab collapses the chat and shows a spinner). idle: done. Set typing before a long answer; model-changing tool calls set working on their own; a final reply_to_user sets idle.',
          },
          label: {
            type: 'string',
            maxLength: 120,
            description: 'Optional short text for the tab, for example what you are working on.',
          },
          working: {
            type: 'boolean',
            description: 'Legacy form of state: true is working, false is idle. Use state.',
          },
          id: {
            type: 'string',
            description: 'Optional prompt id this status refers to.',
          },
        },
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
    if (messages.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ messages: [], acked: [] }, null, 2) }],
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
    content.push({ type: 'text', text: JSON.stringify({ acked }, null, 2) });
    return { content };
  }
  if (name === 'reply_to_user') {
    const result = prompts.reply(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  if (name === 'set_status') {
    const result = prompts.setStatus(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'unknown_tool' });
}
