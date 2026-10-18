/**
 * Signed-in profile menu + Account pane — golden screenshots at 1280 and 390.
 */
import React, { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Plug } from 'lucide-react';
import ProfilePanel from '../../src/components/ProfilePanel.jsx';
import AccountPane from '../../src/components/AccountPane.jsx';
import PrivacyChoicesController from '../../src/components/PrivacyChoicesController.jsx';
import ProfileUserIdRow from '../../src/components/ProfileUserIdRow.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { PROFILE_MENU_ITEM_CLASS } from '../../src/components/profileMenuChrome.js';
import { SECONDARY_BUTTON_CLASS } from '../../src/components/agentBridgeConnectButton.js';

const MOCK_USER = {
  _id: '6ac6f322b12cb4a9e675fc29',
  name: 'artur0x0',
  email: 'artur0x0@users.noreply.github.com',
  githubId: '12345',
  authProvider: 'github',
  createdAt: '2025-03-12T00:00:00.000Z',
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

function Frame({ children, shot }) {
  return React.createElement(
    'div',
    {
      'data-profile-menu-shot': shot,
      className: 'relative min-h-screen surface-panel font-ui',
    },
    React.createElement(
      'div',
      { className: 'absolute right-4 top-4 z-50' },
      React.createElement(
        'div',
        {
          className: [
            'pointer-events-none flex h-9 w-9 items-center justify-center',
            'rounded-full border border-green-500/50 surface-glass-chip',
            'bg-chrome-surface/55 text-xs font-semibold text-green-300',
          ].join(' '),
        },
        'AR',
      ),
      children,
    ),
  );
}

function ConnectAgentStandIn({ slot }) {
  if (!slot) return null;
  return createPortal(
    React.createElement(
      'button',
      {
        type: 'button',
        className: PROFILE_MENU_ITEM_CLASS,
        'data-agent-bridge-connect': '',
      },
      React.createElement(Plug, { size: 14, 'aria-hidden': true }),
      'Connect agent',
    ),
    slot,
  );
}

function row(className, attrs, ...children) {
  return React.createElement(
    'button',
    { type: 'button', className, ...attrs },
    ...children,
  );
}

/** Playtest 6c0dd38 signed-in dropdown: email, GitHub linked, danger zone, always-on Disconnect. */
function BeforeDropdown() {
  return React.createElement(
    'div',
    {
      'data-profile-panel': '',
      'data-profile-panel-mode': 'signed-in',
      role: 'dialog',
      'aria-label': 'Profile',
      className: [
        'absolute right-0 top-full z-[60] mt-1 w-64 rounded-md border border-gray-600',
        'surface-panel text-on-dark font-ui py-2 shadow-xl',
      ].join(' '),
    },
    React.createElement(
      'div',
      { className: 'px-3 pb-2 pt-1', 'data-profile-panel-info': '' },
      React.createElement(
        'p',
        { className: 'truncate text-sm font-medium text-on-dark', 'data-profile-panel-name': '' },
        MOCK_USER.name,
      ),
      React.createElement(ProfileUserIdRow, {
        user: MOCK_USER,
        signedIn: true,
        reauth: false,
      }),
      React.createElement(
        'p',
        {
          className: 'truncate text-xs text-muted-on-dark',
          'data-profile-panel-email': '',
          title: MOCK_USER.email,
        },
        MOCK_USER.email,
      ),
      React.createElement(
        'p',
        { className: 'mt-0.5 text-[10px] text-muted-on-dark', 'data-profile-panel-github': '' },
        'GitHub linked',
      ),
    ),
    row(
      'block w-full px-3 py-1.5 text-left text-xs font-medium text-on-dark hover:bg-white/10',
      { 'data-profile-cart': '' },
      'Cart',
    ),
    row(
      'block w-full px-3 py-1.5 text-left text-xs text-on-dark hover:bg-white/10',
      { 'data-profile-sign-out': '' },
      'Sign out',
    ),
    row(
      'block w-full px-3 py-1.5 text-left text-xs text-amber-200/90 hover:bg-amber-500/15',
      { 'data-profile-clear-local': '', 'data-clear-cache': '' },
      'Clear local cache',
    ),
    React.createElement('div', {
      className: 'my-2 border-t border-chrome-border',
      'data-profile-danger-divider': '',
    }),
    React.createElement(
      'p',
      {
        className: 'px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-red-400/90',
        'data-profile-danger-zone': '',
      },
      'Danger zone',
    ),
    row(
      'block w-full px-3 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/15',
      { 'data-profile-delete-account': '' },
      'Delete account',
    ),
    React.createElement('div', {
      className: 'my-2 border-t border-chrome-border',
      'data-profile-privacy-divider': '',
    }),
    React.createElement(PrivacyChoicesController, { variant: 'profileMenu' }),
    React.createElement('div', {
      className: 'my-2 border-t border-chrome-border',
      'data-profile-agent-bridge-divider': '',
    }),
    React.createElement(
      'div',
      { className: 'relative px-3 py-2 space-y-2', 'data-agent-bridge-pairing': '' },
      React.createElement(
        'button',
        {
          type: 'button',
          className: SECONDARY_BUTTON_CLASS,
          'data-agent-bridge-disconnect': '',
        },
        'Disconnect',
      ),
    ),
  );
}

function AfterShot({ showAccount = false }) {
  const [slot, setSlot] = useState(null);
  const [accountOpen, setAccountOpen] = useState(showAccount);

  useLayoutEffect(() => {
    if (showAccount) setAccountOpen(true);
  }, [showAccount]);

  return React.createElement(
    Frame,
    { shot: showAccount ? 'account' : 'dropdown' },
    React.createElement(ProfilePanel, {
      open: !accountOpen,
      signedIn: true,
      reauth: false,
      showCart: true,
      cartCount: 0,
      onClose: () => {},
      onSignOut: async () => {},
      onOpenAccount: () => setAccountOpen(true),
      agentBridgeLive: true,
      agentBridgeSlotRef: setSlot,
    }),
    React.createElement(ConnectAgentStandIn, { slot }),
    React.createElement(AccountPane, {
      open: accountOpen,
      signedIn: true,
      reauth: false,
      onClose: () => setAccountOpen(false),
      onDeleteAccount: async () => {},
      onClearLocalCadData: async () => {},
    }),
  );
}

export function renderProfileMenuShot(el, { showAccount = false, before = false } = {}) {
  installAuthMock();
  const params = new URLSearchParams(window.location.search);
  const account = showAccount || params.get('account') === '1';
  const isBefore = before || params.get('before') === '1';
  const tree = isBefore
    ? React.createElement(Frame, { shot: 'before' }, React.createElement(BeforeDropdown))
    : React.createElement(AfterShot, { showAccount: account });
  createRoot(el).render(React.createElement(AuthProvider, null, tree));
  window.__READY__ = true;
}
