import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { syncSentryUserId } from '../utils/sentryClient.js';

/** Sets hashed user id on Sentry when DSN is configured. */
export default function SentryUserSync() {
  const { user, isAuthenticated } = useAuth();
  useEffect(() => {
    const rawId = isAuthenticated ? (user?.id || user?._id) : null;
    void syncSentryUserId(rawId ? String(rawId) : null);
  }, [isAuthenticated, user?.id, user?._id]);
  return null;
}
