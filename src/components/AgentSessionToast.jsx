import ErrorPopup from './ErrorPopup.jsx';
import {
  AGENT_CONNECTED_TOAST_COPY,
  AGENT_CONNECTED_TOAST_MS,
  AGENT_DISCONNECTED_TOAST_COPY,
} from '../agent/ws/pairingFlow.js';

const POSITION_CLASS = 'fixed top-16 left-1/2 z-[140] w-[min(100vw-1.5rem,24rem)] -translate-x-1/2';

/**
 * Green "Agent connected" / "Agent disconnected" card. Presentational only:
 * when it opens, and for how long, stays in pairingFlow.
 * `className` replaces the fixed position (the 390px golden stacks two cards).
 */
export default function AgentSessionToast({
  kind,
  onDismiss,
  onDisconnect,
  onReconnect,
  className = '',
}) {
  const connected = kind === 'connected';
  return (
    <div
      className={className || POSITION_CLASS}
      data-agent-toast-ms={AGENT_CONNECTED_TOAST_MS}
      data-agent-bridge-connected-toast={connected ? '' : undefined}
      data-agent-bridge-disconnected-toast={connected ? undefined : ''}
    >
      <ErrorPopup
        tone="success"
        onDismiss={onDismiss}
        action={connected ? (
          <button
            type="button"
            className="toast-action text-ui-sm font-semibold text-on-dark surface-quiet"
            onClick={onDisconnect}
            data-ui-action="data-agent-connected-toast-disconnect"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="toast-action text-ui-sm font-semibold text-on-dark surface-quiet"
            onClick={onReconnect}
            data-ui-action="data-agent-disconnected-toast-reconnect"
          >
            Reconnect
          </button>
        )}
      >
        {connected ? AGENT_CONNECTED_TOAST_COPY : AGENT_DISCONNECTED_TOAST_COPY}
      </ErrorPopup>
    </div>
  );
}
