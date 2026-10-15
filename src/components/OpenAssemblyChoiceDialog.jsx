import VaultPickerDialog from './VaultPickerDialog';
import {
  PARTS_DIALOG_BTN_COMPACT,
  PARTS_DIALOG_BTN_GHOST,
  PARTS_DIALOG_BTN_PRIMARY,
  PARTS_DIALOG_BTN_SECONDARY,
} from '../utils/partsChrome.js';

/**
 * "Open assembly?" — one dialog for every entry (folder → Assembly list,
 * and that list's git open search). Three actions, one right-aligned row,
 * including on a 375px phone.
 */
export default function OpenAssemblyChoiceDialog({
  assemblyName,
  loading = false,
  error = '',
  onClose,
  onInsert,
  onOpen,
}) {
  return (
    <VaultPickerDialog
      title="Open assembly?"
      labelledBy="git-open-choice-title"
      dataAttr="open-choice"
      onClose={loading ? undefined : onClose}
      footer={(
        <div
          className="mt-4 -mx-2 flex flex-nowrap items-center justify-end gap-1 min-w-0"
          data-git-open-choice-stage=""
        >
          <button
            type="button"
            className={`${PARTS_DIALOG_BTN_COMPACT} ${PARTS_DIALOG_BTN_GHOST}`}
            onClick={onClose}
            data-git-dialog-cancel=""
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            data-git-open-insert=""
            data-ui-action="data-git-open-insert"
            className={`${PARTS_DIALOG_BTN_COMPACT} ${PARTS_DIALOG_BTN_SECONDARY}`}
            disabled={loading}
            onClick={onInsert}
          >
            Insert parts into current
          </button>
          <button
            type="button"
            data-git-open-replace=""
            data-ui-action="data-git-open-replace"
            className={`${PARTS_DIALOG_BTN_COMPACT} ${PARTS_DIALOG_BTN_PRIMARY}`}
            disabled={loading}
            onClick={onOpen}
          >
            Open assembly
          </button>
        </div>
      )}
    >
      {loading && <p className="text-xs text-chrome-secondary" data-git-dialog-loading="">Inserting…</p>}
      {!loading && (
        <p className="text-xs text-gray-300" data-git-open-choice-ask="">
          {'Open '}
          <span className="font-medium text-chrome-text">{assemblyName}</span>
          {' as the working assembly, or insert its parts into the current one?'}
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-amber-300" data-git-open-choice-error="">{error}</p>
      )}
    </VaultPickerDialog>
  );
}
