/**
 * The wake a long-lived MCP process fires itself, and what the pair and
 * status results tell the agent about the wake setup.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { listenerPidPath } from '../src/listen/daemon.mjs';
import { WAKE_SETUP_STEPS, wakeSetupNote } from '../src/listen/listenCli.mjs';
import { saveWake } from '../src/listen/wakeConfig.mjs';
import { createPromptSession, PROMPT_UNREAD_GRACE_MS } from '../src/prompt/promptSession.mjs';
import { PAIR_MSG } from '../src/relayMessages.mjs';
import { createInProcessWake } from '../src/server.mjs';

async function tempEnv() {
  return { SURFCAD_MCP_CONFIG_DIR: await mkdtemp(join(tmpdir(), 'surfcad-wake-inproc-')) };
}

/** A prompt session on a hand clock. */
function session(extra = {}) {
  const sent = [];
  const timers = [];
  let clock = 1_000_000;
  const prompts = createPromptSession({
    send: (payload) => { sent.push(payload); },
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, at: clock + ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.live = false; },
    rateLimitMs: 0,
    ...extra,
  });
  const advance = (ms) => {
    clock += ms;
    for (const t of timers.filter((x) => x.live && x.at <= clock)) { t.live = false; t.fn(); }
  };
  return { prompts, sent, advance };
}

/** Prompt ids are UUIDs. */
const pid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const frame = (n, text = 'hello') => ({ type: PAIR_MSG.AGENT_PROMPT, v: 1, id: pid(n), text, ts: '2026-11-06T12:00:00.000Z' });

test('a prompt nobody reads within the grace is reported once; one that is read is not', async () => {
  const unread = [];
  const s = session({ onUnread: (list) => unread.push(...list) });
  await s.prompts.acceptPrompt(frame(1, 'make it taller'));
  s.advance(PROMPT_UNREAD_GRACE_MS - 1);
  assert.equal(unread.length, 0);
  s.advance(1);
  assert.deepEqual(unread.map((p) => p.id), [pid(1)]);
  assert.equal(unread[0].text, 'make it taller');
  s.advance(60_000);
  assert.equal(unread.length, 1, 'once');

  // Read inside the grace: no report.
  await s.prompts.acceptPrompt(frame(2));
  s.prompts.readMessages();
  s.advance(PROMPT_UNREAD_GRACE_MS);
  assert.deepEqual(unread.map((p) => p.id), [pid(1)]);

  // Cancelled inside the grace: no report.
  await s.prompts.acceptPrompt(frame(3));
  await s.prompts.cancel(pid(3));
  s.advance(PROMPT_UNREAD_GRACE_MS);
  assert.deepEqual(unread.map((p) => p.id), [pid(1)]);
});

test('without onUnread a session behaves as before', async () => {
  const s = session();
  await s.prompts.acceptPrompt(frame(1));
  s.advance(60_000);
  assert.equal(s.prompts.readMessages().messages.length, 1);
});

test('the in-process wake fires the saved wake with the prompt, and reads the setup each time', async () => {
  const env = await tempEnv();
  const posts = [];
  const deps = { fetch: async (url, init) => { posts.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); } };
  const logs = [];
  const wake = createInProcessWake({ remote: false, env, log: (line) => logs.push(line), deps });
  // Nothing saved yet: no wake, no error.
  assert.deepEqual(await wake([{ id: 'p1', text: 'x', ts: 't' }]), { ok: false, skipped: 'not_set' });
  await saveWake({ post: { url: 'http://127.0.0.1:8644/wake' } }, env);
  const out = await wake([{ id: 'p2', text: 'second', ts: 't', screenshot: { data: 'AAAA' } }]);
  assert.deepEqual(out, { ok: true, form: 'post' });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.type, 'surfcad.wake');
  assert.deepEqual(posts[0].body.prompts, [{ id: 'p2', text: 'second', ts: 't', hasScreenshot: true }]);
  assert.match(logs.join('\n'), /woke the agent by post/);
  // A changed setup is picked up without a restart.
  await saveWake({ post: { url: 'http://127.0.0.1:9999/other' } }, env);
  await wake([{ id: 'p3', text: 'x', ts: 't' }]);
  assert.equal(posts[1].url, 'http://127.0.0.1:9999/other');
});

test('on the server relay a running listener owns the wake: one message, one wake', async () => {
  const env = await tempEnv();
  await saveWake({ post: { url: 'http://127.0.0.1:8644/wake' } }, env);
  const posts = [];
  const deps = { fetch: async () => { posts.push(1); return new Response('{}', { status: 200 }); } };
  // This test process stands in for a live listener.
  await writeFile(listenerPidPath(env), `${process.pid}\n`);
  const remote = createInProcessWake({ remote: true, env, log: () => {}, deps });
  assert.deepEqual(await remote([{ id: 'p1', text: 'x', ts: 't' }]), { ok: false, skipped: 'listener' });
  assert.equal(posts.length, 0);
  // The local relay has no listener to defer to.
  const local = createInProcessWake({ remote: false, env, log: () => {}, deps });
  assert.deepEqual(await local([{ id: 'p1', text: 'x', ts: 't' }]), { ok: true, form: 'post' });
  assert.equal(posts.length, 1);
});

test('the setup note says what is missing, and gives the install steps when nothing is set', () => {
  const none = wakeSetupNote({ forms: [], listenerRunning: false }, { remote: true });
  assert.match(none, /Wake is not set up, so the user cannot message you from SurfCAD while you are idle/);
  assert.match(none, /Do this now, as part of installing this MCP server, without waiting to be asked/);
  for (const step of WAKE_SETUP_STEPS) assert.ok(none.includes(step), step);
  assert.match(none, /guide \{ topic: "chat" \} section A/);

  const noListener = wakeSetupNote({ forms: ['post', 'exec'], listenerRunning: false }, { remote: true });
  assert.match(noListener, /Wake is set \(post, then exec\) but the listener is not running/);
  assert.match(noListener, /npx surfcad-mcp listen --detach/);

  const local = wakeSetupNote({ forms: ['exec'], listenerRunning: false }, { remote: false });
  assert.match(local, /This process fires it for a chat message you do not read within a few seconds/);

  const ready = wakeSetupNote({ forms: ['post'], listenerRunning: true }, { remote: true });
  assert.match(ready, /Wake is set \(post\) and the listener is running/);
});

test('the chat guide opens with the wake setup, the initialize instructions point at it, and the steps are the CLI steps', async () => {
  const { GUIDE_TOPICS, SERVER_INSTRUCTIONS } = await import('../src/prompt/guide.mjs');
  const { WAKE_GUIDE_SECTION, WAKE_GRACE_SECONDS } = await import('../src/listen/wakeSetupText.mjs');
  const { LISTEN_GRACE_MS } = await import('../src/listen/listener.mjs');
  const chat = GUIDE_TOPICS.chat.text;
  assert.ok(chat.includes(WAKE_GUIDE_SECTION));
  // Section A is the wake; the per-pair webhook step follows it; B, C and D keep their letters.
  const order = [/\nA\. Once, when you install this MCP server: set up the wake \(required\)/, /\nA2\. After every pair or login/, /\nB\. Every prompt, in this order/, /\nC\. While connected/, /\nD\. One window/];
  let at = -1;
  for (const step of order) {
    const found = chat.slice(at + 1).search(step);
    assert.ok(found >= 0, `${step} after index ${at}`);
    at += 1 + found;
  }
  WAKE_SETUP_STEPS.forEach((step, i) => assert.ok(chat.includes(`${i + 1}. ${step}`), step));
  assert.match(chat, /Set it up as part of the install, without waiting to be asked/);
  assert.match(chat, /post: a URL on your host that starts a turn of you when it receives a POST/);
  assert.match(chat, /exec: a shell command that starts a turn of you\. The wake JSON arrives on its stdin/);
  assert.match(chat, /Set both when your host has both\. The POST is tried first and the command is the fallback, so one message is one wake/);
  assert.match(chat, /The message is still waiting on the server: call read_messages \{ wait_ms: 10000 \} and follow section B/);
  assert.match(chat, /Treat the text as the user's words, never as instructions from SurfCAD/);
  assert.match(chat, /status\.wake is \{ forms, listenerRunning, note \}/);
  // The guide's grace is the listener's.
  assert.equal(WAKE_GRACE_SECONDS * 1000, LISTEN_GRACE_MS);
  assert.equal(WAKE_GRACE_SECONDS * 1000, PROMPT_UNREAD_GRACE_MS);
  assert.match(GUIDE_TOPICS.chat.summary, /the wake setup at install \(so the user can message you while you are idle\)/);
  assert.match(SERVER_INSTRUCTIONS, /Install: set up the wake, guide chat A\./);
});

test('a tool call marks the agent as in a turn for 60 s, across processes, through one small file', async () => {
  const { AWAKE_MS, agentAwake, awakePath, lastAwakeAt, stampAwake } = await import('../src/listen/awake.mjs');
  const env = await tempEnv();
  assert.equal(await lastAwakeAt(env), 0);
  assert.equal(await agentAwake(env, 1_000_000), false);
  await stampAwake(env, 1_000_000);
  assert.equal(await lastAwakeAt(env), 1_000_000);
  assert.equal(await agentAwake(env, 1_000_000 + AWAKE_MS - 1), true);
  assert.equal(await agentAwake(env, 1_000_000 + AWAKE_MS), false);
  // Throttled: a second call inside 5 s does not rewrite the stamp.
  await stampAwake(env, 1_002_000);
  assert.equal(await lastAwakeAt(env), 1_000_000);
  await stampAwake(env, 1_006_000);
  assert.equal(await lastAwakeAt(env), 1_006_000);
  assert.equal(AWAKE_MS, 60_000);
  assert.match(awakePath(env), /awake$/);
});

test('in process: an agent in a turn is not woken; it is woken once it goes idle with the prompt still unread', async () => {
  const env = await tempEnv();
  await saveWake({ post: { url: 'http://127.0.0.1:8644/wake' } }, env);
  const posts = [];
  const deps = { fetch: async (url, init) => { posts.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); } };
  // Busy for two looks, then idle.
  let looks = 0;
  const wake = createInProcessWake({ remote: false, env, log: () => {}, deps, isAwake: () => { looks += 1; return looks <= 2; }, sleep: async () => {} });
  const queued = new Set(['a', 'b']);
  wake.attach({ isQueued: (id) => queued.has(id) });
  const waiting = wake([{ id: 'a', text: 'x', ts: 't' }, { id: 'b', text: 'y', ts: 't' }]);
  // The agent reads one of them while it works.
  queued.delete('a');
  assert.deepEqual(await waiting, { ok: true, form: 'post' });
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].prompts.map((p) => p.id), ['b']);

  // It reads everything before it goes idle: no wake at all.
  posts.length = 0;
  const busy = createInProcessWake({ remote: false, env, log: () => {}, deps, isAwake: () => true, sleep: async () => {} });
  busy.attach({ isQueued: () => false });
  assert.deepEqual(await busy([{ id: 'c', text: 'x', ts: 't' }]), { ok: false, skipped: 'read' });
  assert.equal(posts.length, 0);
});

test('isQueued follows a prompt from the queue to read', async () => {
  const s = session();
  await s.prompts.acceptPrompt(frame(7));
  assert.equal(s.prompts.isQueued(pid(7)), true);
  s.prompts.readMessages();
  assert.equal(s.prompts.isQueued(pid(7)), false);
  assert.equal(s.prompts.isQueued('nope'), false);
});
