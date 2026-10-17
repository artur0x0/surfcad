import { Check, X } from 'lucide-react';

/**
 * Per-client allow/deny prompt for a local MCP peer.
 */
export default function AgentBridgeApprovalPopup({ open, onAllow, onDeny, embedded = false }) {
  if (!open) return null;

  const positionClass = embedded
    ? 'absolute left-0 right-0 -top-2 z-10 -translate-y-full'
    : 'fixed bottom-20 right-3 z-[130]';

  return (
    <div
      role="dialog"
      aria-label="Approve local agent connection"
      className={`${positionClass} flex items-center gap-2 rounded-full border border-chrome-border bg-chrome-surface/95 px-2 py-2 shadow-lg backdrop-blur-sm`}
      data-agent-bridge-approval=""
    >
      <p className="text-[11px] text-chrome-text-secondary px-1 max-w-[9rem]">
        Allow this agent to control SurfCAD?
      </p>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        aria-label="Allow connection"
        onClick={onAllow}
        data-ui-action="data-agent-bridge-approve"
      >
        <Check size={18} aria-hidden />
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-chrome-border text-chrome-text-secondary hover:bg-gray-600 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
        aria-label="Deny connection"
        onClick={onDeny}
        data-ui-action="data-agent-bridge-reject"
      >
        <X size={18} aria-hidden />
      </button>
    </div>
  );
}
