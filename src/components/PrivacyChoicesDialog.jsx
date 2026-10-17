import VaultPickerDialog from './VaultPickerDialog';
import PrivacyChoicesDialogPanel from './PrivacyChoicesDialogPanel';

/**
 * Analytics opt-out dialog (controlled). Dark chrome to match vault dialogs.
 */
export default function PrivacyChoicesDialog({
  open = false,
  onClose,
  analyticsAllowed = true,
  gpcActive = false,
  onAnalyticsChange,
}) {
  if (!open) return null;

  return (
    <VaultPickerDialog
      title="Privacy choices"
      labelledBy="privacy-choices-title"
      dataAttr="privacy-choices"
      onClose={onClose}
      footer={(
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            data-ui-action="data-privacy-choices-done"
            data-privacy-choices-done=""
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      )}
    >
      <PrivacyChoicesDialogPanel
        analyticsAllowed={analyticsAllowed}
        gpcActive={gpcActive}
        onAnalyticsChange={onAnalyticsChange}
      />
    </VaultPickerDialog>
  );
}
