import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Plug } from 'lucide-react';
import { createPairingToken } from '../agent/ws/pairingToken.js';
import { createAgentBridgeTabConnection } from '../agent/ws/tabConnection.js';
import { createAgentBridgeTransport } from '../agent/ws/agentBridgeTransport.js';
import { isAgentBridgeAutoApprove } from '../agent/ws/autoApprove.js';
import { agentBridgeTransportOverride, defaultAgentBridgeWsUrl } from '../agent/ws/wsUrl.js';
import { track } from '../utils/analytics.js';
import {
  MCP_START_COMMAND,
  agentBridgePairingMode,
  browserBlockedHint,
  detectBrowserFamily,
} from '../agent/ws/connectionErrors.js';
import AgentBridgePopupStatus from './AgentBridgePopupStatus.jsx';
import {
  AGENT_PAIRING_PROMPT,
  clipPairingPrompt,
  pairingPromptPreview,
  serverPairingPrompt,
} from '../agent/ws/pairingPrompt.js';
import { probeRelayWebSocket } from '../agent/ws/relayProbe.js';
import { createRelayPoller, DEFAULT_RELAY_POLL_MS } from '../agent/ws/relayPoller.js';
import {
  forcesServerRelay,
  readPhoneWidth,
  readRelayPreference,
  resolveRelayTarget,
  serverAgentWsUrl,
  shouldProbeLocalRelay,
} from '../agent/ws/relayPreference.js';
import { createServerTabConnection } from '../agent/ws/serverTabConnection.js';
import {
  AGENT_CONNECTED_TOAST_COPY,
  AGENT_CONNECTED_TOAST_MS,
  disposePairingHost,
  isCurrentPairingConnection,
  isRelayTabConnected,
  pairingDialogStage,
  pairingProbeUserCopy,
  shouldClosePairingDialogOnConnect,
  shouldPollRelay,
  shouldShowAgentBridgeDisconnect,
  shouldShowLocalAgentConnect,
  serverBlocksLocalPairing,
  shouldShowPairingApproval,
  SERVER_PAIRING_WAITING_COPY,
  shouldShowPairingCode,
  shouldShowPairingPrompt,
} from '../agent/ws/pairingFlow.js';
import { CONNECT_AGENT_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from './agentBridgeConnectButton.js';
import { PROFILE_MENU_ITEM_CLASS } from './profileMenuChrome.js';
import AgentBridgeApprovalPopup from './AgentBridgeApprovalPopup.jsx';
import AgentBridgeDisconnectMenuItem from './AgentBridgeDisconnectMenuItem.jsx';
import AgentBridgePairingDialog from './AgentBridgePairingDialog.jsx';
import ErrorPopup from './ErrorPopup.jsx';
import { approvalPopupPortalTarget, approvalPopupReducer } from '../agent/ws/agentBridgeChrome.js';

/**
 * Local WebSocket pairing for MCP / stdio clients (M1). Shown only when the
 * in-page agent bridge is active. No silent auto-pair: the user must open
 * pairing and approve each local client.
 *
 * Desktop Chrome Auto probes the loopback relay. Safari, iOS, and a
 * phone-width page open the server-relay dialog instead and never probe
 * localhost. Desktop Safari's loopback bridge window is only for a
 * non-forced popup transport.
 */
export default function AgentBridgePairing({
  enabled,
  embedded = false,
  onConnectionChange = null,
  onPairingChange = null,
  /** When passed (even as null), menu chrome portals into this node. */
  uiTarget = undefined,
  /** Close the profile menu when Connect Agent opens the dialog. */
  onBeginFlow = null,
}) {
  const [flowOpen, setFlowOpen] = useState(false);
  const [token, setToken] = useState('');
  const [state, setState] = useState('idle');
  const [issue, setIssue] = useState(null);
  const [copied, setCopied] = useState(null);
  const [relayReachable, setRelayReachable] = useState(false);
  const [approvalUi, setApprovalUi] = useState({ open: false });
  const [link, setLink] = useState(null);
  const [toastOpen, setToastOpen] = useState(false);
  const [popupFallback, setPopupFallback] = useState(false);
  const [usingServer, setUsingServer] = useState(false);
  const [serverUnreachable, setServerUnreachable] = useState(false);
  const [preference, setPreference] = useState(() => (
    typeof localStorage === 'undefined' ? 'auto' : readRelayPreference(localStorage)
  ));
  const [narrow, setNarrow] = useState(() => (
    typeof window === 'undefined' ? false : readPhoneWidth(window)
  ));
  const [serverKick, setServerKick] = useState(0);
  const connRef = useRef(null);
  const serverModeRef = useRef(false);
  const serverUnreachableRef = useRef(false);
  const serverAttemptRef = useRef(false);
  const userStoppedRef = useRef(false);
  const pollerRef = useRef(null);
  const transportRef = useRef(null);
  const flowOpenRef = useRef(flowOpen);
  const relayReachableRef = useRef(relayReachable);
  const stateRef = useRef(state);
  const issueRef = useRef(issue);
  const wsUrl = useMemo(() => defaultAgentBridgeWsUrl(), []);

  flowOpenRef.current = flowOpen;
  relayReachableRef.current = relayReachable;
  stateRef.current = state;
  issueRef.current = issue;

  const pageSecure = typeof window !== 'undefined' && window.location?.protocol === 'https:';
  const detectedMode = typeof window === 'undefined' ? 'direct' : agentBridgePairingMode({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    override: agentBridgeTransportOverride(),
  });
  const mode = popupFallback && detectedMode === 'direct' ? 'popup' : detectedMode;
  const popupMode = mode === 'popup';
  const popupModeRef = useRef(popupMode);
  popupModeRef.current = popupMode;
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const relayEnv = {
    preference,
    userAgent,
    platform: typeof navigator === 'undefined' ? '' : navigator.platform,
    maxTouchPoints: typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
    isMobile: narrow,
    innerWidth: typeof window === 'undefined' ? 0 : window.innerWidth,
  };
  const forcedServer = forcesServerRelay(relayEnv);
  const relayTarget = resolveRelayTarget(relayEnv);
  const forcedServerRef = useRef(false);
  forcedServerRef.current = forcedServer;
  const webkitHttpsBlocked = mode === 'unsupported' && !forcedServer && relayTarget !== 'server' && !usingServer;

  const disposeTransport = useCallback(() => {
    transportRef.current?.dispose?.();
    transportRef.current = null;
  }, []);

  const stopConnection = useCallback(() => {
    connRef.current = disposePairingHost({ conn: connRef.current }).conn;
    disposeTransport();
    setState('idle');
    setIssue(null);
    setLink(null);
  }, [disposeTransport]);

  const stopPolling = useCallback(() => {
    pollerRef.current?.stop();
    pollerRef.current = null;
  }, []);

  const disconnectPairing = useCallback(() => {
    if (stateRef.current === 'pending') {
      connRef.current?.rejectPair();
    }
    setFlowOpen(false);
    stopPolling();
    stopConnection();
    setToken('');
    setRelayReachable(false);
  }, [stopConnection, stopPolling]);

  const disconnectFromUser = useCallback(() => {
    userStoppedRef.current = true;
    serverModeRef.current = false;
    serverAttemptRef.current = false;
    setUsingServer(false);
    disconnectPairing();
  }, [disconnectPairing]);

  useEffect(() => {
    if (!enabled) {
      userStoppedRef.current = false;
      serverModeRef.current = false;
      serverAttemptRef.current = false;
      serverUnreachableRef.current = false;
      setUsingServer(false);
      setServerUnreachable(false);
      disconnectPairing();
    }
  }, [enabled, disconnectPairing]);

  useEffect(() => {
    userStoppedRef.current = false;
  }, [preference]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const sync = () => setPreference(readRelayPreference(window.localStorage));
    window.addEventListener('surfcad-agent-relay', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('surfcad-agent-relay', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const apply = () => setNarrow(readPhoneWidth(window));
    apply();
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 768px)') : null;
    mq?.addEventListener('change', apply);
    window.addEventListener('resize', apply);
    return () => {
      mq?.removeEventListener('change', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);

  useEffect(() => () => {
    const next = disposePairingHost({ conn: connRef.current, poller: pollerRef.current });
    connRef.current = next.conn;
    pollerRef.current = next.poller;
    transportRef.current?.dispose?.();
    transportRef.current = null;
  }, []);

  useEffect(() => {
    if (state === 'paired') {
      track('local_agent_paired');
    }
  }, [state]);

  useEffect(() => {
    onConnectionChange?.(link);
  }, [onConnectionChange, link]);

  useEffect(() => {
    onPairingChange?.({ paired: state === 'paired', link });
  }, [onPairingChange, state, link]);

  useEffect(() => {
    if (state === 'pending') {
      setApprovalUi((prev) => approvalPopupReducer(prev, 'pair_request'));
      setFlowOpen(true);
    } else {
      setApprovalUi((prev) => approvalPopupReducer(prev, 'dismiss'));
    }
  }, [state]);

  useEffect(() => {
    if (!flowOpen) return;
    if (shouldClosePairingDialogOnConnect({ paired: state === 'paired', link })) {
      setFlowOpen(false);
      setToastOpen(true);
    }
  }, [state, link, flowOpen]);

  useEffect(() => {
    if (issue === 'bridge_closed' || issue === 'popup_blocked') {
      setFlowOpen(true);
    }
  }, [issue]);

  useEffect(() => {
    if (!toastOpen) return undefined;
    const id = setTimeout(() => setToastOpen(false), AGENT_CONNECTED_TOAST_MS);
    return () => clearTimeout(id);
  }, [toastOpen]);

  const copyText = useCallback(async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }, []);

  const copyPairingPrompt = useCallback(() => {
    const text = forcedServerRef.current
      ? serverPairingPrompt(typeof window === 'undefined' ? null : window.location)
      : AGENT_PAIRING_PROMPT;
    void copyText(text, 'prompt');
  }, [copyText]);

  const copyMcpCommand = useCallback(() => {
    void copyText(MCP_START_COMMAND, 'mcp');
  }, [copyText]);

  const copyPageLink = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied('link');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }, []);

  const copyPairingCode = useCallback(() => {
    if (!token) return;
    void copyText(token, 'code');
  }, [copyText, token]);

  const onConnectionState = useCallback((next, source) => {
    if (!isCurrentPairingConnection(connRef.current, source)) return;
    setState(next);
    if (serverModeRef.current) return;
    // The bridge window reports the relay itself (onRelay); 'advertising'
    // only means the window is opening.
    if (isRelayTabConnected(next) && !popupModeRef.current) {
      setRelayReachable(true);
    } else if (next === 'idle' && flowOpenRef.current) {
      setRelayReachable(false);
    }
  }, []);

  // Popup transport: call from a click handler (first createSocket opens the window).
  const startPairing = useCallback((transportMode = mode, code) => {
    if (webkitHttpsBlocked) return;
    if (!enabled || typeof window === 'undefined' || !window.surfcad?.call) return;
    stopConnection();
    const nextCode = code || createPairingToken();
    setToken(nextCode);
    const transport = createAgentBridgeTransport({ mode: transportMode });
    transportRef.current = transport;
    const conn = createAgentBridgeTabConnection({
      url: wsUrl,
      token: nextCode,
      call: (name, args) => window.surfcad.call(name, args),
      onState: (next) => onConnectionState(next, conn),
      onIssue: (nextIssue) => {
        if (!isCurrentPairingConnection(connRef.current, conn)) return;
        setIssue(nextIssue);
      },
      onLink: (next) => {
        if (!isCurrentPairingConnection(connRef.current, conn)) return;
        setLink(next);
      },
      onRelay: (detected) => {
        if (!isCurrentPairingConnection(connRef.current, conn)) return;
        if (detected) setRelayReachable(true);
      },
      isAutoApprove: isAgentBridgeAutoApprove,
      pageSecure,
      suppressMissingRelayIssue: true,
      createSocket: transport.createSocket,
    });
    connRef.current = conn;
    conn.connect();
  }, [enabled, mode, onConnectionState, stopConnection, pageSecure, webkitHttpsBlocked, wsUrl]);

  const beginConnectFlow = useCallback(() => {
    onBeginFlow?.();
    if (forcedServerRef.current) {
      userStoppedRef.current = false;
      if (!serverModeRef.current) setServerKick((n) => n + 1);
      setFlowOpen(true);
      setIssue(null);
      return;
    }
    if (serverBlocksLocalPairing({
      relayTarget,
      usingServer: serverModeRef.current,
      serverUnreachable: serverUnreachableRef.current,
    })) return;
    serverAttemptRef.current = false;
    if (webkitHttpsBlocked) {
      setFlowOpen(true);
      return;
    }
    setFlowOpen(true);
    setIssue(null);
    setRelayReachable(false);
    setToken('');
    stopConnection();
    if (popupMode) startPairing('popup');
  }, [onBeginFlow, popupMode, relayTarget, startPairing, stopConnection, webkitHttpsBlocked]);

  const reconnectBridge = useCallback(() => {
    transportRef.current?.armOpen?.();
    if (connRef.current && token) connRef.current.connect();
    else startPairing(mode, token || undefined);
  }, [mode, startPairing, token]);

  const switchToPopupBridge = useCallback(() => {
    setPopupFallback(true);
    setRelayReachable(false);
    startPairing('popup', token || undefined);
  }, [startPairing, token]);

  const handleRelayDetected = useCallback(() => {
    setRelayReachable(true);
    if (!token && flowOpen) {
      startPairing();
    } else if (token && state === 'idle' && flowOpen) {
      connRef.current?.connect();
    }
  }, [flowOpen, startPairing, state, token]);

  useEffect(() => {
    if (!flowOpen || webkitHttpsBlocked || popupMode || serverBlocksLocalPairing({
      relayTarget,
      usingServer,
      serverUnreachable,
      forcedServer,
    })) {
      stopPolling();
      return undefined;
    }
    const polling = shouldPollRelay({ flowOpen, relayReachable, state, issue });
    if (!polling) {
      stopPolling();
      return undefined;
    }
    stopPolling();
    pollerRef.current = createRelayPoller({
      intervalMs: DEFAULT_RELAY_POLL_MS,
      isActive: () => shouldPollRelay({
        flowOpen: flowOpenRef.current,
        relayReachable: relayReachableRef.current,
        state: stateRef.current,
        issue: issueRef.current,
      }),
      probe: () => probeRelayWebSocket(wsUrl, { pageSecure }),
      onIssue: (next) => {
        issueRef.current = next;
        setIssue(next);
      },
      onDetected: handleRelayDetected,
    });
    pollerRef.current.start();
    return () => {
      stopPolling();
    };
  }, [flowOpen, forcedServer, handleRelayDetected, issue, pageSecure, popupMode, relayReachable, relayTarget, serverUnreachable, state, stopPolling, usingServer, webkitHttpsBlocked, wsUrl]);

  useEffect(() => {
    if (popupMode || forcedServer) return;
    if (flowOpen && relayReachable && state === 'idle' && token && connRef.current) {
      connRef.current.connect();
    }
  }, [flowOpen, forcedServer, popupMode, relayReachable, state, token]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    if (relayTarget === 'local') {
      serverUnreachableRef.current = false;
      setServerUnreachable(false);
      if (serverModeRef.current || serverAttemptRef.current) {
        serverModeRef.current = false;
        serverAttemptRef.current = false;
        setUsingServer(false);
        stopConnection();
      }
      return undefined;
    }
    const pending = {
      cancelled: false,
      timer: /** @type {ReturnType<typeof setTimeout> | null} */ (null),
      giveUp: /** @type {ReturnType<typeof setTimeout> | null} */ (null),
    };
    const markServerUnreachable = () => {
      serverUnreachableRef.current = true;
      setServerUnreachable(true);
    };
    const openServer = () => {
      if (pending.cancelled || userStoppedRef.current) return;
      if (!window.surfcad?.call) return;
      // A local dialog that is already open owns the socket. The server
      // dialog does not: the tab stays registered while that dialog is up.
      if (!forcedServerRef.current && flowOpenRef.current && connRef.current && !serverModeRef.current) return;
      if (serverModeRef.current && connRef.current) return;
      stopPolling();
      serverAttemptRef.current = false;
      stopConnection();
      serverAttemptRef.current = true;
      // usingServer stays false until the socket opens. A preview or golden
      // with no /agent relay must keep Connect agent on screen.
      const conn = createServerTabConnection({
        url: serverAgentWsUrl(window.location),
        call: (name, args) => window.surfcad.call(name, args),
        onState: (next) => {
          if (pending.cancelled || !isCurrentPairingConnection(connRef.current, conn)) return;
          if (next === 'advertising' || next === 'paired') {
            if (userStoppedRef.current || (flowOpenRef.current && !forcedServerRef.current)) {
              if (pending.giveUp) clearTimeout(pending.giveUp);
              serverAttemptRef.current = false;
              conn.disconnect();
              return;
            }
            if (pending.giveUp) clearTimeout(pending.giveUp);
            serverUnreachableRef.current = false;
            setServerUnreachable(false);
            serverAttemptRef.current = false;
            serverModeRef.current = true;
            setUsingServer(true);
            onConnectionState(next, conn);
            return;
          }
          if (!serverModeRef.current && next === 'reconnecting') {
            if (pending.giveUp) clearTimeout(pending.giveUp);
            serverAttemptRef.current = false;
            if (forcedServerRef.current) return;
            markServerUnreachable();
            conn.disconnect();
            return;
          }
          if (!serverModeRef.current) return;
          onConnectionState(next, conn);
        },
        onLink: (next) => {
          if (!serverModeRef.current || !isCurrentPairingConnection(connRef.current, conn)) return;
          setLink(next);
        },
      });
      connRef.current = conn;
      conn.connect();
      if (pending.giveUp) clearTimeout(pending.giveUp);
      pending.giveUp = setTimeout(() => {
        if (pending.cancelled || serverModeRef.current || forcedServerRef.current) return;
        if (!isCurrentPairingConnection(connRef.current, conn)) return;
        serverAttemptRef.current = false;
        markServerUnreachable();
        conn.disconnect();
      }, 8000);
    };
    const openWhenReady = (triesLeft) => {
      if (pending.cancelled || userStoppedRef.current) return;
      if (window.surfcad?.call) {
        openServer();
        return;
      }
      if (triesLeft <= 0) {
        if (forcedServerRef.current) {
          pending.timer = setTimeout(() => openWhenReady(20), 250);
          return;
        }
        markServerUnreachable();
        return;
      }
      pending.timer = setTimeout(() => openWhenReady(triesLeft - 1), 50);
    };
    if (userStoppedRef.current) return undefined;
    if (!shouldProbeLocalRelay({
      preference,
      userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      isMobile: narrow,
      innerWidth: window.innerWidth,
      relayTarget,
    })) {
      openWhenReady(20);
    } else {
      probeRelayWebSocket(wsUrl, { pageSecure }).then((result) => {
        if (pending.cancelled || userStoppedRef.current) return;
        if (result?.ok) {
          serverUnreachableRef.current = false;
          setServerUnreachable(false);
          return;
        }
        if (flowOpenRef.current && connRef.current && !serverModeRef.current) return;
        openWhenReady(20);
      }).catch(() => {
        if (!pending.cancelled && !userStoppedRef.current) openWhenReady(20);
      });
    }
    return () => {
      pending.cancelled = true;
      if (pending.timer) clearTimeout(pending.timer);
      if (pending.giveUp) clearTimeout(pending.giveUp);
    };
  }, [enabled, forcedServer, narrow, onConnectionState, pageSecure, preference, relayTarget, serverKick, stopConnection, stopPolling, userAgent, wsUrl]);

  const handleApprove = useCallback(() => {
    setApprovalUi((prev) => approvalPopupReducer(prev, 'allow'));
    connRef.current?.approvePair();
  }, []);

  const handleReject = useCallback(() => {
    setApprovalUi((prev) => approvalPopupReducer(prev, 'deny'));
    connRef.current?.rejectPair();
  }, []);

  const handleDialogDismiss = useCallback(() => {
    if (forcedServerRef.current) {
      setFlowOpen(false);
      return;
    }
    if (state === 'pending') handleReject();
    if (state === 'paired' && link === 'connected') {
      setFlowOpen(false);
      return;
    }
    disconnectFromUser();
  }, [disconnectFromUser, handleReject, link, state]);

  useEffect(() => {
    if (!flowOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleDialogDismiss();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [flowOpen, handleDialogDismiss]);

  if (!enabled) return null;

  const paired = state === 'paired';
  const pending = state === 'pending';
  const browserFamily = typeof navigator !== 'undefined' ? detectBrowserFamily(navigator.userAgent) : 'unknown';
  const stage = pairingDialogStage({
    flowOpen,
    webkitHttpsBlocked,
    relayReachable,
    pending,
  });
  const windowGone = issue === 'bridge_closed' || issue === 'popup_blocked';
  const showPrompt = shouldShowPairingPrompt(stage) && !windowGone;
  const showCode = shouldShowPairingCode(stage) && Boolean(token);
  const showApproval = shouldShowPairingApproval(stage) && approvalUi.open;
  const waitingForRelay = stage === 'prompt'
    && issue !== 'origin_rejected' && issue !== 'browser_blocked'
    && issue !== 'bridge_closed' && issue !== 'popup_blocked';
  const waitingCopy = popupMode ? 'Waiting for the local agent…' : pairingProbeUserCopy(null);
  const promptPreview = pairingPromptPreview();
  const showRelayMissingBanner = issue === 'relay_missing' && !waitingForRelay && flowOpen;

  const issueBlock = showRelayMissingBanner ? (
    <div className="rounded border border-amber-500/40 bg-amber-950/40 px-2 py-2 text-ui-xs text-on-dark" data-agent-bridge-error="relay_missing">
      <p className="mb-2">Local relay not found. In your MCP client config, run:</p>
      <div className="flex gap-2 items-center">
        <code className="flex-1 rounded bg-black/40 px-2 py-1 font-mono text-ui-xs text-on-dark">{MCP_START_COMMAND}</code>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          onClick={copyMcpCommand}
          data-ui-action="data-agent-bridge-copy-mcp"
        >
          {copied === 'mcp' ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  ) : issue === 'origin_rejected' ? (
    <p className="text-ui-xs text-red-300" data-agent-bridge-error="origin_rejected">
      {pairingProbeUserCopy('origin_rejected')}
    </p>
  ) : issue === 'browser_blocked' ? (
    <p className="text-ui-xs text-red-300" data-agent-bridge-error="browser_blocked">
      {browserBlockedHint(browserFamily)}
    </p>
  ) : issue === 'relay_error' ? (
    <p className="text-ui-xs text-red-300" data-agent-bridge-error="relay_error">
      The local relay closed the connection. Restart <code className="font-mono">{MCP_START_COMMAND}</code> and try again.
    </p>
  ) : null;

  const dialogBody = (
    <>
      {issueBlock}
      <AgentBridgePopupStatus
        mode={mode}
        issue={issue}
        token={token}
        state={state}
        browserFamily={browserFamily}
        copied={copied}
        onReconnect={reconnectBridge}
        onUsePopup={switchToPopupBridge}
        onCopyLink={copyPageLink}
      />
      {webkitHttpsBlocked ? (
        <div
          className="rounded border border-chrome-border/80 px-2 py-2 text-ui-xs"
          data-agent-bridge-unsupported="webkit-https"
        >
          <p className="text-on-dark mb-1.5">Pairing works in Chrome for now.</p>
          <p className="text-muted-on-dark mb-2">
            Open this page in Chrome on your computer to connect a local MCP client.
          </p>
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            onClick={copyPageLink}
            data-ui-action="data-agent-bridge-copy-link"
          >
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>
      ) : (
        <div className="space-y-3" data-agent-bridge-guided="">
          {showPrompt ? (
            <div className="rounded-md border border-chrome-border/80 px-2 py-2" data-agent-bridge-prompt="">
              <p className="text-ui-xs text-muted-on-dark mb-2">Send this to your AI agent:</p>
              <p className="text-ui-xs text-on-dark leading-snug mb-2 line-clamp-3" data-agent-bridge-prompt-preview="">
                {promptPreview}
              </p>
              <button
                type="button"
                className={CONNECT_AGENT_BUTTON_CLASS}
                onClick={copyPairingPrompt}
                data-ui-action="data-agent-bridge-copy-prompt"
              >
                {copied === 'prompt' ? 'Copied' : 'Copy prompt'}
              </button>
            </div>
          ) : null}
          {waitingForRelay ? (
            <div
              className="flex items-center justify-center gap-2 text-ui-xs text-muted-on-dark py-1"
              data-agent-bridge-waiting-relay=""
            >
              <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
              {waitingCopy}
            </div>
          ) : null}
          {showCode ? (
            <>
              <div className="font-mono text-lg tracking-widest text-center py-1 text-on-dark" data-agent-bridge-code="">
                {token}
              </div>
              <p className="text-ui-xs text-muted-on-dark text-center">
                Send this pairing code to your agent so it can connect.
              </p>
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                onClick={copyPairingCode}
                data-ui-action="data-agent-bridge-copy-code"
              >
                {copied === 'code' ? 'Copied' : 'Copy code'}
              </button>
            </>
          ) : null}
          {showApproval ? (
            <AgentBridgeApprovalPopup
              open
              onAllow={handleApprove}
              onDeny={handleReject}
            />
          ) : null}
          {link === 'reconnecting' && !paired ? (
            <p className="text-ui-xs text-amber-300/90 text-center" data-agent-bridge-link="reconnecting">
              Connection to the local agent dropped. Reconnecting…
            </p>
          ) : null}
          {link === 'lost' && !paired ? (
            <p className="text-ui-xs text-red-300 text-center" data-agent-bridge-link="lost">
              {popupMode
                ? 'Lost the local agent. Keep the SurfCAD local agent bridge window open; it reconnects when the agent is back.'
                : 'Lost the local agent. Keep this tab open in Chrome; it reconnects when the agent is back.'}
            </p>
          ) : null}
          {shouldShowAgentBridgeDisconnect({ paired, link }) ? (
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              onClick={disconnectFromUser}
              data-ui-action="data-agent-bridge-disconnect"
            >
              Disconnect
            </button>
          ) : null}
        </div>
      )}
    </>
  );

  const connectAgentButton = shouldShowLocalAgentConnect({
    flowOpen,
    paired,
    relayTarget,
    usingServer,
    serverUnreachable,
    forcedServer,
  }) ? (
    <button
      type="button"
      className={PROFILE_MENU_ITEM_CLASS}
      onClick={beginConnectFlow}
      data-ui-action="data-agent-bridge-connect"
      data-agent-bridge-connect=""
    >
      <Plug size={14} aria-hidden />
      Connect agent
    </button>
  ) : null;

  const menuDisconnect = shouldShowAgentBridgeDisconnect({ paired, link }) && !flowOpen ? (
    <AgentBridgeDisconnectMenuItem onDisconnect={disconnectFromUser} />
  ) : null;

  const bodyTarget = approvalPopupPortalTarget(typeof document !== 'undefined' ? document : null);
  const showConnectedBanner = shouldShowAgentBridgeDisconnect({ paired, link });
  const bannerPortal = showConnectedBanner && bodyTarget
    ? createPortal(
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[145] flex justify-center px-3 py-2"
        data-agent-connected-banner=""
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
      >
        <div className="pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-md px-3 py-2 surface-success font-ui">
          <span className="text-ui-sm font-semibold text-on-dark">Agent connected</span>
          <button
            type="button"
            className="rounded-md px-2.5 py-1 text-ui-xs font-ui text-on-dark surface-quiet"
            onClick={disconnectFromUser}
            data-ui-action="data-agent-connected-disconnect"
          >
            Disconnect
          </button>
        </div>
      </div>,
      bodyTarget,
    )
    : null;
  const toastPortal = toastOpen && bodyTarget
    ? createPortal(
      <div
        className="fixed top-16 left-1/2 z-[140] w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2"
        data-agent-bridge-connected-toast=""
      >
        <ErrorPopup
          tone="success"
          onDismiss={() => setToastOpen(false)}
          className="px-4 py-2"
        >
          {AGENT_CONNECTED_TOAST_COPY}
        </ErrorPopup>
      </div>,
      bodyTarget,
    )
    : null;

  const serverPromptText = forcedServer
    ? serverPairingPrompt(typeof window === 'undefined' ? null : window.location)
    : '';
  const serverDialogBody = (
    <div className="space-y-3" data-agent-bridge-server="">
      <div className="rounded-md border border-chrome-border/80 px-2 py-2" data-agent-bridge-prompt="">
        <p className="text-ui-xs text-muted-on-dark mb-2">Send this to your AI agent:</p>
        <p className="text-ui-xs text-on-dark leading-snug mb-2 line-clamp-3" data-agent-bridge-prompt-preview="">
          {clipPairingPrompt(serverPromptText)}
        </p>
        <button
          type="button"
          className={CONNECT_AGENT_BUTTON_CLASS}
          onClick={copyPairingPrompt}
          data-ui-action="data-agent-bridge-copy-prompt"
        >
          {copied === 'prompt' ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
      <div
        className="flex items-center justify-center gap-2 text-ui-xs text-muted-on-dark py-1"
        data-agent-bridge-waiting-server=""
      >
        <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
        {SERVER_PAIRING_WAITING_COPY}
      </div>
    </div>
  );

  const dialog = (
    <AgentBridgePairingDialog open={flowOpen} onDismiss={handleDialogDismiss} transport={forcedServer ? 'server' : mode}>
      {forcedServer ? serverDialogBody : dialogBody}
    </AgentBridgePairingDialog>
  );

  const menuBody = (
    <div data-agent-bridge-pairing="">
      {connectAgentButton}
      {menuDisconnect}
    </div>
  );

  const portalMode = uiTarget !== undefined;
  if (portalMode) {
    return (
      <>
        {dialog}
        {bannerPortal}
        {toastPortal}
        {uiTarget ? createPortal(menuBody, uiTarget) : null}
      </>
    );
  }

  if (embedded) {
    return (
      <>
        {dialog}
        {bannerPortal}
        {toastPortal}
        {menuBody}
      </>
    );
  }

  return (
    <>
      {dialog}
      {bannerPortal}
      {toastPortal}
      <div
        className="fixed bottom-3 right-3 z-[120] flex flex-col items-end gap-1 max-w-[min(100vw-1rem,20rem)]"
        data-agent-bridge-pairing=""
      >
        {connectAgentButton || menuDisconnect}
      </div>
    </>
  );
}
