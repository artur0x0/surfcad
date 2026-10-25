import ErrorPopup from './ErrorPopup';
import { assemblyOpenLabel, resolveAssemblyOpenName } from '../utils/assemblyOpenOverlay';

/**
 * Centered spinner while an assembly opens. Opaque viewport ground
 * (`surface-dark`), so the assembly already on screen does not show through.
 * pointer-events-none and z below the error toasts so Retry stays clickable.
 * The ring reuses the boot loader's spin (`animate-spin`).
 */
export default function AssemblyOpenSpinner({ name, index = 0, total = 0 }) {
  const display = resolveAssemblyOpenName(name);
  const { label, detail } = assemblyOpenLabel(display, { index, total });
  return (
    <div
      className="absolute inset-0 z-[45] flex items-center justify-center pointer-events-none surface-dark font-ui text-on-dark"
      data-assembly-open-spinner=""
      data-assembly-open-name={display}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="px-4 text-center" data-assembly-open-card="">
        <div
          className="assembly-open-ring animate-spin motion-reduce:animate-none rounded-full h-12 w-12 mx-auto mb-4"
          data-assembly-open-ring=""
        />
        <p className="text-ui" data-assembly-open-label="">{label}</p>
        {detail ? (
          <p className="mt-1 text-ui-sm text-muted-on-dark" data-assembly-open-progress="">{detail}</p>
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
