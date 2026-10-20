import { useEffect } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import VaultPickerDialog from './VaultPickerDialog';
import {
  PARTS_DIALOG_BTN_GHOST,
  PARTS_DIALOG_BTN_PRIMARY,
  PARTS_TEXT_INPUT_CLASS,
  PARTS_TEXT_INPUT_STYLE,
} from '../utils/partsChrome.js';
import { NO_REPO_YET_COPY } from '../utils/git/workingSidecar.js';

const ROW_TRASH = 'shrink-0 rounded p-1 text-gray-500 hover:bg-red-500/15 hover:text-red-300';
const DANGER_BTN = 'rounded-md bg-red-600 text-xs font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:hover:bg-red-600';

/**
 * One Open assembly row: the name opens it, the trash asks before delete.
 * Same control on the folder → Assembly list and the git open search.
 */
export function AssemblyOpenRow({
  name,
  label,
  current = false,
  item = null,
  onOpen,
  onDelete,
}) {
  return (
    <li className="flex items-center gap-1" data-git-open-assembly-row={name}>
      <button
        type="button"
        data-git-open-item={name}
        data-git-open-item-id={item?.id || undefined}
        data-git-open-kind="assembly"
        data-git-open-current={current ? 'true' : undefined}
        className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-xs text-chrome-text hover:bg-white/10"
        onClick={() => onOpen?.(name, item)}
      >
        <span className="block truncate">{label || name}</span>
        {current ? <span className="text-[10px] text-gray-500">open now</span> : null}
      </button>
      <button
        type="button"
        data-assembly-delete={name}
        title={`Delete ${name}`}
        aria-label={`Delete assembly ${name}`}
        className={ROW_TRASH}
        onClick={(event) => {
          event.stopPropagation();
          onDelete?.(name);
        }}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

export function AssemblyOpenList({ items, current, currentId = '', onOpen, onDelete }) {
  return (
    <ul className="max-h-64 space-y-1 overflow-y-auto" data-git-open-list="">
      {(items || []).map((item) => (
        <AssemblyOpenRow
          key={item.id || item.name}
          name={item.name}
          label={item.label || item.name}
          // A v2 row is current by id (names may repeat); a v1 folder by name.
          current={item.id ? item.id === currentId : item.name === current}
          item={item}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

/**
 * Delete assembly? Name, part count, parts other assemblies still use,
 * and two actions plus Cancel. Keep-parts leaves files in /parts and is
 * the primary. Deleting the part files stays disabled until the assembly
 * name is typed. A copy another assembly uses moves to /parts either way.
 */
function DeleteButtonFace({ label, spinning, which }) {
  return (
    <>
      <span className={spinning ? 'invisible' : undefined}>{label}</span>
      {spinning ? (
        <span
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          data-assembly-delete-spinner={which}
        >
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        </span>
      ) : null}
    </>
  );
}

export default function DeleteAssemblyDialog({
  assemblyName,
  partCount = 0,
  referenced = [],
  typed = '',
  loading = false,
  busy = false,
  busyAction = '',
  error = '',
  onTyped,
  onKeep,
  onDrop,
  onClose,
}) {
  const count = Number(partCount) || 0;
  const countLabel = `${count} ${count === 1 ? 'part' : 'parts'}`;
  const confirmed = String(typed || '').trim() === assemblyName;
  const locked = loading || busy;
  const keepSpinning = busy && busyAction === 'keep';
  const dropSpinning = busy && busyAction === 'drop';
  // Capture Escape even when focus is still in the list underneath. A delete
  // in flight swallows it; otherwise this popup closes and the list stays.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (locked) return;
      onClose?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [locked, onClose]);
  return (
    <VaultPickerDialog
      title="Delete assembly?"
      labelledBy="assembly-delete-title"
      dataAttr="delete-assembly"
      onClose={locked ? undefined : onClose}
      footer={(
        <div className="mt-4 flex flex-col gap-2" data-assembly-delete-actions="">
          <button
            type="button"
            data-assembly-delete-keep=""
            className={`relative inline-flex h-10 w-full items-center justify-center disabled:cursor-not-allowed ${keepSpinning ? '' : 'disabled:opacity-40'} ${PARTS_DIALOG_BTN_PRIMARY}`}
            disabled={locked}
            aria-busy={keepSpinning ? 'true' : 'false'}
            onClick={() => onKeep?.()}
          >
            <DeleteButtonFace label="Delete assembly, keep parts" spinning={keepSpinning} which="keep" />
          </button>
          <button
            type="button"
            data-assembly-delete-parts=""
            data-assembly-delete-parts-enabled={confirmed && !locked ? 'true' : 'false'}
            className={`relative inline-flex h-10 w-full items-center justify-center disabled:cursor-not-allowed ${dropSpinning ? '' : 'disabled:opacity-40'} ${DANGER_BTN}`}
            disabled={locked || !confirmed}
            aria-busy={dropSpinning ? 'true' : 'false'}
            onClick={() => onDrop?.()}
          >
            <DeleteButtonFace label="Delete assembly and its parts" spinning={dropSpinning} which="drop" />
          </button>
          <button
            type="button"
            className={`inline-flex h-10 w-full items-center justify-center disabled:cursor-not-allowed disabled:opacity-40 ${PARTS_DIALOG_BTN_GHOST}`}
            onClick={onClose}
            data-git-dialog-cancel=""
            disabled={locked}
          >
            Cancel
          </button>
        </div>
      )}
    >
      {loading && (
        <div data-assembly-delete-checking="">
          <p className="text-xs text-chrome-secondary" data-git-dialog-loading="">Checking parts…</p>
          <div
            className="mt-2 h-4 w-4 animate-spin motion-reduce:animate-none rounded-full border-b-2 border-white"
            data-assembly-delete-checking-spinner=""
            role="status"
            aria-label="Checking parts"
          />
        </div>
      )}
      {!loading && (
        <>
          <p className="text-xs text-gray-300" data-assembly-delete-summary="">
            <span className="font-medium text-chrome-text" data-assembly-delete-name="">{assemblyName}</span>
            {' has '}
            <span data-assembly-delete-count={String(count)}>{countLabel}</span>
            .
          </p>
          <p className="mt-2 text-xs text-chrome-secondary" data-assembly-delete-rules="">
            Keeping parts leaves files in /parts where they are. Deleting parts removes a script only when no other assembly uses it. A copy another assembly uses moves to /parts.
          </p>
          {referenced.length > 0 && (
            <div className="mt-3" data-assembly-delete-kept="">
              <p className="text-xs text-gray-200" data-assembly-delete-kept-heading="">
                These parts are used elsewhere and will be kept in /parts
              </p>
              <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                {referenced.map((part) => (
                  <li
                    key={part.path || part.name}
                    className="text-xs text-gray-300"
                    data-assembly-delete-kept-part={part.name}
                  >
                    <span className="text-chrome-text">{part.name}</span>
                    <span className="text-gray-500" data-assembly-delete-kept-by="">
                      {` — ${(part.assemblies || []).join(', ')}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="mt-3 block text-xs text-chrome-secondary" htmlFor="assembly-delete-confirm">
            {`Type ${assemblyName} to delete its parts`}
          </label>
          <input
            id="assembly-delete-confirm"
            data-assembly-delete-confirm-input=""
            className={`mt-1 ${PARTS_TEXT_INPUT_CLASS}`}
            style={PARTS_TEXT_INPUT_STYLE}
            value={typed}
            autoComplete="off"
            disabled={locked}
            onChange={(event) => onTyped?.(event.target.value)}
          />
        </>
      )}
      {error && (
        <p
          className={error === NO_REPO_YET_COPY
            ? 'mt-2 font-ui text-ui-sm text-on-dark'
            : 'mt-2 text-xs text-amber-300'}
          data-assembly-delete-error=""
          data-git-no-repo={error === NO_REPO_YET_COPY ? '' : undefined}
        >
          {error}
        </p>
      )}
    </VaultPickerDialog>
  );
}
