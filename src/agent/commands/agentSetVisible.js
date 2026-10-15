export const agentSetVisibleCommand = Object.freeze({
  name: 'agent_set_visible',
  schema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      enabled: { type: 'boolean', description: 'Turn operator-visible cues on or off' },
      stepDelayMs: { type: 'number', minimum: 0, description: 'Pause after each highlight (ms)' },
      cursor: { type: 'boolean' },
      highlight: { type: 'boolean' },
      ripple: { type: 'boolean' },
      easeCamera: { type: 'boolean', description: 'Ease camera_set pose changes' },
    },
  },
  example: { enabled: true, stepDelayMs: 400 },
  immediate: true,
  run(ctx, args) {
    const apply = ctx.setAgentVisible;
    if (typeof apply !== 'function') {
      return { error: { code: 'internal', message: 'setAgentVisible handler is missing' } };
    }
    const next = apply(args && typeof args === 'object' ? args : {});
    return { result: { options: next } };
  },
});
