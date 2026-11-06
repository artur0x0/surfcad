/**
 * "The agent is in a turn right now": the time of its last MCP tool call,
 * shared between surfcad-mcp processes on this machine through one small
 * file. The MCP server stamps it on every tool call. The listener reads it
 * before a wake.
 *
 * An agent in a turn is not woken. It reads the message at its next
 * read_messages, as the chat guide requires, and a wake on top of that would
 * start a second turn beside the first (with an exec wake, a second copy of
 * the agent). Once it has made no tool call for AWAKE_MS it counts as idle,
 * the same 60 s after which the tab shows it idle, and an unread message
 * wakes it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configDir } from '../remote/config.mjs';

/** No tool call for this long: the agent is idle and may be woken. */
export const AWAKE_MS = 60_000;
/** The stamp is rewritten at most this often. */
const STAMP_EVERY_MS = 5_000;

/** @param {NodeJS.ProcessEnv} [env] */
export function awakePath(env = process.env) {
  return join(configDir(env), 'awake');
}

let lastStampAt = 0;
let lastStampPath = '';

/**
 * Record a tool call. Best effort and throttled: a failure to write must
 * never fail the tool call.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {number} [now]
 */
export async function stampAwake(env = process.env, now = Date.now()) {
  const path = awakePath(env);
  if (path === lastStampPath && now - lastStampAt < STAMP_EVERY_MS) return;
  lastStampAt = now;
  lastStampPath = path;
  try {
    await mkdir(configDir(env), { recursive: true, mode: 0o700 });
    await writeFile(path, `${now}\n`, { mode: 0o600 });
  } catch {
    /* best effort */
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<number>} ms timestamp of the last tool call, 0 when none is recorded
 */
export async function lastAwakeAt(env = process.env) {
  try {
    const at = Number.parseInt((await readFile(awakePath(env), 'utf8')).trim(), 10);
    return Number.isFinite(at) && at > 0 ? at : 0;
  } catch {
    return 0;
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {number} [now]
 */
export async function agentAwake(env = process.env, now = Date.now()) {
  const at = await lastAwakeAt(env);
  return at > 0 && now - at >= 0 && now - at < AWAKE_MS;
}
