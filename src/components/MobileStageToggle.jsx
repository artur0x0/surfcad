import React, { useEffect, useState } from 'react';
import { Bot, Box, LayoutList, Loader2 } from 'lucide-react';
import { subscribeAgentPromptWorking } from '../agent/agentFeaturePopupGate.js';
import { shouldShowAgentBridgeDisconnect } from '../agent/ws/pairingFlow.js';
import { useAgentBridgeHost } from './AgentBridgeHost.jsx';

/**
 * Slice Mobile B — iPhone Home Screen–style stage control.
 *
 * Bottom translucent glass pill. Two Lucide icons, in order: CAD (box),
 * Parts (layout-list). The script editor is not a pill stage: a part-row
 * pencil opens it. Session sticky via the caller (`3dculos.mobileStage`).
 * Desktop never mounts this.
 *
 * While an agent is connected, a middle Bot button opens the agent chat.
 * It is absent otherwise. The inert center mark stays for that case.
 * Future AI prompt: do NOT wire PromptInput from here.
 */
export default function MobileStageToggle({ stage = 'cad', onChange }) {
  const isCad = stage === 'cad';
  const isParts = stage === 'parts';
  const { paired, link, openAgentChat } = useAgentBridgeHost();
  const connected = shouldShowAgentBridgeDisconnect({ paired, link });
  const [working, setWorking] = useState(false);

  useEffect(() => subscribeAgentPromptWorking(setWorking), []);

  const goCad = () => onChange?.('cad');
  const goParts = () => onChange?.('parts');

  const glyph = (on) => (on ? 'text-white' : 'text-white/35');

  return (
    <div
      className="pointer-events-auto flex justify-center"
      data-mobile-stage-toggle=""
      data-home-indicator=""
      role="group"
      aria-label="CAD or Parts"
      style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }}
    >
      <div
        className="relative flex items-center justify-center rounded-full shadow-lg border border-white/20 bg-chrome-surface/55 surface-glass-chip"
        style={{ width: connected ? 168 : 112, height: 30 }}
        data-home-indicator-pill=""
        data-agent-chat-toggle={connected ? 'on' : 'off'}
      >
        <button
          type="button"
          data-stage-btn="cad"
          aria-label="CAD stage"
          aria-pressed={isCad}
          onClick={goCad}
          className={`absolute inset-y-0 left-0 z-10 rounded-l-full active:bg-white/10 ${connected ? 'w-1/3' : 'w-1/2'}`}
        />
        <button
          type="button"
          data-stage-btn="parts"
          aria-label="Parts stage"
          aria-pressed={isParts}
          onClick={goParts}
          className={`absolute inset-y-0 right-0 z-10 rounded-r-full active:bg-white/10 ${connected ? 'w-1/3' : 'w-1/2'}`}
        />
        {connected ? (
          <button
            type="button"
            data-ui-action="data-agent-chat-open"
            data-agent-chat-open=""
            aria-label={working ? 'Agent working' : 'Agent chat'}
            onClick={() => openAgentChat?.()}
            className="absolute inset-y-0 left-1/3 z-10 flex w-1/3 items-center justify-center text-white"
          >
            {working
              ? <Loader2 size={16} className="animate-spin" aria-hidden />
              : <Bot size={16} strokeWidth={1.75} aria-hidden />}
          </button>
        ) : (
          /*
            Future AI prompt: center of this pill will invoke the AI prompt.
            Hook only — do NOT wire PromptInput / generate here (Slice B non-goal).
            `data-ai-prompt-hook` marks the inert center affordance for later.
          */
          <span
            data-ai-prompt-hook=""
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full z-[5] pointer-events-none"
            title="AI prompt (coming soon)"
          />
        )}

        <div
          className="relative z-[1] flex w-full items-center justify-between px-5 pointer-events-none"
          aria-hidden="true"
        >
          <span data-stage-dot="cad" data-stage-icon="box" className={`flex items-center ${glyph(isCad)}`}>
            <Box size={16} strokeWidth={isCad ? 2.25 : 1.75} />
          </span>
          <span data-stage-dot="parts" data-stage-icon="layout-list" className={`flex items-center ${glyph(isParts)}`}>
            <LayoutList size={16} strokeWidth={isParts ? 2.25 : 1.75} />
          </span>
        </div>
      </div>
    </div>
  );
}
