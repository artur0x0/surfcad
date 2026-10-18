import { Check, X } from 'lucide-react';

/**
 * Per-client allow/deny prompt for a local MCP peer.
 * Renders in-flow inside the Connect Agent dialog (replaces the pairing code).
 */
export default function AgentBridgeApprovalPopup({ open, onAllow, onDeny }) {
  if (!open) return null;

  return (
    <div
      role="group"
      aria-label="Approve local agent connection"
      className="w-max max-w-full rounded-full border border-chrome-border surface-glass font-ui px-2 py-2 text-left"
      data-agent-bridge-approval=""
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="inline align-middle px-1 text-ui-xs text-on-dark">
        Allow this agent to control SurfCAD?
      </p>
      <span className="ml-2 inline-flex items-center gap-2 align-middle whitespace-nowrap">
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full surface-success text-on-dark"
          aria-label="Allow connection"
          onClick={onAllow}
          data-ui-action="data-agent-bridge-approve"
        >
          <Check size={18} aria-hidden />
        </button>
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full surface-quiet text-on-dark"
          aria-label="Deny connection"
          onClick={onDeny}
          data-ui-action="data-agent-bridge-reject"
        >
          <X size={18} aria-hidden />
        </button>
      </span>
    </div>
  );
}
