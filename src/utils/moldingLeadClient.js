/**
 * POST /api/molding/leads. The body names a public label, never a price
 * and never the partner's real name. The server reveals a name only after
 * the review fee is paid. The return URL is not a payment.
 */

/** Same sentence as PAY_FOR_REVIEW_MESSAGE in backend/services/moldingLead.js. */
export const PAY_FOR_REVIEW_MESSAGE = 'Pay for review to see the partner.';

export const MOLD_REVIEW_LABEL_KEY = 'surfcad.moldReviewAnonLabel';

export function leadBody(type, vendor, quote = {}) {
  return {
    type,
    anonLabel: vendor?.anonLabel,
    snapshot: {
      quantity: quote.quantity,
      cavityCount: quote.cavityCount,
      grade: vendor?.grade,
      region: vendor?.region,
      machineCount: vendor?.machineCount,
      aluminumUsd: vendor?.aluminumUsd,
      steelUsd: vendor?.steelUsd,
      steelCheaperAt: vendor?.steelCheaperAt ?? null,
      range: vendor?.range,
      disclaimer: quote.disclaimer,
    },
  };
}

export async function postMoldingLead(body, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl('/api/molding/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    return { error: { code: 'lead_failed', message: 'The request did not go through.' } };
  }
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (res.status === 401) {
    return { error: { code: 'sign_in', message: 'Sign in to request this.' } };
  }
  if (res.status === 429) {
    const message = typeof parsed?.error === 'string'
      ? parsed.error
      : 'Too many molding requests. Try again in a few minutes.';
    return { error: { code: 'rate_limited', message } };
  }
  if (!res.ok) {
    if (parsed?.error?.code) return parsed;
    return { error: { code: 'lead_failed', message: 'The request did not go through.' } };
  }
  return parsed;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function reviewError(res, parsed) {
  if (res.status === 401) {
    return { error: { code: 'sign_in', message: 'Sign in to request this.' } };
  }
  if (res.status === 429) {
    const message = typeof parsed?.error === 'string'
      ? parsed.error
      : 'Too many molding requests. Try again in a few minutes.';
    return { error: { code: 'rate_limited', message } };
  }
  if (!res.ok) {
    if (parsed?.error?.code) return parsed;
    return { error: { code: 'review_unavailable', message: 'Human review checkout is not available.' } };
  }
  return parsed;
}

export async function postReviewCheckout(anonLabel, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl('/api/molding/review-checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ anonLabel }),
    });
  } catch {
    return { error: { code: 'review_unavailable', message: 'Human review checkout is not available.' } };
  }
  return reviewError(res, await readJson(res));
}

export async function fetchReviewStatus(anonLabel, fetchImpl = fetch) {
  const query = new URLSearchParams({ anonLabel });
  let res;
  try {
    res = await fetchImpl(`/api/molding/review-status?${query}`, { credentials: 'same-origin' });
  } catch {
    return { error: { code: 'review_unavailable', message: 'Human review checkout is not available.' } };
  }
  return reviewError(res, await readJson(res));
}

export function checkoutUrlAllowed(url) {
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function sessionBin(storage) {
  if (storage) return storage;
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

export function rememberReviewLabel(label, storage) {
  try {
    sessionBin(storage)?.setItem(MOLD_REVIEW_LABEL_KEY, label);
  } catch {
    /* private mode */
  }
}

export function readReviewLabel(storage) {
  try {
    return sessionBin(storage)?.getItem(MOLD_REVIEW_LABEL_KEY) || '';
  } catch {
    return '';
  }
}

export function clearReviewLabel(storage) {
  try {
    sessionBin(storage)?.removeItem(MOLD_REVIEW_LABEL_KEY);
  } catch {
    /* private mode */
  }
}

export function partnerUnlocked(result) {
  return !!result
    && result.reviewFeePaid === true
    && result.revealed === true
    && typeof result.displayName === 'string'
    && result.displayName.trim().length > 0;
}

function withoutPartnerIdentity(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const copy = { ...body };
  delete copy.displayName;
  delete copy.notes;
  delete copy.email;
  delete copy.phone;
  delete copy.contact;
  delete copy.partnerName;
  if (copy.reviewFeePaid !== true) copy.revealed = false;
  return copy;
}

export async function pollReviewStatus(anonLabel, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const attempts = Number.isInteger(options.attempts) && options.attempts > 0 ? options.attempts : 8;
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 1500;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await fetchReviewStatus(anonLabel, fetchImpl);
    if (partnerUnlocked(last)) return last;
    const code = last?.error?.code;
    if (code === 'no_lead' || code === 'unknown_partner' || code === 'sign_in' || code === 'bad_args' || code === 'rate_limited') {
      return withoutPartnerIdentity(last);
    }
    if (i + 1 < attempts) await sleep(intervalMs);
  }
  return withoutPartnerIdentity(last);
}
