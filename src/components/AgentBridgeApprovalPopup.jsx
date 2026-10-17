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
      className="flex items-center gap-2 rounded-full border border-chrome-border surface-glass font-ui px-2 py-2"
      data-agent-bridge-approval=""
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="text-ui-xs text-on-dark px-1 max-w-[9rem]">
        Allow this agent to control SurfCAD?
      </p>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full surface-success text-on-dark"
        aria-label="Allow connection"
        onClick={onAllow}
        data-ui-action="data-agent-bridge-approve"
      >
        <Check size={18} aria-hidden />
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full surface-quiet text-on-dark"
        aria-label="Deny connection"
        onClick={onDeny}
        data-ui-action="data-agent-bridge-reject"
      >
        <X size={18} aria-hidden />
      </button>
    </div>
  );
}
