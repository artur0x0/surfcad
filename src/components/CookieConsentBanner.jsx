/**
 * First-visit cookie consent strip. Non-modal: does not trap focus on the canvas.
 */
export default function CookieConsentBanner({ onAllowAll, onOnlyRequired }) {
  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-modal="false"
      data-cookie-consent-banner=""
      className="pointer-events-auto mx-auto w-full max-w-lg rounded-lg border border-chrome-border
        bg-chrome-surface/95 surface-glass-chip px-3 py-2.5 shadow-lg
        sm:max-w-2xl sm:px-4 sm:py-3"
    >
      <p className="text-[11px] leading-snug text-gray-300 sm:text-xs" data-cookie-consent-copy="">
        SurfCAD uses required cookies to keep you signed in and save your work. We also use
        optional analytics cookies to understand how the product is used and improve it.
      </p>
      <div
        className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end"
        data-cookie-consent-actions=""
      >
        <button
          type="button"
          data-ui-action="data-cookie-consent-only-required"
          data-cookie-consent-only-required=""
          className="w-full rounded-md border border-chrome-border bg-white/5 px-3 py-1.5
            text-xs font-medium text-gray-100 hover:bg-white/10 sm:w-auto"
          onClick={onOnlyRequired}
        >
          Only required
        </button>
        <button
          type="button"
          data-ui-action="data-cookie-consent-allow-all"
          data-cookie-consent-allow-all=""
          className="w-full rounded-md border border-chrome-border bg-white/5 px-3 py-1.5
            text-xs font-medium text-gray-100 hover:bg-white/10 sm:w-auto"
          onClick={onAllowAll}
        >
          Allow all
        </button>
      </div>
    </div>
  );
}
