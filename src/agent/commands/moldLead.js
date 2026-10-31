/**
 * Ask the selected anonymized vendor for a firm quote or a human review.
 * Firm quote reveals that vendor. Human review records a lead and does not
 * charge a card and does not reveal the name. Pay review fee opens Stripe
 * Checkout and does not mark the lead paid. The quote panel must be open.
 */

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    anonLabel: {
      type: 'string',
      description: 'Public label from the open budgetary quote, such as Partner A. Omit to use the selected vendor.',
    },
  },
});

function runLead(ctx, key, missing, args) {
  const ask = ctx[key];
  if (typeof ask !== 'function') {
    return { error: { code: 'internal', message: missing } };
  }
  const out = ask({ anonLabel: args?.anonLabel });
  const pack = (value) => (value?.error ? { error: value.error } : { result: value });
  if (out && typeof out.then === 'function') return out.then(pack);
  return pack(out);
}

export const moldFirmQuoteCommand = Object.freeze({
  name: 'mold_request_firm_quote',
  uiEntry: 'data-mold-firm-quote',
  schema: SCHEMA,
  example: { anonLabel: 'Partner A' },
  immediate: true,
  run(ctx, args) {
    return runLead(ctx, 'moldRequestFirmQuote', 'moldRequestFirmQuote handler is missing', args);
  },
});

export const moldHumanReviewCommand = Object.freeze({
  name: 'mold_request_human_review',
  uiEntry: 'data-mold-human-review',
  schema: SCHEMA,
  example: { anonLabel: 'Partner A' },
  immediate: true,
  run(ctx, args) {
    return runLead(ctx, 'moldRequestHumanReview', 'moldRequestHumanReview handler is missing', args);
  },
});

export const moldPayReviewCommand = Object.freeze({
  name: 'mold_pay_human_review',
  uiEntry: 'data-mold-pay-review',
  schema: SCHEMA,
  example: { anonLabel: 'Partner A' },
  immediate: true,
  run(ctx, args) {
    return runLead(ctx, 'moldPayHumanReview', 'moldPayHumanReview handler is missing', args);
  },
});
