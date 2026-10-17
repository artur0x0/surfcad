/**
 * Profile menu with Mongo user id row — golden screenshots.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import ProfilePanel from '../../src/components/ProfilePanel.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';

const MOCK_USER = {
  _id: '507f1f77bcf86cd799439011',
  email: 'artur@surfcad.com',
  firstName: 'Artur',
  lastName: 'Demo',
  githubId: '12345',
};

function installAuthMock() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, ...rest) => {
    const href = String(url);
    if (href.includes('/api/auth/me')) {
      return {
        ok: true,
        json: async () => ({ authenticated: true, user: MOCK_USER }),
      };
    }
    if (href.includes('/api/auth/logout')) {
      return { ok: true, json: async () => ({}) };
    }
    return realFetch(url, ...rest);
  };
}

function Shot() {
  return React.createElement(
    'div',
    {
      'data-profile-user-id-shot': '',
      style: {
        position: 'relative',
        minHeight: '100vh',
        background: '#111827',
        padding: '4rem 1rem 1rem',
      },
    },
    React.createElement(ProfilePanel, {
      open: true,
      signedIn: true,
      reauth: false,
      onClose: () => {},
      onSignOut: async () => {},
      onDeleteAccount: async () => {},
    }),
  );
}

export function renderProfileUserIdShot(el) {
  installAuthMock();
  createRoot(el).render(
    React.createElement(AuthProvider, null, React.createElement(Shot)),
  );
  window.__PROFILE_USER_ID__ = MOCK_USER._id;
  window.__READY__ = true;
}
