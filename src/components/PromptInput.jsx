import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowDown, Camera, Loader2, Send, Square, X } from 'lucide-react';
import { createAgentPrompt } from '../agent/createAgentPrompt.js';
import { attachViewerShot } from '../agent/agentPromptCapture.js';
import {
  AGENT_PROMPT_CHAT,
  AGENT_PROMPT_CHAT_LONG,
  AGENT_PROMPT_REPLY_LONG,
  AGENT_PROMPT_REPLY_SHORT,
  AGENT_PROMPT_TYPED,
  agentPromptDemoAllowed,
  readAgentPromptDemo,
  shouldShowAgentPrompt,
} from '../agent/agentPromptDemo.js';
import { registerAgentPromptHandler } from '../agent/agentPromptHost.js';
import { setAgentPromptWorking } from '../agent/agentFeaturePopupGate.js';
import { typingReducer, typingSeed, typingShown } from '../agent/agentPromptTyping.js';
import { conversationReducer, conversationSeed, stickToBottom } from '../agent/agentPromptConversation.js';
import {
  AGENT_PROMPT_WORKING_TIMEOUT_MS,
  ackNotice,
  bindAgentPromptTransport,
  shouldUseLiveAgentPrompt,
} from '../agent/agentPromptLive.js';
import { AGENT_PROMPT_MAX_CHARS, sendAgentPromptText } from '../agent/agentPromptStub.js';
import { shouldShowAgentBridgeDisconnect } from '../agent/ws/pairingFlow.js';
import { useAgentBridgeHost } from './AgentBridgeHost.jsx';

const COUNTER_FROM = 7200;
const PLACEHOLDER = 'Message your agent…';

function demoSeed(state) {
  if (state === 'typing') {
    return { input: AGENT_PROMPT_TYPED, reply: '', working: false, shotOn: false, streaming: false };
  }
  if (state === 'reply-short') {
    return { input: '', reply: AGENT_PROMPT_REPLY_SHORT, working: false, shotOn: false, streaming: false };
  }
  if (state === 'reply-long') {
    return { input: '', reply: AGENT_PROMPT_REPLY_LONG, working: false, shotOn: false, streaming: false };
  }
  if (state === 'reply-streaming') {
    return { input: '', reply: 'Adding the holes', working: false, shotOn: false, streaming: true };
  }
  if (state === 'working') {
    return { input: '', reply: 'Updating the cube', working: true, shotOn: false, streaming: true };
  }
  if (state === 'shot-on') {
    return { input: '', reply: '', working: false, shotOn: true, streaming: false };
  }
  if (state === 'chat') {
    return { input: '', reply: '', messages: AGENT_PROMPT_CHAT, working: false, shotOn: false, streaming: false };
  }
  if (state === 'chat-long') {
    return { input: '', reply: '', messages: AGENT_PROMPT_CHAT_LONG, working: false, shotOn: false, streaming: false };
  }
  return { input: '', reply: '', working: false, shotOn: false, streaming: false };
}

export default function PromptInput({
  isMobile = false,
  transport: transportProp = null,
  captureViewer = null,
  demoSearch = undefined,
  promptEnv = undefined,
  promptContext = undefined,
  featurePopupOpen = false,
}) {
  const { paired, link, promptTransport } = useAgentBridgeHost();
  const demoAllowed = agentPromptDemoAllowed(promptEnv);
  const demo = useMemo(
    () => readAgentPromptDemo(demoSearch, promptEnv),
    [demoSearch, promptEnv],
  );
  const liveSession = shouldUseLiveAgentPrompt({ paired, link });

  const stubRef = useRef(undefined);
  if (stubRef.current === undefined) {
    stubRef.current = createAgentPrompt(undefined, promptEnv);
  }
  // Paired (or still-connected) sessions use the real transport in DEV and
  // prod. The echo stub is DEV-only and only when nothing is paired.
  const transport = transportProp
    || (liveSession ? promptTransport : stubRef.current)
    || null;
  const visible = shouldShowAgentPrompt({
    paired,
    link,
    demo,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
    hasTransport: Boolean(transport),
    demoAllowed,
  });

  const seed = demoSeed(demo?.state);
  const [input, setInput] = useState(seed.input);
  // One pending prompt drives the dots, Stop, and the working hint; see agentPromptTyping.js.
  const [typing, dispatchTyping] = useReducer(typingReducer, seed, typingSeed);
  const working = typing.working;
  // The conversation for this connection: user messages and agent replies in order.
  const [chat, dispatchChat] = useReducer(conversationReducer, seed, conversationSeed);
  const [ack, setAck] = useState(null);
  const paneRef = useRef(null);
  // Follow new messages unless the user scrolled up to read.
  const stuckRef = useRef(true);
  const [jump, setJump] = useState(false);
  const [shot, setShot] = useState(null);
  const [shotOn, setShotOn] = useState(seed.shotOn);
  const textareaRef = useRef(null);
  const pendingIdRef = useRef(null);
  const notice = ackNotice(ack);

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
    return bindAgentPromptTransport(transport, {
      onReply(msg) {
        if (!msg || typeof msg !== 'object') return;
        const text = typeof msg.text === 'string' ? msg.text : '';
        dispatchChat({ type: 'reply', id: msg.id, text });
        dispatchTyping({ type: 'reply', id: msg.id, final: msg.final === true });
      },
      onWorking(on) {
        dispatchTyping({ type: 'working', on: on === true });
      },
      onAck(event) {
        if (!event || typeof event !== 'object') return;
        if (pendingIdRef.current && event.id !== pendingIdRef.current) return;
        setAck(event);
        dispatchTyping({ type: 'ack', id: event.id, delivery: event.delivery });
      },
    });
  }, [transport, visible]);

  useEffect(() => {
    if (visible) return undefined;
    dispatchTyping({ type: 'disconnect' });
    dispatchChat({ type: 'disconnect' });
    setAck(null);
    pendingIdRef.current = null;
    return undefined;
  }, [visible]);

  useEffect(() => {
    setAgentPromptWorking(working);
    return () => {
      if (working) setAgentPromptWorking(false);
    };
  }, [working]);

  useEffect(() => {
    if (!working) return undefined;
    const timer = setTimeout(() => dispatchTyping({ type: 'timeout' }), AGENT_PROMPT_WORKING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [working]);

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
    setAck(null);
    const sent = sendAgentPromptText(
      transport,
      trimmed,
      {
        ...(shot ? { screenshot: shot } : {}),
        ...(promptContext ? { context: promptContext } : {}),
      },
      { working },
    );
    if (!sent.ok) return sent;
    pendingIdRef.current = sent.id;
    dispatchTyping({ type: 'sent', id: sent.id });
    dispatchChat({
      type: 'sent',
      id: sent.id,
      text: trimmed,
      thumb: shot?.data ? `data:image/png;base64,${shot.data}` : null,
    });
    stuckRef.current = true;
    setInput('');
    discardShot();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    return sent;
  }, [discardShot, input, promptContext, shot, transport, working]);

  const stopAgent = useCallback(() => {
    const id = pendingIdRef.current;
    if (typeof transport?.cancel === 'function') void transport.cancel(id);
    setAgentPromptWorking(false);
    dispatchTyping({ type: 'stop' });
    return { ok: true };
  }, [transport]);

  // Dismiss hides the pane; the history stays until the agent disconnects.
  const dismissReply = useCallback(() => {
    dispatchChat({ type: 'dismiss' });
    setAck(null);
    return { ok: true };
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = paneRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stuckRef.current = true;
    setJump(false);
  }, []);

  const onPaneScroll = useCallback(() => {
    const el = paneRef.current;
    if (!el) return;
    stuckRef.current = stickToBottom(el);
    if (stuckRef.current) setJump(false);
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

  const responding = typingShown(typing);
  const showReply = visible && (responding || (!chat.hidden && chat.messages.length > 0));
  const lastKey = chat.messages.length ? chat.messages[chat.messages.length - 1].key : '';
  const lastLen = chat.messages.length ? chat.messages[chat.messages.length - 1].text.length : 0;

  // New content: follow it when the pane was at the bottom, else offer a way down.
  useEffect(() => {
    if (!showReply) return undefined;
    const el = paneRef.current;
    if (!el) return undefined;
    if (stuckRef.current) {
      el.scrollTop = el.scrollHeight;
      setJump(false);
    } else if (el.scrollHeight > el.clientHeight) {
      setJump(true);
    }
    return undefined;
  }, [showReply, lastKey, lastLen, responding]);

  if (!visible) return null;

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
      }${featurePopupOpen ? ' agent-prompt--away' : ''}`}
      data-agent-prompt=""
      data-agent-prompt-compact={isMobile ? '1' : '0'}
      data-agent-prompt-working={working ? '1' : '0'}
      data-agent-prompt-shot={shotCue ? '1' : '0'}
      data-agent-prompt-away={featurePopupOpen ? '1' : '0'}
      data-agent-prompt-responding={responding ? '1' : '0'}
      aria-hidden={featurePopupOpen ? true : undefined}
      {...(featurePopupOpen ? { inert: '' } : {})}
    >
      {showReply ? (
        <div
          className="agent-prompt-reply rail-scroll"
          data-agent-reply=""
          data-agent-chat-count={chat.messages.length}
          ref={paneRef}
          onScroll={onPaneScroll}
        >
          {responding ? null : (
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
                aria-label="Dismiss conversation"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          )}
          <div className="agent-prompt-chat" data-agent-chat="">
            {chat.messages.map((row) => (
              row.role === 'user' ? (
                <div
                  key={row.key}
                  className="agent-prompt-msg agent-prompt-msg--user surface-quiet text-ui text-on-dark"
                  data-agent-msg="user"
                >
                  {row.thumb ? (
                    <img src={row.thumb} alt="" className="agent-prompt-thumb agent-prompt-msg-thumb" data-agent-msg-thumb="" />
                  ) : null}
                  <span className="agent-prompt-msg-text">{row.text}</span>
                </div>
              ) : (
                <div
                  key={row.key}
                  className="agent-prompt-msg agent-prompt-msg--agent agent-prompt-reply-body text-ui text-on-dark"
                  data-agent-msg="agent"
                  data-agent-reply-body=""
                >
                  {row.text}
                </div>
              )
            ))}
            {responding ? (
              <div className="agent-prompt-reply-line" data-agent-typing="">
                <span className="agent-prompt-dots" data-agent-reply-dots="" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            ) : null}
          </div>
          {jump ? (
            <button
              type="button"
              className="agent-prompt-jump surface-quiet text-on-dark"
              onClick={scrollToBottom}
              data-ui-action="data-agent-prompt-jump"
              data-agent-prompt-jump=""
              aria-label="Jump to newest message"
            >
              <ArrowDown size={14} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

      {notice?.kind === 'failed' ? (
        <p className="agent-prompt-ack text-ui-xs text-on-dark" data-agent-prompt-ack="failed">
          {notice.text}
        </p>
      ) : null}

      {notice?.kind === 'queued' && !working ? (
        <p className="agent-prompt-ack text-ui-xs text-muted-on-dark" data-agent-prompt-ack="queued">
          Waiting for agent
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
        <div className="agent-prompt-field">
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
            placeholder={working ? '' : PLACEHOLDER}
            className="agent-prompt-input text-ui-lg text-on-dark font-ui"
            data-agent-prompt-input=""
            disabled={working}
            aria-label="Message your agent"
          />
          {working && !input ? (
            <span className="agent-prompt-hint text-ui-sm text-on-dark" data-agent-working="">
              <Loader2 size={14} className="agent-prompt-spinner text-on-dark" aria-hidden />
              <span>Agent is working...</span>
            </span>
          ) : null}
        </div>
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
            <Square size={14} fill="currentColor" aria-hidden />
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
