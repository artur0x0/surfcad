/**
 * SPA page at /git/callback — receives ?code=&state= from GitHub OAuth,
 * POSTs the code to the stateless exchange endpoint, stores the token in
 * sessionStorage, then soft-navs to App. App-user session upsert (G8) is
 * best-effort and must NOT block soft-nav — awaiting /api/auth/github with
 * no budget left Sign-in stuck on a spinner while Manifold never started
 * (Tailscale phone "Loading..." forever after #201).
 *
 * Mounted outside React StrictMode (see main.jsx) so the effect does not
 * double-fire and clear OAuth state before exchange. completeGithubCallback
 * also dedupes by code for defense in depth.
 *
 * Success uses onComplete (soft navigate) when provided so the already-loaded
 * module graph mounts App once. Falls back to location.replace('/') only when
 * mounted without a parent router (tests / unexpected entry).
 */
import { useEffect, useState } from 'react';
import {
  completeGithubCallback,
  establishGithubSession,
  githubRedirectUri,
  GITHUB_OAUTH_STATE_MISSING_HINT,
} from '../utils/git/githubAuth.js';
import {
  finishPopupOAuth,
  isGithubPopupHandoff,
  postPopupOAuthResult,
} from '../utils/git/githubSilentAuth.js';

export default function GitCallback({ onComplete } = {}) {
  const [status, setStatus] = useState('exchanging'); // exchanging | ok | error
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await completeGithubCallback(window.location.search, {
        redirectUri: githubRedirectUri(window.location.origin),
      });
      if (cancelled) return;
      if (isGithubPopupHandoff()) {
        // Silent re-auth. The opener keeps the CAD page; this window only
        // exchanges the code and hands the result back. Token is already in
        // the shared refresh bundle. Do not soft-nav a second App in here.
        postPopupOAuthResult(
          window.opener,
          { ok: !!result.ok, error: result.ok ? '' : (result.error || 'OAuth failed') },
          window.location.origin,
        );
        finishPopupOAuth();
        window.close();
        return;
      }

      if (!result.ok) {
        setStatus('error');
        setError(result.error || 'OAuth failed');
        return;
      }

      // Soft-nav FIRST (same as Connect / #191). Token is already in
      // sessionStorage. Session upsert is best-effort in the background —
      // App's #201 bridge also retries establishGithubSession + checkAuth.
      setStatus('ok');
      window.history.replaceState({}, '', '/');
      if (typeof onComplete === 'function') {
        onComplete();
      } else {
        window.location.replace('/');
      }

      void establishGithubSession({ accessToken: result.token }).then((session) => {
        if (!session.ok) {
          console.warn('[GitCallback] app session upsert failed:', session.error);
        }
      });
    })();
    return () => { cancelled = true; };
  }, [onComplete]);

  const sameOriginHint = error === GITHUB_OAUTH_STATE_MISSING_HINT
    || /OAuth state/i.test(error);

  return (
    <div
      data-git-callback=""
      data-git-callback-status={status}
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-gray-950 px-6 text-gray-200"
    >
      {status === 'exchanging' && (
        <p data-git-callback-busy="">Connecting GitHub…</p>
      )}
      {status === 'ok' && (
        <p data-git-callback-ok="">Connected. Redirecting…</p>
      )}
      {status === 'error' && (
        <>
          <p data-git-callback-error="" className="text-red-400">
            GitHub connect failed: {error}
          </p>
          {sameOriginHint && (
            <p data-git-callback-origin-hint="" className="max-w-md text-center text-sm text-chrome-secondary">
              Open Connect and finish authorization on the same origin
              (same host and port) that you used to start — for example
              {' '}
              <code className="text-gray-300">http://100.106.101.1:&lt;port&gt;/</code>
              {' '}
              if you started there. Do not mix localhost, surfcad.com, and a Tailscale IP.
            </p>
          )}
          <a
            href="/"
            className="rounded border border-gray-600 px-3 py-1 text-sm text-gray-300 hover:bg-gray-800"
          >
            Back to SurfCAD
          </a>
        </>
      )}
    </div>
  );
}
