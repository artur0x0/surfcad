import { AGENT_PROMPT_MAX_CHARS } from '../agentPromptStub.js';

export const agentPromptCommand = Object.freeze({
  name: 'agent_prompt',
  uiEntry: [
    'data-agent-prompt-send',
    'data-agent-prompt-stop',
    'data-agent-prompt-dismiss',
    'data-agent-prompt-screenshot',
  ],
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        maxLength: AGENT_PROMPT_MAX_CHARS,
        description: 'Prompt text to send to the paired agent',
      },
      action: {
        type: 'string',
        enum: ['send', 'stop', 'dismiss', 'screenshot'],
        description: 'send is the default when text is present',
      },
    },
  },
  example: { text: 'Add a 2 mm fillet on the cut-out corners', action: 'send' },
  immediate: true,
  run(ctx, args) {
    const fn = ctx.agentPrompt;
    if (typeof fn !== 'function') {
      return { error: { code: 'internal', message: 'agentPrompt handler is missing' } };
    }
    const out = fn(args && typeof args === 'object' ? args : {});
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? out ?? { ok: true } };
  },
});
