/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  createLiveAgentPromptTransport,
  shouldUseLiveAgentPrompt,
} from '../agent/agentPromptLive.js';
import { clearFolded, writeFolded } from '../agent/agentPromptFold.js';
import {
  AGENT_CHAT_CLEAR_EVENT,
  AGENT_CHAT_RESTORE_GRACE_MS,
  agentChatStorage,
  agentChatUserId,
  clearAgentChatPersist,
  nextAgentChatShell,
  readAgentChatPersist,
  stepAgentReport,
  writeAgentChatPersist,
} from '../agent/ws/agentChatPersist.js';
import {
  createCloseMenuRegistry,
  shouldKeepAgentBridgeHostMounted,
  shouldOpenAgentChatOnConnect,
  shouldShowAgentBridgeDisconnect,
} from '../agent/ws/pairingFlow.js';
import { forcesServerRelay, readPhoneWidth } from '../agent/ws/relayPreference.js';
import { useAuth } from '../hooks/useAuth';
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
  chatHold: null,
  agentGone: false,
  rememberChatOpen: () => {},
});

function readForcedServer() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  try {
    return forcesServerRelay({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      innerWidth: window.innerWidth,
      isMobile: readPhoneWidth(window),
    });
  } catch {
    return false;
  }
}

function bootChatRestore() {
  const forced = readForcedServer();
  if (!forced) return { forced, record: null };
  return { forced, record: readAgentChatPersist(agentChatStorage()) };
}

/**
 * Live pairing socket + Allow/Deny live here, not on ProfileChip. App mounts
 * this once above the isMobile split so a 768px resize cannot steal the tabKey
 * or hide the portal.
 *
 * A Safari/iOS reload paints the last open or collapsed chat immediately.
 * That bit is not a live agent: paired, the ring, and Disconnect stay off
 * until the socket reports.
 */
export function useAgentBridgeHost() {
  return useContext(AgentBridgeHostContext);
}

export default function AgentBridgeHost({ enabled = false, children }) {
  const { user, isLoading } = useAuth();
  const bootRef = useRef(null);
  if (bootRef.current == null) bootRef.current = bootChatRestore();
  const recordRef = useRef(bootRef.current.record);
  const dropRestoreRef = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;
  const [link, setLink] = useState(null);
  const [paired, setPaired] = useState(false);
  const [agentChatOpen, setAgentChatOpen] = useState(() => bootRef.current.record?.open === true);
  const [holdOpen, setHoldOpen] = useState(() => (
    bootRef.current.record ? bootRef.current.record.open === true : null
  ));
  const [gone, setGone] = useState(false);
  const [report, setReport] = useState('pending');
  const [forcedServer, setForcedServer] = useState(bootRef.current.forced);
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
  const rememberChatOpen = useCallback((open) => {
    const next = open === true;
    dropRestoreRef.current = false;
    setAgentChatOpen(next);
    setHoldOpen((prev) => (prev == null ? null : next));
    if (recordRef.current) recordRef.current = { ...recordRef.current, open: next };
    writeFolded(!next);
    const id = agentChatUserId(userRef.current);
    if (id) writeAgentChatPersist(agentChatStorage(), id, next);
  }, []);
  const openAgentChat = useCallback(() => {
    rememberChatOpen(true);
  }, [rememberChatOpen]);
  const closeAgentChat = useCallback(() => {
    setGone(false);
    rememberChatOpen(false);
  }, [rememberChatOpen]);
  const wasConnectedRef = useRef(false);
  const pairedRef = useRef(false);
  const linkRef = useRef(null);
  pairedRef.current = paired;
  linkRef.current = link;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const apply = () => setForcedServer(readForcedServer());
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onClear = (event) => {
      recordRef.current = null;
      dropRestoreRef.current = true;
      setReport('cleared');
      setHoldOpen(null);
      setGone(false);
      const close = event?.detail?.close !== false;
      const live = shouldShowAgentBridgeDisconnect({
        paired: pairedRef.current,
        link: linkRef.current,
      });
      if (close || !live) setAgentChatOpen(false);
    };
    window.addEventListener(AGENT_CHAT_CLEAR_EVENT, onClear);
    return () => window.removeEventListener(AGENT_CHAT_CLEAR_EVENT, onClear);
  }, []);

  const onAgentReport = useCallback((event) => {
    setReport((prev) => stepAgentReport(prev, event));
  }, []);

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

  useEffect(() => {
    if (report !== 'grace' || !recordRef.current) return undefined;
    const timer = setTimeout(() => {
      setReport((prev) => stepAgentReport(prev, 'grace-elapsed'));
    }, AGENT_CHAT_RESTORE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [report]);

  useEffect(() => {
    const connected = shouldShowAgentBridgeDisconnect({ paired, link });
    const record = recordRef.current;
    const restoring = forcedServer && report !== 'cleared' && record;
    if (restoring) {
      const shell = nextAgentChatShell({
        record,
        userId: agentChatUserId(user),
        authPending: isLoading === true,
        forcedServer: true,
        report,
        live: connected,
      });
      if (shell.clear) {
        recordRef.current = null;
        clearAgentChatPersist(agentChatStorage());
        dropRestoreRef.current = true;
        if (!shell.gone) clearFolded();
      }
      if (shell.adopt) recordRef.current = null;
      if (shell.hold) {
        if (holdOpen !== shell.open) setHoldOpen(shell.open);
        if (gone) setGone(false);
        if (agentChatOpen !== shell.open) setAgentChatOpen(shell.open);
      } else if (shell.gone) {
        if (holdOpen !== null) setHoldOpen(null);
        if (!gone) setGone(true);
        if (agentChatOpen !== shell.open) setAgentChatOpen(shell.open);
      } else if (shell.adopt) {
        // Keep the hold until the live transport is already in state.
        // Dropping it a render early unmounts the shell (the flicker).
        if (gone) setGone(false);
        if (agentChatOpen !== shell.open) setAgentChatOpen(shell.open);
        if (promptTransport && holdOpen !== null) setHoldOpen(null);
      } else {
        if (holdOpen !== null) setHoldOpen(null);
        if (gone) setGone(false);
        if (agentChatOpen) setAgentChatOpen(false);
      }
      wasConnectedRef.current = connected;
      return;
    }

    if (gone) {
      if (connected) setGone(false);
      wasConnectedRef.current = connected;
      return;
    }

    if (wasConnectedRef.current && !connected) {
      clearAgentChatPersist(agentChatStorage());
      dropRestoreRef.current = true;
    }
    if (shouldOpenAgentChatOnConnect(wasConnectedRef.current, connected)) openAgentChat();
    if (!connected) setAgentChatOpen(false);
    // A restore adopts before the prompt transport exists. Leave the hold
    // up through that render so the shell does not collapse and return.
    if (holdOpen !== null && (!connected || promptTransport)) setHoldOpen(null);
    wasConnectedRef.current = connected;
  }, [
    agentChatOpen, forcedServer, gone, holdOpen, isLoading, link, openAgentChat,
    paired, promptTransport, report, user,
  ]);

  useEffect(() => {
    if (gone || dropRestoreRef.current) return;
    const id = agentChatUserId(user);
    if (!id || isLoading) return;
    const connected = shouldShowAgentBridgeDisconnect({ paired, link });
    if (holdOpen == null && !connected) return;
    const open = holdOpen == null ? agentChatOpen : holdOpen;
    writeAgentChatPersist(agentChatStorage(), id, open);
  }, [agentChatOpen, gone, holdOpen, isLoading, link, paired, user]);

  const chatHold = useMemo(
    () => (holdOpen == null ? null : { open: holdOpen === true }),
    [holdOpen],
  );
  const value = useMemo(
    () => ({
      link, paired, promptTransport, offerSlot, registerCloseMenu,
      agentChatOpen, openAgentChat, closeAgentChat,
      chatHold, agentGone: gone, rememberChatOpen,
    }),
    [
      link, paired, promptTransport, offerSlot, registerCloseMenu,
      agentChatOpen, openAgentChat, closeAgentChat,
      chatHold, gone, rememberChatOpen,
    ],
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
          onAgentReport={onAgentReport}
          onBeginFlow={closeProfileMenu}
        />
      ) : null}
      {children}
    </AgentBridgeHostContext.Provider>
  );
}
