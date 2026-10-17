import {
  privacyChoicesAnalyticsAttr,
  privacyChoicesEffective,
} from './privacyChoicesMarkup.js';

/**
 * Dialog body (no portal). Used by PrivacyChoicesDialog and unit markup tests.
 */
export default function PrivacyChoicesDialogPanel({
  analyticsAllowed = true,
  gpcActive = false,
  onAnalyticsChange,
}) {
  const effective = privacyChoicesEffective(analyticsAllowed, gpcActive);
  const analyticsAttr = privacyChoicesAnalyticsAttr(analyticsAllowed, gpcActive);

  return (
    <>
      <p className="text-xs text-gray-300" data-privacy-choices-copy="">
        We collect anonymous usage events and page performance to improve SurfCAD.
        We do not use session recording or advertising trackers.
      </p>
      <div className="mt-4">
        <button
          type="button"
          role="switch"
          aria-checked={effective}
          aria-disabled={gpcActive}
          data-privacy-choices-toggle=""
          data-privacy-choices-analytics={analyticsAttr}
          disabled={gpcActive}
          onClick={() => {
            if (gpcActive) return;
            onAnalyticsChange?.(!analyticsAllowed);
          }}
          className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm
            ${gpcActive ? 'cursor-not-allowed opacity-70' : ''}
            ${effective ? 'bg-cyan-600/30 text-cyan-100' : 'bg-white/10 text-gray-200'}`}
        >
          <span>Allow usage analytics</span>
          <span
            className={`h-6 w-11 rounded-full p-0.5 transition-colors ${effective ? 'bg-cyan-600' : 'bg-gray-600'}`}
            data-privacy-choices-switch=""
          >
            <span
              className={`block h-5 w-5 rounded-full bg-white transition-transform ${effective ? 'translate-x-5' : ''}`}
            />
          </span>
        </button>
      </div>
      {gpcActive && (
        <p className="mt-3 text-[11px] text-chrome-secondary" data-privacy-choices-gpc="">
          Global Privacy Control is on in your browser. SurfCAD treats that as an opt-out
          and will not enable usage analytics while it stays set.
        </p>
      )}
    </>
  );
}
