/**
 * Agent session toasts plus the other shared cards, at phone width.
 * The connected and disconnected cards are the production component.
 * The other cards are here so a shared padding change cannot shrink them.
 */
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import AgentSessionToast from '../../src/components/AgentSessionToast.jsx';
import ErrorPopup from '../../src/components/ErrorPopup.jsx';

const STACKED = 'relative mx-auto mt-10 w-[min(100vw-1.5rem,24rem)]';

export function renderAgentSessionToastShot(el) {
  createRoot(el).render(React.createElement(Shot));
}

function Shot() {
  useEffect(() => {
    window.__CLICKS__ = [];
    window.__READY__ = true;
  }, []);

  const note = (name) => {
    window.__CLICKS__ = [...(window.__CLICKS__ || []), name];
  };

  return (
    <div
      data-agent-session-toast-shot=""
      style={{ position: 'relative', minHeight: '100vh', background: '#1e1e1e' }}
    >
      <div
        data-toast-checker=""
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: '#2a2a2a',
          backgroundImage:
            'linear-gradient(45deg, #3a3a3a 25%, transparent 25%), linear-gradient(-45deg, #3a3a3a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a3a 75%), linear-gradient(-45deg, transparent 75%, #3a3a3a 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, paddingTop: 64, paddingBottom: 48 }}>
        <AgentSessionToast
          kind="connected"
          className={STACKED}
          onDismiss={() => note('connected-dismiss')}
          onDisconnect={() => note('disconnect')}
          onReconnect={() => note('connected-reconnect')}
        />
        <AgentSessionToast
          kind="disconnected"
          className={STACKED}
          onDismiss={() => note('disconnected-dismiss')}
          onDisconnect={() => note('disconnected-disconnect')}
          onReconnect={() => note('reconnect')}
        />
        <div className={STACKED} data-toast-sample="notice">
          <ErrorPopup tone="success" onDismiss={() => {}} className="px-4 py-2">
            Saved Branch
          </ErrorPopup>
        </div>
        <div className={STACKED} data-toast-sample="soft">
          <ErrorPopup
            tone="warn"
            onDismiss={() => {}}
            onUndo={() => {}}
            canUndo
            className="px-3 py-2"
          >
            Pick at least one edge.
          </ErrorPopup>
        </div>
        <div className={STACKED} data-toast-sample="roomy" data-delete-undo-toast="">
          <ErrorPopup tone="warn" onDismiss={() => {}} onUndo={() => {}} canUndo roomy>
            Deleted.
          </ErrorPopup>
        </div>
        <div className={STACKED} data-toast-sample="stacked">
          <ErrorPopup
            tone="error"
            layout="stacked"
            title="Error"
            onDismiss={() => {}}
            onUndo={() => {}}
            canUndo
            className="p-3"
          >
            The script failed.
          </ErrorPopup>
        </div>
      </div>
    </div>
  );
}
