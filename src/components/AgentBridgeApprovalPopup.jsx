import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import {
  APPROVAL_POPUP_WIDE_MIN_PX,
  approvalPopupPositionClass,
} from '../agent/ws/agentBridgeChrome.js';

function useViewportWidth() {
  const [width, setWidth] = useState(() => (
    typeof window === 'undefined' ? 1280 : window.innerWidth
  ));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

/**
 * Per-client allow/deny prompt for a local MCP peer.
 */
export default function AgentBridgeApprovalPopup({ open, onAllow, onDeny, embedded = false }) {
  const viewportWidth = useViewportWidth();
  if (!open) return null;

  const positionClass = approvalPopupPositionClass(embedded ? null : viewportWidth, { embedded });
  const anchor = embedded
    ? undefined
    : (viewportWidth < APPROVAL_POPUP_WIDE_MIN_PX ? 'under-chip' : 'bottom-center');

  return (
    <div
      role="dialog"
      aria-label="Approve local agent connection"
      className={`${positionClass} flex items-center gap-2 rounded-full border border-chrome-border bg-chrome-surface/95 px-2 py-2 shadow-lg backdrop-blur-sm`}
      data-agent-bridge-approval=""
      data-agent-bridge-approval-portal={embedded ? undefined : ''}
      data-agent-bridge-approval-anchor={anchor}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="text-[11px] text-chrome-text px-1 max-w-[9rem]">
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
        className="flex h-9 w-9 items-center justify-center rounded-full bg-chrome-border text-chrome-secondary hover:bg-gray-600 hover:text-chrome-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chrome-text"
        aria-label="Deny connection"
        onClick={onDeny}
        data-ui-action="data-agent-bridge-reject"
      >
        <X size={18} aria-hidden />
      </button>
    </div>
  );
}
