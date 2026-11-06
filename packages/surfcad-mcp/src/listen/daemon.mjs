/**
 * One listener per config directory: a pid file, a log file, and a detached
 * start for agents that set the listener up with one command and move on.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDir } from '../remote/config.mjs';

/** @param {NodeJS.ProcessEnv} [env] */
export function listenerPidPath(env = process.env) {
  return join(configDir(env), 'listener.pid');
}

/** @param {NodeJS.ProcessEnv} [env] */
export function listenerLogPath(env = process.env) {
  return join(configDir(env), 'listener.log');
}

/**
 * @param {number} pid
 * @param {(pid: number, signal: number) => void} [kill]
 */
export function pidAlive(pid, kill = process.kill.bind(process)) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists and belongs to someone else. Still alive.
    return Boolean(err && typeof err === 'object' && err.code === 'EPERM');
  }
}

/**
 * The pid of the running listener, or null. A pid file left by a listener
 * that died is removed.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ kill?: (pid: number, signal: number) => void }} [deps]
 * @returns {Promise<number | null>}
 */
export async function readListenerPid(env = process.env, deps = {}) {
  let text;
  try {
    text = await readFile(listenerPidPath(env), 'utf8');
  } catch {
    return null;
  }
  const pid = Number.parseInt(text.trim(), 10);
  if (pidAlive(pid, deps.kill)) return pid;
  await rm(listenerPidPath(env), { force: true });
  return null;
}

/**
 * @param {number} pid
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function writeListenerPid(pid, env = process.env) {
  const dir = configDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(listenerPidPath(env), `${pid}\n`, { mode: 0o600 });
  await chmod(listenerPidPath(env), 0o600);
}

/**
 * Remove the pid file if it still names `pid`.
 * @param {number} pid
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function clearListenerPid(pid, env = process.env) {
  try {
    const text = await readFile(listenerPidPath(env), 'utf8');
    if (Number.parseInt(text.trim(), 10) !== pid) return;
  } catch {
    return;
  }
  await rm(listenerPidPath(env), { force: true });
}

/**
 * Start `surfcad-mcp listen` as its own process group with its output in
 * the log file, and return at once.
 * @param {{ env?: NodeJS.ProcessEnv, spawn?: typeof nodeSpawn, bin?: string, args?: string[] }} [options]
 * @returns {Promise<{ pid: number | undefined, log: string }>}
 */
export async function startDetachedListener(options = {}) {
  const env = options.env || process.env;
  const spawn = options.spawn || nodeSpawn;
  const bin = options.bin || fileURLToPath(new URL('../../bin/surfcad-mcp.js', import.meta.url));
  const dir = configDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const log = listenerLogPath(env);
  const fd = openSync(log, 'a', 0o600);
  try {
    const child = spawn(process.execPath, [bin, 'listen', ...(options.args || [])], {
      detached: true,
      stdio: ['ignore', fd, fd],
      env,
      windowsHide: true,
    });
    child.unref?.();
    // The listener writes this itself once it is up. Writing it here too
    // means "running" is true the moment --detach returns, with no gap in
    // which a second start or a status read sees nothing. A child that dies
    // at once leaves a dead pid, and readListenerPid removes those.
    if (Number.isInteger(child.pid) && child.pid > 0) await writeListenerPid(child.pid, env);
    return { pid: child.pid, log };
  } finally {
    closeSync(fd);
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ kill?: (pid: number, signal: number | string) => void }} [deps]
 * @returns {Promise<{ stopped: boolean, pid: number | null }>}
 */
export async function stopListener(env = process.env, deps = {}) {
  const kill = deps.kill || process.kill.bind(process);
  const pid = await readListenerPid(env, { kill });
  if (!pid) return { stopped: false, pid: null };
  try {
    kill(pid, 'SIGTERM');
  } catch {
    /* gone between the check and the signal */
  }
  await rm(listenerPidPath(env), { force: true });
  return { stopped: true, pid };
}
