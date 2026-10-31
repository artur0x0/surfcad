/**
 * POST /api/molding/leads. The body names a public label, never a price
 * and never the partner's real name. The server decides whether to reveal it.
 */

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
