/**
 * Env for the LLM explorer (OpenAI-compatible chat completions).
 * No secrets are read from disk — only process.env.
 */

const DEFAULT_MODEL = 'gpt-4o-mini';

export function readLlmConfig(env = process.env) {
  const baseUrl = (
    env.SURFCAD_LLM_BASE_URL
    || env.OPENAI_BASE_URL
    || 'https://api.openai.com/v1'
  ).replace(/\/$/, '');
  const apiKey = env.SURFCAD_LLM_API_KEY || env.OPENAI_API_KEY || '';
  const model = env.SURFCAD_LLM_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL;
  return { baseUrl, apiKey, model };
}

export function readBudgetConfig(env = process.env) {
  const maxSteps = Number(env.BUG_HUNTER_MAX_STEPS || env.SURFCAD_BUG_HUNTER_MAX_STEPS || 24);
  const maxCostUsd = Number(env.BUG_HUNTER_MAX_COST_USD || env.SURFCAD_BUG_HUNTER_MAX_COST_USD || 0.25);
  return {
    maxSteps: Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : 24,
    maxCostUsd: Number.isFinite(maxCostUsd) && maxCostUsd > 0 ? maxCostUsd : 0.25,
  };
}

export function defaultReportDir(env = process.env) {
  if (env.BUG_HUNTER_OUT) return env.BUG_HUNTER_OUT;
  if (env.SURFCAD_BUG_HUNTER_OUT) return env.SURFCAD_BUG_HUNTER_OUT;
  return 'reports/bug-hunter';
}
