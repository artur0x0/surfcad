import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BEARER_MAX,
  AGENT_PROMPT_STALL_MS,
  PROMPT_QUEUE_CAP,
  PROMPT_RATE_MS,
  PROMPT_SCREENSHOT_MAX_BYTES,
  PROMPT_TEXT_MAX,
  USER_CONTENT_NOTICE,
  base64DecodedLength,
  createPromptSession,
} from '../src/prompt/promptSession.mjs';
import { callPromptTool, promptToolDefinitions } from '../src/prompt/promptTools.mjs';
import { PAIR_MSG } from '../src/relayMessages.mjs';
import { webhookInsecureTlsAllowed, WEBHOOK_TLS_INSECURE_ENV } from '../src/prompt/webhookUrl.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function prompt(n, extra = {}) {
  const msg = {
    type: PAIR_MSG.AGENT_PROMPT,
    v: extra.v ?? 1,
    id: extra.id ?? pid(n),
    text: extra.text ?? `prompt ${n}`,
    ts: extra.ts ?? '2026-10-18T00:00:00.000Z',
  };
  if (extra.context) msg.context = extra.context;
  if (extra.screenshot) msg.screenshot = extra.screenshot;
  return msg;
}

function shot(data = PNG) {
  return { mime: 'image/png', data, width: 1, height: 1 };
}

function clock(start = 1_000_000) {
  let now = start;
  const timers = new Set();
  return {
    now: () => now,
    setTimer(fn, ms) {
      const timer = { at: now + ms, fn, cleared: false, fired: false };
      timers.add(timer);
      return timer;
    },
    clearTimer(timer) {
      if (timer) timer.cleared = true;
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let next = null;
        for (const timer of timers) {
          if (timer.cleared || timer.fired) continue;
          if (timer.at <= until && (!next || timer.at < next.at)) next = timer;
        }
        if (!next) break;
        now = next.at;
        next.fired = true;
        next.fn();
      }
      now = until;
    },
  };
}

function harness(extra = {}) {
  const sent = [];
  const time = extra.clock || clock();
  const posts = [];
  const session = createPromptSession({
    send: (payload) => {
      if (extra.send) extra.send(payload);
      else sent.push(payload);
    },
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    testWebhookOverride: extra.testWebhookOverride || (() => false),
    resolveHost: extra.resolveHost,
    postWebhook: extra.postWebhook || (async (url, body, meta) => {
      posts.push({ url, body, meta });
      return { ok: true };
    }),
    queueCap: extra.queueCap,
    rateLimitMs: extra.rateLimitMs,
    idleMs: extra.idleMs,
  });
  return { session, sent, posts, time };
}

function acks(sent) {
  return sent.filter((msg) => msg.type === PAIR_MSG.AGENT_PROMPT_ACK);
}

function expectStatus({
  webhookRegistered = false,
  queued = 0,
  delivered = 0,
  replied = 0,
  cancelled = 0,
  last = null,
} = {}) {
  return {
    webhookRegistered,
    queued,
    counts: { queued, delivered, replied, cancelled },
    last,
  };
}

test('queue returns oldest first, drops the oldest past the cap, and acks on read', async () => {
  assert.equal(PROMPT_QUEUE_CAP, 50);
  const { session, sent } = harness({ rateLimitMs: 0 });
  for (let n = 1; n <= 51; n += 1) await session.acceptPrompt(prompt(n));

  const overflow = acks(sent).find((msg) => msg.error === 'queue_overflow');
  assert.equal(overflow.id, pid(1));
  assert.equal(overflow.delivery, 'failed');
  assert.equal(acks(sent).filter((msg) => msg.delivery === 'queued').length, 51);

  const first = session.readMessages(2);
  assert.deepEqual(first.messages.map((row) => row.id), [pid(2), pid(3)]);
  assert.equal(first.messages[0].acked, true);
  assert.equal(session.queuedCount(), 48);

  const rest = session.readMessages();
  assert.equal(rest.messages[0].id, pid(4));
  assert.equal(rest.messages.at(-1).id, pid(51));
  assert.equal(rest.messages.length, 48);
  assert.equal(session.queuedCount(), 0);
  assert.equal(session.readMessages().messages.length, 0);
});

test('rate limit is one accepted prompt per second and does not consume the slot on rejection', async () => {
  assert.equal(PROMPT_RATE_MS, 1000);
  const time = clock();
  const { session, sent } = harness({ clock: time });
  await session.acceptPrompt(prompt(1));
  await session.acceptPrompt(prompt(2));
  assert.equal(acks(sent).at(-1).delivery, 'failed');
  assert.equal(acks(sent).at(-1).error, 'rate_limited');
  assert.equal(session.queuedCount(), 1);

  time.advance(999);
  await session.acceptPrompt(prompt(3));
  assert.equal(acks(sent).at(-1).error, 'rate_limited');

  time.advance(1);
  await session.acceptPrompt(prompt(4));
  assert.equal(acks(sent).at(-1).delivery, 'queued');
  assert.deepEqual(session.readMessages().messages.map((row) => row.id), [pid(1), pid(4)]);
});

test('screenshot over 2 MiB is a typed error and is not queued', async () => {
  assert.equal(PROMPT_SCREENSHOT_MAX_BYTES, 2 * 1024 * 1024);
  const decoded = PROMPT_SCREENSHOT_MAX_BYTES + 1;
  assert.equal(decoded % 3, 0);
  const data = 'A'.repeat((decoded / 3) * 4);
  assert.equal(base64DecodedLength(data), decoded);
  const { session, sent } = harness({ rateLimitMs: 0 });
  await session.acceptPrompt(prompt(1, { screenshot: shot(data) }));
  assert.equal(acks(sent)[0].delivery, 'failed');
  assert.equal(acks(sent)[0].error, 'screenshot_too_large');
  assert.equal(session.queuedCount(), 0);

  await session.acceptPrompt(prompt(2, { screenshot: shot() }));
  const read = session.readMessages();
  assert.equal(read.messages[0].screenshot.data, undefined);
  assert.equal(read.messages[0].screenshot.mime, 'image/png');
  assert.equal(read.images[0].data, PNG);
  assert.equal(JSON.stringify(read.messages).includes(PNG), false);
});

test('prompt text cap, bad screenshots, and context are enforced before the queue', async () => {
  const { session, sent } = harness({ rateLimitMs: 0 });
  await session.acceptPrompt(prompt(1, { text: 'a'.repeat(PROMPT_TEXT_MAX + 1) }));
  assert.equal(acks(sent).at(-1).error, 'prompt_too_long');
  await session.acceptPrompt(prompt(2, { text: '' }));
  assert.equal(acks(sent).at(-1).error, 'bad_prompt');
  await session.acceptPrompt(prompt(3, { v: 2 }));
  assert.equal(acks(sent).at(-1).error, 'bad_prompt');
  await session.acceptPrompt(prompt(4, { screenshot: { mime: 'image/jpeg', data: PNG, width: 1, height: 1 } }));
  assert.equal(acks(sent).at(-1).error, 'bad_screenshot');
  await session.acceptPrompt(prompt(5, {
    text: 'a'.repeat(PROMPT_TEXT_MAX),
    context: { part_id: 'part-1', assembly_id: 'asm-1', ignored: 'no' },
    screenshot: shot(),
  }));
  const row = session.readMessages().messages[0];
  assert.equal(row.text.length, PROMPT_TEXT_MAX);
  assert.deepEqual(row.context, { part_id: 'part-1', assembly_id: 'asm-1' });
  assert.equal(row.notice, USER_CONTENT_NOTICE);
});

test('webhook POST uses the contract body and a failure falls back to the queue', async () => {
  const posts = [];
  let fail = true;
  const { session, sent } = harness({
    rateLimitMs: 0,
    testWebhookOverride: () => webhookInsecureTlsAllowed({
      NODE_ENV: 'test',
      [WEBHOOK_TLS_INSECURE_ENV]: '1',
    }),
    postWebhook: async (url, body, meta) => {
      posts.push({ url, body, meta });
      if (fail) return { ok: false, error: 'webhook_failed' };
      return { ok: true };
    },
  });
  await assert.rejects(
    () => session.registerWebhook('https://user:pass@127.0.0.1/hook'),
    (err) => err.code === 'bad_webhook_url' && !String(err.message).includes('user:pass'),
  );
  await assert.rejects(
    () => session.registerWebhook('http://127.0.0.1/hook'),
    (err) => err.code === 'bad_webhook_url',
  );
  await session.registerWebhook('https://127.0.0.1:8443/hook');
  assert.equal(session.webhookRegistered(), true);

  await session.acceptPrompt(prompt(1, { text: 'with shot', screenshot: shot(), context: { part_id: 'p' } }));
  assert.equal(acks(sent).at(-1).delivery, 'queued');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].meta.insecureTls, true);
  assert.equal(posts[0].body.type, 'surfcad.prompt');
  assert.equal(posts[0].body.text, 'with shot');
  assert.equal(posts[0].body.screenshot.data, PNG);
  assert.equal(posts[0].body.context.part_id, 'p');
  assert.equal(session.queuedCount(), 1);

  fail = false;
  session.readMessages();
  await session.acceptPrompt(prompt(2, { text: 'posted' }));
  assert.equal(acks(sent).at(-1).delivery, 'webhook');
  assert.equal(session.queuedCount(), 0);
  assert.equal(posts[1].body.id, pid(2));

  session.unregisterWebhook();
  assert.equal(session.webhookRegistered(), false);
  await session.acceptPrompt(prompt(3));
  assert.equal(acks(sent).at(-1).delivery, 'queued');
  assert.equal(posts.length, 2);
});

test('production ignores the insecure-webhook switch, so loopback stays rejected', async () => {
  const { session } = harness({
    testWebhookOverride: () => webhookInsecureTlsAllowed({
      NODE_ENV: 'production',
      [WEBHOOK_TLS_INSECURE_ENV]: '1',
    }),
  });
  await assert.rejects(
    () => session.registerWebhook('https://127.0.0.1/hook'),
    (err) => err.code === 'bad_webhook_url',
  );
  assert.equal(session.webhookRegistered(), false);
  await session.registerWebhook('https://8.8.8.8/hook');
  assert.equal(session.webhookRegistered(), true);
});

test('a public webhook does not skip TLS checks even when the test switch is on', async () => {
  const { session, posts } = harness({
    rateLimitMs: 0,
    testWebhookOverride: () => true,
  });
  await session.registerWebhook('https://8.8.8.8/hook');
  await session.acceptPrompt(prompt(1));
  assert.equal(posts[0].meta.insecureTls, false);
  assert.equal(posts[0].meta.pinAddress, '8.8.8.8');
});

test('a read does not enter building; a mutating call does; a quiet 15 min stalls', async () => {
  assert.equal(AGENT_PROMPT_STALL_MS, 15 * 60 * 1000);
  const time = clock();
  const { session, sent } = harness({ clock: time, rateLimitMs: 0 });
  session.noteToolCall();
  assert.equal(sent.length, 0);

  await session.acceptPrompt(prompt(1));
  session.noteToolCall();
  session.readMessages();
  assert.equal(sent.some((msg) => msg.type === PAIR_MSG.AGENT_STATUS && msg.state === 'working'), false);

  const responding = session.setStatus({ state: 'responding', id: pid(1) });
  assert.deepEqual(responding, { working: true, state: 'typing' });
  assert.equal(sent.at(-1).state, 'typing');
  session.noteToolCall();
  assert.equal(sent.at(-1).type, PAIR_MSG.AGENT_ACTIVITY);
  assert.equal(sent.filter((msg) => msg.state === 'working').length, 0);

  session.noteToolCall({ mutates: true });
  assert.equal(sent.at(-1).type, PAIR_MSG.AGENT_STATUS);
  assert.equal(sent.at(-1).working, true);
  assert.equal(sent.at(-1).state, 'working');
  assert.equal(sent.at(-1).id, pid(1));

  session.noteToolCall({ mutates: true });
  assert.equal(sent.filter((msg) => msg.type === PAIR_MSG.AGENT_STATUS && msg.state === 'working' && !msg.stalled).length, 1);
  assert.equal(sent.at(-1).type, PAIR_MSG.AGENT_ACTIVITY);

  time.advance(AGENT_PROMPT_STALL_MS - 1);
  assert.equal(sent.some((msg) => msg.stalled === true), false);
  assert.equal(sent.some((msg) => msg.working === false), false);
  time.advance(1);
  assert.equal(sent.at(-1).stalled, true);
  assert.equal(sent.at(-1).working, true);
  assert.equal(sent.at(-1).state, 'working');

  await session.acceptPrompt(prompt(2));
  session.noteToolCall();
  assert.equal(sent.filter((msg) => msg.id === pid(2) && msg.state === 'working').length, 0);
  session.setStatus({ state: 'building', id: pid(2) });
  assert.equal(sent.at(-1).state, 'working');
  time.advance(60_000);
  session.noteToolCall();
  time.advance(60_000);
  assert.equal(sent.at(-1).type, PAIR_MSG.AGENT_ACTIVITY);
  assert.equal(sent.some((msg) => msg.stalled === true && msg.id === pid(2)), false);
  time.advance(AGENT_PROMPT_STALL_MS);
  assert.equal(sent.at(-1).stalled, true);
  assert.equal(sent.at(-1).working, true);
  assert.equal(sent.at(-1).id, pid(2));

  await session.acceptPrompt(prompt(3));
  session.noteToolCall();
  assert.equal(sent.filter((msg) => msg.id === pid(3) && msg.state === 'working').length, 0);
  const replied = session.reply({ in_reply_to: pid(3), text: '40 mm', final: true });
  assert.equal(replied.final, true);
  const types = sent.map((msg) => msg.type);
  assert.ok(types.includes(PAIR_MSG.AGENT_REPLY));
  const reply = sent.find((msg) => msg.type === PAIR_MSG.AGENT_REPLY);
  assert.equal(reply.text, '40 mm');
  assert.equal(reply.final, true);
  assert.equal(reply.v, 1);
  assert.equal(sent.at(-1).type, PAIR_MSG.AGENT_STATUS);
  assert.equal(sent.at(-1).working, false);
  assert.equal(sent.at(-1).state, 'idle');
});

test('responding and building stall after the same quiet window', async () => {
  for (const [state, wire] of [['responding', 'typing'], ['building', 'working']]) {
    const time = clock();
    const { session, sent } = harness({ clock: time, rateLimitMs: 0 });
    await session.acceptPrompt(prompt(1));
    session.setStatus({ state, id: pid(1) });
    assert.equal(sent.at(-1).state, wire, state);
    time.advance(AGENT_PROMPT_STALL_MS - 1);
    assert.equal(sent.some((msg) => msg.stalled === true), false, state);
    time.advance(1);
    const stall = sent.at(-1);
    assert.equal(stall.stalled, true, state);
    assert.equal(stall.state, wire, state);
    assert.equal(stall.working, true, state);
  }
});

test('tool calls, read_messages, set_status, and replies refresh the idle window; a held call does not stall', async () => {
  const time = clock();
  const { session, sent } = harness({ clock: time, rateLimitMs: 0 });
  await session.acceptPrompt(prompt(1));
  session.noteToolCall({ mutates: true });
  assert.equal(sent.at(-1).state, 'working');

  const gap = Math.floor(AGENT_PROMPT_STALL_MS * 0.6);
  time.advance(gap);
  session.noteToolCall({ mutates: true });
  time.advance(gap);
  session.readMessages();
  time.advance(gap);
  session.setStatus({ state: 'working', id: pid(1) });
  time.advance(gap);
  session.reply({ in_reply_to: pid(1), text: 'still on it', final: false });
  assert.equal(sent.at(-1).type, PAIR_MSG.AGENT_ACTIVITY);
  assert.equal(sent.some((msg) => msg.state === 'typing'), false, 'a partial reply does not leave building');
  time.advance(gap);
  assert.ok(5 * gap > AGENT_PROMPT_STALL_MS);
  assert.equal(sent.some((msg) => msg.stalled === true), false, 'activity inside each window keeps working');
  assert.equal(sent.some((msg) => msg.working === false), false);

  session.holdWork(true);
  time.advance(AGENT_PROMPT_STALL_MS * 3);
  assert.equal(sent.some((msg) => msg.stalled === true), false, 'an in-flight bridge call is activity');
  session.holdWork(false);
  time.advance(AGENT_PROMPT_STALL_MS - 1);
  assert.equal(sent.some((msg) => msg.stalled === true), false);
  time.advance(1);
  const stall = sent.at(-1);
  assert.equal(stall.stalled, true);
  assert.equal(stall.working, true);

  session.noteToolCall();
  assert.equal(sent.at(-1).stalled, undefined);
  assert.equal(sent.at(-1).working, true);
  const cancelled = await session.cancel(pid(1));
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(sent.at(-1).working, false);
  assert.equal(sent.at(-1).state, 'idle');
});

test('clear drops the queue, the webhook, and an in-flight POST', async () => {
  let release;
  const { session, sent } = harness({
    rateLimitMs: 0,
    testWebhookOverride: () => true,
    postWebhook: () => new Promise((resolve) => { release = resolve; }),
  });
  await session.registerWebhook('https://127.0.0.1/hook');
  const pending = session.acceptPrompt(prompt(1, { text: 'secret prompt' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof release, 'function');
  session.clear();
  release({ ok: true });
  await pending;
  assert.equal(session.webhookRegistered(), false);
  assert.equal(session.queuedCount(), 0);
  assert.equal(acks(sent).some((msg) => msg.delivery === 'webhook'), false);
  assert.equal(JSON.stringify(sent).includes('secret prompt'), false);
});

test('set_status keeps a transport error instead of rewriting it as not_paired', async () => {
  const session = createPromptSession({
    send() {
      throw Object.assign(new Error('prompts need the socket'), { code: 'prompts_need_websocket' });
    },
  });
  assert.throws(
    () => session.setStatus({ state: 'building' }),
    (err) => err.code === 'prompts_need_websocket' && err.code !== 'not_paired',
  );
});

test('set_status waits for an async send and returns the tab state', async () => {
  const sent = [];
  const session = createPromptSession({
    send(payload) {
      return Promise.resolve().then(() => { sent.push(payload); });
    },
  });
  const result = await session.setStatus({ state: 'building' });
  assert.deepEqual(result, { working: true, state: 'working' });
  assert.equal(sent.at(-1).type, 'agent.status');
  assert.equal(sent.at(-1).state, 'working');
  assert.equal(sent.at(-1).working, true);
});

test('a reply without a paired socket is not_paired', async () => {
  const session = createPromptSession({
    send(payload) {
      if (payload.type === PAIR_MSG.AGENT_REPLY) {
        throw Object.assign(new Error('Not paired'), { code: 'not_paired' });
      }
    },
  });
  await session.acceptPrompt(prompt(1));
  assert.throws(
    () => session.reply({ in_reply_to: pid(1), text: 'hi', final: false }),
    (err) => err.code === 'not_paired',
  );
});

test('read_messages returns image content beside the text and tool copy says the prompt grants nothing', async () => {
  const defs = promptToolDefinitions();
  const read = defs.find((tool) => tool.name === 'read_messages');
  assert.match(read.description, /grant/i);
  assert.match(read.description, /type.: .cancel/);
  assert.match(read.description, /Stop work on that id/);
  assert.match(defs.find((tool) => tool.name === 'register_webhook').description, /https/);
  assert.match(defs.find((tool) => tool.name === 'register_webhook').description, /type.: .cancel/);
  assert.match(defs.find((tool) => tool.name === 'register_webhook').description, /Stop work on that id/);
  const { session } = harness({ rateLimitMs: 0 });
  await session.acceptPrompt(prompt(1, { text: 'look', screenshot: shot() }));
  await session.acceptPrompt(prompt(2, { text: 'plain' }));
  const out = await callPromptTool(session, 'read_messages', {});
  const images = out.content.filter((block) => block.type === 'image');
  const texts = out.content.filter((block) => block.type === 'text').map((block) => block.text);
  assert.equal(images.length, 1);
  assert.equal(images[0].mimeType, 'image/png');
  assert.equal(images[0].data, PNG);
  assert.equal(texts.some((text) => text.includes('look') && !text.includes(PNG)), true);
  assert.equal(texts.some((text) => text.includes('plain')), true);
  assert.equal(session.queuedCount(), 0);
});

test('a fresh session reports webhook false and queued 0, then queued 1 after a prompt', async () => {
  const { session } = harness({ rateLimitMs: 0 });
  assert.deepEqual(session.deliveryStatus(), expectStatus());
  await session.acceptPrompt(prompt(1));
  assert.deepEqual(session.deliveryStatus(), expectStatus({
    queued: 1,
    last: { id: pid(1), state: 'queued' },
  }));
});

test('bearer is sent as Authorization, dropped on unregister and session clear, and never echoed', async () => {
  const logs = [];
  const names = ['log', 'info', 'warn', 'error', 'debug'];
  const prev = {};
  for (const name of names) {
    prev[name] = console[name];
    console[name] = (...args) => logs.push(args.map((arg) => {
      if (typeof arg === 'string') return arg;
      try { return JSON.stringify(arg); } catch { return String(arg); }
    }).join(' '));
  }
  try {
    const posts = [];
    const { session, sent } = harness({
      rateLimitMs: 0,
      postWebhook: async (url, body, meta) => {
        posts.push({ url, body, meta });
        if (meta.authorization === 'Bearer test-bearer') {
          throw new Error('down test-bearer');
        }
        return { ok: true };
      },
    });
    const registered = await callPromptTool(session, 'register_webhook', {
      url: 'https://8.8.8.8/hook/s3cret-path',
      bearer: 'test-bearer',
    });
    const registeredText = registered.content.map((block) => block.text).join('\n');
    assert.equal(registeredText.includes('test-bearer'), false);
    assert.equal(registeredText.includes('s3cret-path'), false);
    assert.equal(registeredText.includes('8.8.8.8'), false);
    assert.deepEqual(JSON.parse(registeredText), { registered: true });
    assert.deepEqual(session.deliveryStatus(), expectStatus({ webhookRegistered: true }));
    assert.equal(JSON.stringify(session.deliveryStatus()).includes('test-bearer'), false);

    await session.acceptPrompt(prompt(1, { text: 'hello from the page' }));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].meta.authorization, 'Bearer test-bearer');
    assert.equal(posts[0].meta.bearer, undefined);
    assert.equal(acks(sent).at(-1).delivery, 'queued');
    assert.equal(JSON.stringify(sent).includes('test-bearer'), false);
    assert.equal(JSON.stringify(posts[0].body).includes('test-bearer'), false);
    assert.equal(session.deliveryStatus().queued, 1);

    const cleared = await callPromptTool(session, 'unregister_webhook', {});
    assert.deepEqual(JSON.parse(cleared.content[0].text), { registered: false });
    assert.equal(session.deliveryStatus().webhookRegistered, false);
    await session.acceptPrompt(prompt(2));
    assert.equal(posts.length, 1);

    await session.registerWebhook('https://8.8.8.8/hook/s3cret-path', 'other-token');
    await session.acceptPrompt(prompt(3));
    assert.equal(posts.at(-1).meta.authorization, 'Bearer other-token');

    session.clear();
    assert.deepEqual(session.deliveryStatus(), expectStatus());
    await session.registerWebhook('https://8.8.8.8/hook/s3cret-path');
    await session.acceptPrompt(prompt(4));
    assert.equal(posts.at(-1).meta.authorization, undefined);
    assert.equal(JSON.stringify(posts).includes('test-bearer'), true);
    assert.equal(posts.filter((row) => row.meta.authorization === 'Bearer test-bearer').length, 1);

    assert.equal(logs.some((line) => line.includes('test-bearer') || line.includes('other-token') || line.includes('s3cret-path')), false);
  } finally {
    for (const name of names) console[name] = prev[name];
  }
});

test('CR, LF, empty, and overlong bearers are rejected and not stored', async () => {
  const { session, posts } = harness({ rateLimitMs: 0 });
  const url = 'https://8.8.8.8/hook';
  const samples = [
    'test-bearer\n',
    'test-bearer\r',
    'test-bearer\r\nX-Injected: 1',
    '',
    '   ',
    'x'.repeat(BEARER_MAX + 1),
  ];
  for (const bearer of samples) {
    await assert.rejects(
      () => session.registerWebhook(url, bearer),
      (err) => err.code === 'bad_args'
        && !String(err.message).includes('test-bearer')
        && !String(err.message).includes('X-Injected'),
    );
  }
  await assert.rejects(
    () => session.registerWebhook(url, 12),
    (err) => err.code === 'bad_args' && err.message === 'bearer must be a string',
  );
  assert.equal(session.webhookRegistered(), false);
  assert.equal(posts.length, 0);
  await session.registerWebhook(url, 'a'.repeat(BEARER_MAX));
  assert.equal(session.webhookRegistered(), true);
  assert.equal(JSON.stringify(session.deliveryStatus()).includes('a'.repeat(32)), false);
  await assert.rejects(
    () => callPromptTool(session, 'register_webhook', {
      url: 'https://user:test-bearer@8.8.8.8/hook',
      bearer: 'test-bearer',
    }),
    (err) => err.code === 'bad_webhook_url' && !String(err.message).includes('test-bearer'),
  );
});

test('a prompt POST from the session sends Authorization: Bearer and unregister clears it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfcad-bearer-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', keyPath,
    '-out', certPath,
    '-days', '1',
    '-nodes',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' });
  const hits = [];
  const server = https.createServer({
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  }, (req, res) => {
    res.writeHead(204);
    res.end();
    hits.push({ authorization: req.headers.authorization ?? null, path: req.url });
  });
  const sent = [];
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const url = `https://127.0.0.1:${port}/hook/s3cret-path`;
    const session = createPromptSession({
      send: (payload) => sent.push(payload),
      testWebhookOverride: () => true,
      rateLimitMs: 0,
    });
    const registered = await session.registerWebhook(url, 'test-bearer');
    assert.deepEqual(registered, { registered: true });
    await session.acceptPrompt(prompt(1, { text: 'from the page' }));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].authorization, 'Bearer test-bearer');
    assert.equal(hits[0].path, '/hook/s3cret-path');
    assert.equal(acks(sent).at(-1).delivery, 'webhook');
    assert.equal(JSON.stringify(sent).includes('test-bearer'), false);
    assert.equal(JSON.stringify(session.deliveryStatus()).includes('test-bearer'), false);
    assert.equal(JSON.stringify(session.deliveryStatus()).includes('s3cret-path'), false);
    assert.equal(session.deliveryStatus().queued, 0);

    session.unregisterWebhook();
    await session.acceptPrompt(prompt(2, { text: 'queued after unregister' }));
    assert.equal(hits.length, 1);
    assert.equal(acks(sent).at(-1).delivery, 'queued');

    await session.registerWebhook(url);
    await session.acceptPrompt(prompt(3, { text: 'no bearer' }));
    assert.equal(hits.length, 2);
    assert.equal(hits[1].authorization, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancelling a queued prompt drops it and status shows cancelled', async () => {
  const { session, sent } = harness({ rateLimitMs: 0 });
  await session.acceptPrompt(prompt(1, { text: 'stop me' }));
  await session.acceptPrompt(prompt(2, { text: 'keep me' }));
  const result = await session.cancel(pid(1));
  assert.deepEqual(result, { id: pid(1), state: 'cancelled' });
  assert.equal(session.deliveryStatus().queued, 1);
  assert.equal(session.deliveryStatus().counts.cancelled, 1);
  assert.deepEqual(session.deliveryStatus().last, { id: pid(2), state: 'queued' });
  const read = session.readMessages();
  assert.deepEqual(read.messages.map((row) => row.id), [pid(2)]);
  assert.equal(JSON.stringify(read.messages).includes('stop me'), false);
  assert.equal(session.deliveryStatus().queued, 0);

  await session.acceptPrompt(prompt(3, { text: 'also stop' }));
  await session.acceptPrompt(prompt(4, { text: 'and this' }));
  await session.cancel(pid(3));
  await session.cancel(pid(4));
  assert.equal(session.readMessages().messages.length, 0);
  assert.deepEqual(session.deliveryStatus(), expectStatus({
    delivered: 1,
    cancelled: 3,
    last: { id: pid(4), state: 'cancelled' },
  }));
  assert.equal(sent.some((msg) => msg.type === PAIR_MSG.AGENT_REPLY), false);
});

test('cancelling a delivered prompt posts {type:cancel,id} with the bearer', async () => {
  const { session, posts, sent } = harness({ rateLimitMs: 0 });
  await session.registerWebhook('https://8.8.8.8/hook/s3cret-path', 'test-bearer');
  await session.acceptPrompt(prompt(1, { text: 'already posted' }));
  assert.equal(acks(sent).at(-1).delivery, 'webhook');
  assert.equal(posts.length, 1);
  const result = await session.cancel(pid(1));
  assert.deepEqual(result, { id: pid(1), state: 'cancelled' });
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[1].body, { type: 'cancel', id: pid(1) });
  assert.equal(posts[1].meta.authorization, 'Bearer test-bearer');
  assert.equal(JSON.stringify(posts[1].body).includes('test-bearer'), false);
  assert.equal(JSON.stringify(session.deliveryStatus()).includes('test-bearer'), false);
  assert.equal(session.deliveryStatus().queued, 0);
  assert.equal(session.readMessages().messages.length, 0);
  const again = await session.cancel(pid(1));
  assert.deepEqual(again, { id: pid(1), state: 'cancelled' });
  assert.equal(posts.length, 2, 'a second cancel does not post again');
});

test('cancelling a read prompt with no webhook returns a cancel item', async () => {
  const { session, sent } = harness({ rateLimitMs: 0 });
  await session.acceptPrompt(prompt(1, { text: 'seen' }));
  session.setStatus({ state: 'building' });
  assert.equal(sent.at(-1).state, 'working');
  assert.equal(sent.at(-1).working, true);
  const read = session.readMessages();
  assert.equal(read.messages[0].text, 'seen');
  assert.equal(session.deliveryStatus().last.state, 'delivered');
  const result = await session.cancel(pid(1));
  assert.deepEqual(result, { id: pid(1), state: 'cancelled' });
  assert.equal(sent.at(-1).type, PAIR_MSG.AGENT_STATUS);
  assert.equal(sent.at(-1).working, false);
  const next = await callPromptTool(session, 'read_messages', {});
  const texts = next.content.filter((block) => block.type === 'text').map((block) => block.text);
  assert.equal(texts.some((text) => text.includes('"type": "cancel"') && text.includes(pid(1))), true);
  assert.equal(texts.some((text) => text.includes('seen')), false);
  assert.deepEqual(session.deliveryStatus().last, { id: pid(1), state: 'cancelled' });
  assert.equal(session.deliveryStatus().queued, 0);
});

test('a failed cancel webhook falls back to a read_messages cancel item', async () => {
  const { session } = harness({
    rateLimitMs: 0,
    postWebhook: async (_url, body) => {
      if (body?.type === 'cancel') return { ok: false, error: 'webhook_failed' };
      return { ok: true };
    },
  });
  await session.registerWebhook('https://8.8.8.8/hook');
  await session.acceptPrompt(prompt(1));
  await session.cancel(pid(1));
  const read = session.readMessages();
  assert.deepEqual(read.messages, [{ type: 'cancel', id: pid(1) }]);
});

test('reply_to_user and set_status after cancel are ignored and do not reach the page', async () => {
  const { session, sent } = harness({ rateLimitMs: 0 });
  await session.acceptPrompt(prompt(1));
  session.readMessages();
  await session.cancel(pid(1));
  const before = sent.length;
  const reply = session.reply({ in_reply_to: pid(1), text: 'too late', final: true });
  assert.deepEqual(reply, { ok: false, error: 'cancelled' });
  const status = session.setStatus({ working: true, id: pid(1) });
  assert.deepEqual(status, { ok: false, error: 'cancelled' });
  assert.equal(sent.slice(before).some((msg) => msg.type === PAIR_MSG.AGENT_REPLY), false);
  assert.equal(sent.slice(before).some((msg) => msg.type === PAIR_MSG.AGENT_STATUS && msg.working === true), false);
  const toolReply = await callPromptTool(session, 'reply_to_user', {
    in_reply_to: pid(1),
    text: 'still late',
    final: true,
  });
  assert.match(toolReply.content[0].text, /"error": "cancelled"/);
});

test('cancel of an unknown id is not_found and a final reply is already_final', async () => {
  const { session, sent } = harness({ rateLimitMs: 0 });
  assert.deepEqual(await session.cancel(pid(9)), { id: pid(9), state: 'not_found' });
  await session.acceptPrompt(prompt(1));
  session.reply({ in_reply_to: pid(1), text: 'done', final: true });
  assert.equal(sent.some((msg) => msg.type === PAIR_MSG.AGENT_REPLY), true);
  assert.deepEqual(await session.cancel(pid(1)), { id: pid(1), state: 'already_final' });
  assert.equal(session.deliveryStatus().last.state, 'replied');
  assert.equal(session.deliveryStatus().counts.cancelled, 0);
});

test('cancel waits until an in-flight webhook delivery finishes', async () => {
  const resolvers = [];
  const bodies = [];
  const { session } = harness({
    rateLimitMs: 0,
    postWebhook: (_url, body) => new Promise((resolve) => {
      bodies.push(body);
      resolvers.push(resolve);
    }),
  });
  await session.registerWebhook('https://8.8.8.8/hook', 'test-bearer');
  const pending = session.acceptPrompt(prompt(1, { text: 'in flight' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolvers.length, 1);
  const canceling = session.cancel(pid(1));
  let settled = false;
  canceling.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  resolvers[0]({ ok: true });
  await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolvers.length, 2);
  assert.equal(settled, false);
  resolvers[1]({ ok: true });
  assert.deepEqual(await canceling, { id: pid(1), state: 'cancelled' });
  assert.equal(bodies[1].type, 'cancel');
  assert.equal(bodies[1].id, pid(1));
  assert.equal(JSON.stringify(bodies).includes('test-bearer'), false);
});

test('read_messages long-poll: waitForMessage resolves on the next prompt or cancel, false at the deadline', async () => {
  const time = clock();
  const { session } = harness({ clock: time, rateLimitMs: 0 });
  let settled = null;
  const waiting = session.waitForMessage(5000).then((v) => { settled = v; return v; });
  time.advance(1000);
  await Promise.resolve();
  assert.equal(settled, null, 'still waiting after 1 s');
  await session.acceptPrompt(prompt(1));
  assert.equal(await waiting, true, 'a prompt wakes the reader');
  assert.deepEqual(session.readMessages().messages.map((row) => row.id), [pid(1)]);

  // Deadline with nothing queued.
  let timedOut = null;
  const idle = session.waitForMessage(3000).then((v) => { timedOut = v; return v; });
  time.advance(3000);
  assert.equal(await idle, false);
  assert.equal(timedOut, false);

  // Already queued: no wait at all.
  await session.acceptPrompt(prompt(2));
  assert.equal(await session.waitForMessage(60_000), true);

  // A cancel notice also wakes the reader.
  session.readMessages();
  const onCancel = session.waitForMessage(5000);
  await session.cancel(pid(2));
  assert.equal(await onCancel, true);
  assert.deepEqual(session.readMessages().messages, [{ type: 'cancel', id: pid(2) }]);

  // wait 0 answers at once.
  assert.equal(await session.waitForMessage(0), false);
});

test('read_messages { wait_ms } over callPromptTool waits for a prompt and rejects a bad value', async () => {
  const time = clock();
  const { session } = harness({ clock: time, rateLimitMs: 0 });
  const def = promptToolDefinitions().find((tool) => tool.name === 'read_messages');
  assert.equal(def.inputSchema.properties.wait_ms.maximum, 25_000);
  let result = null;
  const pending = callPromptTool(session, 'read_messages', { wait_ms: 2000 }).then((r) => { result = r; return r; });
  await Promise.resolve();
  assert.equal(result, null, 'the call is held while the queue is empty');
  await session.acceptPrompt(prompt(7));
  const out = await pending;
  const text = out.content.filter((c) => c.type === 'text').map((c) => JSON.parse(c.text));
  assert.equal(text[0].id, pid(7));
  assert.deepEqual(text.at(-1), {
    acked: [pid(7)],
    recent: [{ id: pid(7), state: 'delivered' }],
  });

  const empty = callPromptTool(session, 'read_messages', { wait_ms: 1000 });
  time.advance(1000);
  const none = await empty;
  assert.deepEqual(JSON.parse(none.content[0].text), {
    messages: [],
    acked: [],
    recent: [{ id: pid(7), state: 'delivered' }],
  });

  await assert.rejects(() => callPromptTool(session, 'read_messages', { wait_ms: 99_999 }), (err) => err.code === 'bad_args');
  await assert.rejects(() => callPromptTool(session, 'read_messages', { wait_ms: -1 }), (err) => err.code === 'bad_args');
});

test('an unknown reply id is rejected before send, and recent ids survive the ack', async () => {
  const { session, sent } = harness({ rateLimitMs: 0, queueCap: 2 });
  assert.throws(
    () => session.reply({ in_reply_to: 'x', text: 'probe' }),
    (err) => err.code === 'unknown_prompt',
  );
  assert.equal(sent.some((msg) => msg.type === PAIR_MSG.AGENT_REPLY), false);

  await session.acceptPrompt(prompt(1));
  await session.acceptPrompt(prompt(2));
  await session.acceptPrompt(prompt(3));
  const read = await callPromptTool(session, 'read_messages', {});
  const parsed = read.content.filter((block) => block.type === 'text').map((block) => JSON.parse(block.text));
  assert.deepEqual(parsed.filter((row) => row.id).map((row) => row.id), [pid(2), pid(3)]);
  assert.deepEqual(parsed.at(-1).acked, [pid(2), pid(3)]);
  assert.deepEqual(parsed.at(-1).recent, [
    { id: pid(2), state: 'delivered' },
    { id: pid(3), state: 'delivered' },
  ]);

  const before = sent.length;
  assert.throws(
    () => session.reply({ in_reply_to: 'x', text: 'probe' }),
    (err) => err.code === 'unknown_prompt',
  );
  assert.throws(
    () => session.reply({ in_reply_to: pid(1), text: 'gone' }),
    (err) => err.code === 'unknown_prompt',
  );
  assert.equal(sent.length, before, 'an unknown id sends nothing');

  const empty = await callPromptTool(session, 'read_messages', {});
  assert.deepEqual(JSON.parse(empty.content[0].text), {
    messages: [],
    acked: [],
    recent: [
      { id: pid(2), state: 'delivered' },
      { id: pid(3), state: 'delivered' },
    ],
  });

  const streamed = [
    session.reply({ in_reply_to: pid(2), text: 'one ', final: false }),
    session.reply({ in_reply_to: pid(2), text: 'two ', final: false }),
    session.reply({ in_reply_to: pid(2), text: 'three', final: true }),
  ];
  assert.deepEqual(streamed, [
    { id: pid(2), final: false },
    { id: pid(2), final: false },
    { id: pid(2), final: true },
  ]);
  const replies = sent.filter((msg) => msg.type === PAIR_MSG.AGENT_REPLY && msg.id === pid(2));
  assert.deepEqual(replies.map((msg) => msg.text), ['one ', 'two ', 'three']);
  assert.deepEqual(replies.map((msg) => msg.final), [false, false, true]);

  const after = await callPromptTool(session, 'read_messages', {});
  assert.deepEqual(JSON.parse(after.content[0].text).recent, [
    { id: pid(2), state: 'replied' },
    { id: pid(3), state: 'delivered' },
  ]);
});

test('a session note posts without a prompt id, stays plain text, and is rate limited', async () => {
  const time = clock();
  const { session, sent } = harness({ clock: time });
  const defs = Object.fromEntries(promptToolDefinitions().map((tool) => [tool.name, tool]));
  assert.deepEqual(defs.reply_to_user.inputSchema.required, ['text']);
  assert.match(defs.reply_to_user.description, /Omit in_reply_to/);
  assert.match(defs.read_messages.description, /idle session that has not received a prompt has recent: \[\]/);

  const idle = await callPromptTool(session, 'read_messages', {});
  assert.deepEqual(JSON.parse(idle.content[0].text).recent, []);

  await assert.rejects(
    () => session.reply({ text: '' }),
    (err) => err.code === 'bad_args',
  );
  assert.throws(
    () => session.reply({ in_reply_to: '', text: 'nope' }),
    (err) => err.code === 'bad_args',
  );
  assert.throws(
    () => session.reply({ in_reply_to: 'x', text: 'probe' }),
    (err) => err.code === 'unknown_prompt',
  );
  assert.equal(sent.length, 0);

  const first = session.reply({ text: '<b>hi</b>', final: true });
  const second = session.reply({ text: 'again' });
  assert.deepEqual(await first, { ok: true, session: true });
  await assert.rejects(second, (err) => err.code === 'rate_limited');
  const notes = sent.filter((msg) => msg.type === PAIR_MSG.AGENT_MESSAGE);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].v, 1);
  assert.equal(notes[0].text, '<b>hi</b>');
  assert.equal(notes[0].id, undefined);
  assert.equal(notes[0].final, undefined);
  assert.equal(sent.some((msg) => msg.type === PAIR_MSG.AGENT_REPLY), false);
  assert.deepEqual(session.recentPrompts(), []);
  assert.equal(session.deliveryStatus().last, null);

  time.advance(1000);
  assert.deepEqual(await session.reply({ text: 'later' }), { ok: true, session: true });
  assert.equal(sent.filter((msg) => msg.type === PAIR_MSG.AGENT_MESSAGE).at(-1).text, 'later');

  await session.acceptPrompt(prompt(1));
  const read = await callPromptTool(session, 'read_messages', {});
  assert.deepEqual(JSON.parse(read.content.at(-1).text).recent, [
    { id: pid(1), state: 'delivered' },
  ]);
  assert.deepEqual(session.reply({ in_reply_to: pid(1), text: 'done', final: true }), {
    id: pid(1),
    final: true,
  });
});

test('post_progress sends no text and close_session does not exit the process', async () => {
  const { session, sent } = harness();
  const exited = [];
  const original = process.exit;
  process.exit = ((code) => { exited.push(code); });
  try {
    assert.deepEqual(await session.postProgress({ text: 'thinking about the fillet' }), { ok: true, working: true });
    assert.deepEqual(sent.at(-1), { type: PAIR_MSG.AGENT_PROGRESS, v: 1, working: true });
    assert.equal(Object.hasOwn(sent.at(-1), 'text'), false);
    assert.deepEqual(await session.closeSession(), { ok: true, closed: true });
    assert.deepEqual(sent.at(-1), { type: PAIR_MSG.AGENT_CLOSE_SESSION, v: 1 });
    assert.deepEqual(exited, []);
  } finally {
    process.exit = original;
  }
});
