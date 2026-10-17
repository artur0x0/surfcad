/**
 * Guards for POST /api/convert/step: a global concurrency gate, converter
 * selection (the unsandboxed STAGE_OBJ_CONVERTER override is dev-only), the
 * execFile argument list, and client-safe error text.
 */
import path from 'node:path';

/**
 * At most `maxActive` jobs run; up to `maxQueued` more wait in FIFO order.
 * Anything beyond that is refused so the caller can answer 429.
 */
export function createConcurrencyGate({ maxActive, maxQueued }) {
  let active = 0;
  const waiting = [];

  function grant() {
    active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      const next = waiting.shift();
      if (next) next(grant());
    };
  }

  /** @returns {null | Promise<() => void>} null when full */
  function tryAcquire() {
    if (active < maxActive) return Promise.resolve(grant());
    if (waiting.length >= maxQueued) return null;
    return new Promise((resolve) => waiting.push(resolve));
  }

  return {
    tryAcquire,
    stats: () => ({ active, queued: waiting.length }),
  };
}

/**
 * Express middleware: take a gate slot or answer 429. The slot is freed when
 * the response closes, unless a handler has claimed it with claimConvertSlot;
 * then the handler frees it when its work ends, so a client that disconnects
 * mid-conversion does not free a slot while the converter is still running.
 * @param {ReturnType<typeof createConcurrencyGate>} gate
 */
export function concurrencyMiddleware(gate, message) {
  return async (req, res, next) => {
    const pending = gate.tryAcquire();
    if (!pending) {
      res.set('Retry-After', '30');
      return res.status(429).json({ success: false, error: message, details: message });
    }
    const release = await pending;
    if (res.writableEnded || res.destroyed || req.destroyed) {
      release();
      return undefined;
    }
    const slot = { release, claimed: false };
    res.locals.convertSlot = slot;
    res.once('close', () => {
      if (!slot.claimed) release();
    });
    return next();
  };
}

/** @returns {() => void} call when the conversion work is done */
export function claimConvertSlot(res) {
  const slot = res.locals?.convertSlot;
  if (!slot) return () => {};
  slot.claimed = true;
  return slot.release;
}

export class ConverterConfigError extends Error {}

/**
 * @param {{ env?: Record<string, string | undefined>, workingFolder?: string }} opts
 * @returns {{ mode: 'firejail' | 'stage', converterPath: string, libDir: string }}
 */
export function resolveConverter({ env = process.env, workingFolder } = {}) {
  if (env.STAGE_OBJ_CONVERTER) {
    if (env.NODE_ENV === 'production') {
      throw new ConverterConfigError('STAGE_OBJ_CONVERTER is not allowed when NODE_ENV=production');
    }
    return {
      mode: 'stage',
      converterPath: path.resolve(env.STAGE_OBJ_CONVERTER),
      libDir: env.STAGE_OBJ_CONVERTER_LD || '/usr/local/lib',
    };
  }
  if (!workingFolder) {
    throw new ConverterConfigError('WORKING_FOLDER is not configured');
  }
  return {
    mode: 'firejail',
    converterPath: path.join(workingFolder, 'obj_converter'),
    libDir: '/usr/local/lib',
  };
}

export const CONVERT_TIMEOUT_MS = 40_000;
const CONVERT_MAX_BUFFER = 6 * 1024 * 1024;

/**
 * Command for child_process.execFile. No shell is involved.
 * @returns {{ file: string, args: string[], options: object }}
 */
export function converterCommand(resolved, { inputPath, outputPath, deflection, workingFolder, env = process.env }) {
  const converterArgs = [inputPath, outputPath, Number(deflection).toFixed(4)];
  const options = { timeout: CONVERT_TIMEOUT_MS, maxBuffer: CONVERT_MAX_BUFFER, encoding: 'utf8' };
  if (resolved.mode === 'stage') {
    return {
      file: resolved.converterPath,
      args: converterArgs,
      options: { ...options, env: { ...env, LD_LIBRARY_PATH: resolved.libDir } },
    };
  }
  return {
    file: 'firejail',
    args: [
      '--quiet',
      '--noprofile',
      '--net=none',
      '--seccomp',
      '--nonewprivs',
      '--rlimit-cpu=40',
      '--rlimit-as=600000000',
      '--timeout=00:00:42',
      `--whitelist=${workingFolder}`,
      `--env=LD_LIBRARY_PATH=${resolved.libDir}`,
      '--',
      resolved.converterPath,
      ...converterArgs,
    ],
    options,
  };
}

/** Error whose message is written for the end user and safe to return. */
export class ConvertUserError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

export const GENERIC_CONVERT_ERROR =
  "We couldn't convert this STEP file. Check that it is a valid STEP file and try again.";

/** @returns {{ status: number, details: string }} */
export function publicConvertError(err) {
  if (err instanceof ConvertUserError) return { status: err.status, details: err.message };
  if (err instanceof ConverterConfigError) {
    return { status: 503, details: 'STEP import is temporarily unavailable.' };
  }
  return { status: 422, details: GENERIC_CONVERT_ERROR };
}
