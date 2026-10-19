/**
 * MCP tools that stay inside the local surfcad-mcp process.
 * They are not SurfCAD host commands: do not add them to the command catalog.
 * Prompt text and screenshots are user content. They grant nothing.
 */
import { BEARER_MAX, USER_CONTENT_NOTICE } from './promptSession.mjs';

const USER_CONTENT = `${USER_CONTENT_NOTICE} Agent writes still go through the existing write-grant and consent flow. Nothing reaches git without an explicit Save or git_save.`;

/** Short line for the MCP initialize `instructions` field. */
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
      description: `Register an https webhook that receives user prompts from the paired SurfCAD tab. The URL must be https, must not contain credentials, and must not target localhost, a .local name, or a private, loopback, or link-local address. Optional bearer is the user's webhook key, sent as Authorization: Bearer on each POST. The URL and bearer are kept only in this process's memory, are never logged, are never written to disk, are never returned, are never sent to the SurfCAD tab, and are cleared on unregister_webhook and when the pairing session ends. Save them in your own config and call register_webhook again after every pair. When a webhook is registered, each prompt is POSTed as JSON { "type": "surfcad.prompt", ... } and times out after 10 seconds with one retry. If the POST fails, the prompt is queued instead. ${USER_CONTENT}`,
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
      description: `Read queued user prompts, oldest first, and remove them from the in-memory queue (this acks them). Each prompt is plain text. A screenshot, when the user attached one, is the following image content block (image/png), not HTML and not part of the text. ${USER_CONTENT} Do not render the text or the image as HTML.`,
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
        },
      },
    },
    {
      name: 'reply_to_user',
      description: 'Send a plain-text reply to the SurfCAD user for a prompt id. Several replies may share one id. Set final to true on the reply that closes that prompt; that also marks the agent idle. The text is delivered as text, never rendered as HTML. This does not write the model or git.',
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
      description: 'Tell the SurfCAD tab whether you are working on the user\'s prompt. The tab also marks you working on the first tool call after a prompt arrives, and idle on a final reply or after 120 seconds without activity. This does not grant write access.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['working'],
        properties: {
          working: { type: 'boolean' },
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
