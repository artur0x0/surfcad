/** Web vitals keys captured on the `web_vitals` event. */
export const WEB_VITAL_KEYS = Object.freeze(['lcp', 'inp', 'cls', 'fcp', 'ttfb']);

/**
 * CLS stays unrounded (values are often 0.00x). Other vitals are ms integers.
 * @param {string} name
 * @param {number} value
 * @returns {number | null}
 */
export function normalizeWebVital(name, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (name === 'cls') return n;
  return Math.round(n);
}

/** True when every vital has been recorded, including an explicit 0. */
export function webVitalsComplete(metrics) {
  if (!metrics) return false;
  return WEB_VITAL_KEYS.every((key) => metrics[key] != null);
}

/** True when at least one vital is present, including 0. */
export function webVitalsHasSample(metrics) {
  if (!metrics) return false;
  return WEB_VITAL_KEYS.some((key) => metrics[key] != null);
}
