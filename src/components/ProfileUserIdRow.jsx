import React, { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import {
  PROFILE_USER_ID_COPIED_MS,
  copyProfileMongoUserId,
  profileMongoUserId,
  profileUserIdRowVisible,
} from './profileUserId.js';

export default function ProfileUserIdRow({ user, signedIn = false, reauth = false }) {
  const visible = profileUserIdRowVisible(signedIn, reauth, user);
  const userId = visible ? profileMongoUserId(user) : '';
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!userId) return;
    const ok = await copyProfileMongoUserId(userId);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), PROFILE_USER_ID_COPIED_MS);
  }, [userId]);

  if (!userId) return null;

  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1" data-profile-user-id-row="">
      <span
        className="min-w-0 flex-1 truncate font-mono text-[10px] text-gray-500"
        data-profile-user-id=""
        title={userId}
      >
        {userId}
      </span>
      <button
        type="button"
        data-profile-user-id-copy=""
        aria-label="Copy user id"
        className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-gray-400
          hover:bg-white/10 hover:text-chrome-text"
        onClick={() => { void handleCopy(); }}
      >
        {copied ? (
          <>
            <Check size={12} className="text-emerald-400" aria-hidden="true" />
            <span className="text-[10px] font-medium text-emerald-400">Copied</span>
          </>
        ) : (
          <Copy size={12} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
