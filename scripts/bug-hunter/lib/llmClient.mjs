/**
 * Model-agnostic OpenAI-compatible chat client.
 */

import { readLlmConfig } from './config.mjs';

export function createLlmClient(options = {}) {
  const cfg = options.config || readLlmConfig(options.env);
  const fetchImpl = options.fetch || globalThis.fetch;
  if (!cfg.apiKey && !options.allowMissingKey) {
    return {
      configured: false,
      model: cfg.model,
      async complete() {
        throw new Error('LLM API key missing — set SURFCAD_LLM_API_KEY or OPENAI_API_KEY');
      },
    };
  }

  return {
    configured: true,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    /**
     * @param {{ messages: Array<{role:string,content:string}>, temperature?: number }} params
     */
    async complete(params) {
      const url = `${cfg.baseUrl}/chat/completions`;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: params.temperature ?? 0.2,
          messages: params.messages,
          response_format: { type: 'json_object' },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body?.error?.message || res.statusText || 'LLM request failed';
        throw new Error(msg);
      }
      const choice = body.choices?.[0]?.message?.content || '{}';
      let parsed;
      try {
        parsed = JSON.parse(choice);
      } catch {
        parsed = { raw: choice };
      }
      return {
        message: parsed,
        usage: body.usage || {},
      };
    },
  };
}
