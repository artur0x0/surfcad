import { BRANCH_SWITCH_CONFLICT_COPY } from '../utils/git/branchSwitchConflict.js';

const QUIET = 'rounded-md px-3 py-1.5 font-ui text-ui-sm text-on-dark surface-quiet';

/** Copy and buttons for the one branch-switch conflict popup. */
export default function BranchSwitchConflictChoices({
  busy = false,
  onGoBack = null,
  onUseLocal = null,
  onUseRemote = null,
}) {
  return (
    <div data-git-branch-switch-popup="">
      <p className="font-ui text-ui-sm text-on-dark" data-git-branch-switch-conflict="">
        {BRANCH_SWITCH_CONFLICT_COPY}
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2" data-git-branch-switch-choices="">
        <button
          type="button"
          className={QUIET}
          disabled={busy}
          data-ui-action="data-git-branch-switch-go-back"
          data-git-branch-switch-go-back=""
          onClick={() => onGoBack?.()}
        >
          Go back
        </button>
        <button
          type="button"
          className={QUIET}
          disabled={busy}
          data-ui-action="data-git-branch-switch-use-local"
          data-git-branch-switch-use-local=""
          onClick={() => onUseLocal?.()}
        >
          Use local
        </button>
        <button
          type="button"
          className="rounded-md px-3 py-1.5 font-ui text-ui-sm text-on-dark surface-danger"
          disabled={busy}
          data-ui-action="data-git-branch-switch-use-remote"
          data-git-branch-switch-use-remote=""
          onClick={() => onUseRemote?.()}
        >
          Use remote
        </button>
      </div>
    </div>
  );
}
