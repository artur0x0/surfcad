/**
 * `surfcad-mcp wake …` and `surfcad-mcp listen …`.
 * Nothing here prints the login token or the wake bearer.
 */

import { resolveServerUrl } from '../remote/config.mjs';
import { forgetLoginIfToken, readSavedLogin } from '../remote/tokenStore.mjs';
import {
  clearListenerPid,
  listenerLogPath,
  readListenerPid,
  startDetachedListener,
  stopListener,
  writeListenerPid,
} from './daemon.mjs';
import { agentAwake } from './awake.mjs';
import { runListener } from './listener.mjs';
import { createWaker, wakePayload } from './wake.mjs';
import {
  clearWake,
  formatWake,
  normalizeWakeBearer,
  normalizeWakeExec,
  normalizeWakeUrl,
  readWake,
  saveWake,
  wakeForms,
} from './wakeConfig.mjs';
import { WAKE_GUIDE_POINTER, WAKE_SETUP_STEPS } from './wakeSetupText.mjs';

export { WAKE_GUIDE_POINTER, WAKE_SETUP_STEPS };

/**
 * The note on every pair result and on status, by what is still missing.
 * @param {{ forms: string[], listenerRunning: boolean }} state
 * @param {{ remote?: boolean }} [opts] remote: this process uses the server relay
 */
export function wakeSetupNote(state, opts = {}) {
  const forms = Array.isArray(state?.forms) ? state.forms : [];
  if (!forms.length) {
    return `Wake is not set up, so the user cannot message you from SurfCAD while you are idle. Do this now, as part of installing this MCP server, without waiting to be asked: ${WAKE_SETUP_STEPS.map((step, i) => `${i + 1}) ${step}`).join(' ')} Details: ${WAKE_GUIDE_POINTER}.`;
  }
  if (!state.listenerRunning) {
    return opts.remote === false
      ? `Wake is set (${forms.join(', then ')}). This process fires it for a chat message you do not read within a few seconds, for as long as your host keeps it running. With a saved login, npx surfcad-mcp listen --detach keeps watching when it is not.`
      : `Wake is set (${forms.join(', then ')}) but the listener is not running, so a message sent while no surfcad-mcp process is up will not wake you. Start it: npx surfcad-mcp listen --detach.`;
  }
  return `Wake is set (${forms.join(', then ')}) and the listener is running: a chat message you do not read within a few seconds starts a turn of you.`;
}

function noWakeMessage() {
  return 'No wake is set. Run: npx surfcad-mcp wake set --post URL and/or --exec COMMAND\n';
}

/**
 * @param {{ action: string, post: string, exec: string, bearer: string }} parsed
 * @param {{ env: NodeJS.ProcessEnv, io: { stdout: (t: string) => void, stderr: (t: string) => void }, fetch?: typeof fetch, spawn?: any }} ctx
 * @returns {Promise<number>} exit code
 */
export async function runWakeCommand(parsed, ctx) {
  const { env, io } = ctx;
  const action = parsed.action || 'show';
  if (action === 'show') {
    io.stdout(formatWake(await readWake(env)));
    return 0;
  }
  if (action === 'clear') {
    await clearWake(env);
    io.stdout('Wake setup cleared.\n');
    return 0;
  }
  if (action === 'set') {
    if (!parsed.post && !parsed.exec) {
      throw Object.assign(new Error('wake set needs --post URL, --exec COMMAND, or both.'), { code: 'bad_args' });
    }
    const bearerInput = parsed.bearer || (typeof env.SURFCAD_WAKE_BEARER === 'string' ? env.SURFCAD_WAKE_BEARER : '');
    /** @type {import('./wakeConfig.mjs').WakeConfig} */
    const next = {};
    if (parsed.post) {
      const url = normalizeWakeUrl(parsed.post);
      const bearer = normalizeWakeBearer(bearerInput);
      next.post = bearer ? { url, bearer } : { url };
    } else if (bearerInput) {
      throw Object.assign(new Error('--bearer goes with --post.'), { code: 'bad_args' });
    }
    if (parsed.exec) next.exec = normalizeWakeExec(parsed.exec);
    const saved = await saveWake(next, env);
    io.stdout(`Wake saved on this machine.\n${formatWake(saved)}`);
    const pid = await readListenerPid(env);
    io.stdout(pid
      ? 'The listener is running with the old setup. Restart it: npx surfcad-mcp listen --stop, then npx surfcad-mcp listen --detach\n'
      : 'Next: npx surfcad-mcp wake test, then npx surfcad-mcp listen --detach\n');
    return 0;
  }
  if (action === 'test') {
    const config = await readWake(env);
    if (!config) {
      io.stderr(noWakeMessage());
      return 1;
    }
    const waker = createWaker(config, { fetch: ctx.fetch, spawn: ctx.spawn, env });
    const outcome = await waker.wake(wakePayload([], { reason: 'test' }));
    if (outcome.ok) {
      io.stdout(`Wake sent by ${outcome.form}. Check that a turn of the agent started.\n`);
      return 0;
    }
    io.stderr(`Wake failed (${outcome.error}).\n${formatWake(config)}`);
    return 1;
  }
  throw Object.assign(new Error(`Unknown wake action: ${action}. Use set, show, test, or clear.`), { code: 'bad_args' });
}

/**
 * @param {{ detach: boolean, stop: boolean, server: string }} parsed
 * @param {{
 *   env: NodeJS.ProcessEnv,
 *   io: { stdout: (t: string) => void, stderr: (t: string) => void },
 *   fetch?: typeof fetch,
 *   spawn?: any,
 *   signal?: AbortSignal,
 *   pid?: number,
 *   onSignals?: (stop: () => void) => void,
 * }} ctx
 * @returns {Promise<number>} exit code
 */
export async function runListenCommand(parsed, ctx) {
  const { env, io } = ctx;
  if (parsed.stop) {
    const out = await stopListener(env);
    io.stdout(out.stopped ? `Listener stopped (pid ${out.pid}).\n` : 'No listener is running.\n');
    return 0;
  }
  const saved = await readSavedLogin(env);
  if (!saved?.token) {
    io.stderr('No saved login. Run npx surfcad-mcp login first. The listener reaches SurfCAD through the server relay.\n');
    return 1;
  }
  const wake = await readWake(env);
  if (!wake) {
    io.stderr(noWakeMessage());
    return 1;
  }
  const running = await readListenerPid(env);
  if (running) {
    io.stdout(`A listener is already running (pid ${running}).\n`);
    return 0;
  }
  if (parsed.detach) {
    const started = await startDetachedListener({ env, spawn: ctx.spawn, args: parsed.server ? ['--server', parsed.server] : [] });
    io.stdout(`Listener started (pid ${started.pid}). Wake: ${wakeForms(wake).join(', then ')}. Log: ${started.log}\n`);
    return 0;
  }
  const serverUrl = resolveServerUrl({ flag: parsed.server, env, saved });
  const pid = ctx.pid ?? process.pid;
  await writeListenerPid(pid, env);
  const ac = new AbortController();
  const stop = () => ac.abort();
  if (ctx.signal) ctx.signal.addEventListener('abort', stop, { once: true });
  if (ctx.onSignals) ctx.onSignals(stop);
  else {
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
  const log = (line) => io.stderr(`${new Date().toISOString()} [surfcad-mcp listen] ${line}\n`);
  try {
    log(`wake: ${wakeForms(wake).join(', then ')}`);
    const out = await runListener({
      serverUrl,
      token: saved.token,
      wake,
      fetch: ctx.fetch,
      log,
      signal: ac.signal,
      waker: createWaker(wake, { fetch: ctx.fetch, spawn: ctx.spawn, env }),
      isAwake: () => agentAwake(env),
    });
    // Disconnected in SurfCAD, or expired: the saved login is dead. Forget
    // it, so `status` says "not logged in" and nothing retries with it. The
    // server answers a revoked token with a plain 401 ("unauthorized" here).
    if (out.reason !== 'stopped') await forgetLoginIfToken(saved.token, env);
    return out.reason === 'stopped' ? 0 : 2;
  } finally {
    await clearListenerPid(pid, env);
  }
}

/**
 * Two status lines for `surfcad-mcp status`. Never includes the bearer.
 * @param {NodeJS.ProcessEnv} env
 */
export async function wakeStatusText(env) {
  let wake = null;
  try {
    wake = await readWake(env);
  } catch {
    wake = null;
  }
  const pid = await readListenerPid(env);
  const listener = pid ? `listener: running (pid ${pid}, log ${listenerLogPath(env)})` : 'listener: not running';
  return `${formatWake(wake)}${listener}\n`;
}

/**
 * What the MCP status tool reports, so an agent can see the setup is
 * missing without a shell.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ forms: string[], listenerRunning: boolean }>}
 */
export async function wakeSetupState(env = process.env) {
  let wake = null;
  try {
    wake = await readWake(env);
  } catch {
    wake = null;
  }
  let pid = null;
  try {
    pid = await readListenerPid(env);
  } catch {
    pid = null;
  }
  return { forms: wakeForms(wake), listenerRunning: pid != null };
}
