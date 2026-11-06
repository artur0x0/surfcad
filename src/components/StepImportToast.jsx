import { Loader2 } from 'lucide-react';
import ErrorPopup from './ErrorPopup';

export const STEP_NOTICES_HREF = '/THIRD_PARTY_NOTICES.txt';

/**
 * Shown while a STEP file is being converted. The conversion runs on the
 * device with Open CASCADE Technology (LGPL-2.1), and this card is where the
 * app says so: the link opens the notices file that carries the licence and
 * where the source is. See packages/surfcad-step/LICENSES.md.
 *
 * It has no dismiss control. App.jsx removes it when the import settles. It
 * does not carry data-upload-toast: that marks the error and notice cards.
 */
export default function StepImportToast() {
  return (
    <div
      className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md"
      data-step-importing=""
    >
      <ErrorPopup
        tone="cyan"
        layout="stacked"
        role="status"
        aria-live="polite"
        title={(
          <span className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin shrink-0" aria-hidden="true" />
            Importing…
          </span>
        )}
      >
        STEP files are converted on this device with Open CASCADE Technology.{' '}
        <a
          href={STEP_NOTICES_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-white pointer-events-auto"
          data-step-notices-link=""
        >
          Open-source notices
        </a>
      </ErrorPopup>
    </div>
  );
}
