/**
 * Profile panel from ProfileChip.
 * Signed in: user info, Sign out, Clear local cache, Danger zone → Delete account.
 * Signed out: Sign in + Clear local cache.
 * Clear local cache opens the confirm popup in App (ClearCacheDialog).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import PrivacyChoicesController from './PrivacyChoicesController';

function displayName(user) {
  if (!user) return '';
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`;
  if (user.firstName || user.lastName) return user.firstName || user.lastName;
  if (user.name) return user.name;
  return user.email || '';
}

export default function ProfilePanel({
  open,
  onClose,
  onSignOut,
  onDeleteAccount,
  onSignIn = null,
  onClearLocalCadData = null,
  onReconnect = null,
  reconnecting = false,
  reconnectError = '',
  signedIn = true,
  reauth = false,
  showCart = false,
  cartCount = 0,
  onOpenCart = null,
  align = 'right',
  agentBridgeLive = false,
  agentBridgeSlotRef = null,
}) {
  const { user } = useAuth();
  const ref = useRef(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setConfirmDelete(false);
      setBusy(false);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose?.();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        if (confirmDelete) setConfirmDelete(false);
        else onClose?.();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, confirmDelete]);

  if (!open) return null;

  const name = displayName(user) || (user ? '' : 'GitHub connected');
  const email = user?.email || '';
  const loginHint = user?.githubId
    ? 'GitHub linked'
    : (!user ? 'Signed in with GitHub' : null);
  const canClear = typeof onClearLocalCadData === 'function';

  const runDelete = async () => {
    setBusy(true);
    setError('');
    try {
      await onDeleteAccount?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not delete account');
      setBusy(false);
    }
  };

  const alignClass = align === 'left' ? 'left-0' : 'right-0';
  const cartLabel = cartCount > 0 ? `Cart (${cartCount})` : 'Cart';
  const cartButton = showCart ? (
    <button
      type="button"
      data-profile-cart=""
      className="block w-full px-3 py-1.5 text-left text-xs font-medium text-emerald-200 hover:bg-white/10"
      onClick={() => { onOpenCart?.(); onClose?.(); }}
    >
      {cartLabel}
    </button>
  ) : null;

  return (
    <div
      ref={ref}
      data-profile-panel=""
      data-profile-panel-mode={reauth ? 'reauth' : (signedIn ? 'signed-in' : 'signed-out')}
      role="dialog"
      aria-label="Account"
      className={`absolute ${alignClass} top-full z-[60] mt-1 w-64 rounded-md border border-gray-600
        bg-chrome-surface py-2 shadow-xl`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {confirmDelete ? (
        <div className="px-3 py-1" data-profile-delete-confirm="">
          <p className="text-xs text-gray-200">
            This deletes your SurfCAD account and your GitHub repo
            (usually <span className="font-mono text-chrome-text">surfcad-vault</span>).
            This cannot be undone.
          </p>
          {error ? (
            <p className="mt-2 text-xs text-amber-300" data-profile-delete-error="">{error}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              data-profile-delete-cancel=""
              className="rounded-md px-2.5 py-1 text-xs text-gray-200 hover:bg-white/10"
              disabled={busy}
              onClick={() => { setConfirmDelete(false); setError(''); }}
            >
              Cancel
            </button>
            <button
              type="button"
              data-profile-delete-confirm-btn=""
              className="rounded-md bg-red-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-600
                disabled:opacity-50"
              disabled={busy}
              onClick={() => { void runDelete(); }}
            >
              {busy ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </div>
      ) : reauth ? (
        <>
          <div className="px-3 pb-2 pt-1" data-profile-panel-info="">
            {name ? (
              <p className="truncate text-sm font-medium text-chrome-text" data-profile-panel-name="">
                {name}
              </p>
            ) : null}
            {email ? (
              <p className="truncate text-xs text-chrome-secondary" data-profile-panel-email="" title={email}>
                {email}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-gray-300" data-profile-reauth-copy="">
              GitHub needs a reconnect to open your repo.
            </p>
            {reconnectError ? (
              <p className="mt-1 text-xs text-amber-300" data-profile-reconnect-error="">{reconnectError}</p>
            ) : null}
          </div>
          {cartButton}
          <button
            type="button"
            data-profile-reconnect=""
            className="block w-full px-3 py-1.5 text-left text-xs font-medium text-amber-100 hover:bg-white/10"
            disabled={reconnecting}
            onClick={() => { onReconnect?.(); }}
          >
            {reconnecting ? 'Reconnecting…' : 'Reconnect'}
          </button>
          <button
            type="button"
            data-profile-sign-out=""
            className="block w-full px-3 py-1.5 text-left text-xs text-chrome-text hover:bg-white/10"
            onClick={() => { void onSignOut?.(); onClose?.(); }}
          >
            Sign out
          </button>
          {canClear ? (
            <button
              type="button"
              data-profile-clear-local=""
              data-clear-cache=""
              className="block w-full px-3 py-1.5 text-left text-xs text-amber-200/90 hover:bg-amber-500/15"
              onClick={() => { onClose?.(); void onClearLocalCadData?.(); }}
            >
              Clear local cache
            </button>
          ) : null}
        </>
      ) : !signedIn ? (
        <>
          <button
            type="button"
            data-profile-sign-in=""
            className="block w-full px-3 py-1.5 text-left text-xs text-chrome-text hover:bg-white/10"
            onClick={() => { onSignIn?.(); onClose?.(); }}
          >
            Sign in
          </button>
          {canClear ? (
            <button
              type="button"
              data-profile-clear-local=""
              data-clear-cache=""
              className="block w-full px-3 py-1.5 text-left text-xs text-amber-200/90 hover:bg-amber-500/15"
              onClick={() => { onClose?.(); void onClearLocalCadData?.(); }}
            >
              Clear local cache
            </button>
          ) : null}
        </>
      ) : (
        <>
          <div className="px-3 pb-2 pt-1" data-profile-panel-info="">
            {name ? (
              <p className="truncate text-sm font-medium text-chrome-text" data-profile-panel-name="">
                {name}
              </p>
            ) : null}
            {email ? (
              <p className="truncate text-xs text-chrome-secondary" data-profile-panel-email="" title={email}>
                {email}
              </p>
            ) : null}
            {loginHint ? (
              <p className="mt-0.5 text-[10px] text-gray-500" data-profile-panel-github="">{loginHint}</p>
            ) : null}
          </div>
          {cartButton}
          <button
            type="button"
            data-profile-sign-out=""
            className="block w-full px-3 py-1.5 text-left text-xs text-chrome-text hover:bg-white/10"
            onClick={() => { void onSignOut?.(); onClose?.(); }}
          >
            Sign out
          </button>
          {canClear ? (
            <button
              type="button"
              data-profile-clear-local=""
              data-clear-cache=""
              className="block w-full px-3 py-1.5 text-left text-xs text-amber-200/90 hover:bg-amber-500/15"
              onClick={() => { onClose?.(); void onClearLocalCadData?.(); }}
            >
              Clear local cache
            </button>
          ) : null}
          <div className="my-2 border-t border-chrome-border" data-profile-danger-divider="" />
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-red-400/90"
            data-profile-danger-zone="">
            Danger zone
          </p>
          <button
            type="button"
            data-profile-delete-account=""
            className="block w-full px-3 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/15"
            onClick={() => setConfirmDelete(true)}
          >
            Delete account
          </button>
        </>
      )}
      <div className="my-2 border-t border-chrome-border" data-profile-privacy-divider="" />
      <PrivacyChoicesController variant="profileMenu" />
      {agentBridgeLive ? (
        <>
          <div className="my-2 border-t border-chrome-border" data-profile-agent-bridge-divider="" />
          <div ref={agentBridgeSlotRef} data-agent-bridge-slot="" />
        </>
      ) : null}
    </div>
  );
}
