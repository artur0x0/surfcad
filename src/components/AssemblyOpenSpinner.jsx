import ErrorPopup from './ErrorPopup';
import { assemblyOpenLabel } from '../utils/assemblyOpenOverlay';

/**
 * Centered spinner over the viewport while an assembly opens.
 * pointer-events-none and z below the error toasts so Retry stays clickable.
 * The ring reuses the boot loader's border spinner (`animate-spin`).
 */
export default function AssemblyOpenSpinner({ name, index = 0, total = 0 }) {
  const { label, detail } = assemblyOpenLabel(name, { index, total });
  return (
    <div
      className="absolute inset-0 z-[45] flex items-center justify-center pointer-events-none surface-scrim"
      data-assembly-open-spinner=""
      data-assembly-open-name={name || 'assembly'}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="px-4 text-center text-white" data-assembly-open-card="">
        <div
          className="animate-spin motion-reduce:animate-none rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"
          data-assembly-open-ring=""
        />
        <p className="text-sm" data-assembly-open-label="">{label}</p>
        {detail ? (
          <p className="mt-1 text-xs text-gray-300" data-assembly-open-progress="">{detail}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Same ErrorPopup shell as other failures, with Retry. */
export function AssemblyOpenFailureToast({ message, onRetry = null, onDismiss = null }) {
  return (
    <div
      className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md pointer-events-auto"
      data-assembly-open-toast=""
    >
      <ErrorPopup
        tone="banner"
        onDismiss={onDismiss}
        className="px-4 py-2"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span data-assembly-open-toast-msg="">{message}</span>
          {typeof onRetry === 'function' && (
            <button
              type="button"
              data-assembly-open-retry=""
              className="shrink-0 rounded-md bg-white/15 px-2 py-0.5 text-[11px] font-semibold hover:bg-white/25"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
        </div>
      </ErrorPopup>
    </div>
  );
}
