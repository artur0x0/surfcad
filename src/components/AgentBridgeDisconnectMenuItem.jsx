import { Unplug } from 'lucide-react';
import { PROFILE_MENU_ITEM_CLASS } from './profileMenuChrome.js';

/**
 * Profile-menu row that drops the local agent relay.
 * Same row chrome as Connect agent (14px lucide icon, gap-2).
 */
export default function AgentBridgeDisconnectMenuItem({ onDisconnect }) {
  return (
    <button
      type="button"
      className={PROFILE_MENU_ITEM_CLASS}
      onClick={onDisconnect}
      data-ui-action="data-agent-bridge-disconnect"
      data-agent-bridge-chip=""
    >
      <Unplug size={14} aria-hidden />
      Disconnect
    </button>
  );
}
