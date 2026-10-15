/** PNG data URL of the viewport. `format` may be omitted. */
export const screenshotCommand = Object.freeze({
  name: 'screenshot',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      format: {
        type: 'string',
        enum: ['png'],
        description: 'Image format. Omit to use png.',
      },
    },
  }),
  example: { format: 'png' },
  checkArgs(args) {
    if (args.format != null && args.format !== 'png') {
      return { code: 'unsupported_format', message: 'screenshot format must be png' };
    }
    return null;
  },
  async run(ctx, args) {
    const format = args.format == null ? 'png' : args.format;
    if (format !== 'png') {
      return { error: { code: 'unsupported_format', message: 'screenshot format must be png' } };
    }
    let png;
    try {
      png = await ctx.screenshot();
    } catch (err) {
      return { error: { code: 'screenshot_failed', message: String(err?.message || err) } };
    }
    if (typeof png !== 'string' || !png.startsWith('data:image/png')) {
      return { error: { code: 'screenshot_failed', message: 'screenshot failed' } };
    }
    return { result: { dataUrl: png } };
  },
});
