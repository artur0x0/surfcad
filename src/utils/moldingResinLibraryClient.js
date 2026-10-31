// GET /api/molding/resin-library. Properties only. A failure leaves the quote up.

export async function fetchMoldingResinLibrary(fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl('/api/molding/resin-library', { credentials: 'same-origin' });
  } catch {
    return { error: { code: 'library_unavailable', message: 'The resin library did not answer.' } };
  }
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (res.status === 429) {
    return {
      error: {
        code: 'rate_limited',
        message: typeof parsed?.error === 'string'
          ? parsed.error
          : 'Too many resin library reads. Try again in a few minutes.',
      },
    };
  }
  if (!res.ok || !Array.isArray(parsed?.resins)) {
    return { error: { code: 'library_unavailable', message: 'The resin library did not answer.' } };
  }
  if (parsed.resins.some((row) => row?.usdPerKg != null || row?.partnerId != null)) {
    return { error: { code: 'library_unavailable', message: 'The resin library did not answer.' } };
  }
  return { source: parsed.source || '', resins: parsed.resins };
}
