/**
 * Signed-in Account pane from the profile menu.
 * Read-only user info, then Privacy choices, Clear local cache, Danger zone.
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import AgentRelayAccount from './AgentRelayAccount';
import PrivacyChoicesController from './PrivacyChoicesController';
import ProfileUserIdRow from './ProfileUserIdRow';
import VaultPickerDialog from './VaultPickerDialog';
import {
  profileCreatedDateLabel,
  profileDisplayName,
  profileGithubLinked,
  profilePublicEmail,
  profileSignInProvider,
} from './profileAccount.js';

function InfoRow({ label, value, attr }) {
  if (!value) return null;
  return (
    <div className="py-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-on-dark">{label}</p>
      <p className="truncate text-xs text-on-dark" data-profile-account-field={attr} title={value}>
        {value}
      </p>
    </div>
  );
}

export default function AccountPane({
  open = false,
  onClose,
  onDeleteAccount,
  onClearLocalCadData = null,
  signedIn = true,
  reauth = false,
}) {
  const { user } = useAuth();
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

  if (!open) return null;

  const name = profileDisplayName(user);
  const email = profilePublicEmail(user?.email);
  const provider = profileSignInProvider(user);
  const githubLinked = profileGithubLinked(user);
  const created = profileCreatedDateLabel(user?.createdAt);
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

  const githubStatus = githubLinked
    ? 'Linked'
    : (provider === 'GitHub' ? 'Signed in with GitHub' : 'Not linked');

  return (
    <VaultPickerDialog
      title="Account"
      labelledBy="profile-account-title"
      dataAttr="account"
      onClose={() => {
        if (confirmDelete) {
          setConfirmDelete(false);
          setError('');
          return;
        }
        onClose?.();
      }}
      panelClassName="flex max-h-[calc(100dvh-7rem)] flex-col min-h-0"
      bodyClassName="min-h-0 flex-1 overflow-y-auto rail-scroll"
      footer={(
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            data-profile-account-done=""
            className="rounded-md px-3 py-1.5 text-xs font-medium text-on-dark font-ui surface-success"
            onClick={() => onClose?.()}
          >
            Done
          </button>
        </div>
      )}
    >
      <div data-profile-account-pane="" className="text-on-dark font-ui">
        {confirmDelete ? (
          <div className="px-0 py-1" data-profile-delete-confirm="">
            <p className="text-xs text-on-dark">
              This deletes your SurfCAD account and your GitHub repo
              (usually <span className="font-mono text-on-dark">surfcad-vault</span>).
              This cannot be undone.
            </p>
            {error ? (
              <p className="mt-2 text-xs text-amber-300" data-profile-delete-error="">{error}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                data-profile-delete-cancel=""
                className="rounded-md px-2.5 py-1 text-xs text-on-dark hover:bg-white/10"
                disabled={busy}
                onClick={() => { setConfirmDelete(false); setError(''); }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-profile-delete-confirm-btn=""
                className="rounded-md bg-red-700 px-2.5 py-1 text-xs font-medium text-on-dark hover:bg-red-600
                  disabled:opacity-50"
                disabled={busy}
                onClick={() => { void runDelete(); }}
              >
                {busy ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pb-2" data-profile-account-info="">
              <InfoRow label="Username" value={name} attr="username" />
              <div className="py-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-on-dark">
                  Account id
                </p>
                <ProfileUserIdRow user={user} signedIn={signedIn} reauth={reauth} />
              </div>
              <InfoRow label="Sign-in" value={provider} attr="provider" />
              <InfoRow label="GitHub" value={githubStatus} attr="github" />
              <InfoRow label="Email" value={email} attr="email" />
              <InfoRow label="Created" value={created} attr="created" />
            </div>
            <div className="my-2 border-t border-chrome-border" data-agent-relay-divider="" />
            <AgentRelayAccount open={open} />
            <div className="my-2 border-t border-chrome-border" data-profile-privacy-divider="" />
            <PrivacyChoicesController
              variant="profileMenu"
              buttonClassName="block w-full px-0 py-1.5 text-left text-xs text-on-dark hover:bg-white/10"
            />
            {canClear ? (
              <button
                type="button"
                data-profile-clear-local=""
                data-clear-cache=""
                className="block w-full px-0 py-1.5 text-left text-xs text-amber-200/90 hover:bg-amber-500/15"
                onClick={() => { onClose?.(); void onClearLocalCadData?.(); }}
              >
                Clear local cache
              </button>
            ) : null}
            <div className="my-2 border-t border-chrome-border" data-profile-danger-divider="" />
            <p className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-red-400/90"
              data-profile-danger-zone="">
              Danger zone
            </p>
            <button
              type="button"
              data-profile-delete-account=""
              className="block w-full px-0 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/15"
              onClick={() => setConfirmDelete(true)}
            >
              Delete account
            </button>
          </>
        )}
      </div>
    </VaultPickerDialog>
  );
}
