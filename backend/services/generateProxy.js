/**
 * POST /api/generate — signed-in proxy to the Groq chat API.
 * The server owns the system prompt: clients may send only user and
 * assistant turns, with bounded count and size.
 */

export const GENERATE_MODEL_CONFIG = Object.freeze({
  model: 'meta-llama/llama-4-scout-17b-16e-instruct',
  temperature: 1,
  top_p: 1,
  max_tokens: 2048,
});

export const GENERATE_LIMITS = Object.freeze({
  maxMessages: 64,
  maxMessageChars: 64_000,
  maxTotalChars: 120_000,
});

const ALLOWED_ROLES = new Set(['user', 'assistant']);
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const UPSTREAM_TIMEOUT_MS = 60_000;

/**
 * @returns {{ ok: true, messages: { role: string, content: string }[] } | { ok: false, status: number, error: string }}
 */
export function validateGenerateMessages(messages, limits = GENERATE_LIMITS) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, status: 400, error: 'messages must be a non-empty array' };
  }
  if (messages.length > limits.maxMessages) {
    return { ok: false, status: 413, error: `Too many messages (max ${limits.maxMessages})` };
  }
  let total = 0;
  const clean = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      return { ok: false, status: 400, error: 'Each message must be an object' };
    }
    if (!ALLOWED_ROLES.has(message.role)) {
      return { ok: false, status: 400, error: 'Message role must be user or assistant' };
    }
    if (typeof message.content !== 'string') {
      return { ok: false, status: 400, error: 'Message content must be a string' };
    }
    if (message.content.length > limits.maxMessageChars) {
      return { ok: false, status: 413, error: 'A message is too long' };
    }
    total += message.content.length;
    if (total > limits.maxTotalChars) {
      return { ok: false, status: 413, error: 'Conversation is too long' };
    }
    clean.push({ role: message.role, content: message.content });
  }
  if (clean[clean.length - 1].role !== 'user') {
    return { ok: false, status: 400, error: 'The last message must be from the user' };
  }
  return { ok: true, messages: clean };
}

/**
 * @param {{ systemPrompt: string, apiKey?: string, fetchImpl?: typeof fetch }} deps
 */
export function createGenerateHandler({ systemPrompt, apiKey, fetchImpl = fetch }) {
  return async function generateHandler(req, res) {
    if (!apiKey) {
      return res.status(503).json({ error: 'AI generation is not configured' });
    }
    const checked = validateGenerateMessages(req.body?.messages);
    if (!checked.ok) {
      return res.status(checked.status).json({ error: checked.error });
    }
    try {
      const response = await fetchImpl(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          ...GENERATE_MODEL_CONFIG,
          messages: [{ role: 'system', content: systemPrompt }, ...checked.messages],
        }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.error(`[Generate] Upstream status ${response.status}`);
        const status = response.status === 429 ? 429 : 502;
        return res.status(status).json({ error: status === 429 ? 'AI is busy. Try again shortly.' : 'AI request failed' });
      }
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        console.error('[Generate] Upstream response had no message content');
        return res.status(502).json({ error: 'AI request failed' });
      }
      return res.json({ choices: [{ message: { role: 'assistant', content } }] });
    } catch (error) {
      console.error('[Generate] Proxy error:', error?.name || 'Error');
      return res.status(502).json({ error: 'AI request failed' });
    }
  };
}
