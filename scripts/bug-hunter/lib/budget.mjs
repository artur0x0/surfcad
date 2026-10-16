/**
 * Step and estimated cost budget for the explorer loop.
 */

/** Rough $/1M tokens for common cheap models (estimate only). */
const MODEL_COST_PER_M = {
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
};

function ratesForModel(model) {
  const key = String(model || '').toLowerCase();
  for (const [name, row] of Object.entries(MODEL_COST_PER_M)) {
    if (key.includes(name)) return row;
  }
  return { in: 0.5, out: 1.5 };
}

export function createBudget({ maxSteps, maxCostUsd, model }) {
  const rates = ratesForModel(model);
  let steps = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  function estimateCostUsd() {
    return (promptTokens * rates.in + completionTokens * rates.out) / 1_000_000;
  }

  return {
    get steps() { return steps; },
    get promptTokens() { return promptTokens; },
    get completionTokens() { return completionTokens; },
    get estimatedCostUsd() { return estimateCostUsd(); },
    canContinue() {
      return steps < maxSteps && estimateCostUsd() < maxCostUsd;
    },
    recordStep(usage = {}) {
      steps += 1;
      promptTokens += Number(usage.prompt_tokens || usage.promptTokens || 0);
      completionTokens += Number(usage.completion_tokens || usage.completionTokens || 0);
    },
    snapshot() {
      return {
        maxSteps,
        maxCostUsd,
        steps,
        promptTokens,
        completionTokens,
        estimatedCostUsd: estimateCostUsd(),
      };
    },
  };
}
