import { canFallBackToPopupBridge } from '../agent/ws/connectionErrors.js';
import { SECONDARY_BUTTON_CLASS } from './agentBridgeConnectButton.js';

/**
 * Local agent panel copy for the Safari popup bridge: what the window is,
 * the Disconnected state with Reconnect, blocked pop-ups, and the switch to
 * the bridge when a direct socket is blocked. Renders nothing on the direct
 * path unless that socket was blocked.
 *
 * @param {{
 *   mode: 'direct' | 'popup' | 'unsupported',
 *   issue: string | null,
 *   token: string,
 *   state: string,
 *   browserFamily: string,
 *   copied: string | null,
 *   onReconnect: () => void,
 *   onUsePopup: () => void,
 *   onCopyLink: () => void,
 * }} props
 */
export default function AgentBridgePopupStatus({
  mode, issue, token, state, browserFamily, copied, onReconnect, onUsePopup, onCopyLink,
}) {
  if (mode === 'direct') {
    if (issue !== 'browser_blocked' || !canFallBackToPopupBridge(browserFamily)) return null;
    return (
      <button
        type="button"
        className={`${SECONDARY_BUTTON_CLASS} mb-2`}
        onClick={onUsePopup}
        data-ui-action="data-agent-bridge-use-popup"
      >
        Use bridge window
      </button>
    );
  }
  if (mode !== 'popup') return null;

  const windowGone = issue === 'bridge_closed' || issue === 'popup_blocked';
  const showReconnect = !!token && state === 'idle' && windowGone;

  return (
    <div className="text-ui-xs mb-2 font-ui" data-agent-bridge-popup-status="">
      {!windowGone && (
        <p className="text-muted-on-dark" data-agent-bridge-popup-intro="">
          This browser reaches the local agent through a small SurfCAD bridge window. Keep it open while the
          agent works.
        </p>
      )}
      {issue === 'bridge_closed' && (
        <div
          className="rounded border border-amber-500/40 bg-amber-950/40 px-2 py-2 text-amber-100 mb-2"
          data-agent-bridge-error="bridge_closed"
        >
          <p className="font-medium mb-1">Disconnected</p>
          <p>The SurfCAD local agent bridge window was closed. Click Reconnect to open it again, then allow the agent.</p>
        </div>
      )}
      {issue === 'popup_blocked' && (
        <div
          className="rounded border border-chrome-border/80 surface-panel px-2 py-2 mb-2"
          data-agent-bridge-error="popup_blocked"
        >
          <p className="text-on-dark mb-1.5">
            Your browser blocked the bridge window. Allow pop-ups for this site, then click Reconnect.
          </p>
          <p className="text-muted-on-dark mb-2">If pop-ups must stay blocked, pairing works in Chrome for now.</p>
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            onClick={onCopyLink}
            data-ui-action="data-agent-bridge-copy-link"
          >
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}
      {showReconnect && (
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          onClick={onReconnect}
          data-ui-action="data-agent-bridge-reconnect"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}
