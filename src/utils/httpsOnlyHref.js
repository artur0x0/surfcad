/** Return a URL string only when it is https. Reject javascript:/data:/http:. */
export function httpsOnlyHref(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}
