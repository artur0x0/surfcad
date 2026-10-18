// main.js
import { StrictMode, Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import GitCallback from './components/GitCallback';
import PartnersPage from './pages/PartnersPage.jsx';
import PrivacyPage from './pages/PrivacyPage.jsx';
import { AuthProvider } from './hooks/useAuth';
import { GithubSessionProvider } from './hooks/useGithubSession';
import { GITHUB_CALLBACK_PATH } from './utils/git/githubAuth.js';
import SentryErrorBoundary from './components/SentryErrorBoundary.jsx';
import SentryUserSync from './components/SentryUserSync.jsx';
import PrivacyConsentController from './components/PrivacyConsentController.jsx';
import { bootstrapSentry } from './utils/sentryClient.js';
import { applyGpcDefaultOnFirstVisit } from './utils/consent.js';

// eslint-disable-next-line react-refresh/only-export-components -- Entry shell, not an HMR boundary.
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));

bootstrapSentry();
applyGpcDefaultOnFirstVisit();

const PARTNERS_PATH = '/partners';
const PRIVACY_PATH = '/privacy';
const ADMIN_PATH = '/admin';

function pathIsGitCallback(pathname = window.location.pathname) {
  return String(pathname || '').replace(/\/$/, '') === GITHUB_CALLBACK_PATH;
}

function pathIsPartners(pathname = window.location.pathname) {
  return String(pathname || '').replace(/\/$/, '') === PARTNERS_PATH;
}

function pathIsPrivacy(pathname = window.location.pathname) {
  return String(pathname || '').replace(/\/$/, '') === PRIVACY_PATH;
}

function pathIsAdmin(pathname = window.location.pathname) {
  return String(pathname || '').replace(/\/$/, '') === ADMIN_PATH;
}

/**
 * Path-based shell so /git/callback can hand off to App without a second
 * full document load. Connect already left the origin for GitHub; coming
 * back loads this bundle once for the callback. location.replace('/') used
 * to reload the whole graph (including the ~2MB sandbox worker) and could
 * stick forever on the Manifold "Loading..." gate on mobile / Tailscale.
 *
 * GitCallback stays outside StrictMode: Strict remount double-fires the
 * OAuth effect and would clear sessionStorage state before the exchange.
 */
/* Entry shell — not a HMR boundary. */
// eslint-disable-next-line react-refresh/only-export-components -- Root is the createRoot tree, not a shared export
function Root() {
  const [gitCallback, setGitCallback] = useState(() => pathIsGitCallback());
  const [partnersPage, setPartnersPage] = useState(() => pathIsPartners());
  const [privacyPage, setPrivacyPage] = useState(() => pathIsPrivacy());
  const [adminPage, setAdminPage] = useState(() => pathIsAdmin());

  const goHome = useCallback(() => {
    if (pathIsGitCallback()) {
      window.history.replaceState({}, '', '/');
    }
    setGitCallback(false);
    setPartnersPage(pathIsPartners());
    setPrivacyPage(pathIsPrivacy());
    setAdminPage(pathIsAdmin());
  }, []);

  useEffect(() => {
    const sync = () => {
      setGitCallback(pathIsGitCallback());
      setPartnersPage(pathIsPartners());
      setPrivacyPage(pathIsPrivacy());
      setAdminPage(pathIsAdmin());
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  if (gitCallback) {
    return (
      <SentryErrorBoundary>
        <GitCallback onComplete={goHome} />
      </SentryErrorBoundary>
    );
  }

  if (partnersPage) {
    return (
      <SentryErrorBoundary>
        <AuthProvider>
          <SentryUserSync />
          <PartnersPage />
          <PrivacyConsentController />
        </AuthProvider>
      </SentryErrorBoundary>
    );
  }

  if (privacyPage) {
    return (
      <SentryErrorBoundary>
        <AuthProvider>
          <SentryUserSync />
          <PrivacyPage />
          <PrivacyConsentController />
        </AuthProvider>
      </SentryErrorBoundary>
    );
  }

  if (adminPage) {
    return (
      <SentryErrorBoundary>
        <AuthProvider>
          <SentryUserSync />
          <Suspense
            fallback={(
              <div className="surface-light text-on-light font-ui flex h-dvh items-center justify-center">
                Loading…
              </div>
            )}
          >
            <AdminPage />
          </Suspense>
        </AuthProvider>
      </SentryErrorBoundary>
    );
  }

  return (
    <SentryErrorBoundary>
      <StrictMode>
        <AuthProvider>
          <SentryUserSync />
          <GithubSessionProvider>
            <App />
          </GithubSessionProvider>
          <PrivacyConsentController />
        </AuthProvider>
      </StrictMode>
    </SentryErrorBoundary>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
