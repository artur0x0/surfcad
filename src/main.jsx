// main.js
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import GitCallback from './components/GitCallback';
import PartnersPage from './pages/PartnersPage.jsx';
import { AuthProvider } from './hooks/useAuth';
import { GithubSessionProvider } from './hooks/useGithubSession';
import { GITHUB_CALLBACK_PATH } from './utils/git/githubAuth.js';

const PARTNERS_PATH = '/partners';

function pathIsGitCallback(pathname = window.location.pathname) {
  return String(pathname || '').replace(/\/$/, '') === GITHUB_CALLBACK_PATH;
}

function pathIsPartners(pathname = window.location.pathname) {
  return String(pathname || '').replace(/\/$/, '') === PARTNERS_PATH;
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

  const goHome = useCallback(() => {
    if (pathIsGitCallback()) {
      window.history.replaceState({}, '', '/');
    }
    setGitCallback(false);
    setPartnersPage(pathIsPartners());
  }, []);

  useEffect(() => {
    const sync = () => {
      setGitCallback(pathIsGitCallback());
      setPartnersPage(pathIsPartners());
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  if (gitCallback) {
    return <GitCallback onComplete={goHome} />;
  }

  if (partnersPage) {
    return <PartnersPage />;
  }

  return (
    <StrictMode>
      <AuthProvider>
        <GithubSessionProvider>
          <App />
        </GithubSessionProvider>
      </AuthProvider>
    </StrictMode>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
