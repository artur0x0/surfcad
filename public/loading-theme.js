/**
 * Synchronous boot: set data-loading-theme before first paint.
 * Keep the hour inequality in lockstep with loadingThemeForHour().
 * Tests set window.__SURFCAD_LOADING_HOUR__ (0–23) before this file runs.
 */
(function () {
  var path = String(location.pathname || '/').replace(/\/$/, '') || '/';
  if (path !== '/') return;
  var hour = (typeof globalThis.__SURFCAD_LOADING_HOUR__ === 'number'
    && globalThis.__SURFCAD_LOADING_HOUR__ >= 0
    && globalThis.__SURFCAD_LOADING_HOUR__ <= 23)
    ? globalThis.__SURFCAD_LOADING_HOUR__
    : new Date().getHours();
  var theme = (hour >= 19 || hour < 7) ? 'dark' : 'light';
  document.documentElement.setAttribute('data-loading-theme', theme);
})();
