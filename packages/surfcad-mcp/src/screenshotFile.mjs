import { randomBytes } from 'node:crypto';
import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

const BROWSER_KEYS = ['format', 'quality', 'max_width', 'scale'];

/**
 * Browser-safe screenshot args. File paths stay on the MCP host.
 * @param {Record<string, unknown>} args
 */
export function browserScreenshotArgs(args) {
  const out = {};
  const src = args && typeof args === 'object' ? args : {};
  for (const key of BROWSER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key];
  }
  return out;
}

function interpretSaveValue(value, key) {
  if (value === true) return { path: null };
  if (typeof value === 'string') {
    if (value.includes('\0')) {
      return { error: { code: 'bad_args', message: `screenshot ${key} has an invalid path` } };
    }
    const trimmed = value.trim();
    if (!trimmed) return { path: null };
    return { path: isAbsolute(trimmed) ? resolve(trimmed) : resolve(trimmed) };
  }
  return { error: { code: 'bad_args', message: `screenshot ${key} must be a file path or true` } };
}

/**
 * Split a screenshot tool call into browser args and an optional host save.
 * `save` is null when the caller did not ask to write a file (historical
 * default: the data URL is returned as-is).
 * @param {Record<string, unknown>} args
 */
export function prepareScreenshotCall(args) {
  const src = args && typeof args === 'object' ? args : {};
  const browserArgs = browserScreenshotArgs(src);
  const hasTo = Object.prototype.hasOwnProperty.call(src, 'save_to');
  const hasFile = Object.prototype.hasOwnProperty.call(src, 'file');
  if (!hasTo && !hasFile) return { browserArgs, save: null };
  const left = hasTo ? interpretSaveValue(src.save_to, 'save_to') : null;
  const right = hasFile ? interpretSaveValue(src.file, 'file') : null;
  if (left?.error) return { browserArgs, error: left.error };
  if (right?.error) return { browserArgs, error: right.error };
  const pathA = left ? left.path : null;
  const pathB = right ? right.path : null;
  if (pathA && pathB && pathA !== pathB) {
    return {
      browserArgs,
      error: { code: 'bad_args', message: 'screenshot save_to and file must be the same path' },
    };
  }
  return {
    browserArgs,
    save: {
      path: pathA || pathB || null,
      overwrite: src.overwrite === true,
    },
  };
}

function extensionFor(format) {
  return format === 'jpeg' ? '.jpg' : '.png';
}

function uniqueName(format) {
  return `surfcad-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}${extensionFor(format)}`;
}

async function exists(path) {
  try {
    return await stat(path);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

async function uniqueSibling(desired) {
  const dir = dirname(desired);
  const ext = extname(desired);
  const base = basename(desired, ext);
  for (let n = 2; n < 1000; n += 1) {
    const candidate = join(dir, `${base}-${n}${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  return join(dir, `${base}-${randomBytes(4).toString('hex')}${ext}`);
}

/**
 * @param {{ path: string|null, overwrite: boolean }} save
 * @param {'png'|'jpeg'} format
 */
export async function resolveScreenshotDestination(save, format) {
  if (!save?.path) return join(tmpdir(), uniqueName(format));
  const wanted = save.path;
  const current = await exists(wanted);
  if (current?.isDirectory()) return join(wanted, uniqueName(format));
  const parent = dirname(wanted);
  const parentStat = await exists(parent);
  if (!parentStat?.isDirectory()) {
    const err = new Error(`screenshot save directory does not exist: ${parent}`);
    err.code = 'screenshot_save_failed';
    throw err;
  }
  if (current && !save.overwrite) return uniqueSibling(wanted);
  if (!extname(wanted)) return `${wanted}${extensionFor(format)}`;
  return wanted;
}

function decodeDataUrl(dataUrl) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!match) {
    const err = new Error('screenshot did not return a png or jpeg data URL');
    err.code = 'screenshot_save_failed';
    throw err;
  }
  const format = match[1].toLowerCase() === 'jpeg' ? 'jpeg' : 'png';
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  return { format, bytes };
}

async function writeBytes(path, bytes, overwrite) {
  if (overwrite) {
    await writeFile(path, bytes);
    return path;
  }
  let handle;
  try {
    handle = await open(path, 'wx');
    await handle.writeFile(bytes);
    return path;
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
    const next = await uniqueSibling(path);
    return writeBytes(next, bytes, false);
  } finally {
    await handle?.close();
  }
}

/**
 * Write the browser image and return path + size. Never includes the data URL.
 * @param {{ dataUrl?: string, width?: number, height?: number }} result
 * @param {{ path: string|null, overwrite: boolean }} save
 */
export async function writeScreenshotResult(result, save) {
  const decoded = decodeDataUrl(result?.dataUrl);
  const path = await resolveScreenshotDestination(save, decoded.format);
  await mkdir(dirname(path), { recursive: false }).catch((err) => {
    if (err?.code !== 'EEXIST') throw err;
  });
  const written = await writeBytes(path, decoded.bytes, save.overwrite === true && path === save.path);
  const saved = {
    path: written,
    size: decoded.bytes.length,
    format: decoded.format,
  };
  if (Number.isInteger(result?.width)) saved.width = result.width;
  if (Number.isInteger(result?.height)) saved.height = result.height;
  return saved;
}

/**
 * Screenshot tool call after the session is paired. Other tools pass through.
 * @param {{ call: (name: string, args: object) => Promise<unknown> }} session
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
export async function callPairedBridgeTool(session, name, args) {
  let forward = args && typeof args === 'object' ? args : {};
  let save = null;
  if (name === 'screenshot') {
    const prepared = prepareScreenshotCall(forward);
    if (prepared.error) return { value: prepared.error, isError: true };
    forward = prepared.browserArgs;
    save = prepared.save;
  }
  const result = await session.call(name, forward);
  if (!save) return { value: result, isError: false };
  try {
    const saved = await writeScreenshotResult(result, save);
    return { value: saved, isError: false };
  } catch (err) {
    return {
      value: {
        code: err?.code || 'screenshot_save_failed',
        message: String(err?.message || err),
      },
      isError: true,
    };
  }
}

/**
 * Add MCP-only file options to the screenshot tool. The browser catalog
 * does not list them, and they are stripped before the tab is called.
 * @param {{ name: string, description?: string, inputSchema?: object }} tool
 */
export function augmentScreenshotTool(tool) {
  if (!tool || tool.name !== 'screenshot') return tool;
  const inputSchema = JSON.parse(JSON.stringify(tool.inputSchema || {
    type: 'object',
    additionalProperties: false,
    properties: {},
  }));
  inputSchema.properties = {
    ...(inputSchema.properties || {}),
    save_to: {
      description: 'Write the image on the MCP host and return { path, size } instead of base64. A string is a file path. true or "" uses a unique file in the OS temp directory. Never sent to the browser.',
      anyOf: [{ type: 'string' }, { type: 'boolean' }],
    },
    file: {
      description: 'Alias of save_to.',
      anyOf: [{ type: 'string' }, { type: 'boolean' }],
    },
    overwrite: {
      type: 'boolean',
      description: 'Replace an existing file at save_to. Without this, an existing path gets a unique name.',
    },
  };
  return {
    ...tool,
    description: `${tool.description || 'Capture the viewport.'} On the MCP host, save_to or file writes the image to disk and returns { path, size } instead of base64. A missing path (true or "") uses a unique file in the OS temp directory. An existing file is not replaced unless overwrite is true. The path is never sent to the browser.`,
    inputSchema,
  };
}
