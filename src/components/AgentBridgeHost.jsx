/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { shouldKeepAgentBridgeHostMounted } from '../agent/ws/pairingFlow.js';
import AgentBridgePairing from './AgentBridgePairing';

const AgentBridgeHostContext = createContext({
  link: null,
  offerSlot: () => {},
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
  const offerSlot = useCallback((node) => {
    setSlot(node || null);
  }, []);
  const value = useMemo(() => ({ link, offerSlot }), [link, offerSlot]);
  const mount = shouldKeepAgentBridgeHostMounted({ agentBridgeLive: enabled });

  return (
    <AgentBridgeHostContext.Provider value={value}>
      {mount ? (
        <AgentBridgePairing
          enabled
          embedded
          uiTarget={slot}
          onConnectionChange={setLink}
        />
      ) : null}
      {children}
    </AgentBridgeHostContext.Provider>
  );
}
