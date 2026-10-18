import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROMPT_IDLE_MS,
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

test('first tool call after a prompt is working, a final reply and 120s idle go idle', async () => {
  assert.equal(PROMPT_IDLE_MS, 120_000);
  const time = clock();
  const { session, sent } = harness({ clock: time, rateLimitMs: 0 });
  session.noteToolCall();
  assert.equal(sent.length, 0);

  await session.acceptPrompt(prompt(1));
  session.noteToolCall();
  assert.equal(sent.at(-1).type, PAIR_MSG.AGENT_STATUS);
  assert.equal(sent.at(-1).working, true);
  assert.equal(sent.at(-1).id, pid(1));

  session.noteToolCall();
  assert.equal(sent.filter((msg) => msg.type === PAIR_MSG.AGENT_STATUS && msg.working === true).length, 1);

  time.advance(119_999);
  assert.equal(sent.filter((msg) => msg.working === false).length, 0);
  time.advance(1);
  assert.equal(sent.at(-1).working, false);

  await session.acceptPrompt(prompt(2));
  session.noteToolCall();
  time.advance(60_000);
  session.noteToolCall();
  time.advance(60_000);
  assert.equal(sent.at(-1).working, true);
  time.advance(120_000);
  assert.equal(sent.at(-1).working, false);

  await session.acceptPrompt(prompt(3));
  session.noteToolCall();
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

test('a reply without a paired socket is not_paired', () => {
  const session = createPromptSession({
    send() {
      throw Object.assign(new Error('Not paired'), { code: 'not_paired' });
    },
  });
  assert.throws(
    () => session.reply({ in_reply_to: pid(1), text: 'hi', final: false }),
    (err) => err.code === 'not_paired',
  );
});

test('read_messages returns image content beside the text and tool copy says the prompt grants nothing', async () => {
  const defs = promptToolDefinitions();
  const read = defs.find((tool) => tool.name === 'read_messages');
  assert.match(read.description, /grant/i);
  assert.match(defs.find((tool) => tool.name === 'register_webhook').description, /https/);
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
