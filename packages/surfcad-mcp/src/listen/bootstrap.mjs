/**
 * Wake bootstrap: after a pair or login the user can message the agent from
 * SurfCAD with no further setup, where the host makes that possible.
 *
 * SurfCAD cannot make up a way to start a turn of an agent. That exists only
 * on the agent's host. So the wake comes from one of two places, and the
 * user is never asked to paste a URL:
 *
 *   env    The host (or whoever installs this MCP server for it) puts the
 *          wake in the server's environment: SURFCAD_WAKE_POST (with
 *          SURFCAD_WAKE_BEARER) and/or SURFCAD_WAKE_EXEC. This is the
 *          host-provided path: an MCP server config has an `env` block, and
 *          that is the one channel a host has to this process.
 *   saved  `surfcad-mcp wake set` was run on this machine (the escape hatch).
 *
 * With a wake in hand the bootstrap starts the listener (server relay) and
 * greets: it fires the wake once per login with reason "greet", and the
 * session that starts says hello in the SurfCAD chat. That greeting is the
 * validation. It proves the whole path, wake to host to MCP to tab, with
 * something the user can see.
 *
 * With no wake, nothing is pretended: the state says cold wake is
 * unavailable, and the session that paired greets the user itself.
 */

import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configDir } from '../remote/config.mjs';
import { readSavedLogin } from '../remote/tokenStore.mjs';
import { readListenerPid, startDetachedListener } from './daemon.mjs';
import { createWaker, wakePayload } from './wake.mjs';
import {
  normalizeWakeBearer,
  normalizeWakeExec,
  normalizeWakeUrl,
  readWake,
  saveWake,
  wakeForms,
} from './wakeConfig.mjs';

/**
 * The wake the host put in this server's environment, or null. A value that
 * does not pass the `wake set` rules is left out and named in `problems`.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ config: import('./wakeConfig.mjs').WakeConfig | null, problems: string[] }}
 */
export function wakeFromEnv(env = process.env) {
  /** @type {import('./wakeConfig.mjs').WakeConfig} */
  const config = {};
  const problems = [];
  const text = (name) => (typeof env[name] === 'string' ? env[name].trim() : '');
  if (text('SURFCAD_WAKE_POST')) {
    try {
      const url = normalizeWakeUrl(text('SURFCAD_WAKE_POST'));
      const bearer = normalizeWakeBearer(text('SURFCAD_WAKE_BEARER'));
      config.post = bearer ? { url, bearer } : { url };
    } catch (err) {
      problems.push(`SURFCAD_WAKE_POST: ${err?.message || 'not a usable URL'}`);
    }
  }
  if (text('SURFCAD_WAKE_EXEC')) {
    try {
      config.exec = normalizeWakeExec(text('SURFCAD_WAKE_EXEC'));
    } catch (err) {
      problems.push(`SURFCAD_WAKE_EXEC: ${err?.message || 'not a usable command'}`);
    }
  }
  return { config: config.post || config.exec ? config : null, problems };
}

function sameWake(a, b) {
  const norm = (c) => JSON.stringify({ post: c?.post ? { url: c.post.url, bearer: c.post.bearer || '' } : null, exec: c?.exec || '' });
  return norm(a) === norm(b);
}

/**
 * The wake for this machine and where it came from. The environment wins: it
 * is what the host says now, and it is written to wake.json so the listener,
 * a separate process, uses the same one.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ config: import('./wakeConfig.mjs').WakeConfig | null, source: 'env' | 'saved' | null, problems: string[] }>}
 */
export async function provisionWake(env = process.env) {
  const fromEnv = wakeFromEnv(env);
  let saved = null;
  try {
    saved = await readWake(env);
  } catch {
    saved = null;
  }
  if (fromEnv.config) {
    if (!sameWake(fromEnv.config, saved)) {
      try {
        saved = await saveWake(fromEnv.config, env);
      } catch {
        return { config: fromEnv.config, source: 'env', problems: [...fromEnv.problems, 'The wake could not be saved for the listener.'] };
      }
    }
    return { config: saved || fromEnv.config, source: 'env', problems: fromEnv.problems };
  }
  return { config: saved, source: saved ? 'saved' : null, problems: fromEnv.problems };
}

/** @param {NodeJS.ProcessEnv} [env] */
export function wakeStatePath(env = process.env) {
  return join(configDir(env), 'wake-state.json');
}

/** A short one-way mark of a login. Never the token. */
function loginMark(token) {
  return createHash('sha256').update(String(token || 'local')).digest('hex').slice(0, 16);
}

async function readState(env) {
  try {
    const parsed = JSON.parse(await readFile(wakeStatePath(env), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeState(state, env) {
  try {
    await mkdir(configDir(env), { recursive: true, mode: 0o700 });
    await writeFile(wakeStatePath(env), `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await chmod(wakeStatePath(env), 0o600);
  } catch {
    /* a greeting sent twice is the worst that happens */
  }
}

/**
 * @typedef {{
 *   forms: string[],
 *   source: 'env' | 'saved' | null,
 *   listenerRunning: boolean,
 *   listenerStarted: boolean,
 *   coldWake: 'ready' | 'listener_stopped' | 'unavailable',
 *   greeting: 'sent_by_wake' | 'send_it_yourself' | 'already_sent' | 'wake_failed',
 *   problems: string[],
 * }} WakeBootstrap
 */

/**
 * Run after a successful pair or login.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   remote: boolean,
 *   greet?: boolean,
 *   selfGreet?: boolean,
 *   autoListen?: boolean,
 *   spawn?: any,
 *   fetch?: typeof fetch,
 *   waker?: ReturnType<typeof createWaker>,
 *   startListener?: typeof startDetachedListener,
 *   listenerPid?: typeof readListenerPid,
 * }} options
 * `remote`: this process is on the server relay (a saved login exists), so
 * the listener can run. `greet: false` skips the greeting (a status read).
 * `autoListen: false` reports the listener and does not start it.
 * `selfGreet: false`: the caller cannot tell a session to greet (the CLI, a
 * server start), so with no wake the greeting is left for the next pair.
 * @returns {Promise<WakeBootstrap>}
 */
export async function bootstrapWake(options) {
  const env = options.env || process.env;
  const listenerPid = options.listenerPid || readListenerPid;
  const { config, source, problems } = await provisionWake(env);
  const forms = wakeForms(config);

  let listenerRunning = false;
  let listenerStarted = false;
  let token = '';
  if (options.remote) {
    try {
      token = (await readSavedLogin(env))?.token || '';
    } catch {
      token = '';
    }
    listenerRunning = (await listenerPid(env)) != null;
    // A listener with no wake cannot start a turn, so it is not started.
    if (config && token && !listenerRunning && options.autoListen !== false) {
      try {
        await (options.startListener || startDetachedListener)({ env, spawn: options.spawn });
        listenerStarted = true;
        listenerRunning = (await listenerPid(env)) != null;
      } catch {
        problems.push('The listener could not be started. Run: npx surfcad-mcp listen --detach');
      }
    }
  }

  // Cold wake: something can start a turn while no agent process is up.
  // The local relay has no listener; there this process fires the wake, so
  // it holds only while the host keeps the process running.
  /** @type {WakeBootstrap['coldWake']} */
  let coldWake = 'unavailable';
  if (config) coldWake = !options.remote || listenerRunning ? 'ready' : 'listener_stopped';

  // One greeting per login: by the wake when there is one (that is the
  // check that it works), else by the session that just paired.
  /** @type {WakeBootstrap['greeting']} */
  let greeting = 'already_sent';
  if (options.greet !== false) {
    const mark = loginMark(options.remote ? token : 'local');
    const state = await readState(env);
    if (state.greeted !== mark) {
      const done = () => writeState({ ...state, greeted: mark, greetedAt: new Date().toISOString() }, env);
      if (!config) {
        if (options.selfGreet !== false) {
          greeting = 'send_it_yourself';
          await done();
        }
      } else {
        const waker = options.waker || createWaker(config, { env, fetch: options.fetch, spawn: options.spawn });
        const outcome = await waker.wake(wakePayload([], { reason: 'greet' }));
        if (outcome.ok) {
          greeting = 'sent_by_wake';
          await done();
        } else {
          // Not marked: the next pair tries the wake again.
          greeting = 'wake_failed';
          problems.push(`The wake did not fire (${outcome.error}).`);
          coldWake = 'unavailable';
        }
      }
    }
  }
  return { forms, source, listenerRunning, listenerStarted, coldWake, greeting, problems };
}
