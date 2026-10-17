/**
 * Profile chip — CAD viewport (absolute). Parts ribbon + Script toolbar (inline)
 * mount only at mobile widths.
 *
 * Look comes from the shared GitHub session phase (same signal as Open):
 * green when GitHub is connected, grey with an exclamation when the SurfCAD
 * session is in but GitHub needs a reconnect, grey user icon when signed out.
 * A tap on the grey reauth chip spins and tries refresh, then a silent
 * OAuth popup. Reconnect is the full-page flow, only after that fails.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, User } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useAuthState } from '../hooks/useAuthState';
import { chipView } from '../utils/authPhase.js';
import { agentBridgeRingLabel, agentBridgeRingState } from '../agent/ws/agentBridgeChrome.js';
import { profileInitials } from '../utils/profileInitials.js';
import { clearGithubToken, loadGithubToken } from '../utils/git/githubAuth.js';
import { DEFAULT_VAULT_NAME } from '../utils/git/vault.js';
import ProfilePanel from './ProfilePanel';
import { useCartChrome } from '../hooks/useCart';

export default function ProfileChip({
  onAccount,
  onSignedOut = null,
  onClearLocalCadData = null,
  vaultName = DEFAULT_VAULT_NAME,
  variant = 'viewport',
  agentBridgeLive = false,
}) {
  const { user, guest, isGuest, logout, checkAuth } = useAuth();
  const session = useAuthState();
  const cartChrome = useCartChrome();
  const cartCount = session.signedIn ? (cartChrome?.count || 0) : 0;
  const [panelOpen, setPanelOpen] = useState(false);
  const [agentBridgeLink, setAgentBridgeLink] = useState(null);
  const phase = session.phase;
  const motion = session.reconnecting
    ? 'spinning'
    : (session.offerReconnect ? 'reconnect' : 'idle');
  const view = chipView({ phase, motion });
  const signedIn = session.githubConnected;
  const reauth = session.needsReconnect;
  const canClear = typeof onClearLocalCadData === 'function';
  const showIdentity = signedIn || reauth;

  useEffect(() => {
    if (variant === 'viewport' && reauth && session.offerReconnect) setPanelOpen(true);
  }, [variant, reauth, session.offerReconnect]);

  const label = useMemo(
    () => profileInitials({
      user: showIdentity ? user : null,
      guest: (!showIdentity && (isGuest || guest)) ? (guest || true) : null,
      isAuthenticated: showIdentity,
    }),
    [user, guest, isGuest, showIdentity],
  );

  const title = signedIn
    ? (user?.email || user?.name || 'Account')
    : reauth
      ? 'Reconnect GitHub'
      : (isGuest || guest)
        ? 'Guest — sign in'
        : 'Sign in';

  const tone = signedIn
    ? 'border-green-500/50 text-green-300 hover:bg-green-500/15'
    : 'border-gray-500/50 text-chrome-secondary hover:bg-gray-500/15';

  const inline = variant === 'inline';
  const shell = inline
    ? `pointer-events-auto relative z-10 flex h-7 w-7 shrink-0 items-center
        justify-center rounded-full border surface-glass-chip bg-chrome-surface/55
        text-[10px] font-semibold tracking-wide transition-colors
        active:opacity-80 ${tone}`
    : `pointer-events-auto absolute top-4 right-4 z-50 flex h-9 w-9 items-center
        justify-center rounded-full border surface-glass-chip bg-chrome-surface/55
        text-xs font-semibold tracking-wide shadow-lg transition-colors
        active:opacity-80 ${tone}`;

  const iconSize = inline ? 14 : 16;
  const wrapClass = inline
    ? 'pointer-events-auto relative z-10 shrink-0'
    : 'pointer-events-auto absolute top-4 right-4 z-50 relative';

  const startReconnect = () => {
    if (session.offerReconnect) session.reconnectInteractive();
    else void session.reconnect();
  };

  const handleClick = () => {
    if (reauth) {
      if (session.reconnecting) return;
      if (session.offerReconnect) {
        setPanelOpen(true);
        return;
      }
      void session.reconnect();
      return;
    }
    // Clear and/or local agent pairing live in the account panel.
    if (canClear || agentBridgeLive) {
      setPanelOpen((open) => !open);
      return;
    }
    // Green chip = GitHub connected. Always open the account panel.
    if (signedIn) {
      setPanelOpen((open) => !open);
      return;
    }
    onAccount?.();
  };

  const handleSignOut = async () => {
    clearGithubToken();
    session.markNeedsReauth();
    await logout();
    onSignedOut?.();
  };

  const handleDeleteAccount = async () => {
    const token = loadGithubToken();
    const res = await fetch('/api/auth/account', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_token: token || undefined,
        vault_name: vaultName || DEFAULT_VAULT_NAME,
      }),
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      throw new Error(body?.error || `Delete failed (${res.status})`);
    }
    clearGithubToken();
    session.markNeedsReauth();
    await checkAuth();
    onSignedOut?.();
  };

  const showPanel = signedIn || reauth || canClear || agentBridgeLive;
  const agentRing = agentBridgeLive ? agentBridgeRingState(agentBridgeLink) : null;

  return (
    <div className={wrapClass} data-profile-chip-wrap="">
      {agentRing ? (
        <span
          className={`agent-bridge-profile-ring agent-bridge-profile-ring--${agentRing} pointer-events-none absolute inset-0 rounded-full`}
          data-agent-bridge-connection-ring={agentRing}
          title={agentBridgeRingLabel(agentRing)}
          aria-hidden="true"
        />
      ) : null}
      <button
        type="button"
        data-profile-chip=""
        data-profile-chip-variant={variant}
        data-profile-chip-state={view.spinner ? 'spinning' : (view.reconnect ? 'reconnect' : view.auth)}
        data-profile-initials={label || (signedIn ? 'user' : 'out')}
        data-profile-auth={view.auth}
        aria-busy={view.spinner ? 'true' : 'false'}
        aria-expanded={showPanel ? (panelOpen ? 'true' : 'false') : undefined}
        aria-haspopup={showPanel ? 'dialog' : undefined}
        onClick={handleClick}
        onPointerDown={(e) => e.stopPropagation()}
        title={title}
        aria-label={title}
        className={inline
          ? shell.replace('relative z-10 ', '')
          : shell.replace('absolute top-4 right-4 z-50 ', '')}
      >
        {view.spinner ? (
          <Loader2 size={iconSize} className="animate-spin" aria-hidden="true" data-profile-spinner="" />
        ) : label ? (
          <span className="select-none" aria-hidden="true">{label}</span>
        ) : (
          <User size={iconSize} aria-hidden="true" strokeWidth={2.25} data-profile-icon="user" />
        )}
      </button>
      {view.badge ? (
        <span
          data-profile-badge="reauth"
          className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center
            justify-center rounded-full bg-amber-400 text-[9px] font-bold leading-none text-gray-950"
          aria-hidden="true"
        >
          !
        </span>
      ) : null}
      {cartCount > 0 ? (
        <button
          type="button"
          data-cart-badge=""
          data-cart-count={cartCount}
          className="absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center
            rounded-full bg-emerald-500 px-1 text-[9px] font-bold leading-none text-gray-950"
          aria-label={`Cart, ${cartCount}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            cartChrome?.openCart?.();
          }}
        >
          {cartCount > 99 ? '99+' : cartCount}
        </button>
      ) : null}
      {showPanel && (
        <ProfilePanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          onSignOut={handleSignOut}
          onDeleteAccount={handleDeleteAccount}
          onSignIn={canClear ? () => { onAccount?.(); } : null}
          onClearLocalCadData={canClear ? onClearLocalCadData : null}
          onReconnect={startReconnect}
          reconnecting={session.reconnecting}
          reconnectError={session.lastError}
          signedIn={signedIn}
          reauth={reauth}
          showCart={session.signedIn}
          cartCount={cartCount}
          onOpenCart={session.signedIn ? () => cartChrome?.openCart?.() : null}
          align="right"
          agentBridgeLive={agentBridgeLive}
          onAgentBridgeConnectionChange={setAgentBridgeLink}
        />
      )}
      {variant === 'viewport' && reauth && session.bootEmpty ? (
        <div
          data-reauth-empty=""
          className="pointer-events-auto fixed left-1/2 top-[28%] z-[70] w-[min(20rem,calc(100%-2rem))]
            -translate-x-1/2 rounded-lg border border-gray-600 bg-gray-950/95 px-4 py-4 text-center shadow-xl"
        >
          <p className="text-sm font-medium text-chrome-text">Reconnect GitHub</p>
          <p className="mt-1 text-xs text-chrome-secondary" data-reauth-empty-copy="">
            Nothing new was created. Reconnect to open your repo.
          </p>
          <button
            type="button"
            data-profile-reconnect=""
            className="mt-3 rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-gray-950"
            onClick={startReconnect}
          >
            Reconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
