import { createPortal } from 'react-dom';

/**
 * Centered vault dialog. Same shell for Save, Open, branch, the
 * Open assembly choice, and Account.
 */
export default function VaultPickerDialog({
  title,
  labelledBy,
  dataAttr,
  onClose,
  children,
  footer = null,
  headerRight = null,
  panelClassName = '',
  bodyClassName = '',
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center surface-scrim p-4"
      data-git-dialog={dataAttr}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose?.();
        }
      }}
    >
      <div className={`w-full max-w-sm rounded-lg surface-glass border border-chrome-border p-4 shadow-xl font-ui text-on-dark ${panelClassName}`}>
        <div className="flex items-center gap-2" data-git-dialog-header="">
          <h2 id={labelledBy} className="min-w-0 flex-1 text-sm font-semibold text-on-dark">{title}</h2>
          {headerRight}
        </div>
        <div className={`mt-3 ${bodyClassName}`}>{children}</div>
        {footer}
      </div>
    </div>,
    document.body,
  );
}
