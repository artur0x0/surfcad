/**
 * Wall-clock loading-screen theme. Dark 19:00–06:59 local, light 07:00–18:59.
 * Pure: hour in, 'dark' | 'light' out. The boot script in public/loading-theme.js
 * uses the same inequality so first paint matches this helper.
 *
 * Tests force the hour with `window.__SURFCAD_LOADING_HOUR__` (0–23) before
 * the boot script runs (Playwright addInitScript).
 */
export function loadingThemeForHour(hour) {
  return hour >= 19 || hour < 7 ? 'dark' : 'light';
}

export function readForcedLoadingHour(globalRef = globalThis) {
  const hour = globalRef.__SURFCAD_LOADING_HOUR__;
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

export function applyLoadingTheme({
  documentRef = globalThis.document,
  hour = readForcedLoadingHour() ?? new Date().getHours(),
} = {}) {
  const theme = loadingThemeForHour(hour);
  documentRef?.documentElement?.setAttribute('data-loading-theme', theme);
  return theme;
}

export function readLoadingTheme({
  documentRef = globalThis.document,
  hour = readForcedLoadingHour() ?? new Date().getHours(),
} = {}) {
  const attr = documentRef?.documentElement?.getAttribute('data-loading-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return loadingThemeForHour(hour);
}

export function clearLoadingTheme(documentRef = globalThis.document) {
  documentRef?.documentElement?.removeAttribute('data-loading-theme');
}
