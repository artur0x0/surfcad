import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  applyGpcDefaultOnFirstVisit,
  isGpcActive,
  onConsentChange,
  shouldShowPrivacyConsentPopup,
} from '../utils/consent';
import { applyAnalyticsConsentChoice } from '../utils/applyAnalyticsConsentChoice';
import { onOpenPrivacyChoices } from '../utils/privacyChoicesUi';
import PrivacyConsentPopup from './PrivacyConsentPopup';

/**
 * First-visit bottom popup on app / partners / privacy shells.
 * Hidden after an explicit choice or a stored GPC default.
 * openPrivacyChoices() re-opens the same two buttons.
 */
export default function PrivacyConsentController() {
  const { isAuthenticated } = useAuth();
  const forcedRef = useRef(false);
  const [visible, setVisible] = useState(() => shouldShowPrivacyConsentPopup());
  const [gpcActive, setGpcActive] = useState(() => isGpcActive());

  useEffect(() => {
    applyGpcDefaultOnFirstVisit();
    setVisible(shouldShowPrivacyConsentPopup());
    setGpcActive(isGpcActive());
    const offConsent = onConsentChange(() => {
      setGpcActive(isGpcActive());
      if (!forcedRef.current) setVisible(shouldShowPrivacyConsentPopup());
    });
    const offOpen = onOpenPrivacyChoices(() => {
      forcedRef.current = true;
      setVisible(true);
      setGpcActive(isGpcActive());
    });
    return () => {
      offConsent();
      offOpen();
    };
  }, []);

  const dismissWith = useCallback(async (allow) => {
    forcedRef.current = false;
    await applyAnalyticsConsentChoice(allow, { isAuthenticated });
    setVisible(shouldShowPrivacyConsentPopup());
    setGpcActive(isGpcActive());
  }, [isAuthenticated]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[45] flex justify-center px-2
        privacy-consent-anchor sm:px-3"
      data-privacy-consent-host=""
    >
      <PrivacyConsentPopup
        gpcActive={gpcActive}
        onAcceptAll={() => { void dismissWith(true); }}
        onRequiredOnly={() => { void dismissWith(false); }}
      />
    </div>
  );
}
