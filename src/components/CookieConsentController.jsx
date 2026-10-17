import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  applyGpcDefaultOnFirstVisit,
  onConsentChange,
  shouldShowCookieConsentBanner,
} from '../utils/consent';
import { applyAnalyticsConsentChoice } from '../utils/applyAnalyticsConsentChoice';
import CookieConsentBanner from './CookieConsentBanner';

/**
 * First-visit banner on all shells. Hidden after an explicit choice or GPC default.
 */
export default function CookieConsentController() {
  const { isAuthenticated } = useAuth();
  const [visible, setVisible] = useState(() => shouldShowCookieConsentBanner());

  useEffect(() => {
    applyGpcDefaultOnFirstVisit();
    setVisible(shouldShowCookieConsentBanner());
    return onConsentChange(() => {
      setVisible(shouldShowCookieConsentBanner());
    });
  }, []);

  const dismissWith = useCallback(async (allow) => {
    await applyAnalyticsConsentChoice(allow, { isAuthenticated });
    setVisible(shouldShowCookieConsentBanner());
  }, [isAuthenticated]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[35] flex justify-center px-2
        cookie-consent-anchor sm:px-3"
      data-cookie-consent-host=""
    >
      <CookieConsentBanner
        onAllowAll={() => { void dismissWith(true); }}
        onOnlyRequired={() => { void dismissWith(false); }}
      />
    </div>
  );
}
