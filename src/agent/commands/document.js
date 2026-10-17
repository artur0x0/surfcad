import { ensureAgentGitWriteConsent } from './git.js';

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
    additionalProperties: false,
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
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      script: { type: 'string' },
      position: {
        type: 'array',
        items: { type: 'number' },
        minItems: 3,
        maxItems: 3,
        description:
          'Optional initial translation [x, y, z] mm. Agent create_part defaults to the assembly origin; UI creation still staggers along +X.',
      },
    },
  }),
  example: { name: 'Bracket' },
  async run(ctx, args) {
    return hostCall(ctx, 'agentCreatePart', args || {});
  },
});

export const renamePartCommand = Object.freeze({
  name: 'rename_part',
  uiEntry: 'data-part-name-input',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['part_id', 'name'],
    properties: {
      part_id: { type: 'string', description: 'Part row id from parts' },
      name: { type: 'string', description: 'New display name; a vault part also moves to <name>.js (-2, -3 on collision)' },
    },
  }),
  example: { part_id: 'parts/Bracket.js', name: 'Mount' },
  checkArgs(args) {
    if (!args?.part_id || typeof args.part_id !== 'string') {
      return { code: 'bad_args', message: 'rename_part needs part_id' };
    }
    if (typeof args?.name !== 'string' || !args.name.trim()) {
      return { code: 'bad_args', message: 'rename_part needs a non-empty name' };
    }
    return null;
  },
  async run(ctx, args) {
    const plan = typeof ctx.readAgentPartRename === 'function'
      ? ctx.readAgentPartRename(args.part_id)
      : { known: true, writesGit: false };
    if (!plan?.known) {
      return { error: { code: 'unknown_part', message: `Unknown part id: ${args.part_id}` } };
    }
    if (plan.writesGit) {
      const gate = ensureAgentGitWriteConsent(ctx, 'rename_part');
      if (gate) return { error: gate };
    }
    return hostCall(ctx, 'agentRenamePart', { partId: args.part_id, name: args.name.trim() });
  },
});

export const openAssemblyCommand = Object.freeze({
  name: 'open_assembly',
  uiEntry: ['data-part-open-action-assembly', 'data-git-open-replace'],
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
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
    additionalProperties: false,
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
    additionalProperties: false,
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
