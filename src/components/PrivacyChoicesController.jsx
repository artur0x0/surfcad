import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  applyServerConsent,
  getAnalyticsConsent,
  isGpcActive,
  onConsentChange,
  readStoredRecord,
} from '../utils/consent';
import { applyAnalyticsConsentChoice } from '../utils/applyAnalyticsConsentChoice';
import PrivacyChoicesDialog from './PrivacyChoicesDialog';

/**
 * Footer link or profile menu item + dialog. Works signed out (local only) or signed in (syncs server).
 */
export default function PrivacyChoicesController({
  linkClassName = '',
  buttonClassName = '',
  variant = 'link',
}) {
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
    const record = await applyAnalyticsConsentChoice(next, { isAuthenticated });
    setAnalyticsAllowed(record.analytics);
    setGpcActive(isGpcActive());
  }, [isAuthenticated]);

  const effectiveOn = getAnalyticsConsent();
  const openDialog = () => setOpen(true);

  const trigger = variant === 'profileMenu' ? (
    <button
      type="button"
      data-profile-privacy-choices=""
      className={buttonClassName || 'block w-full px-3 py-1.5 text-left text-xs text-on-dark hover:bg-white/10'}
      onClick={openDialog}
    >
      Privacy choices
    </button>
  ) : (
    <button
      type="button"
      className={linkClassName}
      data-privacy-choices-link=""
      onClick={openDialog}
    >
      Privacy choices
    </button>
  );

  return (
    <>
      {trigger}
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
