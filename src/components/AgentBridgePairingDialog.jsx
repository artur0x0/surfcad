import { createPortal } from 'react-dom';

/**
 * Standalone Connect Agent dialog (not inside the profile menu).
 * Centered on every width with extra bottom padding so it cannot sit on the
 * page-footer Privacy choices link.
 */
export default function AgentBridgePairingDialog({ open, onDismiss, children, transport }) {
  if (!open) return null;
  const target = typeof document !== 'undefined' ? document.body : null;
  if (!target) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center surface-scrim p-4 pb-14"
      data-agent-bridge-dialog=""
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-bridge-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss?.();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="w-full max-w-sm max-h-[calc(100dvh-7rem)] overflow-y-auto rail-scroll rounded-lg surface-glass border border-chrome-border p-4 shadow-xl font-ui text-on-dark"
        data-agent-bridge-dialog-card=""
        data-agent-bridge-panel=""
        data-agent-bridge-transport={transport}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id="agent-bridge-dialog-title" className="text-ui font-semibold text-on-dark">
          Connect Agent
        </h2>
        <div className="mt-3 space-y-3">{children}</div>
      </div>
    </div>,
    target,
  );
}
