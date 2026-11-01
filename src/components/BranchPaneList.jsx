import { GitMerge, Loader2, Trash2 } from 'lucide-react';

/**
 * Branch list inside the Branches pane. Merge sits on the current row,
 * right of the CURRENT label, and is hidden when that row is the default
 * branch (main). The name truncates; the label and Merge do not.
 */
export default function BranchPaneList({
  items = [],
  currentBranch = '',
  defaultBranch = 'main',
  onSwitch = null,
  onDelete = null,
  onMerge = null,
}) {
  const base = String(defaultBranch || 'main').trim() || 'main';
  return (
    <ul className="max-h-56 space-y-1 overflow-y-auto rail-scroll list-scroll" data-git-branch-dialog-list="">
      {(items || []).map((b) => {
        const current = !!b.current || b.name === currentBranch;
        const creating = !!b.pending;
        const canDelete = b.name !== base && !current && !creating;
        const showMerge = current && !creating && b.name !== base;
        return (
          <li
            key={b.name}
            className="flex min-w-0 items-center gap-1"
            data-git-branch-pending={creating ? 'true' : undefined}
            data-git-branch-row-wrap={b.name}
          >
            <button
              type="button"
              data-git-branch-row={b.name}
              data-git-branch-current={current ? 'true' : 'false'}
              disabled={current || creating}
              className={`flex min-w-0 flex-1 items-center rounded px-2 py-1.5 text-left text-xs ${
                current
                  ? 'bg-blue-600/20 text-blue-200'
                  : 'text-chrome-text hover:bg-white/10'
              } disabled:cursor-default`}
              onClick={() => onSwitch?.(b.name)}
            >
              <span className="min-w-0 flex-1 truncate font-mono">{b.name}</span>
            </button>
            {creating ? (
              <Loader2 size={14} className="shrink-0 animate-spin text-sky-300" data-git-branch-pending-spinner="" />
            ) : null}
            {current && !creating ? (
              <span className="shrink-0 whitespace-nowrap text-[9px] uppercase tracking-wide text-blue-300" data-git-branch-marker="">
                current
              </span>
            ) : null}
            {showMerge ? (
              <button
                type="button"
                data-git-branch-action="merge"
                data-git-branch-merge=""
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 font-ui text-ui-sm text-on-dark surface-quiet"
                onClick={() => { void onMerge?.(); }}
              >
                <GitMerge size={16} aria-hidden="true" />
                Merge
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                data-git-branch-action="delete"
                data-git-branch-delete-row={b.name}
                title={`Delete ${b.name}`}
                aria-label={`Delete branch ${b.name}`}
                className="shrink-0 rounded p-1 text-gray-500 hover:bg-red-500/15 hover:text-red-300"
                onClick={() => onDelete?.(b.name)}
              >
                <Trash2 size={14} />
              </button>
            ) : (!showMerge && !creating ? (
              <span className="w-6 shrink-0 text-center text-[9px] text-gray-600" title="protected">·</span>
            ) : null)}
          </li>
        );
      })}
    </ul>
  );
}
