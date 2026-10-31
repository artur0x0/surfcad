/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  createLiveAgentPromptTransport,
  shouldUseLiveAgentPrompt,
} from '../agent/agentPromptLive.js';
import {
  createCloseMenuRegistry,
  shouldKeepAgentBridgeHostMounted,
  shouldShowAgentBridgeDisconnect,
} from '../agent/ws/pairingFlow.js';
import AgentBridgePairing from './AgentBridgePairing';

const AgentBridgeHostContext = createContext({
  link: null,
  paired: false,
  promptTransport: null,
  offerSlot: () => {},
  registerCloseMenu: () => () => {},
  agentChatOpen: false,
  openAgentChat: () => {},
  closeAgentChat: () => {},
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
  const [agentChatOpen, setAgentChatOpen] = useState(false);
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
  const openAgentChat = useCallback(() => setAgentChatOpen(true), []);
  const closeAgentChat = useCallback(() => setAgentChatOpen(false), []);
  useEffect(() => {
    if (!shouldShowAgentBridgeDisconnect({ paired, link })) setAgentChatOpen(false);
  }, [paired, link]);
  const onPairingChange = useCallback(({ paired: nextPaired, link: nextLink } = {}) => {
    setPaired(nextPaired === true);
    if (nextLink !== undefined) setLink(nextLink);
  }, []);
  const livePrompt = shouldUseLiveAgentPrompt({ paired, link });
  const [promptTransport, setPromptTransport] = useState(null);
  useEffect(() => {
    if (!livePrompt) {
      setPromptTransport(null);
      return undefined;
    }
    let cancelled = false;
    let created = null;
    const assign = () => {
      if (cancelled || created) return;
      created = createLiveAgentPromptTransport();
      if (created) setPromptTransport(created);
    };
    assign();
    const retry = setTimeout(assign, 0);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      setPromptTransport(null);
    };
  }, [livePrompt]);
  const value = useMemo(
    () => ({
      link, paired, promptTransport, offerSlot, registerCloseMenu,
      agentChatOpen, openAgentChat, closeAgentChat,
    }),
    [link, paired, promptTransport, offerSlot, registerCloseMenu, agentChatOpen, openAgentChat, closeAgentChat],
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
