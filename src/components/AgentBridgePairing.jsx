import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Plug, PlugZap } from 'lucide-react';
import { createPairingToken } from '../agent/ws/pairingToken.js';
import { createAgentBridgeTabConnection } from '../agent/ws/tabConnection.js';
import { isAgentBridgeAutoApprove } from '../agent/ws/autoApprove.js';
import { defaultAgentBridgeWsUrl } from '../agent/ws/wsUrl.js';
import { track } from '../utils/analytics.js';
import {
  MCP_START_COMMAND,
  browserBlockedHint,
  detectBrowserFamily,
  shouldPreemptWebKitHttpsPairing,
} from '../agent/ws/connectionErrors.js';
import { AGENT_PAIRING_PROMPT, pairingPromptPreview } from '../agent/ws/pairingPrompt.js';
import { probeRelayWebSocket } from '../agent/ws/relayProbe.js';
import { createRelayPoller, DEFAULT_RELAY_POLL_MS } from '../agent/ws/relayPoller.js';
import {
  isCurrentPairingConnection,
  isRelayTabConnected,
  shouldPollRelay,
  shouldRevealPairingCode,
} from '../agent/ws/pairingFlow.js';
import { CONNECT_AGENT_BUTTON_CLASS } from './agentBridgeConnectButton.js';
import AgentBridgeApprovalPopup from './AgentBridgeApprovalPopup.jsx';
import { approvalPopupPortalTarget, approvalPopupReducer } from '../agent/ws/agentBridgeChrome.js';

/**
 * Local WebSocket pairing for MCP / stdio clients (M1). Shown only when the
 * in-page agent bridge is active. No silent auto-pair: the user must open
 * pairing and approve each local client.
 */
export default function AgentBridgePairing({
  enabled,
  embedded = false,
  onConnectionChange = null,
  /** When passed (even as null), UI portals into this node and stays mounted without it. */
  uiTarget = undefined,
}) {
  const [flowOpen, setFlowOpen] = useState(false);
  const [token, setToken] = useState('');
  const [state, setState] = useState('idle');
  const [issue, setIssue] = useState(null);
  const [copied, setCopied] = useState(null);
  const [relayReachable, setRelayReachable] = useState(false);
  const [approvalUi, setApprovalUi] = useState({ open: false });
  const [link, setLink] = useState(null);
  const connRef = useRef(null);
  const pollerRef = useRef(null);
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
  const webkitHttpsBlocked = typeof window !== 'undefined' && shouldPreemptWebKitHttpsPairing({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    userAgent: navigator.userAgent,
  });

  const stopConnection = useCallback(() => {
    const conn = connRef.current;
    connRef.current = null;
    conn?.disconnect();
    setState('idle');
    setIssue(null);
    setLink(null);
  }, []);

  const stopPolling = useCallback(() => {
    pollerRef.current?.stop();
    pollerRef.current = null;
  }, []);

  const closeFlow = useCallback(() => {
    setFlowOpen(false);
    stopPolling();
    stopConnection();
    setToken('');
    setRelayReachable(false);
  }, [stopConnection, stopPolling]);

  useEffect(() => {
    if (!enabled) {
      closeFlow();
    }
  }, [enabled, closeFlow]);

  useEffect(() => () => {
    stopConnection();
    stopPolling();
  }, [stopConnection, stopPolling]);

  useEffect(() => {
    if (state === 'paired') {
      track('local_agent_paired');
    }
  }, [state]);

  useEffect(() => {
    onConnectionChange?.(link);
  }, [onConnectionChange, link]);

  useEffect(() => {
    if (state === 'pending') {
      setApprovalUi((prev) => approvalPopupReducer(prev, 'pair_request'));
    } else {
      setApprovalUi((prev) => approvalPopupReducer(prev, 'dismiss'));
    }
  }, [state]);

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
    void copyText(AGENT_PAIRING_PROMPT, 'prompt');
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
    if (isRelayTabConnected(next)) {
      setRelayReachable(true);
    } else if (next === 'idle' && flowOpenRef.current) {
      setRelayReachable(false);
    }
  }, []);

  const startPairing = useCallback(() => {
    if (webkitHttpsBlocked) return;
    if (!enabled || typeof window === 'undefined' || !window.surfcad?.call) return;
    stopConnection();
    const code = createPairingToken(6);
    setToken(code);
    const conn = createAgentBridgeTabConnection({
      url: wsUrl,
      token: code,
      call: (name, args) => window.surfcad.call(name, args),
      onState: (next) => onConnectionState(next, conn),
      onIssue: (issue) => {
        if (!isCurrentPairingConnection(connRef.current, conn)) return;
        setIssue(issue);
      },
      onLink: (next) => {
        if (!isCurrentPairingConnection(connRef.current, conn)) return;
        setLink(next);
      },
      isAutoApprove: isAgentBridgeAutoApprove,
      pageSecure,
      suppressMissingRelayIssue: true,
    });
    connRef.current = conn;
    conn.connect();
  }, [enabled, onConnectionState, stopConnection, pageSecure, webkitHttpsBlocked, wsUrl]);

  const beginConnectFlow = useCallback(() => {
    if (webkitHttpsBlocked) return;
    setFlowOpen(true);
    setIssue(null);
    setRelayReachable(false);
    setToken('');
    stopConnection();
  }, [stopConnection, webkitHttpsBlocked]);

  const handleRelayDetected = useCallback(() => {
    setRelayReachable(true);
    if (!token && flowOpen) {
      startPairing();
    } else if (token && state === 'idle' && flowOpen) {
      connRef.current?.connect();
    }
  }, [flowOpen, startPairing, state, token]);

  useEffect(() => {
    if (!flowOpen || webkitHttpsBlocked) {
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
  }, [flowOpen, handleRelayDetected, issue, pageSecure, relayReachable, state, stopPolling, webkitHttpsBlocked, wsUrl]);

  useEffect(() => {
    if (flowOpen && relayReachable && state === 'idle' && token && connRef.current) {
      connRef.current.connect();
    }
  }, [flowOpen, relayReachable, state, token]);

  const handleApprove = useCallback(() => {
    setApprovalUi((prev) => approvalPopupReducer(prev, 'allow'));
    connRef.current?.approvePair();
  }, []);

  const handleReject = useCallback(() => {
    setApprovalUi((prev) => approvalPopupReducer(prev, 'deny'));
    connRef.current?.rejectPair();
  }, []);

  if (!enabled) return null;

  const paired = state === 'paired';
  const pending = state === 'pending';
  const advertising = state === 'advertising';
  const browserFamily = typeof navigator !== 'undefined' ? detectBrowserFamily(navigator.userAgent) : 'unknown';
  const showCode = shouldRevealPairingCode(relayReachable) && Boolean(token);
  const waitingForRelay = flowOpen && !relayReachable && !webkitHttpsBlocked
    && issue !== 'origin_rejected' && issue !== 'browser_blocked';
  const promptPreview = pairingPromptPreview();

  const showRelayMissingBanner = issue === 'relay_missing' && !waitingForRelay;

  const issueBlock = showRelayMissingBanner ? (
    <div className="rounded border border-amber-500/40 bg-amber-950/40 px-2 py-2 text-xs text-amber-100 mb-2" data-agent-bridge-error="relay_missing">
      <p className="mb-2">Local relay not found. In your MCP client config, run:</p>
      <div className="flex gap-2 items-center">
        <code className="flex-1 rounded bg-black/40 px-2 py-1 font-mono text-[11px]">{MCP_START_COMMAND}</code>
        <button
          type="button"
          className="shrink-0 rounded bg-chrome-border/90 px-2 py-1 text-white hover:bg-gray-600"
          onClick={copyMcpCommand}
          data-ui-action="data-agent-bridge-copy-mcp"
        >
          {copied === 'mcp' ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  ) : issue === 'origin_rejected' ? (
    <p className="text-xs text-red-300 mb-2" data-agent-bridge-error="origin_rejected">
      This page origin was rejected by the local relay. Open https://surfcad.com (not a copy) and try again.
    </p>
  ) : issue === 'browser_blocked' ? (
    <p className="text-xs text-red-300 mb-2" data-agent-bridge-error="browser_blocked">
      {browserBlockedHint(browserFamily)}
    </p>
  ) : issue === 'relay_error' ? (
    <p className="text-xs text-red-300 mb-2" data-agent-bridge-error="relay_error">
      The local relay closed the connection. Restart <code className="font-mono">{MCP_START_COMMAND}</code> and try again.
    </p>
  ) : null;

  const guidedFlow = flowOpen && !webkitHttpsBlocked ? (
    <div className="space-y-3" data-agent-bridge-guided="">
      <div className="rounded-md border border-chrome-border/80 bg-chrome-surface/60 px-2 py-2" data-agent-bridge-prompt="">
        <p className="text-[11px] text-chrome-text-secondary mb-2">Send this to your AI agent:</p>
        <p className="text-[11px] text-chrome-text leading-snug mb-2 line-clamp-3" data-agent-bridge-prompt-preview="">
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
      {waitingForRelay ? (
        <div
          className="flex items-center justify-center gap-2 text-xs text-chrome-text-secondary py-1"
          data-agent-bridge-waiting-relay=""
        >
          <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
          Waiting for relay…
        </div>
      ) : null}
      {showCode ? (
        <>
          <div className="font-mono text-lg tracking-widest text-center py-1" data-agent-bridge-code="">
            {token}
          </div>
          <p className="text-xs text-chrome-text-secondary text-center mb-1">
            Send this pairing code to your agent so it can connect.
          </p>
          <button
            type="button"
            className="w-full rounded border border-chrome-border px-2 py-1.5 text-xs text-white bg-chrome-border/90 hover:bg-gray-600"
            onClick={copyPairingCode}
            data-ui-action="data-agent-bridge-copy-code"
          >
            {copied === 'code' ? 'Copied' : 'Copy code'}
          </button>
          {pending && (
            <p className="text-xs text-center text-chrome-text-secondary mb-2" data-agent-bridge-approval-hint="">
              Approve or deny the connection in the popup.
            </p>
          )}
          {paired && (
            <div
              className="flex items-center justify-center gap-1.5 text-emerald-400 text-xs mb-2"
              data-agent-bridge-paired=""
            >
              <PlugZap size={14} aria-hidden />
              Paired with local client
            </div>
          )}
          {link === 'reconnecting' && !paired && (
            <p className="text-xs text-amber-300/90 text-center mb-2" data-agent-bridge-link="reconnecting">
              Connection to the local agent dropped. Reconnecting…
            </p>
          )}
          {link === 'lost' && !paired && (
            <p className="text-xs text-red-300 text-center mb-2" data-agent-bridge-link="lost">
              Lost the local agent. Keep this tab open in Chrome; it reconnects when the agent is back.
            </p>
          )}
          {advertising && !pending && !paired && !issue && !link && (
            <p className="text-xs text-amber-300/90 text-center mb-2" data-agent-bridge-waiting="">
              Relay connected — waiting for local MCP client with this code…
            </p>
          )}
          <button
            type="button"
            className="w-full rounded border border-chrome-border px-2 py-1.5 text-chrome-text-secondary hover:text-chrome-text"
            onClick={closeFlow}
            data-ui-action="data-agent-bridge-disconnect"
          >
            Disconnect
          </button>
        </>
      ) : null}
    </div>
  ) : null;

  const panel = flowOpen ? (
    <div
      className={
        embedded
          ? 'mt-2 rounded-md border border-chrome-border bg-chrome-surface/80 p-3 text-sm text-chrome-text'
          : 'rounded-lg border border-chrome-border bg-chrome-surface/95 p-3 text-sm text-chrome-text shadow-lg backdrop-blur-sm'
      }
      data-agent-bridge-panel=""
    >
      {issueBlock}
      {webkitHttpsBlocked ? (
        <div
          className="rounded border border-chrome-border/80 bg-chrome-surface/60 px-2 py-2 text-xs mb-2"
          data-agent-bridge-unsupported="webkit-https"
        >
          <p className="text-chrome-text mb-1.5">Pairing works in Chrome for now.</p>
          <p className="text-chrome-text-secondary mb-2">
            Open this page in Chrome on your computer to connect a local MCP client.
          </p>
          <button
            type="button"
            className="w-full rounded bg-chrome-border/90 px-2 py-1.5 text-white hover:bg-gray-600"
            onClick={copyPageLink}
            data-ui-action="data-agent-bridge-copy-link"
          >
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>
      ) : null}
      {guidedFlow}
    </div>
  ) : null;

  const chipClass = embedded
    ? `flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors ${
      paired
        ? 'border border-emerald-500/50 bg-emerald-950/40 text-emerald-300'
        : 'border border-chrome-border text-chrome-text-secondary hover:bg-white/5 hover:text-chrome-text'
    }`
    : `flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs shadow-md backdrop-blur-sm ${
      paired
        ? 'border-emerald-500/60 bg-emerald-950/80 text-emerald-300'
        : 'border-chrome-border bg-chrome-surface/90 text-chrome-text-secondary hover:text-chrome-text'
    }`;

  const connectAgentButton = !flowOpen && !webkitHttpsBlocked ? (
    <button
      type="button"
      className={embedded ? CONNECT_AGENT_BUTTON_CLASS : `${CONNECT_AGENT_BUTTON_CLASS} shadow-md`}
      onClick={beginConnectFlow}
      data-ui-action="data-agent-bridge-connect"
      data-agent-bridge-connect=""
    >
      Connect Agent
    </button>
  ) : null;

  const chip = !embedded && (flowOpen || paired) ? (
    <button
      type="button"
      title="Local agent bridge pairing"
      className={chipClass}
      onClick={() => (flowOpen ? closeFlow() : beginConnectFlow())}
      data-ui-action="data-agent-bridge-toggle"
      data-agent-bridge-chip=""
    >
      <span className="inline-flex items-center gap-1.5">
        {paired ? <PlugZap size={14} aria-hidden /> : <Plug size={14} aria-hidden />}
        {paired ? 'Agent paired' : 'Connect Agent'}
      </span>
    </button>
  ) : null;

  const portalMode = uiTarget !== undefined;
  const bodyTarget = approvalPopupPortalTarget(typeof document !== 'undefined' ? document : null);
  const approvalPopup = approvalUi.open && bodyTarget
    ? createPortal(
      <AgentBridgeApprovalPopup
        open
        embedded={false}
        onAllow={handleApprove}
        onDeny={handleReject}
      />,
      bodyTarget,
    )
    : null;

  const embeddedBody = (
    <div className="relative px-3 py-2 space-y-2" data-agent-bridge-pairing="">
      {connectAgentButton}
      {paired && !flowOpen ? (
        <button
          type="button"
          className={chipClass}
          onClick={beginConnectFlow}
          data-ui-action="data-agent-bridge-toggle"
          data-agent-bridge-chip=""
        >
          <span className="inline-flex items-center gap-1.5">
            <PlugZap size={14} aria-hidden />
            Agent paired
          </span>
        </button>
      ) : null}
      {panel}
    </div>
  );

  if (portalMode) {
    return (
      <>
        {approvalPopup}
        {uiTarget ? createPortal(embeddedBody, uiTarget) : null}
      </>
    );
  }

  if (embedded) {
    return (
      <>
        {approvalPopup}
        {embeddedBody}
      </>
    );
  }

  return (
    <>
      {approvalPopup}
      <div
        className="fixed bottom-3 right-3 z-[120] flex flex-col items-end gap-1 max-w-[min(100vw-1rem,20rem)]"
        data-agent-bridge-pairing=""
      >
        {panel}
        {connectAgentButton || chip}
      </div>
    </>
  );
}
