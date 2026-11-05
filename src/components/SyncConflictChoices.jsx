/**
 * The "Conflict with main" popup's three choices, one row.
 *
 * Shown when an assembly opens or reloads with local changes queued and a
 * remote tip that moved since the last sync (the outbox hold). Nothing has
 * been written when it opens.
 *
 * - Go back: close; the local changes stay queued.
 * - Keep mine: write the queued local files over the remote tip (the only
 *   force-write; `git_force_overwrite` for agents). Other remote files stay.
 * - Get remote: drop the queued local changes and reload from the tip.
 */

const QUIET = 'whitespace-nowrap rounded-md px-3 py-1.5 font-ui text-ui-sm text-on-dark surface-quiet';
const DANGER = 'whitespace-nowrap rounded-md px-3 py-1.5 font-ui text-ui-sm text-on-dark surface-danger';

export default function SyncConflictChoices({
  busy = false,
  onGoBack = null,
  onKeepMine = null,
  onGetRemote = null,
}) {
  return (
    <div className="flex flex-nowrap justify-end gap-2" data-git-conflict-choices="">
      <button
        type="button"
        className={QUIET}
        disabled={busy}
        onClick={() => onGoBack?.()}
        data-git-keep-branch=""
        data-git-conflict-stay=""
      >
        Go back
      </button>
      <button
        type="button"
        className={DANGER}
        disabled={busy}
        data-ui-action="data-git-conflict-overwrite"
        data-git-force-merge=""
        data-git-conflict-overwrite=""
        onClick={() => onKeepMine?.()}
      >
        Keep mine
      </button>
      <button
        type="button"
        className={QUIET}
        disabled={busy}
        data-ui-action="data-git-conflict-get-remote"
        data-git-conflict-get-remote=""
        onClick={() => onGetRemote?.()}
      >
        Get remote
      </button>
    </div>
  );
}
