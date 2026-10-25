import { requireDestructiveConfirm } from '../gitAgent.js';
import { rejectAssemblyId, rejectPartId } from '../state/identity.js';
import { withPlacementWarning } from '../state/unjointedParts.js';
import { positionLimitMessage, positionWithinLimit } from '../../utils/positionLimit.js';

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

/**
 * Fold a host run into the same result `run` returns: ok, errors, failures.
 * The part id stays on the result when the script fails.
 */
function attachRun(ctx, hosted) {
  if (hosted?.error) return hosted;
  const result = hosted?.result;
  if (!result || typeof result !== 'object' || !result.run) return hosted;
  const script = typeof result.script === 'string' ? result.script : '';
  const recorded = typeof ctx.remember === 'function'
    ? ctx.remember(result.run, script)
    : {
      ok: result.run.ok === true,
      errors: Array.isArray(result.run.errors) ? result.run.errors : [],
      failures: [],
      status: null,
    };
  return {
    result: {
      partId: result.partId ?? null,
      partCount: result.partCount ?? 0,
      ok: recorded.ok,
      errors: recorded.errors,
      failures: recorded.failures,
      ...(recorded.status ? { status: recorded.status } : {}),
    },
  };
}

export const createAssemblyCommand = Object.freeze({
  name: 'create_assembly',
  uiEntry: 'data-part-add-kind-assembly',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', description: 'Optional display label. Names are not unique and are not used as keys.' },
    },
  }),
  example: { name: 'Gearbox' },
  async run(ctx, args) {
    const name = typeof args?.name === 'string' ? args.name.trim() : '';
    return hostCall(ctx, 'agentCreateAssembly', name ? { name } : {});
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
          'Optional rough block-out translation [x, y, z] mm. Agent create_part defaults to the assembly origin; UI creation still staggers along +X. joint_create sets the final placement of a part that touches another. In an assembly of two or more parts, a position on a part that is in no joint returns warning unjointed_part and the call still succeeds.',
      },
    },
  }),
  example: { name: 'Bracket' },
  checkArgs(args) {
    if (args?.position != null && !positionWithinLimit(args.position)) {
      return { code: 'bad_args', message: `create_part ${positionLimitMessage('position')}` };
    }
    return null;
  },
  async run(ctx, args) {
    const hosted = attachRun(ctx, await hostCall(ctx, 'agentCreatePart', args || {}));
    return withPlacementWarning(ctx, hosted, hosted?.result?.partId, args?.position != null);
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
      part_id: { type: 'string', description: 'Part id from parts. Not a vault path.' },
      name: { type: 'string', description: 'New display name. Working copy only; Save writes the same f(id) file.' },
    },
  }),
  example: { part_id: '2026-10-07-20-56-31-0423-a3f9', name: 'Mount' },
  checkArgs(args) {
    const bad = rejectPartId(args?.part_id);
    if (bad) return bad;
    if (typeof args?.name !== 'string' || !args.name.trim()) {
      return { code: 'bad_args', message: 'rename_part needs a non-empty name' };
    }
    return null;
  },
  async run(ctx, args) {
    return hostCall(ctx, 'agentRenamePart', { partId: args.part_id, name: args.name.trim() });
  },
});

export const openAssemblyCommand = Object.freeze({
  name: 'open_assembly',
  uiEntry: ['data-part-open-action-assembly', 'data-git-open-replace'],
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['assembly_id'],
    properties: {
      assembly_id: { type: 'string', description: 'Assembly surf-id from list_assemblies. Not a name or path.' },
    },
  }),
  example: { assembly_id: '2026-10-18-02-50-00-0001-aa01' },
  checkArgs(args) {
    return rejectAssemblyId(args?.assembly_id);
  },
  async run(ctx, args) {
    return hostCall(ctx, 'agentOpenAssembly', { assemblyId: args.assembly_id });
  },
});

export const openPartCommand = Object.freeze({
  name: 'open_part',
  uiEntry: 'data-part-open-action-part',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      part_id: { type: 'string', description: 'Part surf-id to open by reference into the current assembly.' },
      assembly_id: { type: 'string', description: 'Assembly surf-id whose parts are opened by reference.' },
    },
  }),
  example: { part_id: '2026-10-07-20-56-31-0423-a3f9' },
  checkArgs(args) {
    if (args?.part_id != null) {
      const bad = rejectPartId(args.part_id);
      if (bad) return bad;
    }
    if (args?.assembly_id != null) {
      const bad = rejectAssemblyId(args.assembly_id);
      if (bad) return bad;
    }
    if (!args?.part_id && !args?.assembly_id) {
      return { code: 'bad_args', message: 'open_part needs part_id and/or assembly_id' };
    }
    return null;
  },
  async run(ctx, args) {
    return hostCall(ctx, 'agentOpenPart', {
      partId: args.part_id || null,
      assemblyId: args.assembly_id || null,
    });
  },
});

export const insertPartCommand = Object.freeze({
  name: 'insert_part',
  uiEntry: ['data-git-open-insert', 'data-part-add-instance'],
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      part_id: { type: 'string', description: 'Part surf-id to insert as a reference (same id).' },
      assembly_id: { type: 'string', description: 'Insert every part of this assembly as references.' },
      copy: { type: 'boolean', description: 'Mint a new part id and set copiedFrom (independent file).' },
      instance: {
        type: 'boolean',
        description: 'With part_id (a row of the open assembly): add another placement of that part. The new row shares its script, run and undo history (edit any one and all rebuild) and has its own id, name, pose and visibility. The result is the new row id; parts lists it with instanceOf.',
      },
      position: {
        type: 'array',
        items: { type: 'number' },
        minItems: 3,
        maxItems: 3,
        description: 'instance:true only: rough block-out translation [x, y, z] mm of the new row. Default staggers along +X like a UI-created part. joint_create sets the final placement when the instance touches another part. A position in an assembly of two or more parts returns warning unjointed_part when the new row is in no joint; the call still succeeds.',
      },
      name: { type: 'string', description: 'Local: new part name (same as create_part)' },
      script: { type: 'string' },
    },
  }),
  example: { part_id: '2026-10-07-20-56-31-0423-a3f9' },
  checkArgs(args) {
    if (args?.part_id != null) {
      const bad = rejectPartId(args.part_id);
      if (bad) return bad;
    }
    if (args?.assembly_id != null) {
      const bad = rejectAssemblyId(args.assembly_id);
      if (bad) return bad;
    }
    if (args?.instance === true && !args?.part_id) {
      return { code: 'bad_args', message: 'insert_part instance:true needs part_id (a row of the open assembly)' };
    }
    if (args?.position != null && !positionWithinLimit(args.position)) {
      return { code: 'bad_args', message: `insert_part ${positionLimitMessage('position')}` };
    }
    return null;
  },
  async run(ctx, args) {
    if (args?.instance === true) {
      const hosted = await hostCall(ctx, 'agentInsertPart', {
        partId: args.part_id,
        instance: true,
        position: Array.isArray(args.position) ? args.position : null,
      });
      return withPlacementWarning(ctx, hosted, hosted?.result?.partId, args?.position != null);
    }
    if (args?.part_id || args?.assembly_id) {
      return hostCall(ctx, 'agentInsertPart', {
        partId: args.part_id || null,
        assemblyId: args.assembly_id || null,
        copy: args?.copy === true,
      });
    }
    const hosted = attachRun(ctx, await hostCall(ctx, 'agentCreatePart', args || {}));
    return withPlacementWarning(ctx, hosted, hosted?.result?.partId, args?.position != null);
  },
});

export const listAssembliesCommand = Object.freeze({
  name: 'list_assemblies',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {},
  }),
  example: {},
  immediate: true,
  async run(ctx) {
    return hostCall(ctx, 'agentListAssemblies', {});
  },
});

export const deletePartCommand = Object.freeze({
  name: 'delete_part',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['part_id', 'scope'],
    properties: {
      part_id: { type: 'string', description: 'Part id from parts. Not a vault path.' },
      scope: {
        type: 'string',
        enum: ['assembly', 'repo'],
        description: 'assembly drops the row; repo also plans a file delete on the next Save.',
      },
      confirm: { type: 'boolean', description: 'Required true when scope is repo.' },
    },
  }),
  example: { part_id: '2026-10-07-20-56-31-0423-a3f9', scope: 'assembly' },
  checkArgs(args) {
    const bad = rejectPartId(args?.part_id);
    if (bad) return bad;
    if (args?.scope !== 'assembly' && args?.scope !== 'repo') {
      return { code: 'bad_args', message: 'delete_part scope must be assembly or repo' };
    }
    if (args.scope === 'repo') {
      const gate = requireDestructiveConfirm(args, 'delete_part scope repo');
      if (gate) return gate;
    }
    return null;
  },
  async run(ctx, args) {
    if (args.scope === 'repo') {
      const gate = requireDestructiveConfirm(args, 'delete_part scope repo');
      if (gate) return { error: gate };
    }
    return hostCall(ctx, 'agentDeletePart', {
      partId: args.part_id,
      scope: args.scope,
      confirm: args.confirm === true,
    });
  },
});

export const deleteAssemblyCommand = Object.freeze({
  name: 'delete_assembly',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['assembly_id'],
    properties: {
      assembly_id: { type: 'string', description: 'Assembly surf-id. Not a name or path.' },
      confirm: { type: 'boolean', description: 'Must be true.' },
      delete_parts: { type: 'boolean', description: 'When true, plan part-file deletes on the next Save if unreferenced.' },
    },
  }),
  example: { assembly_id: '2026-10-18-02-50-00-0001-aa01', confirm: true },
  checkArgs(args) {
    const bad = rejectAssemblyId(args?.assembly_id);
    if (bad) return bad;
    return requireDestructiveConfirm(args, 'delete_assembly');
  },
  async run(ctx, args) {
    const gate = requireDestructiveConfirm(args, 'delete_assembly');
    if (gate) return { error: gate };
    return hostCall(ctx, 'agentDeleteAssembly', {
      assemblyId: args.assembly_id,
      confirm: true,
      deleteParts: args.delete_parts === true,
    });
  },
});

export const renameAssemblyCommand = Object.freeze({
  name: 'rename_assembly',
  uiEntry: 'data-assembly-rename-menu',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['assembly_id', 'name'],
    properties: {
      assembly_id: { type: 'string', description: 'Assembly surf-id from parts / list_assemblies.' },
      name: { type: 'string', description: 'New display label. Working copy only; not unique.' },
    },
  }),
  example: { assembly_id: '2026-10-18-02-50-00-0001-aa01', name: 'Gearbox' },
  checkArgs(args) {
    const bad = rejectAssemblyId(args?.assembly_id);
    if (bad) return bad;
    if (typeof args?.name !== 'string' || !args.name.trim()) {
      return { code: 'bad_args', message: 'rename_assembly needs a non-empty name' };
    }
    return null;
  },
  async run(ctx, args) {
    return hostCall(ctx, 'agentRenameAssembly', {
      assemblyId: args.assembly_id,
      name: args.name.trim(),
    });
  },
});
