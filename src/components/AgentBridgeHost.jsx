/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { shouldKeepAgentBridgeHostMounted } from '../agent/ws/pairingFlow.js';
import AgentBridgePairing from './AgentBridgePairing';

const AgentBridgeHostContext = createContext({
  link: null,
  offerSlot: () => {},
  registerCloseMenu: () => {},
});

/**
 * Live pairing socket + Allow/Deny live here, not on ProfileChip. App mounts
 * this once above the isMobile split so a 768px resize cannot steal the tabKey
 * or hide the portal.
 */
export function useAgentBridgeHost() {
  return useContext(AgentBridgeHostContext);
}

export default function AgentBridgeHost({ enabled = false, children }) {
  const [link, setLink] = useState(null);
  const [slot, setSlot] = useState(null);
  const closeMenuRef = useRef(() => {});
  const offerSlot = useCallback((node) => {
    setSlot(node || null);
  }, []);
  const registerCloseMenu = useCallback((fn) => {
    closeMenuRef.current = typeof fn === 'function' ? fn : () => {};
  }, []);
  const closeProfileMenu = useCallback(() => {
    closeMenuRef.current();
  }, []);
  const value = useMemo(
    () => ({ link, offerSlot, registerCloseMenu }),
    [link, offerSlot, registerCloseMenu],
  );
  const mount = shouldKeepAgentBridgeHostMounted({ agentBridgeLive: enabled });

  return (
    <AgentBridgeHostContext.Provider value={value}>
      {mount ? (
        <AgentBridgePairing
          enabled
          embedded
          uiTarget={slot}
          onConnectionChange={setLink}
          onBeginFlow={closeProfileMenu}
        />
      ) : null}
      {children}
    </AgentBridgeHostContext.Provider>
  );
}
