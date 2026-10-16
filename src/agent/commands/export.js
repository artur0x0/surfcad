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

const EXPORT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    format: {
      type: 'string',
      enum: ['stl', '3mf', 'step'],
      description: 'Export encoding for the part mesh.',
    },
    part_id: {
      type: 'string',
      description: 'Part id; defaults to the active CAD part.',
    },
    download: {
      type: 'boolean',
      description: 'When true, trigger a browser download instead of returning bytes.',
    },
  },
  required: ['format'],
});

function checkExportArgs(args) {
  const format = args?.format;
  if (!format || !['stl', '3mf', 'step'].includes(String(format).toLowerCase())) {
    return { code: 'bad_args', message: 'export_part needs format stl, 3mf, or step' };
  }
  if (args?.part_id != null && typeof args.part_id !== 'string') {
    return { code: 'bad_args', message: 'part_id must be a string' };
  }
  return null;
}

/** H16 — STL / 3MF / STEP bytes or browser download for a part mesh. */
export const exportPartCommand = Object.freeze({
  name: 'export_part',
  uiEntry: 'data-part-download',
  schema: EXPORT_SCHEMA,
  example: { format: '3mf' },
  checkArgs: checkExportArgs,
  async run(ctx, args) {
    return hostCall(ctx, 'agentExportPart', args || {});
  },
});

/** H16 — same as export_part with download: true (ribbon Download). */
export const exportDownloadCommand = Object.freeze({
  name: 'export_download',
  uiEntry: 'data-part-download',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      format: {
        type: 'string',
        enum: ['stl', '3mf', 'step'],
        description: 'Defaults to 3mf to match the Parts ribbon Download button.',
      },
      part_id: { type: 'string' },
    },
  }),
  example: { format: '3mf' },
  checkArgs(args) {
    if (args?.format != null) return checkExportArgs({ ...args, format: args.format });
    return null;
  },
  async run(ctx, args) {
    const format = args?.format ? String(args.format).toLowerCase() : '3mf';
    const gate = checkExportArgs({ format });
    if (gate) return { error: gate };
    return hostCall(ctx, 'agentExportPart', { ...args, format, download: true });
  },
});
