/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createCloseMenuRegistry, shouldKeepAgentBridgeHostMounted } from '../agent/ws/pairingFlow.js';
import AgentBridgePairing from './AgentBridgePairing';

const AgentBridgeHostContext = createContext({
  link: null,
  paired: false,
  offerSlot: () => {},
  registerCloseMenu: () => () => {},
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
  const [paired, setPaired] = useState(false);
  const [slot, setSlot] = useState(null);
  const closeMenusRef = useRef(null);
  if (closeMenusRef.current == null) closeMenusRef.current = createCloseMenuRegistry();
  const offerSlot = useCallback((node) => {
    setSlot(node || null);
  }, []);
  const registerCloseMenu = useCallback((fn) => closeMenusRef.current.register(fn), []);
  const closeProfileMenu = useCallback(() => {
    closeMenusRef.current.closeAll();
  }, []);
  const onPairingChange = useCallback(({ paired: nextPaired, link: nextLink } = {}) => {
    setPaired(nextPaired === true);
    if (nextLink !== undefined) setLink(nextLink);
  }, []);
  const value = useMemo(
    () => ({ link, paired, offerSlot, registerCloseMenu }),
    [link, paired, offerSlot, registerCloseMenu],
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
          onPairingChange={onPairingChange}
          onBeginFlow={closeProfileMenu}
        />
      ) : null}
      {children}
    </AgentBridgeHostContext.Provider>
  );
}
