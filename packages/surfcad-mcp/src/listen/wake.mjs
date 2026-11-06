/**
 * Fire a saved wake action.
 *
 * post  POST the wake JSON. 10 s timeout, one retry, redirects not followed.
 * exec  run the saved command through the shell with the wake JSON on stdin.
 *
 * The command line is the saved text and nothing else. Message text goes to
 * stdin only: never into argv and never into the environment, so a chat
 * message cannot become shell syntax. The environment gets the prompt ids
 * (opaque, server-made) and the reason.
 *
 * Forms are tried in order, post then exec, and the first that works is the
 * wake. Firing both would start two agent turns for one message.
 */

import { spawn as nodeSpawn } from 'node:child_process';

export const WAKE_POST_TIMEOUT_MS = 10_000;
export const WAKE_POST_ATTEMPTS = 2;

/** What the woken agent should do. Short, and the same for every host. */
export const WAKE_INSTRUCTION = 'A SurfCAD user sent you a chat message and this is a new session started to answer it. On the surfcad MCP server call read_messages { wait_ms: 10000 }, then follow guide { topic: "chat" }: set_status responding first, then reply_to_user. You have no memory of earlier sessions: the message is in "prompts", status gives the open part, and guide { topic: "start" } says how to build.';

/** What the agent says when it is first connected. Artur's wording, 2026-11-06. */
export const WAKE_GREETING = 'Hi, what can I help you design?';

/**
 * The greeting wake. It fires once per login, right after pairing, and it is
 * the check that the wake works: the session it starts says hello in the
 * SurfCAD chat, where the user sees it.
 */
export const WAKE_GREET_INSTRUCTION = `You were just connected to SurfCAD and this is a new session started to greet the user. On the surfcad MCP server call reply_to_user { text: "${WAKE_GREETING}" } with no in_reply_to. Then follow guide { topic: "chat" }: wait for their message with read_messages { wait_ms: 10000 }. Read guide { topic: "start" } before the first model call.`;

const WAKE_TEST_INSTRUCTION = 'This is a test of the SurfCAD wake setup. No user message is waiting.';

/**
 * @param {Array<{ id: string, text?: string, ts?: string, screenshot?: unknown }>} prompts
 * @param {{ reason?: 'prompt' | 'test' | 'greet' }} [opts]
 */
export function wakePayload(prompts, opts = {}) {
  const reason = opts.reason === 'test' || opts.reason === 'greet' ? opts.reason : 'prompt';
  let instruction = WAKE_INSTRUCTION;
  if (reason === 'test') instruction = WAKE_TEST_INSTRUCTION;
  if (reason === 'greet') instruction = WAKE_GREET_INSTRUCTION;
  return {
    type: 'surfcad.wake',
    v: 1,
    reason,
    instruction,
    ...(reason === 'greet' ? { greeting: WAKE_GREETING } : {}),
    prompts: (Array.isArray(prompts) ? prompts : []).map((p) => ({
      id: String(p.id),
      ...(typeof p.text === 'string' ? { text: p.text } : {}),
      ...(typeof p.ts === 'string' ? { ts: p.ts } : {}),
      // The picture stays on the server for read_messages. A wake is small.
      ...(p.screenshot ? { hasScreenshot: true } : {}),
    })),
  };
}

/**
 * @param {{ url: string, bearer?: string }} post
 * @param {object} payload
 * @param {{ fetch?: typeof fetch, timeoutMs?: number, attempts?: number }} [deps]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function postWake(post, payload, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const timeoutMs = deps.timeoutMs ?? WAKE_POST_TIMEOUT_MS;
  const attempts = deps.attempts ?? WAKE_POST_ATTEMPTS;
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (post.bearer) headers.authorization = `Bearer ${post.bearer}`;
  const body = JSON.stringify(payload);
  let error = 'wake_post_failed';
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await doFetch(post.url, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      try { await res.body?.cancel?.(); } catch { /* noop */ }
      if (res.status >= 200 && res.status < 300) return { ok: true };
      error = `wake_post_status_${res.status}`;
    } catch (err) {
      error = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'wake_post_timeout' : 'wake_post_failed';
    }
  }
  return { ok: false, error };
}

/**
 * Start the saved command. Resolves once it has started (or failed to):
 * the command may be the agent's whole turn and run for minutes, so nothing
 * here waits for it or kills it. `done` settles when it exits.
 * @param {string} command
 * @param {object} payload
 * @param {{ spawn?: typeof nodeSpawn, env?: NodeJS.ProcessEnv }} [deps]
 * @returns {Promise<{ ok: boolean, error?: string, pid?: number, done?: Promise<number | null> }>}
 */
export function execWake(command, payload, deps = {}) {
  const spawn = deps.spawn || nodeSpawn;
  const env = {
    ...(deps.env || process.env),
    SURFCAD_WAKE: '1',
    SURFCAD_WAKE_REASON: String(payload?.reason || 'prompt'),
    SURFCAD_PROMPT_IDS: (payload?.prompts || []).map((p) => p.id).join(','),
  };
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, { shell: true, stdio: ['pipe', 'ignore', 'ignore'], env, windowsHide: true });
    } catch {
      resolve({ ok: false, error: 'wake_exec_failed' });
      return;
    }
    let started = false;
    const done = new Promise((exited) => {
      child.once('exit', (code) => exited(typeof code === 'number' ? code : null));
      child.once('error', () => exited(null));
    });
    child.once('error', () => {
      if (!started) resolve({ ok: false, error: 'wake_exec_failed' });
    });
    child.once('spawn', () => {
      started = true;
      // A command that does not read stdin closes the pipe: not an error.
      child.stdin?.on('error', () => {});
      try { child.stdin?.end(`${JSON.stringify(payload)}\n`); } catch { /* noop */ }
      resolve({ ok: true, pid: child.pid, done });
    });
  });
}

/**
 * One waker per process. `wake` tries post, then exec. While an exec'd
 * command from an earlier wake is still running, exec answers `wake_exec_busy`
 * instead of starting a second copy; `idle` resolves when it has exited.
 * @param {import('./wakeConfig.mjs').WakeConfig} config
 * @param {{ fetch?: typeof fetch, spawn?: typeof nodeSpawn, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [deps]
 */
export function createWaker(config, deps = {}) {
  /** @type {Promise<number | null> | null} */
  let running = null;
  return {
    /**
     * @param {object} payload
     * @returns {Promise<{ ok: boolean, form: 'post' | 'exec' | null, error?: string }>}
     */
    async wake(payload) {
      let error = 'wake_not_set';
      if (config?.post) {
        const posted = await postWake(config.post, payload, deps);
        if (posted.ok) return { ok: true, form: 'post' };
        error = posted.error || 'wake_post_failed';
      }
      if (config?.exec) {
        if (running) return { ok: false, form: 'exec', error: 'wake_exec_busy' };
        const started = await execWake(config.exec, payload, deps);
        if (started.ok) {
          const done = started.done || Promise.resolve(null);
          running = done;
          done.then(() => { if (running === done) running = null; });
          return { ok: true, form: 'exec' };
        }
        error = started.error || 'wake_exec_failed';
        return { ok: false, form: 'exec', error };
      }
      return { ok: false, form: config?.post ? 'post' : null, error };
    },
    /** Resolves when no exec'd wake command is running. */
    idle() {
      return running ? running.then(() => {}) : Promise.resolve();
    },
    busy() {
      return running != null;
    },
  };
}
