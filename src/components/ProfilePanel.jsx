/**
 * Profile panel from ProfileChip.
 * Signed in: username header, Connect agent, Cart, Account, Sign out.
 * Signed out: Sign in + Clear local cache + Privacy choices.
 * Account opens AccountPane (clear cache, danger zone, privacy).
 */
import React, { useEffect, useRef } from 'react';
import { User } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { shouldDismissProfilePanelOnPointer } from '../agent/ws/agentBridgeChrome.js';
import PrivacyChoicesController from './PrivacyChoicesController';
import ProfileUserIdRow from './ProfileUserIdRow';
import { profileDisplayName } from './profileAccount.js';
import { PROFILE_MENU_ITEM_CLASS } from './profileMenuChrome.js';

export default function ProfilePanel({
  open,
  onClose,
  onSignOut,
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
  onOpenAccount = null,
  align = 'right',
  agentBridgeLive = false,
  agentBridgeSlotRef = null,
}) {
  const { user } = useAuth();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (shouldDismissProfilePanelOnPointer(event, ref.current)) onClose?.();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const name = profileDisplayName(user) || (user ? '' : 'GitHub connected');
  const canClear = typeof onClearLocalCadData === 'function';
  const showAccount = (signedIn || reauth) && typeof onOpenAccount === 'function';

  const alignClass = align === 'left' ? 'left-0' : 'right-0';
  const cartLabel = cartCount > 0 ? `Cart (${cartCount})` : 'Cart';
  const cartButton = showCart ? (
    <button
      type="button"
      data-profile-cart=""
      className={PROFILE_MENU_ITEM_CLASS}
      onClick={() => { onOpenCart?.(); onClose?.(); }}
    >
      {cartLabel}
    </button>
  ) : null;

  const agentSlot = agentBridgeLive ? (
    <div ref={agentBridgeSlotRef} data-agent-bridge-slot="" />
  ) : null;

  const accountButton = showAccount ? (
    <button
      type="button"
      data-profile-account=""
      className={PROFILE_MENU_ITEM_CLASS}
      onClick={() => { onOpenAccount?.(); onClose?.(); }}
    >
      <User size={14} aria-hidden="true" />
      Account
    </button>
  ) : null;

  const identityHeader = (
    <div className="px-3 pb-2 pt-1" data-profile-panel-info="">
      {name ? (
        <p className="truncate text-sm font-medium text-on-dark" data-profile-panel-name="">
          {name}
        </p>
      ) : null}
      <ProfileUserIdRow user={user} signedIn={signedIn} reauth={reauth} />
      {reauth ? (
        <>
          <p className="mt-1 text-xs text-on-dark" data-profile-reauth-copy="">
            GitHub needs a reconnect to open your repo.
          </p>
          {reconnectError ? (
            <p className="mt-1 text-xs text-amber-300" data-profile-reconnect-error="">{reconnectError}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );

  return (
    <div
      ref={ref}
      data-profile-panel=""
      data-profile-panel-mode={reauth ? 'reauth' : (signedIn ? 'signed-in' : 'signed-out')}
      role="dialog"
      aria-label="Profile"
      className={`absolute ${alignClass} top-full z-[60] mt-1 w-64 rounded-md border border-gray-600
        surface-panel text-on-dark font-ui py-2 shadow-xl`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {reauth ? (
        <>
          {identityHeader}
          {agentSlot}
          {cartButton}
          {accountButton}
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
            className={PROFILE_MENU_ITEM_CLASS}
            onClick={() => { void onSignOut?.(); onClose?.(); }}
          >
            Sign out
          </button>
        </>
      ) : !signedIn ? (
        <>
          <button
            type="button"
            data-profile-sign-in=""
            className={PROFILE_MENU_ITEM_CLASS}
            onClick={() => { onSignIn?.(); onClose?.(); }}
          >
            Sign in
          </button>
          {agentSlot}
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
          <div className="my-2 border-t border-chrome-border" data-profile-privacy-divider="" />
          <PrivacyChoicesController variant="profileMenu" />
        </>
      ) : (
        <>
          {identityHeader}
          {agentSlot}
          {cartButton}
          {accountButton}
          <button
            type="button"
            data-profile-sign-out=""
            className={PROFILE_MENU_ITEM_CLASS}
            onClick={() => { void onSignOut?.(); onClose?.(); }}
          >
            Sign out
          </button>
        </>
      )}
    </div>
  );
}
