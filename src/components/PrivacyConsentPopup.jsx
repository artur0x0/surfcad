/**
 * First-visit (and later) privacy consent popup. Non-modal: does not trap focus.
 */
export default function PrivacyConsentPopup({
  onAcceptAll,
  onRequiredOnly,
  gpcActive = false,
}) {
  return (
    <div
      role="dialog"
      aria-label="Privacy choices"
      aria-modal="false"
      data-privacy-consent-popup=""
      className="pointer-events-auto mx-auto w-full max-w-md rounded-lg border border-chrome-border
        surface-glass px-3 py-2.5 shadow-lg font-ui"
    >
      <p className="text-ui-sm leading-snug text-on-dark" data-privacy-consent-copy="">
        SurfCAD uses required cookies to sign you in and save your work. Optional analytics
        start only if you accept.{' '}
        <a
          href="/privacy"
          className="underline underline-offset-2 text-on-dark"
          data-privacy-consent-privacy-link=""
        >
          Privacy page
        </a>
      </p>
      {gpcActive ? (
        <p className="mt-1 text-ui-xs text-muted-on-dark" data-privacy-consent-gpc="">
          Your browser&apos;s Global Privacy Control signal is honored.
        </p>
      ) : null}
      <div
        className="mt-2.5 flex flex-wrap items-center justify-end gap-2"
        data-privacy-consent-actions=""
      >
        <button
          type="button"
          data-ui-action="data-privacy-consent-required-only"
          data-privacy-consent-required-only=""
          className="rounded-md px-3 py-1.5 text-ui-sm font-medium font-ui text-on-dark surface-quiet"
          onClick={onRequiredOnly}
        >
          Required only
        </button>
        <button
          type="button"
          data-ui-action="data-privacy-consent-accept-all"
          data-privacy-consent-accept-all=""
          className="rounded-md px-3 py-1.5 text-ui-sm font-medium font-ui text-on-dark surface-success"
          onClick={onAcceptAll}
        >
          Accept all
        </button>
      </div>
    </div>
  );
}
