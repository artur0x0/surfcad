import { useCallback, useEffect, useRef, useState } from 'react';
import { Plug, PlugZap } from 'lucide-react';
import { createPairingToken } from '../agent/ws/pairingToken.js';
import { createAgentBridgeTabConnection } from '../agent/ws/tabConnection.js';
import { defaultAgentBridgeWsUrl } from '../agent/ws/wsUrl.js';
import { track } from '../utils/analytics.js';
import {
  MCP_START_COMMAND,
  browserBlockedHint,
  detectBrowserFamily,
  shouldPreemptWebKitHttpsPairing,
} from '../agent/ws/connectionErrors.js';

/**
 * Local WebSocket pairing for MCP / stdio clients (M1). Shown only when the
 * in-page agent bridge is active. No silent auto-pair: the user must open
 * pairing and approve each local client.
 */
export default function AgentBridgePairing({ enabled, embedded = false }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [state, setState] = useState('idle');
  const [issue, setIssue] = useState(null);
  const [copied, setCopied] = useState(null);
  const connRef = useRef(null);

  const pageSecure = typeof window !== 'undefined' && window.location?.protocol === 'https:';
  const webkitHttpsBlocked = typeof window !== 'undefined' && shouldPreemptWebKitHttpsPairing({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    userAgent: navigator.userAgent,
  });

  const stopConnection = useCallback(() => {
    connRef.current?.disconnect();
    connRef.current = null;
    setState('idle');
    setIssue(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      stopConnection();
      setOpen(false);
    }
  }, [enabled, stopConnection]);

  useEffect(() => {
    if (state === 'paired') {
      track('local_agent_paired');
    }
  }, [state]);

  const copyMcpCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(MCP_START_COMMAND);
      setCopied('mcp');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }, []);

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

  const startPairing = useCallback(() => {
    if (webkitHttpsBlocked) return;
    if (!enabled || typeof window === 'undefined' || !window.surfcad?.call) return;
    stopConnection();
    const code = createPairingToken(6);
    setToken(code);
    const conn = createAgentBridgeTabConnection({
      url: defaultAgentBridgeWsUrl(),
      token: code,
      call: (name, args) => window.surfcad.call(name, args),
      onState: setState,
      onIssue: setIssue,
      pageSecure,
    });
    connRef.current = conn;
    conn.connect();
  }, [enabled, stopConnection, pageSecure, webkitHttpsBlocked]);

  if (!enabled) return null;

  const paired = state === 'paired';
  const pending = state === 'pending';
  const advertising = state === 'advertising';
  const browserFamily = typeof navigator !== 'undefined' ? detectBrowserFamily(navigator.userAgent) : 'unknown';

  const issueBlock = issue === 'relay_missing' ? (
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

  const panel = open ? (
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
          <p className="text-chrome-text mb-1.5">Pairing works in Chrome or Edge for now.</p>
          <p className="text-chrome-text-secondary mb-2">
            Open this page in Chrome or Edge on your computer to connect a local MCP client.
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
      {!webkitHttpsBlocked && !token && (
        <button
          type="button"
          className="block w-full rounded-md px-3 py-1.5 text-left text-xs text-chrome-text hover:bg-white/10"
          onClick={startPairing}
          data-ui-action="data-agent-bridge-start"
        >
          Show pairing code
        </button>
      )}
      {!webkitHttpsBlocked && token && (
        <>
          <div className="font-mono text-lg tracking-widest text-center py-1" data-agent-bridge-code="">
            {token}
          </div>
          <p className="text-xs text-chrome-text-secondary text-center mb-2">
            Enter this code in your local MCP / stdio client.
          </p>
          {pending && (
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                className="flex-1 rounded bg-emerald-700/90 px-2 py-1.5 text-white hover:bg-emerald-600"
                onClick={() => connRef.current?.approvePair()}
                data-ui-action="data-agent-bridge-approve"
              >
                Allow connection
              </button>
              <button
                type="button"
                className="flex-1 rounded bg-chrome-border px-2 py-1.5 text-white hover:bg-gray-600"
                onClick={() => connRef.current?.rejectPair()}
                data-ui-action="data-agent-bridge-reject"
              >
                Deny
              </button>
            </div>
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
          {advertising && !pending && !paired && !issue && (
            <p className="text-xs text-amber-300/90 text-center mb-2" data-agent-bridge-waiting="">
              Relay connected — waiting for local MCP client with this code…
            </p>
          )}
          <button
            type="button"
            className="w-full rounded border border-chrome-border px-2 py-1.5 text-chrome-text-secondary hover:text-chrome-text"
            onClick={() => {
              stopConnection();
              setToken('');
            }}
            data-ui-action="data-agent-bridge-disconnect"
          >
            Disconnect
          </button>
        </>
      )}
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

  const chip = (
    <button
      type="button"
      title="Local agent bridge pairing"
      className={chipClass}
      onClick={() => setOpen((v) => !v)}
      data-ui-action="data-agent-bridge-toggle"
      data-agent-bridge-chip=""
    >
      <span className="inline-flex items-center gap-1.5">
        {paired ? <PlugZap size={14} aria-hidden /> : <Plug size={14} aria-hidden />}
        {paired ? 'Agent paired' : 'Local agent'}
      </span>
    </button>
  );

  if (embedded) {
    return (
      <div className="px-3 py-2" data-agent-bridge-pairing="">
        {chip}
        {panel}
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-3 right-3 z-[120] flex flex-col items-end gap-1 max-w-[min(100vw-1rem,20rem)]"
      data-agent-bridge-pairing=""
    >
      {panel}
      {chip}
    </div>
  );
}
