const PNG = 'data:image/png';
const JPEG = 'data:image/jpeg';

function badArgs(message) {
  return { code: 'bad_args', message };
}

/**
 * Viewport image. Default (no args, or format png) is a full-size PNG data
 * URL. max_width / scale / jpeg are encoded in the browser. `save_to` is not
 * a browser argument — the MCP server strips it before the call.
 */
export const screenshotCommand = Object.freeze({
  name: 'screenshot',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      format: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: 'Image format. Omit for png, the historical default. jpeg is smaller.',
      },
      quality: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'jpeg quality from 0 to 1. Ignored for png. Default 0.8.',
      },
      max_width: {
        type: 'integer',
        minimum: 1,
        description: 'Downscale in the browser so the width is at most this many pixels. Does not upscale.',
      },
      scale: {
        type: 'number',
        exclusiveMinimum: 0,
        maximum: 1,
        description: 'Multiply width and height by this factor (0 exclusive to 1). Applied before max_width. Does not upscale.',
      },
    },
  }),
  example: { format: 'png' },
  checkArgs(args) {
    if (args.format != null && args.format !== 'png' && args.format !== 'jpeg') {
      return { code: 'unsupported_format', message: 'screenshot format must be png or jpeg' };
    }
    if (args.quality != null) {
      if (typeof args.quality !== 'number' || !Number.isFinite(args.quality) || args.quality < 0 || args.quality > 1) {
        return badArgs('screenshot quality must be a number from 0 to 1');
      }
    }
    if (args.max_width != null) {
      if (typeof args.max_width !== 'number' || !Number.isInteger(args.max_width) || args.max_width < 1) {
        return badArgs('screenshot max_width must be a positive integer');
      }
    }
    if (args.scale != null) {
      if (typeof args.scale !== 'number' || !Number.isFinite(args.scale) || args.scale <= 0 || args.scale > 1) {
        return badArgs('screenshot scale must be a number greater than 0 and at most 1');
      }
    }
    return null;
  },
  async run(ctx, args) {
    const format = args.format == null ? 'png' : args.format;
    if (format !== 'png' && format !== 'jpeg') {
      return { error: { code: 'unsupported_format', message: 'screenshot format must be png or jpeg' } };
    }
    const opts = { format };
    if (args.quality != null) opts.quality = args.quality;
    if (args.max_width != null) opts.max_width = args.max_width;
    if (args.scale != null) opts.scale = args.scale;
    let shot;
    try {
      shot = await ctx.screenshot(opts);
    } catch (err) {
      return { error: { code: 'screenshot_failed', message: String(err?.message || err) } };
    }
    const dataUrl = typeof shot === 'string' ? shot : shot?.dataUrl;
    const prefix = format === 'jpeg' ? JPEG : PNG;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) {
      return { error: { code: 'screenshot_failed', message: 'screenshot failed' } };
    }
    const result = { dataUrl };
    if (shot && typeof shot === 'object') {
      if (Number.isInteger(shot.width)) result.width = shot.width;
      if (Number.isInteger(shot.height)) result.height = shot.height;
      if (shot.format === 'png' || shot.format === 'jpeg') result.format = shot.format;
    }
    return { result };
  },
});
