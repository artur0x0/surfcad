import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  applyServerConsent,
  getAnalyticsConsent,
  isGpcActive,
  onConsentChange,
  readStoredRecord,
  setAnalyticsConsent,
} from '../utils/consent';
import { persistConsentToServer } from '../utils/consentApi';
import PrivacyChoicesDialog from './PrivacyChoicesDialog';

/**
 * Footer link + dialog. Works signed out (local only) or signed in (syncs server).
 */
export default function PrivacyChoicesController({ linkClassName = '' }) {
  const { isAuthenticated, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [analyticsAllowed, setAnalyticsAllowed] = useState(() => readStoredRecord().analytics);
  const [gpcActive, setGpcActive] = useState(() => isGpcActive());

  useEffect(() => onConsentChange(() => {
    setAnalyticsAllowed(readStoredRecord().analytics);
    setGpcActive(isGpcActive());
  }), []);

  const serverConsent = user?.consent;
  useEffect(() => {
    if (serverConsent) {
      applyServerConsent(serverConsent);
      setAnalyticsAllowed(readStoredRecord().analytics);
    }
  }, [serverConsent]);

  const handleAnalyticsChange = useCallback(async (next) => {
    const record = setAnalyticsConsent(next);
    setAnalyticsAllowed(record.analytics);
    setGpcActive(isGpcActive());
    if (isAuthenticated) {
      await persistConsentToServer(record.analytics);
    }
  }, [isAuthenticated]);

  const effectiveOn = getAnalyticsConsent();

  return (
    <>
      <button
        type="button"
        className={linkClassName}
        data-privacy-choices-link=""
        onClick={() => setOpen(true)}
      >
        Privacy choices
      </button>
      <PrivacyChoicesDialog
        open={open}
        onClose={() => setOpen(false)}
        analyticsAllowed={analyticsAllowed}
        gpcActive={gpcActive}
        onAnalyticsChange={handleAnalyticsChange}
      />
      <span className="sr-only" data-privacy-choices-effective={effectiveOn ? 'on' : 'off'} />
    </>
  );
}
