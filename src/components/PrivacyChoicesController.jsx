import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  applyServerConsent,
  getAnalyticsConsent,
  isGpcActive,
  onConsentChange,
  readStoredRecord,
} from '../utils/consent';
import { openPrivacyChoices } from '../utils/privacyChoicesUi';

/**
 * Footer link or profile menu item. Re-opens the same Accept all / Required only
 * popup via openPrivacyChoices(). Works signed out (local only) or signed in
 * (syncs newer server consent into localStorage).
 */
export default function PrivacyChoicesController({
  linkClassName = '',
  buttonClassName = '',
  variant = 'link',
  onPicked,
}) {
  const { user } = useAuth();
  const [effectiveOn, setEffectiveOn] = useState(() => getAnalyticsConsent());

  useEffect(() => onConsentChange(() => {
    setEffectiveOn(getAnalyticsConsent());
  }), []);

  const serverConsent = user?.consent;
  useEffect(() => {
    if (serverConsent) {
      applyServerConsent(serverConsent);
      setEffectiveOn(getAnalyticsConsent());
    }
  }, [serverConsent]);

  const openChoices = () => {
    onPicked?.();
    openPrivacyChoices();
  };

  const trigger = variant === 'profileMenu' ? (
    <button
      type="button"
      data-profile-privacy-choices=""
      className={buttonClassName || 'block w-full px-3 py-1.5 text-left text-xs text-on-dark hover:bg-white/10'}
      onClick={openChoices}
    >
      Privacy choices
    </button>
  ) : (
    <button
      type="button"
      className={linkClassName}
      data-privacy-choices-link=""
      onClick={openChoices}
    >
      Privacy choices
    </button>
  );

  return (
    <>
      {trigger}
      <span className="sr-only" data-privacy-choices-effective={effectiveOn ? 'on' : 'off'} />
      <span className="sr-only" data-privacy-choices-stored={readStoredRecord().analytics ? 'on' : 'off'} />
      <span className="sr-only" data-privacy-choices-gpc={isGpcActive() ? 'on' : 'off'} />
    </>
  );
}
