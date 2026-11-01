import { writeSync } from 'node:fs';

/**
 * Stderr lines for a remote stdio process that is about to exit.
 * stdout stays empty so MCP JSON-RPC is not mixed with diagnostics.
 * The bearer, a join code, and a long token-shaped run are not written.
 */

/**
 * Newlines and other controls become spaces so one exit stays one log line.
 * @param {string} text
 */
function singleLine(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    out += text.charCodeAt(i) < 32 ? ' ' : text[i];
  }
  return out;
}

/**
 * @param {unknown} value
 * @param {number} [max]
 */
export function clipExitDetail(value, max = 160) {
  let text = value instanceof Error ? (value.message || '') : String(value ?? '');
  text = text.replace(/Bearer\s+\S+/gi, '');
  text = text.replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, '');
  text = text.replace(/\b[A-Za-z0-9_-]{32,}\b/g, '');
  text = singleLine(text).replace(/\s+/g, ' ').trim();
  if (text.length > max) text = text.slice(0, max);
  return text;
}

/**
 * @param {string} cause
 * @param {unknown} [detail]
 */
export function formatProcessExitLine(cause, detail) {
  const name = clipExitDetail(cause) || 'unknown';
  const extra = detail == null || detail === '' ? '' : ` ${clipExitDetail(detail)}`;
  return `${new Date().toISOString()} [surfcad-mcp] process exit: ${name}${extra}\n`;
}

/**
 * @param {string} cause
 * @param {unknown} [detail]
 * @param {(fd: number, line: string) => void} [write]
 */
export function logProcessExit(cause, detail, write = writeSync) {
  try {
    write(2, formatProcessExitLine(cause, detail));
  } catch {
    /* stderr is already closed */
  }
}

/**
 * Same exit as the previous stdin handler: disconnect, then leave the
 * process on the next turn so a socket teardown can finish.
 * @param {{ disconnect?: () => void } | null | undefined} remote
 * @param {{
 *   log?: (cause: string, detail?: unknown) => void,
 *   exit?: (code: number) => void,
 * }} [deps]
 */
export function handleRemoteStdinEnd(remote, deps = {}) {
  const log = deps.log || logProcessExit;
  const exit = deps.exit || (() => {
    setTimeout(() => process.exit(0), 0).unref();
  });
  log('stdin end');
  remote?.disconnect?.();
  exit(0);
}

/**
 * @param {{
 *   log?: (cause: string, detail?: unknown) => void,
 *   kill?: (pid: number, signal: NodeJS.Signals) => void,
 *   exit?: (code: number) => void,
 * }} [deps]
 */
export function createRemoteExitHandlers(deps = {}) {
  const log = deps.log || logProcessExit;
  const kill = deps.kill || ((pid, signal) => process.kill(pid, signal));
  const exit = deps.exit || ((code) => process.exit(code));
  return {
    /**
     * Log, then raise the signal again with this handler gone so the
     * default disposition still ends the process.
     * @param {NodeJS.Signals} signal
     */
    onSignal(signal) {
      log(signal);
      kill(process.pid, signal);
    },
    /**
     * A listener replaces Node's default print-and-exit. The message is
     * clipped; the stack is not written because it can carry a request URL.
     * @param {unknown} err
     */
    onUncaught(err) {
      const message = err instanceof Error ? err.message : String(err ?? '');
      log('uncaughtException', message);
      exit(1);
    },
  };
}

/**
 * @param {{
 *   log?: (cause: string, detail?: unknown) => void,
 *   kill?: (pid: number, signal: NodeJS.Signals) => void,
 *   exit?: (code: number) => void,
 * }} [deps]
 * @returns {() => void} remove the listeners
 */
export function installRemoteProcessExitLogs(deps = {}) {
  const handlers = createRemoteExitHandlers(deps);
  const onTerm = () => {
    process.removeListener('SIGTERM', onTerm);
    handlers.onSignal('SIGTERM');
  };
  const onInt = () => {
    process.removeListener('SIGINT', onInt);
    handlers.onSignal('SIGINT');
  };
  process.once('SIGTERM', onTerm);
  process.once('SIGINT', onInt);
  process.once('uncaughtException', handlers.onUncaught);
  return function uninstall() {
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onInt);
    process.removeListener('uncaughtException', handlers.onUncaught);
  };
}
