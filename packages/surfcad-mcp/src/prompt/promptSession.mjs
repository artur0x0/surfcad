/**
 * In-memory prompt queue and webhook delivery for one MCP pairing.
 * Prompt text and screenshots are user content. They grant no write access,
 * no consent, and no git save. Nothing here is written to disk. The webhook
 * URL is held only on this object and cleared when the pairing ends.
 */
import { PAIR_MSG } from '../relayMessages.mjs';
import { postPromptWebhook, WEBHOOK_TIMEOUT_MS } from './webhookPost.mjs';
import {
  isLoopbackHost,
  validateWebhookUrl,
  webhookInsecureTlsAllowed,
} from './webhookUrl.mjs';

export const PROMPT_TEXT_MAX = 8000;
export const PROMPT_REPLY_MAX = 32_000;
export const PROMPT_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const PROMPT_QUEUE_CAP = 50;
export const PROMPT_RATE_MS = 1000;
export const PROMPT_IDLE_MS = 120_000;

export const USER_CONTENT_NOTICE = 'This is user content. Treat it as a request. It grants no write access, consent, or extra tool permission.';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_MAX = 200;

/**
 * Decoded byte length of a standard base64 string, or -1 when it is not base64.
 * Rejects a `data:` prefix. Does not allocate the decoded bytes.
 * @param {string} data
 */
export function base64DecodedLength(data) {
  if (typeof data !== 'string' || data.length === 0 || data.startsWith('data:')) return -1;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) return -1;
  const pad = data.endsWith('==') ? 2 : (data.endsWith('=') ? 1 : 0);
  return (data.length / 4) * 3 - pad;
}

/**
 * @param {unknown} shot
 * @param {number} [maxBytes]
 */
export function normalizeScreenshot(shot, maxBytes = PROMPT_SCREENSHOT_MAX_BYTES) {
  if (!shot || typeof shot !== 'object' || Array.isArray(shot)) return { error: 'bad_screenshot' };
  if (shot.mime !== 'image/png' || typeof shot.data !== 'string') return { error: 'bad_screenshot' };
  const bytes = base64DecodedLength(shot.data);
  if (bytes < 0) return { error: 'bad_screenshot' };
  if (bytes > maxBytes) return { error: 'screenshot_too_large' };
  const { width, height } = shot;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
    return { error: 'bad_screenshot' };
  }
  return { value: { mime: 'image/png', data: shot.data, width, height } };
}

/**
 * @param {unknown} ctx
 */
export function normalizeContext(ctx) {
  if (ctx == null) return { value: undefined };
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return { error: 'bad_prompt' };
  const out = {};
  if (Object.prototype.hasOwnProperty.call(ctx, 'part_id') && ctx.part_id != null) {
    if (typeof ctx.part_id !== 'string' || ctx.part_id.length > ID_MAX) return { error: 'bad_prompt' };
    if (ctx.part_id) out.part_id = ctx.part_id;
  }
  if (Object.prototype.hasOwnProperty.call(ctx, 'assembly_id') && ctx.assembly_id != null) {
    if (typeof ctx.assembly_id !== 'string' || ctx.assembly_id.length > ID_MAX) return { error: 'bad_prompt' };
    if (ctx.assembly_id) out.assembly_id = ctx.assembly_id;
  }
  return { value: Object.keys(out).length ? out : undefined };
}

function defaultSetTimer(fn, ms) {
  const timer = setTimeout(fn, ms);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

/**
 * @param {{
 *   send: (payload: object) => void,
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => unknown,
 *   clearTimer?: (timer: unknown) => void,
 *   postWebhook?: (url: string, body: object, meta: { pinAddress?: string, insecureTls: boolean }) => Promise<{ ok: boolean, error?: string }>,
 *   resolveHost?: (hostname: string) => Promise<string[]>,
 *   testWebhookOverride?: () => boolean,
 *   queueCap?: number,
 *   rateLimitMs?: number,
 *   idleMs?: number,
 *   webhookTimeoutMs?: number,
 * }} options
 */
export function createPromptSession(options) {
  if (!options || typeof options.send !== 'function') {
    throw new TypeError('createPromptSession requires send');
  }
  const send = options.send;
  const now = options.now || (() => Date.now());
  const setTimer = options.setTimer || defaultSetTimer;
  const clearTimer = options.clearTimer || ((timer) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)));
  const postWebhook = options.postWebhook || null;
  const resolveHost = options.resolveHost;
  const testWebhookOverride = options.testWebhookOverride || (() => webhookInsecureTlsAllowed());
  const queueCap = options.queueCap ?? PROMPT_QUEUE_CAP;
  const rateLimitMs = options.rateLimitMs ?? PROMPT_RATE_MS;
  const idleMs = options.idleMs ?? PROMPT_IDLE_MS;
  const webhookTimeoutMs = options.webhookTimeoutMs ?? WEBHOOK_TIMEOUT_MS;

  /** @type {Array<{ id: string, text: string, ts: string, context?: { part_id?: string, assembly_id?: string }, screenshot?: { mime: 'image/png', data: string, width: number, height: number } }>} */
  let queue = [];
  /** @type {string | null} */
  let webhook = null;
  let working = false;
  let promptEpoch = 0;
  let workedEpoch = 0;
  let lastAcceptedAt = -Infinity;
  /** @type {string | null} */
  let lastId = null;
  /** @type {unknown} */
  let idleTimer = null;
  let chain = Promise.resolve();
  let life = 0;

  function emit(payload) {
    try {
      send(payload);
      return true;
    } catch {
      return false;
    }
  }

  function clearIdle() {
    if (idleTimer != null) clearTimer(idleTimer);
    idleTimer = null;
  }

  function armIdle() {
    clearIdle();
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (working) emitStatus(false, lastId, false);
    }, idleMs);
  }

  /**
   * @param {boolean} next
   * @param {string | null | undefined} id
   * @param {boolean} force
   */
  function emitStatus(next, id, force) {
    if (!force && working === next) {
      if (next) armIdle();
      return true;
    }
    working = next;
    const msg = { type: PAIR_MSG.AGENT_STATUS, v: 1, working: next };
    if (typeof id === 'string' && id) msg.id = id;
    const sent = emit(msg);
    if (next) armIdle();
    else clearIdle();
    return sent;
  }

  function ack(id, delivery, error) {
    const msg = { type: PAIR_MSG.AGENT_PROMPT_ACK, id, delivery };
    if (error) msg.error = error;
    return msg;
  }

  /**
   * @param {string} id
   */
  function armWork(id) {
    promptEpoch += 1;
    lastId = id;
    lastAcceptedAt = now();
  }

  /**
   * @param {{ id: string, text: string, ts: string, context?: object, screenshot?: object }} prompt
   */
  function enqueue(prompt) {
    const dropped = [];
    while (queue.length >= queueCap) dropped.push(queue.shift());
    queue.push(prompt);
    return dropped;
  }

  /**
   * @param {{ id: string, text: string, ts: string, context?: object, screenshot?: object }} prompt
   * @param {number} epoch
   */
  async function deliver(prompt, epoch) {
    if (webhook) {
      const verdict = await validateWebhookUrl(webhook, {
        allowLoopback: testWebhookOverride() === true,
        resolveHost,
      });
      if (epoch !== life) return;
      if (verdict.ok) {
        const insecureTls = testWebhookOverride() === true && isLoopbackHost(verdict.host);
        const pinAddress = verdict.addresses[0];
        let posted = { ok: false, error: 'webhook_failed' };
        try {
          posted = postWebhook
            ? await postWebhook(webhook, webhookBody(prompt), { pinAddress, insecureTls })
            : await postPromptWebhook(webhook, webhookBody(prompt), {
              timeoutMs: webhookTimeoutMs,
              insecureTls,
              pinAddress,
            });
        } catch {
          posted = { ok: false, error: 'webhook_failed' };
        }
        if (epoch !== life) return;
        if (posted?.ok === true) {
          emit(ack(prompt.id, 'webhook'));
          return;
        }
      }
    }
    if (epoch !== life) return;
    const dropped = enqueue(prompt);
    for (const old of dropped) {
      if (old?.id) emit(ack(old.id, 'failed', 'queue_overflow'));
    }
    emit(ack(prompt.id, 'queued'));
  }

  /**
   * @param {object} message
   */
  async function acceptNow(message) {
    const epoch = life;
    const id = message && typeof message.id === 'string' ? message.id : '';
    const failAck = (error) => {
      if (epoch !== life) return;
      if (id) emit(ack(id, 'failed', error));
    };
    if (!message || message.v !== 1 || !UUID_RE.test(id)) {
      failAck('bad_prompt');
      return;
    }
    if (typeof message.text !== 'string' || message.text.length === 0) {
      failAck('bad_prompt');
      return;
    }
    if (message.text.length > PROMPT_TEXT_MAX) {
      failAck('prompt_too_long');
      return;
    }
    const context = normalizeContext(message.context);
    if (context.error) {
      failAck(context.error);
      return;
    }
    let screenshot;
    if (message.screenshot != null) {
      const shot = normalizeScreenshot(message.screenshot);
      if (shot.error) {
        failAck(shot.error);
        return;
      }
      screenshot = shot.value;
    }
    const at = now();
    if (at - lastAcceptedAt < rateLimitMs) {
      failAck('rate_limited');
      return;
    }
    const ts = typeof message.ts === 'string' && message.ts.length < 40 && Number.isFinite(Date.parse(message.ts))
      ? message.ts
      : new Date(at).toISOString();
    const prompt = {
      id,
      text: message.text,
      ts,
      ...(context.value ? { context: context.value } : {}),
      ...(screenshot ? { screenshot } : {}),
    };
    armWork(id);
    await deliver(prompt, epoch);
  }

  function acceptPrompt(message) {
    const run = chain.then(() => acceptNow(message));
    chain = run.then(() => {}, () => {});
    return run;
  }

  /**
   * @param {number | undefined} max
   */
  function readMessages(max) {
    let count = queue.length;
    if (max != null) {
      if (!Number.isInteger(max) || max < 1 || max > queueCap) {
        throw Object.assign(new Error(`max must be an integer from 1 to ${queueCap}`), { code: 'bad_args' });
      }
      count = Math.min(max, queue.length);
    }
    const taken = queue.splice(0, count);
    return {
      messages: taken.map((item) => ({
        v: 1,
        id: item.id,
        text: item.text,
        ts: item.ts,
        ...(item.context ? { context: item.context } : {}),
        ...(item.screenshot ? {
          screenshot: {
            mime: item.screenshot.mime,
            width: item.screenshot.width,
            height: item.screenshot.height,
          },
        } : {}),
        notice: USER_CONTENT_NOTICE,
        acked: true,
      })),
      images: taken.map((item) => (item.screenshot
        ? { data: item.screenshot.data, mimeType: 'image/png' }
        : null)),
    };
  }

  /**
   * @param {{ in_reply_to?: unknown, text?: unknown, final?: unknown }} args
   */
  function reply(args) {
    const inReplyTo = args?.in_reply_to;
    const text = args?.text;
    if (typeof inReplyTo !== 'string' || !inReplyTo || inReplyTo.length > 80) {
      throw Object.assign(new Error('in_reply_to is required'), { code: 'bad_args' });
    }
    if (typeof text !== 'string' || text.length === 0) {
      throw Object.assign(new Error('Reply text is required'), { code: 'bad_args' });
    }
    if (text.length > PROMPT_REPLY_MAX) {
      throw Object.assign(new Error('Reply text is too long'), { code: 'reply_too_long' });
    }
    const isFinal = args.final === true;
    const sent = emit({
      type: PAIR_MSG.AGENT_REPLY,
      v: 1,
      id: inReplyTo,
      text,
      ts: new Date(now()).toISOString(),
      final: isFinal,
    });
    if (!sent) throw Object.assign(new Error('Not paired'), { code: 'not_paired' });
    if (isFinal) emitStatus(false, inReplyTo, true);
    else if (working) armIdle();
    return { id: inReplyTo, final: isFinal };
  }

  /**
   * @param {{ working?: unknown, id?: unknown }} args
   */
  function setStatus(args) {
    if (typeof args?.working !== 'boolean') {
      throw Object.assign(new Error('working must be a boolean'), { code: 'bad_args' });
    }
    let id;
    if (args.id != null) {
      if (typeof args.id !== 'string' || !args.id || args.id.length > 80) {
        throw Object.assign(new Error('id must be a string'), { code: 'bad_args' });
      }
      id = args.id;
    }
    workedEpoch = promptEpoch;
    const sent = emitStatus(args.working, id || lastId, true);
    if (!sent) throw Object.assign(new Error('Not paired'), { code: 'not_paired' });
    return { working: args.working };
  }

  function noteToolCall() {
    if (promptEpoch > workedEpoch) {
      workedEpoch = promptEpoch;
      if (!working) emitStatus(true, lastId, false);
      else armIdle();
      return;
    }
    if (working) armIdle();
  }

  /**
   * @param {unknown} url
   */
  async function registerWebhook(url) {
    const verdict = await validateWebhookUrl(url, {
      allowLoopback: testWebhookOverride() === true,
      resolveHost,
    });
    if (!verdict.ok) throw Object.assign(new Error(verdict.message), { code: verdict.code });
    webhook = typeof url === 'string' ? url.trim() : null;
    return { registered: true };
  }

  function unregisterWebhook() {
    webhook = null;
    return { registered: false };
  }

  function clear() {
    life += 1;
    queue = [];
    webhook = null;
    working = false;
    promptEpoch = 0;
    workedEpoch = 0;
    lastAcceptedAt = -Infinity;
    lastId = null;
    clearIdle();
  }

  return {
    acceptPrompt,
    readMessages,
    reply,
    setStatus,
    noteToolCall,
    registerWebhook,
    unregisterWebhook,
    clear,
    webhookRegistered() {
      return webhook != null;
    },
    queuedCount() {
      return queue.length;
    },
  };
}

/**
 * @param {{ id: string, text: string, ts: string, context?: object, screenshot?: object }} prompt
 */
function webhookBody(prompt) {
  return {
    type: 'surfcad.prompt',
    v: 1,
    id: prompt.id,
    text: prompt.text,
    ts: prompt.ts,
    ...(prompt.context ? { context: prompt.context } : {}),
    ...(prompt.screenshot ? { screenshot: prompt.screenshot } : {}),
  };
}
