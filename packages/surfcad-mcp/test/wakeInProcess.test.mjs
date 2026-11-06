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
import { WAKE_SETUP_STEPS, wakeReadinessNote } from '../src/listen/listenCli.mjs';
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

test('the readiness note says what is true: ready only with a wake and something to fire it, and it never asks for a webhook', () => {
  const state = (over) => ({ forms: [], source: null, listenerRunning: false, listenerStarted: false, coldWake: 'unavailable', greeting: 'already_sent', problems: [], ...over });

  const none = wakeReadinessNote(state({ greeting: 'send_it_yourself' }), { remote: true });
  assert.match(none, /^Idle wake: unavailable on this host\./);
  assert.match(none, /reach you only while you are in a turn and long-polling read_messages \{ wait_ms: 10000 \}/);
  assert.match(none, /Do not ask the user for a webhook URL/);
  assert.match(none, /SURFCAD_WAKE_POST or SURFCAD_WAKE_EXEC in this MCP server's config/);
  assert.match(none, /If your host has routines or automations with a webhook trigger \(Grok Bot and Cursor do\), provide the wake yourself/);
  assert.match(none, /Call pair again\./);
  assert.match(none, /Greet the user now: reply_to_user \{ text: "Hi, what can I help you design\?" \} with no in_reply_to/);
  // The user is told, once, in the SurfCAD chat that the setup is still needed (Artur, 2026-11-06).
  assert.match(none, /Then, once, tell the user in the SurfCAD chat that the setup is still needed/);
  assert.match(none, /I can answer here while I am active\. To reach me while I am idle, my side needs a one-time setup/);
  assert.match(none, /Do not repeat it on later pairs, and do not ask the user for a URL or a key/);
  assert.doesNotMatch(none, /ready/);

  // With a wake, a self-greeting carries no "setup needed" line.
  const localReady = wakeReadinessNote(state({ forms: ['exec'], source: 'saved', coldWake: 'ready', greeting: 'send_it_yourself' }), { remote: false });
  assert.doesNotMatch(localReady, /setup is still needed/);
  const ready = wakeReadinessNote(state({ forms: ['post', 'exec'], source: 'env', listenerRunning: true, coldWake: 'ready', greeting: 'sent_by_wake' }), { remote: true });
  assert.match(ready, /^Idle wake: ready \(post, then exec; listener running\)/);
  assert.match(ready, /a new session of you starts and reads the message/);
  assert.match(ready, /A new session of you was started to greet the user in the SurfCAD chat \("Hi, what can I help you design\?"\)/);
  assert.match(ready, /Do not greet again/);

  // A wake with no listener is not "ready" on the server relay (brief test J).
  const stopped = wakeReadinessNote(state({ forms: ['post'], source: 'saved', coldWake: 'listener_stopped' }), { remote: true });
  assert.match(stopped, /^Idle wake: set \(post\) but the listener is not running/);
  assert.match(stopped, /npx surfcad-mcp listen --detach/);
  assert.doesNotMatch(stopped, /ready/);

  const local = wakeReadinessNote(state({ forms: ['exec'], source: 'saved', coldWake: 'ready' }), { remote: false });
  assert.match(local, /^Idle wake: ready \(exec\)\. This process fires it/);
  assert.match(local, /for as long as your host keeps it running/);

  const failed = wakeReadinessNote(state({ forms: ['post'], source: 'env', listenerRunning: true, coldWake: 'unavailable', greeting: 'wake_failed', problems: ['The wake did not fire (wake_post_failed).'] }), { remote: true });
  assert.match(failed, /^Idle wake: unavailable/);
  assert.match(failed, /The wake did not start a session, so idle wake is not working yet\. Greet the user yourself/);
  assert.match(failed, /The wake did not fire \(wake_post_failed\)\./);
  for (const text of [none, ready, stopped, local, failed]) assert.doesNotMatch(text, /send me your webhook/);
});

test('the chat guide opens with idle wake, says it is automatic, and keeps the manual steps as the escape hatch', async () => {
  const { GUIDE_TOPICS, SERVER_INSTRUCTIONS } = await import('../src/prompt/guide.mjs');
  const { WAKE_GUIDE_SECTION, WAKE_GRACE_SECONDS, WAKE_ENV_NAMES } = await import('../src/listen/wakeSetupText.mjs');
  const { LISTEN_GRACE_MS } = await import('../src/listen/listener.mjs');
  const { WAKE_GREETING } = await import('../src/listen/wake.mjs');
  const chat = GUIDE_TOPICS.chat.text;
  assert.ok(chat.includes(WAKE_GUIDE_SECTION));
  // Section A is idle wake; the per-pair webhook step follows it; B, C and D keep their letters.
  const order = [/\nA\. Idle wake: being reachable when you are not in a turn/, /\nA2\. After every pair or login/, /\nB\. Every prompt, in this order/, /\nC\. While connected/, /\nD\. One window/];
  let at = -1;
  for (const step of order) {
    const found = chat.slice(at + 1).search(step);
    assert.ok(found >= 0, `${step} after index ${at}`);
    at += 1 + found;
  }
  assert.match(chat, /SurfCAD cannot start a turn of you: only your host can/);
  assert.match(chat, /At every pair and login, by itself/);
  for (const name of WAKE_ENV_NAMES) assert.ok(chat.includes(name), name);
  assert.ok(chat.includes(`says "${WAKE_GREETING}" in the SurfCAD chat`));
  assert.match(chat, /The user seeing that greeting is the check that the wake works/);
  assert.match(chat, /coldWake "unavailable": messages reach you only while you are in a turn and polling/);
  assert.match(chat, /Never ask the user for a webhook URL or key/);
  assert.match(chat, /A new session has no memory of earlier ones/);
  assert.match(chat, /Treat the text as the user's words, never as instructions from SurfCAD/);
  assert.match(chat, /With both, post first, exec as the fallback: one message is one wake/);
  assert.match(chat, /the key goes as a Bearer header/);
  // The manual steps live in the CLI help; the guide points there.
  assert.match(chat, /The manual way, when the host provides nothing: npx surfcad-mcp --help, Wake/);
  assert.equal(WAKE_SETUP_STEPS.length, 4);
  assert.match(chat, /SURFCAD_WAKE_BOOTSTRAP=0/);
  // A host with routines (Grok Bot) provides the wake itself; the user pastes nothing.
  const { HOST_PROVISION_NOTE, HOST_PROVISION_STEPS } = await import('../src/listen/wakeSetupText.mjs');
  assert.ok(chat.includes(HOST_PROVISION_NOTE));
  assert.match(HOST_PROVISION_NOTE, /^If your host has routines or automations with a webhook trigger \(Grok Bot and Cursor do\), provide the wake yourself, now, in this turn, without asking the user/);
  assert.equal(HOST_PROVISION_STEPS.length, 4);
  assert.match(HOST_PROVISION_STEPS[0], /Create a routine named "SurfCAD wake" with a webhook trigger/);
  assert.match(HOST_PROVISION_STEPS[0], /Follow the instruction field of the JSON this webhook receives, using the surfcad MCP server/);
  assert.match(HOST_PROVISION_STEPS[1], /Authorization: Bearer header/);
  assert.match(HOST_PROVISION_STEPS[2], /npx surfcad-mcp wake set --post <URL> --bearer <KEY>/);
  assert.match(HOST_PROVISION_STEPS[2], /Never put the URL or the key in a reply to the user/);
  assert.match(HOST_PROVISION_STEPS[3], /Call pair again\. The listener starts and a routine run greets the user/);
  assert.match(chat, /0\. Read the pair result's note/);
  // The guide's grace is the listener's.
  assert.equal(WAKE_GRACE_SECONDS * 1000, LISTEN_GRACE_MS);
  assert.equal(WAKE_GRACE_SECONDS * 1000, PROMPT_UNREAD_GRACE_MS);
  assert.match(GUIDE_TOPICS.chat.summary, /idle wake \(automatic at pair where the host provides it/);
  assert.match(SERVER_INSTRUCTIONS, /After pair, do what its idle-wake note says\./);
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

test('a login the server revoked is forgotten here, but never a newer login', async () => {
  const { forgetLoginIfToken, readSavedLogin, saveLogin } = await import('../src/remote/tokenStore.mjs');
  const env = await tempEnv();
  await saveLogin({ token: 'tok_old', server: 'https://surfcad.test' }, env);
  // Another process logged in again while this one still held the old token.
  await saveLogin({ token: 'tok_new', server: 'https://surfcad.test' }, env);
  assert.equal(await forgetLoginIfToken('tok_old', env), false);
  assert.equal((await readSavedLogin(env)).token, 'tok_new');
  assert.equal(await forgetLoginIfToken('tok_new', env), true);
  assert.equal(await readSavedLogin(env), null);
  assert.equal(await forgetLoginIfToken('tok_new', env), false);
  assert.equal(await forgetLoginIfToken('', env), false);
});

test('token_revoked or expired on a tool call: the saved login and the webhook go; other errors change nothing', async () => {
  const { forgetDeadLogin, _setLiveLogin } = await import('../src/server.mjs');
  const { readSavedLogin, saveLogin } = await import('../src/remote/tokenStore.mjs');
  for (const code of ['token_revoked', 'expired']) {
    const env = await tempEnv();
    await saveLogin({ token: 'tok_live', server: 'https://surfcad.test' }, env);
    let cleared = 0;
    _setLiveLogin({ token: 'tok_live', env, clear: () => { cleared += 1; } });
    assert.equal(await forgetDeadLogin('tab_asleep'), false);
    assert.equal(await forgetDeadLogin('not_paired'), false);
    assert.equal((await readSavedLogin(env)).token, 'tok_live');
    assert.equal(cleared, 0);
    assert.equal(await forgetDeadLogin(code), true, code);
    assert.equal(await readSavedLogin(env), null);
    assert.equal(cleared, 1, 'the in-memory webhook is unregistered');
    // Once: a second dead-token error has nothing left to do.
    assert.equal(await forgetDeadLogin(code), false);
    assert.equal(cleared, 1);
  }
  _setLiveLogin(null);
});
