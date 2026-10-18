import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Loader2, Send, Square, X } from 'lucide-react';
import { createAgentPrompt } from '../agent/createAgentPrompt.js';
import { attachViewerShot } from '../agent/agentPromptCapture.js';
import {
  AGENT_PROMPT_REPLY_LONG,
  AGENT_PROMPT_REPLY_SHORT,
  AGENT_PROMPT_TYPED,
  readAgentPromptDemo,
  shouldShowAgentPrompt,
} from '../agent/agentPromptDemo.js';
import { registerAgentPromptHandler } from '../agent/agentPromptHost.js';
import { AGENT_PROMPT_MAX_CHARS, sendAgentPromptText } from '../agent/agentPromptStub.js';
import { shouldShowAgentBridgeDisconnect } from '../agent/ws/pairingFlow.js';
import { useAgentBridgeHost } from './AgentBridgeHost.jsx';

const COUNTER_FROM = 7200;
const PLACEHOLDER = 'Message your agent…';

function demoSeed(state) {
  if (state === 'typing') {
    return { input: AGENT_PROMPT_TYPED, reply: '', working: false, shotOn: false };
  }
  if (state === 'reply-short') {
    return { input: '', reply: AGENT_PROMPT_REPLY_SHORT, working: false, shotOn: false };
  }
  if (state === 'reply-long') {
    return { input: '', reply: AGENT_PROMPT_REPLY_LONG, working: false, shotOn: false };
  }
  if (state === 'working') {
    return {
      input: 'Add four M4 clearance holes 6 mm from each corner',
      reply: '',
      working: true,
      shotOn: false,
    };
  }
  if (state === 'shot-on') {
    return { input: '', reply: '', working: false, shotOn: true };
  }
  return { input: '', reply: '', working: false, shotOn: false };
}

function appendReply(prev, { id, text }) {
  const chunk = typeof text === 'string' ? text : '';
  const last = prev[prev.length - 1];
  if (last && last.id === id) {
    return [...prev.slice(0, -1), { id, text: last.text + chunk }];
  }
  return [...prev, { id, text: chunk }];
}

export default function PromptInput({
  isMobile = false,
  transport: transportProp = null,
  captureViewer = null,
  demoSearch = undefined,
  promptEnv = undefined,
}) {
  const { paired, link } = useAgentBridgeHost();
  const demo = useMemo(
    () => readAgentPromptDemo(demoSearch),
    [demoSearch],
  );

  const transportRef = useRef(null);
  if (transportRef.current == null && transportProp == null) {
    transportRef.current = createAgentPrompt(undefined, promptEnv);
  }
  const transport = transportProp || transportRef.current;
  const visible = shouldShowAgentPrompt({
    paired,
    link,
    demo,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
    hasTransport: Boolean(transport),
  });

  const seed = demoSeed(demo?.state);
  const [input, setInput] = useState(seed.input);
  const [working, setWorking] = useState(seed.working);
  const [replies, setReplies] = useState(
    seed.reply ? [{ id: 'demo', text: seed.reply }] : [],
  );
  const [replyOpen, setReplyOpen] = useState(Boolean(seed.reply));
  const [ackFailed, setAckFailed] = useState(false);
  const [shot, setShot] = useState(null);
  const [shotOn, setShotOn] = useState(seed.shotOn);
  const textareaRef = useRef(null);
  const pendingIdRef = useRef(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const cap = Math.min(144, vh * 0.4);
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    adjustHeight();
    return undefined;
  }, [visible, input, adjustHeight]);

  useEffect(() => {
    if (!visible || !transport) return undefined;
    const offReply = transport.onReply((msg) => {
      if (!msg || typeof msg !== 'object') return;
      setReplies((prev) => appendReply(prev, msg));
      setReplyOpen(true);
      if (msg.final === true) setWorking(false);
    });
    const offWorking = transport.onWorking((on) => {
      setWorking(on === true);
    });
    const offAck = transport.onAck?.((ack) => {
      if (!ack || typeof ack !== 'object') return;
      setAckFailed(ack.delivery === 'failed');
    });
    return () => {
      offReply?.();
      offWorking?.();
      offAck?.();
    };
  }, [transport, visible]);

  const discardShot = useCallback(() => {
    setShot(null);
    setShotOn(false);
  }, []);

  const sendText = useCallback((raw) => {
    const text = typeof raw === 'string' ? raw : input;
    const trimmed = text.trim();
    if (!transport) return { ok: false, reason: 'no_transport' };
    if (!trimmed || working) return { ok: false, reason: 'empty' };
    if (trimmed.length > AGENT_PROMPT_MAX_CHARS) {
      return { ok: false, reason: 'too_long' };
    }
    const sent = sendAgentPromptText(
      transport,
      trimmed,
      shot ? { screenshot: shot } : {},
      { working },
    );
    if (!sent.ok) return sent;
    setAckFailed(false);
    setWorking(true);
    pendingIdRef.current = sent.id;
    setInput('');
    discardShot();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    return sent;
  }, [discardShot, input, shot, transport, working]);

  const stopAgent = useCallback(() => {
    transport?.abort?.();
    setWorking(false);
    return { ok: true };
  }, [transport]);

  const dismissReply = useCallback(() => {
    setReplyOpen(false);
    setReplies([]);
    setAckFailed(false);
    return { ok: true };
  }, []);

  const toggleShot = useCallback(async () => {
    if (shotOn || shot) {
      discardShot();
      return { ok: true, attached: false };
    }
    const attached = await Promise.resolve(attachViewerShot(captureViewer));
    if (!attached.ok) {
      discardShot();
      return attached;
    }
    setShot(attached.shot);
    setShotOn(true);
    return { ok: true, attached: true };
  }, [captureViewer, discardShot, shot, shotOn]);

  useEffect(() => {
    if (!visible) {
      registerAgentPromptHandler(null);
      return undefined;
    }
    return registerAgentPromptHandler((args) => {
      const action = args.action
        || (typeof args.text === 'string' && args.text.trim() ? 'send' : '');
      if (action === 'stop') return stopAgent();
      if (action === 'dismiss') return dismissReply();
      if (action === 'screenshot') return toggleShot();
      if (action === 'send' || args.text) {
        if (typeof args.text === 'string') setInput(args.text);
        return sendText(args.text);
      }
      return { error: { code: 'bad_args', message: 'Need text or action' } };
    });
  }, [dismissReply, sendText, stopAgent, toggleShot, visible]);

  if (!visible) return null;

  const replyText = replies.map((row) => row.text).join('\n\n');
  const showReply = replyOpen && replyText && !working;
  const nearLimit = input.length >= COUNTER_FROM;
  const overLimit = input.length > AGENT_PROMPT_MAX_CHARS;
  const remaining = AGENT_PROMPT_MAX_CHARS - input.length;
  const shotCue = shotOn || shot;
  const canCapture = typeof captureViewer === 'function';
  const shotPreview = shot?.data
    ? `data:image/png;base64,${shot.data}`
    : '';

  const onSubmit = (event) => {
    event?.preventDefault?.();
    if (working) {
      stopAgent();
      return;
    }
    sendText(input);
  };

  return (
    <div
      className={`agent-prompt surface-glass text-on-dark font-ui ${
        isMobile ? 'agent-prompt--compact' : ''
      }`}
      data-agent-prompt=""
      data-agent-prompt-compact={isMobile ? '1' : '0'}
      data-agent-prompt-working={working ? '1' : '0'}
      data-agent-prompt-shot={shotCue ? '1' : '0'}
    >
      {showReply ? (
        <div className="agent-prompt-reply rail-scroll" data-agent-reply="">
          <div className="agent-prompt-cap">
            <span className="text-ui-xs font-semibold uppercase tracking-wide text-muted-on-dark">
              Agent
            </span>
            <button
              type="button"
              className="agent-prompt-icon-btn text-muted-on-dark"
              onClick={dismissReply}
              data-ui-action="data-agent-prompt-dismiss"
              data-agent-prompt-dismiss=""
              aria-label="Dismiss reply"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
          <div className="agent-prompt-reply-body text-ui text-on-dark">{replyText}</div>
        </div>
      ) : null}

      {working ? (
        <div className="agent-prompt-working" data-agent-working="">
          <Loader2 size={14} className="animate-spin text-muted-on-dark" aria-hidden />
          <span className="text-ui-sm text-muted-on-dark">Agent is working…</span>
        </div>
      ) : null}

      {ackFailed ? (
        <p className="agent-prompt-ack text-ui-xs text-muted-on-dark" data-agent-prompt-ack="failed">
          Agent not listening
        </p>
      ) : null}

      {shotCue ? (
        <div className="agent-prompt-shot-cue" data-agent-prompt-shot-cue="">
          {shotPreview ? (
            <img
              src={shotPreview}
              alt=""
              className="agent-prompt-thumb"
              data-agent-prompt-thumb=""
            />
          ) : (
            <span className="agent-prompt-thumb agent-prompt-thumb--empty" aria-hidden />
          )}
          <span className="text-ui-xs text-muted-on-dark">Screenshot attached</span>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="agent-prompt-row">
        <textarea
          ref={textareaRef}
          value={input}
          rows={1}
          onChange={(event) => {
            const next = event.target.value.slice(0, AGENT_PROMPT_MAX_CHARS + 200);
            setInput(next.slice(0, AGENT_PROMPT_MAX_CHARS));
            adjustHeight();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit(event);
            }
          }}
          placeholder={PLACEHOLDER}
          className="agent-prompt-input text-ui-lg text-on-dark font-ui"
          data-agent-prompt-input=""
          disabled={working}
          aria-label="Message your agent"
        />
        {nearLimit ? (
          <span
            className="agent-prompt-counter text-ui-xs text-muted-on-dark"
            data-agent-prompt-counter=""
          >
            {overLimit ? 0 : remaining}
          </span>
        ) : null}
        <button
          type="button"
          className={`agent-prompt-icon-btn agent-prompt-camera ${
            shotCue ? 'text-success' : 'text-on-dark'
          }`}
          onClick={() => { toggleShot(); }}
          data-ui-action="data-agent-prompt-screenshot"
          data-agent-prompt-screenshot=""
          aria-label={shotCue ? 'Discard screenshot' : 'Attach screenshot'}
          aria-pressed={shotCue}
          disabled={!canCapture && !shotCue}
        >
          <Camera size={18} aria-hidden />
        </button>
        {working ? (
          <button
            type="submit"
            className="agent-prompt-icon-btn surface-quiet text-on-dark"
            data-ui-action="data-agent-prompt-stop"
            data-agent-prompt-stop=""
            aria-label="Stop agent"
          >
            <Square size={16} aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            className="agent-prompt-send"
            data-ui-action="data-agent-prompt-send"
            data-agent-prompt-send=""
            aria-label="Send"
            disabled={!input.trim() || overLimit}
          >
            <Send size={18} aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}
