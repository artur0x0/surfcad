function hostCall(ctx, name, args) {
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = fn(args);
  if (out?.then) {
    return out.then((resolved) => {
      if (resolved?.error) return { error: resolved.error };
      return { result: resolved?.result ?? resolved };
    });
  }
  if (out?.error) return { error: out.error };
  return { result: out?.result ?? out };
}

export const createAssemblyCommand = Object.freeze({
  name: 'create_assembly',
  uiEntry: 'data-part-add-kind-assembly',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {},
  }),
  example: {},
  async run(ctx) {
    return hostCall(ctx, 'agentCreateAssembly', {});
  },
});

export const createPartCommand = Object.freeze({
  name: 'create_part',
  uiEntry: 'data-part-add-kind-part',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {
      name: { type: 'string' },
      script: { type: 'string' },
    },
  }),
  example: { name: 'Bracket' },
  async run(ctx, args) {
    return hostCall(ctx, 'agentCreatePart', args || {});
  },
});

export const openAssemblyCommand = Object.freeze({
  name: 'open_assembly',
  uiEntry: ['data-part-open-action-assembly', 'data-git-open-replace'],
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'Vault assembly name' },
    },
  }),
  example: { name: 'my-assembly' },
  checkArgs(args) {
    if (!args?.name || typeof args.name !== 'string') {
      return { code: 'bad_args', message: 'open_assembly needs name' };
    }
    return null;
  },
  async run(ctx, args) {
    return hostCall(ctx, 'agentOpenAssembly', { name: args.name });
  },
});

export const openPartCommand = Object.freeze({
  name: 'open_part',
  uiEntry: 'data-part-open-action-part',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Vault part path' },
    },
  }),
  example: { path: 'parts/Bracket.js' },
  checkArgs(args) {
    if (!args?.path || typeof args.path !== 'string') {
      return { code: 'bad_args', message: 'open_part needs path' };
    }
    return null;
  },
  async run(ctx, args) {
    return hostCall(ctx, 'agentOpenPart', { path: args.path });
  },
});

export const insertPartCommand = Object.freeze({
  name: 'insert_part',
  uiEntry: 'data-git-open-insert',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {
      source_assembly: { type: 'string', description: 'Git vault assembly to insert from' },
      name: { type: 'string', description: 'Local: new part name (same as create_part)' },
      script: { type: 'string' },
    },
  }),
  example: { name: 'Pin' },
  async run(ctx, args) {
    if (args?.source_assembly) {
      return hostCall(ctx, 'agentInsertAssemblyParts', { sourceName: args.source_assembly });
    }
    return hostCall(ctx, 'agentCreatePart', args || {});
  },
});
