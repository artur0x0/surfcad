import { useCallback, useEffect, useRef, useState } from 'react';
import { Plug, PlugZap } from 'lucide-react';
import { createPairingToken } from '../agent/ws/pairingToken.js';
import { createAgentBridgeTabConnection } from '../agent/ws/tabConnection.js';
import { defaultAgentBridgeWsUrl } from '../agent/ws/wsUrl.js';

/**
 * Local WebSocket pairing for MCP / stdio clients (M1). Shown only when the
 * in-page agent bridge is active. No silent auto-pair: the user must open
 * pairing and approve each local client.
 */
export default function AgentBridgePairing({ enabled, embedded = false }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [state, setState] = useState('idle');
  const connRef = useRef(null);

  const stopConnection = useCallback(() => {
    connRef.current?.disconnect();
    connRef.current = null;
    setState('idle');
  }, []);

  useEffect(() => {
    if (!enabled) {
      stopConnection();
      setOpen(false);
    }
  }, [enabled, stopConnection]);

  const startPairing = useCallback(() => {
    if (!enabled || typeof window === 'undefined' || !window.surfcad?.call) return;
    stopConnection();
    const code = createPairingToken(6);
    setToken(code);
    const conn = createAgentBridgeTabConnection({
      url: defaultAgentBridgeWsUrl(),
      token: code,
      call: (name, args) => window.surfcad.call(name, args),
      onState: setState,
    });
    connRef.current = conn;
    conn.connect();
  }, [enabled, stopConnection]);

  if (!enabled) return null;

  const paired = state === 'paired';
  const pending = state === 'pending';
  const advertising = state === 'advertising';

  const panel = open ? (
    <div
      className={
        embedded
          ? 'mt-2 rounded-md border border-chrome-border bg-chrome-surface/80 p-3 text-sm text-chrome-text'
          : 'rounded-lg border border-chrome-border bg-chrome-surface/95 p-3 text-sm text-chrome-text shadow-lg backdrop-blur-sm'
      }
      data-agent-bridge-panel=""
    >
      {!token && (
        <button
          type="button"
          className="block w-full rounded-md px-3 py-1.5 text-left text-xs text-chrome-text hover:bg-white/10"
          onClick={startPairing}
          data-ui-action="data-agent-bridge-start"
        >
          Show pairing code
        </button>
      )}
      {token && (
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
                className="flex-1 rounded bg-chrome-border px-2 py-1.5 hover:bg-gray-600"
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
          {advertising && !pending && !paired && (
            <p className="text-xs text-amber-300/90 text-center mb-2">Waiting for local client…</p>
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
