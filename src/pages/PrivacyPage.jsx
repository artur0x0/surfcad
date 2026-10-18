import { BrandWordmark } from '../components/brand/BrandWordmark.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { isGpcActive } from '../utils/consent.js';
import { openPrivacyChoices } from '../utils/privacyChoicesUi.js';

/**
 * Public privacy page (`/privacy`). Paper surface. Re-opens the same
 * Accept all / Required only popup via openPrivacyChoices().
 */
export default function PrivacyPage() {
  const gpcActive = isGpcActive();

  return (
    <div
      data-privacy-page=""
      className="h-dvh overflow-y-auto surface-light text-on-light font-ui"
    >
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-8 space-y-4">
          <BrandWordmark tone="splash" size={32} />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" data-privacy-title="">
            Privacy
          </h1>
        </header>

        <div className="space-y-4 text-ui leading-relaxed">
          <p data-privacy-copy-required="">
            SurfCAD uses required cookies to keep you signed in, save your work, and report
            crashes so we can keep the product working. Those stay on.
          </p>
          <p data-privacy-copy-optional="">
            Optional analytics — anonymous usage events and page performance — start only after
            you choose Accept all. We do not use session recording or advertising trackers.
          </p>
          <p
            className="text-muted-on-light"
            data-privacy-gpc-honored=""
            data-privacy-gpc={gpcActive ? 'on' : 'off'}
          >
            Your browser&apos;s Global Privacy Control signal is honored.
          </p>
          <button
            type="button"
            data-privacy-change-choices=""
            className="rounded-md border border-chrome-border px-3 py-2 text-ui-sm font-ui text-on-light"
            onClick={() => openPrivacyChoices()}
          >
            Change privacy choices
          </button>
        </div>

        <SiteFooter variant="light">
          <a href="/" className="underline underline-offset-4" data-privacy-home="">
            Back to SurfCAD
          </a>
        </SiteFooter>
      </div>
    </div>
  );
}
