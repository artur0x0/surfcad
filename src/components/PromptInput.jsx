import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowDown, Camera, ChevronDown, ChevronUp, ImagePlus, Loader2, Monitor, Send, Square, X } from 'lucide-react';
import { createAgentPrompt } from '../agent/createAgentPrompt.js';
import { attachViewerShot } from '../agent/agentPromptCapture.js';
import { AGENT_PROMPT_PHOTO_ACCEPT, photoFileToShot } from '../agent/agentPromptPhoto.js';
import {
  AGENT_PROMPT_CHAT,
  AGENT_PROMPT_CHAT_LONG,
  AGENT_PROMPT_REPLY_LONG,
  AGENT_PROMPT_REPLY_SHORT,
  AGENT_PROMPT_SESSION_NOTE,
  AGENT_PROMPT_TYPED,
  agentPromptDemoAllowed,
  readAgentPromptDemo,
  shouldShowAgentPrompt,
} from '../agent/agentPromptDemo.js';
import { registerAgentPromptHandler } from '../agent/agentPromptHost.js';
import { createPressGate } from '../agent/agentPromptPress.js';
import { setAgentPromptBuilding, setAgentPromptWorking } from '../agent/agentFeaturePopupGate.js';
import { pendingShown, typingSeed, typingShown, workingShown } from '../agent/agentPromptTyping.js';
import {
  autoFoldTarget,
  initialPromptFlow,
  promptFlowView,
  scheduleAckHold,
  stepPromptFlow,
} from '../agent/agentPromptFlow.js';
import {
  AGENT_SESSION_IDLE_MS,
  sessionBusy,
  sessionIdleAt,
  sessionPromptMode,
  sessionReducer,
  sessionReplying,
  sessionSeed,
  sessionWorking,
} from '../agent/agentSessionState.js';
import { createPromptWatch, stepPromptWatch } from '../agent/agentPromptWatch.js';
import { clearFolded, foldBadge, readFolded, stateAnnouncement, writeFolded } from '../agent/agentPromptFold.js';
import { conversationReducer, conversationSeed, stickToBottom } from '../agent/agentPromptConversation.js';
import {
  AGENT_PROMPT_STALL_MS,
  ackNotice,
  agentPromptStallCopy,
  bindAgentPromptTransport,
  shouldUseLiveAgentPrompt,
} from '../agent/agentPromptLive.js';
import { AGENT_PROMPT_MAX_CHARS, sendAgentPromptText } from '../agent/agentPromptStub.js';
import {
  AGENT_PROMPT_SEND_TIMEOUT_MS,
  clearAcceptedPrompt,
  emptyPromptFlight,
  promptDraftText,
  restorePromptDraft,
  shouldClearPromptOnSend,
  stepPromptFlight,
} from '../agent/agentPromptSend.js';
import {
  mobileChatHideReason,
  shouldOpenAgentChatOnConnect,
  shouldShowAgentBridgeDisconnect,
} from '../agent/ws/pairingFlow.js';
import { featureSheetEditLift, isTouchEditDevice, keyboardOpen } from '../utils/featureFieldEdit.js';
import { useModalViewport } from '../hooks/useModalViewport.js';
import { useAgentBridgeHost } from './AgentBridgeHost.jsx';
import { AgentPromptFrame } from './AgentPromptTail.jsx';

/** Keep the caret in the field. A tap that blurs first is dropped on iOS.
 *  Cancelling pointerdown can also drop the click, so the button runs its
 *  action on pointerup. When the click does follow, in the same task or a
 *  later one, a press gate (agentPromptPress.js) treats it as that tap's
 *  echo and it does not run the action a second time. */
function keepFieldFocus(event) {
  event.preventDefault();
}

/** An ack error raised by attaching an image, cleared by the next successful attach. */
function isAttachError(error) {
  return error === 'capture_failed' || error === 'photo_failed' || error === 'photo_unsupported' || error === 'photo_too_large';
}

/**
 * While the composer is focused on a touch device, park it on the visual
 * viewport with the same lift as the feature card. While the soft keyboard
 * is up (the visual viewport is short, not focus alone) the prompt says so
 * with data-agent-prompt-keyboard="1": the stage pill hides and the prompt
 * rests close above the keyboard (index.css). Focus alone must not move the
 * prompt: a tap on a prompt button that blurs the field would shift it
 * under the finger, and a hardware keyboard has nothing to clear.
 */
function AgentPromptFocusLift({ rootRef }) {
  useModalViewport();
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let ro = null;
    const apply = () => {
      const pane = root.closest('.viewport-shell') || root.parentElement;
      if (!pane || typeof pane.getBoundingClientRect !== 'function') return;
      const vv = window.visualViewport;
      const vvHeight = vv?.height ?? window.innerHeight;
      const vvOffsetTop = vv?.offsetTop ?? 0;
      const lift = featureSheetEditLift({
        paneBottom: pane.getBoundingClientRect().bottom,
        docTop: document.documentElement.getBoundingClientRect().top,
        scrollY: window.scrollY || window.pageYOffset || 0,
        vvHeight,
        vvOffsetTop,
      });
      root.style.setProperty('--agent-prompt-lift', `${lift}px`);
      const up = keyboardOpen({ layoutHeight: window.innerHeight, vvHeight, vvOffsetTop });
      root.setAttribute('data-agent-prompt-keyboard', up ? '1' : '0');
    };
    apply();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    const pane = root.closest('.viewport-shell') || root.parentElement;
    if (typeof ResizeObserver === 'function' && pane) {
      ro = new ResizeObserver(apply);
      ro.observe(pane);
    }
    return () => {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      ro?.disconnect();
      root.style.removeProperty('--agent-prompt-lift');
      root.removeAttribute('data-agent-prompt-keyboard');
    };
  }, [rootRef]);
  return null;
}

const COUNTER_FROM = 7200;
/** Matches `.agent-prompt--folded` transform duration. After this the
 *  component sets visibility:hidden; a 0s CSS visibility transition does not. */
const AGENT_PROMPT_FOLD_MS = 220;
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
  if (state === 'agent-typing') {
    return { input: '', reply: '', messages: AGENT_PROMPT_CHAT, mode: 'typing', working: false, shotOn: false, streaming: false };
  }
  if (state === 'agent-working') {
    return { input: '', reply: '', messages: AGENT_PROMPT_CHAT, mode: 'working', working: true, shotOn: false, streaming: false };
  }
  if (state === 'session-working') {
    // No prompt in flight: the agent is changing the model on its own.
    return { input: '', reply: '', messages: AGENT_PROMPT_CHAT, working: false, shotOn: false, streaming: false, session: 'working' };
  }
  if (state === 'folded') {
    return { input: '', reply: '', messages: AGENT_PROMPT_CHAT, working: false, shotOn: false, streaming: false, folded: true };
  }
  if (state === 'session-note') {
    return {
      input: '',
      reply: '',
      messages: [{ role: 'agent', text: AGENT_PROMPT_SESSION_NOTE }],
      working: false,
      shotOn: false,
      streaming: false,
    };
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
  const {
    paired,
    link,
    promptTransport,
    agentChatOpen = false,
    openAgentChat,
    closeAgentChat,
    chatHold = null,
    agentGone = false,
    rememberChatOpen,
  } = useAgentBridgeHost();
  const demoAllowed = agentPromptDemoAllowed(promptEnv);
  const demo = useMemo(
    () => readAgentPromptDemo(demoSearch, promptEnv),
    [demoSearch, promptEnv],
  );
  const liveSession = shouldUseLiveAgentPrompt({ paired, link });
  const wasLiveRef = useRef(false);
  const holding = chatHold != null;
  // A reload restore paints the saved shell before the socket. Skip the first
  // connect unfold so a collapsed chat stays collapsed.
  const preserveFoldRef = useRef(chatHold != null);
  const sawLiveRef = useRef(false);

  const stubRef = useRef(undefined);
  if (stubRef.current === undefined) {
    stubRef.current = createAgentPrompt(undefined, promptEnv);
  }
  // Paired (or still-connected) sessions use the real transport in DEV and
  // prod. The echo stub is DEV-only and only when nothing is paired. A
  // reload hold is not paired, so it must not fall through to the stub.
  const transport = transportProp
    || (liveSession ? promptTransport : (holding || agentGone ? null : stubRef.current))
    || null;
  const sessionVisible = shouldShowAgentPrompt({
    paired,
    link,
    demo,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
    hasTransport: Boolean(transport),
    demoAllowed,
  });
  // Phone: the bot button opens the same chat. Desktop and the demo pin stay up.
  // A reload hold paints that same shell immediately. `visible` stays the
  // live session so a hold is not treated as a connected agent.
  const shown = (sessionVisible && (!isMobile || Boolean(demo) || agentChatOpen))
    || (holding && (!isMobile || agentChatOpen))
    || (agentGone && agentChatOpen);
  const visible = sessionVisible;

  const seed = demoSeed(demo?.state);
  const [input, setInput] = useState(seed.input);
  // One pending prompt drives the dots, Stop, and the working hint; see agentPromptTyping.js.
  const [typing, setTyping] = useState(() => typingSeed(seed));
  const typingRef = useRef(typing);
  typingRef.current = typing;
  const dispatchTypingRef = useRef(null);
  const watchRef = useRef(null);
  if (watchRef.current == null) {
    watchRef.current = createPromptWatch({
      timeoutMs: AGENT_PROMPT_STALL_MS,
      onStall: () => dispatchTypingRef.current?.({ type: 'stall' }),
    });
  }
  const dispatchTyping = useCallback((event) => {
    const next = stepPromptWatch(typingRef.current, watchRef.current, event);
    typingRef.current = next;
    setTyping(next);
  }, []);
  dispatchTypingRef.current = dispatchTyping;
  // Session-level state: what the agent is doing with or without a prompt
  // (agentSessionState.js). Fed by the tab's own bridge calls, the agent's
  // status and progress frames, and one idle timer. It lives in the tab, so
  // a fresh MCP process per tool call and an agent-started build both show.
  const [session, setSession] = useState(() => sessionSeed(seed.session));
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const dispatchSession = useCallback((event) => {
    const next = sessionReducer(sessionRef.current, { at: Date.now(), ...event });
    if (next === sessionRef.current) return;
    sessionRef.current = next;
    setSession(next);
  }, []);
  // Two agent states: typing keeps the chat open with the dots; working
  // collapses the chat and shows the spinner in the field.
  const mode = typing.mode;
  const pending = pendingShown(typing);
  // With no prompt in flight the session state drives the same chrome:
  // working collapses the chat and disables the field (nothing to Stop),
  // replying shows the dots.
  const sessionOnly = !pending && sessionBusy(session);
  const sessionWorks = sessionOnly && sessionWorking(session);
  const sessionReplies = sessionOnly && sessionReplying(session);
  const effectiveMode = pending ? mode : sessionPromptMode(session);
  const modeWorking = workingShown(typing) || sessionWorks;
  // The chevron is desktop-only. Auto-fold after the ack hold is shared:
  // phone closes onto the Bot spinner, desktop uses this fold path.
  const foldable = !isMobile;
  const foldedInitially = (seed.folded === true)
    || (foldable && (chatHold != null ? chatHold.open !== true : readFolded()));
  const [folded, setFolded] = useState(foldedInitially);
  // Hidden only after the slide (or immediately when we mount already folded).
  const [foldSettled, setFoldSettled] = useState(foldedInitially);
  const [unread, setUnread] = useState(false);
  const foldedRef = useRef(folded);
  foldedRef.current = folded;
  const [announce, setAnnounce] = useState('');
  const rootRef = useRef(null);
  // The conversation for this connection: user messages and agent replies in order.
  const [chat, dispatchChat] = useReducer(conversationReducer, seed, conversationSeed);
  useEffect(() => {
    if (agentChatOpen) dispatchChat({ type: 'show' });
  }, [agentChatOpen]);
  const [ack, setAck] = useState(null);
  const flowRef = useRef(initialPromptFlow());
  const [flow, setFlow] = useState(flowRef.current);
  const dispatchFlow = useCallback((event) => {
    const next = stepPromptFlow(flowRef.current, event);
    if (next === flowRef.current) return;
    flowRef.current = next;
    setFlow(next);
  }, []);
  const live = promptFlowView(flow);
  // During the 10s ack hold the reply stays up. Working chrome waits.
  const working = modeWorking && !live.holdActive;
  const holdRef = useRef(false);
  holdRef.current = live.holdActive;
  const paneRef = useRef(null);
  // Follow new messages unless the user scrolled up to read.
  const stuckRef = useRef(true);
  const [jump, setJump] = useState(false);
  const [shot, setShot] = useState(null);
  const [shotOn, setShotOn] = useState(seed.shotOn);
  // 'viewer' (a screenshot of the model) or 'photo' (from the device camera or library).
  const [shotSource, setShotSource] = useState('viewer');
  // The attach drawer under the field: Screenshot or Photo.
  const [attachOpen, setAttachOpen] = useState(false);
  const photoInputRef = useRef(null);
  const photoBusyRef = useRef(false);
  const attachShotGateRef = useRef(null);
  if (attachShotGateRef.current == null) attachShotGateRef.current = createPressGate();
  const attachPhotoGateRef = useRef(null);
  if (attachPhotoGateRef.current == null) attachPhotoGateRef.current = createPressGate();
  const textareaRef = useRef(null);
  const pendingIdRef = useRef(null);
  const notice = ackNotice(ack);

  const composingRef = useRef(false);
  const syncAckRef = useRef(null);
  const pendingDraftRef = useRef(null);
  const sentTextRef = useRef(null);
  const sendTimerRef = useRef(null);
  const flightRef = useRef(emptyPromptFlight());
  const commitFlight = useCallback((flight) => {
    flightRef.current = flight;
    pendingIdRef.current = flight.pendingId;
    sentTextRef.current = flight.sent;
    pendingDraftRef.current = flight.draft;
  }, []);
  const applyPromptEffect = useCallback((effect) => {
    if (effect.input?.op === 'restore') {
      setInput((cur) => restorePromptDraft(cur, effect.input.text));
    } else if (effect.input?.op === 'clear') {
      setInput((cur) => clearAcceptedPrompt(cur, effect.input.text));
    }
    if (effect.shot?.op === 'restore') {
      setShot((cur) => cur || effect.shot.shot);
      setShotOn(true);
    } else if (effect.shot?.op === 'clear') {
      setShot(null);
      setShotOn(false);
    }
  }, []);
  // One gate per button: a tap on the camera must not swallow a click on Send.
  const actionGateRef = useRef(null);
  if (actionGateRef.current == null) actionGateRef.current = createPressGate();
  const cameraGateRef = useRef(null);
  if (cameraGateRef.current == null) cameraGateRef.current = createPressGate();
  const shotBusyRef = useRef(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const cap = Math.min(24 * 5 + 12, vh * 0.4);
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, []);

  // A layout effect, not an effect: the field's height must be final in the
  // same layout as the value it holds. After a send React committed the
  // cleared value at the old five-line height, iOS published the caret rect
  // there, and the effect then shrank the field to one line under it, so
  // the caret floated over the "Waiting for agent" line (Artur, 2026-11-07).
  useLayoutEffect(() => {
    if (!shown) {
      setFieldFocused(false);
      return undefined;
    }
    adjustHeight();
    return undefined;
  }, [shown, input, adjustHeight]);

  useEffect(() => {
    if (!visible || !transport) return undefined;
    return bindAgentPromptTransport(transport, {
      onReply(msg) {
        if (!msg || typeof msg !== 'object') return;
        const text = typeof msg.text === 'string' ? msg.text : '';
        const note = msg.session === true;
        dispatchChat({ type: 'reply', id: note ? undefined : msg.id, text, session: note });
        if (note) {
          dispatchSession({ type: 'reply' });
          if (foldedRef.current) setUnread(true);
          setAnnounce('Agent replied');
          return;
        }
        // A reply is activity. A final one closes; a partial one restarts the deadline.
        dispatchTyping({ type: 'reply', id: msg.id, final: msg.final === true });
        dispatchSession({ type: 'reply', final: msg.final === true });
        dispatchFlow({ type: 'reply', final: msg.final === true });
        if (msg.final === true) {
          if (foldedRef.current) setUnread(true);
          setAnnounce('Agent replied');
        }
      },
      // The live transport carries the mode; the DEV stub only has the boolean.
      ...(typeof transport.onState === 'function'
        ? {
          onState(event) {
            if (event?.stalled) dispatchTyping({ type: 'stall' });
            else dispatchTyping({ type: 'state', state: event?.mode });
            // With or without a prompt id: an explicit set_status, or the
            // process entering building on a model change, is the session state.
            if (!event?.stalled) {
              dispatchSession({ type: 'status', state: event?.mode });
              if (event?.mode === 'typing' || event?.mode === 'working') {
                dispatchFlow({ type: 'status', state: event.mode });
              }
            }
          },
        }
        : {
          onWorking(on) {
            dispatchTyping({ type: 'working', on: on === true });
            dispatchFlow({ type: 'status', state: on === true ? 'working' : 'idle' });
          },
        }),
      onAck(event) {
        if (!event || typeof event !== 'object') return;
        syncAckRef.current = event;
        const stepped = stepPromptFlight(flightRef.current, {
          type: 'ack',
          id: event.id,
          delivery: event.delivery,
        });
        if (stepped.ignore) return;
        commitFlight(stepped.flight);
        if (sendTimerRef.current != null) {
          clearTimeout(sendTimerRef.current);
          sendTimerRef.current = null;
        }
        applyPromptEffect(stepped);
        setAck(event);
        dispatchTyping({ type: 'ack', id: event.id, delivery: event.delivery });
        dispatchFlow({ type: 'delivery', delivery: event.delivery });
      },
      onActivity(event) {
        if (event?.hold === true) dispatchTyping({ type: 'hold', on: true });
        else if (event?.hold === false) dispatchTyping({ type: 'hold', on: false });
        else dispatchTyping({ type: 'activity' });
        // A bridge call this tab is running that changes the model: the
        // agent is working, prompt or not. A read is not a state change.
        if (event?.hold === true && event.mutates === true) {
          dispatchSession({ type: 'command', mutates: true });
          dispatchFlow({ type: 'work' });
        }
      },
    });
  }, [applyPromptEffect, commitFlight, dispatchFlow, dispatchSession, dispatchTyping, transport, visible]);

  useEffect(() => {
    const open = shouldOpenAgentChatOnConnect(wasLiveRef.current, liveSession);
    wasLiveRef.current = liveSession;
    if (!open) return;
    if (preserveFoldRef.current) {
      preserveFoldRef.current = false;
      return;
    }
    clearFolded();
    setFolded(false);
    setFoldSettled(false);
  }, [liveSession]);

  useEffect(() => {
    if (chatHold == null && !wasLiveRef.current) preserveFoldRef.current = false;
  }, [chatHold]);

  useEffect(() => {
    if (!agentGone) return undefined;
    dispatchSession({ type: 'closed' });
    setAck({ delivery: 'failed', error: 'not_paired' });
    setFolded(false);
    setFoldSettled(false);
    return undefined;
  }, [agentGone, dispatchSession]);

  useEffect(() => {
    if (!visible || agentGone) return undefined;
    setAck((prev) => (prev?.error === 'not_paired' ? null : prev));
    return undefined;
  }, [agentGone, visible]);

  useEffect(() => {
    if (visible) {
      sawLiveRef.current = true;
      return undefined;
    }
    // The pre-socket gap is not a disconnect. Wiping the fold here is the
    // collapse flicker. Wait until a session was actually on screen.
    if (holding || agentGone || !sawLiveRef.current) return undefined;
    dispatchTyping({ type: 'disconnect' });
    dispatchSession({ type: 'disconnect' });
    dispatchFlow({ type: 'disconnect' });
    dispatchChat({ type: 'disconnect' });
    setAck(null);
    commitFlight(stepPromptFlight(flightRef.current, { type: 'disconnect' }).flight);
    // The agent is gone: the next session starts open.
    clearFolded();
    setFolded(false);
    setFoldSettled(false);
    setUnread(false);
    return undefined;
  }, [agentGone, commitFlight, dispatchFlow, dispatchSession, dispatchTyping, holding, visible]);

  // A progress frame is the working signal. The text on that frame is never read.
  // During the ack hold the pane stays up; the fold runs when the hold ends.
  useEffect(() => {
    if (typeof transport?.onProgress !== 'function') return undefined;
    return transport.onProgress(() => {
      dispatchSession({ type: 'progress' });
      dispatchFlow({ type: 'work' });
      if (mobileChatHideReason({ isMobile, progressEdge: true, hold: holdRef.current })) closeAgentChat?.();
    });
  }, [closeAgentChat, dispatchFlow, dispatchSession, isMobile, transport]);
  // One timer for the session window: no activity for AGENT_SESSION_IDLE_MS is idle.
  useEffect(() => {
    const due = sessionIdleAt(session, AGENT_SESSION_IDLE_MS);
    if (due == null) return undefined;
    const timer = setTimeout(() => dispatchSession({ type: 'tick' }), Math.max(0, due - Date.now()));
    return () => clearTimeout(timer);
  }, [dispatchSession, session]);
  // A just-sent prompt stays open so the user message is readable. Auto-fold
  // waits for the ack-reply hold (agentPromptFlow.js), on phone and desktop.
  const wasSessionWorkingRef = useRef(false);
  useEffect(() => {
    const on = sessionWorking(session);
    const started = on && !wasSessionWorkingRef.current;
    wasSessionWorkingRef.current = on;
    if (mobileChatHideReason({ isMobile, workingEdge: started, hold: holdRef.current })) closeAgentChat?.();
  }, [closeAgentChat, isMobile, session]);
  // The 10s hold, then the shared auto-fold, then reopen on the final reply.
  const appliedFold = useRef(0);
  const appliedExpand = useRef(0);
  useEffect(() => scheduleAckHold(flow.holdUntil, Date.now(), () => dispatchFlow({ type: 'tick' })), [dispatchFlow, flow.holdUntil]);
  useEffect(() => {
    if (flow.foldEpoch === appliedFold.current) return undefined;
    appliedFold.current = flow.foldEpoch;
    if (!flow.foldEpoch) return undefined;
    if (autoFoldTarget(isMobile) === 'bot') {
      closeAgentChat?.();
      return undefined;
    }
    setFolded(true);
    writeFolded(true);
    rememberChatOpen?.(false);
    return undefined;
  }, [closeAgentChat, flow.foldEpoch, isMobile, rememberChatOpen]);
  useEffect(() => {
    if (flow.expandEpoch === appliedExpand.current) return undefined;
    appliedExpand.current = flow.expandEpoch;
    if (!flow.expandEpoch) return undefined;
    setFolded(false);
    setFoldSettled(false);
    setUnread(false);
    writeFolded(false);
    if (autoFoldTarget(isMobile) === 'bot') openAgentChat?.();
    else rememberChatOpen?.(true);
    return undefined;
  }, [flow.expandEpoch, isMobile, openAgentChat, rememberChatOpen]);

  // Agent-owned feature cards stay closed for the whole run, in either mode.
  // A busy session without a prompt uses the same spinner as a prompt in flight.
  const agentBusy = pending || sessionBusy(session);
  useEffect(() => {
    setAgentPromptWorking(agentBusy);
    return () => {
      if (agentBusy) setAgentPromptWorking(false);
    };
  }, [agentBusy]);
  // The phone stage pill spins on the same working indicator as the chat
  // (building), never on a prompt that is only in flight.
  useEffect(() => {
    setAgentPromptBuilding(working);
    return () => {
      if (working) setAgentPromptBuilding(false);
    };
  }, [working]);

  // Demo seeds start pending without an event. Every later event goes through
  // dispatchTyping, which restarts the deadline itself. This only catches the
  // seed and a stall (pause) or a close (stop).
  useEffect(() => {
    const watch = watchRef.current;
    if (!watch) return undefined;
    if (!pending) {
      watch.stop();
      return undefined;
    }
    if (typing.stalled) {
      watch.pause();
      return () => watch.pause();
    }
    watch.markPending();
    // Clear the timer if this prompt unmounts mid-run. Pause keeps an
    // in-flight bridge hold so a call that finishes can still refresh.
    return () => watch.pause();
  }, [pending, typing.stalled]);

  // Screen readers hear each state change; a reply is announced from onReply.
  useEffect(() => {
    if (typing.stalled) {
      setAnnounce(agentPromptStallCopy());
      return undefined;
    }
    const text = stateAnnouncement(effectiveMode);
    if (text) setAnnounce(text);
    else if (effectiveMode === 'idle') setAnnounce((prev) => (prev === 'Agent replied' ? prev : ''));
    return undefined;
  }, [effectiveMode, typing.stalled]);

  const foldPrompt = useCallback(() => {
    if (!foldable) return { ok: false, reason: 'not_foldable' };
    setFolded(true);
    writeFolded(true);
    rememberChatOpen?.(false);
    return { ok: true, folded: true };
  }, [foldable, rememberChatOpen]);

  const unfoldPrompt = useCallback(() => {
    setFolded(false);
    setFoldSettled(false);
    setUnread(false);
    writeFolded(false);
    rememberChatOpen?.(true);
    return { ok: true, folded: false };
  }, [rememberChatOpen]);

  useEffect(() => {
    if (!folded) {
      setFoldSettled(false);
      return undefined;
    }
    const el = rootRef.current;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!el || reduce) {
      setFoldSettled(true);
      return undefined;
    }
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      setFoldSettled(true);
    };
    const onEnd = (event) => {
      if (event.target !== el || event.propertyName !== 'transform') return;
      settle();
    };
    el.addEventListener('transitionend', onEnd);
    const timer = window.setTimeout(settle, AGENT_PROMPT_FOLD_MS + 60);
    return () => {
      done = true;
      el.removeEventListener('transitionend', onEnd);
      window.clearTimeout(timer);
    };
  }, [folded]);

  const discardShot = useCallback(() => {
    setShot(null);
    setShotOn(false);
    setShotSource('viewer');
  }, []);

  const clearSendTimer = useCallback(() => {
    if (sendTimerRef.current != null) {
      clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearSendTimer(), [clearSendTimer]);

  const sendText = useCallback((raw) => {
    const text = typeof raw === 'string'
      ? raw
      : promptDraftText(textareaRef.current?.value, input, composingRef.current);
    const trimmed = text.trim();
    if (!transport) {
      setAck({ delivery: 'failed', error: 'not_paired' });
      return { ok: false, reason: 'no_transport' };
    }
    if (!trimmed || working) return { ok: false, reason: 'empty' };
    if (trimmed.length > AGENT_PROMPT_MAX_CHARS) {
      setAck({ delivery: 'failed', error: 'too_long' });
      return { ok: false, reason: 'too_long' };
    }
    setAck(null);
    syncAckRef.current = null;
    let sent;
    try {
      sent = sendAgentPromptText(
        transport,
        trimmed,
        {
          ...(shot ? { screenshot: shot } : {}),
          ...(promptContext ? { context: promptContext } : {}),
        },
        { working },
      );
    } catch {
      setAck({ delivery: 'failed', error: 'send_failed' });
      return { ok: false, reason: 'send_failed' };
    }
    if (!shouldClearPromptOnSend(sent, syncAckRef.current)) {
      const sync = syncAckRef.current;
      if (sync && sync.id === sent?.id && sync.delivery === 'failed') setAck(sync);
      return sent?.ok ? { ok: false, reason: sync?.error || 'failed', id: sent.id } : sent;
    }
    commitFlight(stepPromptFlight(flightRef.current, {
      type: 'sent', id: sent.id, text: trimmed, shot,
    }).flight);
    dispatchTyping({ type: 'sent', id: sent.id });
    dispatchFlow({ type: 'sent' });
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
    clearSendTimer();
    const sentId = sent.id;
    sendTimerRef.current = setTimeout(() => {
      sendTimerRef.current = null;
      const timed = stepPromptFlight(flightRef.current, { type: 'timeout', id: sentId });
      if (timed.ignore) return;
      commitFlight(timed.flight);
      setAck(timed.ack);
      dispatchTyping({ type: 'ack', id: sentId, delivery: 'failed' });
      applyPromptEffect(timed);
      void transport?.cancel?.(sentId);
    }, AGENT_PROMPT_SEND_TIMEOUT_MS);
    return sent;
  }, [applyPromptEffect, clearSendTimer, commitFlight, discardShot, dispatchFlow, dispatchTyping, input, promptContext, shot, transport, working]);

  const stopAgent = useCallback(() => {
    const id = pendingIdRef.current;
    if (typeof transport?.cancel === 'function') void transport.cancel(id);
    setAgentPromptWorking(false);
    setAgentPromptBuilding(false);
    dispatchTyping({ type: 'stop' });
    dispatchSession({ type: 'stop' });
    dispatchFlow({ type: 'stop' });
    setAnnounce('');
    return { ok: true };
  }, [dispatchFlow, dispatchSession, dispatchTyping, transport]);

  // Dismiss: on desktop it folds the prompt (the history stays); on mobile,
  // where the fold has not landed, it hides the pane as before.
  const dismissReply = useCallback(() => {
    if (foldable) return foldPrompt();
    closeAgentChat?.();
    dispatchChat({ type: 'dismiss' });
    setAck(null);
    return { ok: true };
  }, [closeAgentChat, foldPrompt, foldable]);

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
    // A capture is in flight: this press is not a second toggle.
    if (shotBusyRef.current) return { ok: false, reason: 'capture_busy', attached: false };
    if (shotOn || shot) {
      // Disengage: the pending image is dropped, so Send is text only.
      discardShot();
      return { ok: true, attached: false };
    }
    shotBusyRef.current = true;
    let attached;
    try {
      attached = await Promise.resolve(attachViewerShot(captureViewer));
    } finally {
      shotBusyRef.current = false;
    }
    if (!attached.ok) {
      discardShot();
      // Say why the button did not turn on instead of doing nothing.
      setAck({ delivery: 'failed', error: 'capture_failed' });
      return attached;
    }
    setAck((prev) => (isAttachError(prev?.error) ? null : prev));
    setShot(attached.shot);
    setShotOn(true);
    setShotSource('viewer');
    setAttachOpen(false);
    return { ok: true, attached: true };
  }, [captureViewer, discardShot, shot, shotOn]);

  // A photo from the device. The file input is opened from the drawer;
  // the picked file becomes the same PNG payload as a viewer screenshot.
  const attachPhotoFile = useCallback(async (file) => {
    if (!file) return { ok: false, reason: 'photo_unsupported', attached: false };
    if (photoBusyRef.current) return { ok: false, reason: 'capture_busy', attached: false };
    photoBusyRef.current = true;
    let out;
    try {
      out = await photoFileToShot(file);
    } finally {
      photoBusyRef.current = false;
    }
    if (!out.ok) {
      setAck({ delivery: 'failed', error: out.reason });
      return out;
    }
    setAck((prev) => (isAttachError(prev?.error) ? null : prev));
    setShot(out.shot);
    setShotOn(true);
    setShotSource('photo');
    setAttachOpen(false);
    return { ok: true, attached: true };
  }, []);

  const onPhotoChange = (event) => {
    const input = event.target;
    const file = input?.files?.[0] || null;
    // Reset so the same file can be picked again after a discard.
    if (input) input.value = '';
    void attachPhotoFile(file);
  };

  // The drawer closes on a tap elsewhere and on Escape (onRootKeyDown).
  useEffect(() => {
    if (!attachOpen) return undefined;
    const onDown = (event) => {
      const t = event.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[data-agent-prompt-attach]') || t.closest('[data-agent-prompt-screenshot]')) return;
      setAttachOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [attachOpen]);


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
      if (action === 'fold') return foldPrompt();
      if (action === 'unfold') return unfoldPrompt();
      if (action === 'screenshot') return toggleShot();
      if (action === 'send' || args.text) {
        if (typeof args.text === 'string') setInput(args.text);
        return sendText(args.text);
      }
      return { error: { code: 'bad_args', message: 'Need text or action' } };
    });
  }, [dismissReply, foldPrompt, sendText, stopAgent, toggleShot, unfoldPrompt, visible]);

  const responding = !live.waiting && (live.dots || typingShown(typing) || sessionReplies);
  // Working collapses the chat so the viewport is visible; typing keeps it.
  const showReply = shown && !working && (responding || (!chat.hidden && chat.messages.length > 0));
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

  if (!shown) return null;

  const touchEdit = isTouchEditDevice();

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
    // The form submit that follows a tap already handled on pointerup.
    if (event?.type === 'submit' && actionGateRef.current.echo()) return;
    if (pending) {
      stopAgent();
      return;
    }
    sendText();
  };

  const onActionPointerUp = (event) => {
    actionGateRef.current.press();
    onSubmit(event);
  };

  // The image button: with an image attached it discards it; otherwise it
  // opens the drawer (Screenshot or Photo). The agent's `screenshot`
  // action still toggles the viewer capture directly (toggleShot).
  const onAttachPress = () => {
    if (shotOn || shot) {
      discardShot();
      return;
    }
    setAttachOpen((open) => !open);
  };
  const onCameraPointerUp = () => {
    cameraGateRef.current.press();
    onAttachPress();
  };

  const onCameraClick = () => {
    // The click of the tap pointerup already handled, however late it comes.
    if (cameraGateRef.current.echo()) return;
    onAttachPress();
  };

  const onAttachShotPointerUp = () => {
    attachShotGateRef.current.press();
    if (!shotOn && !shot) toggleShot();
    else setAttachOpen(false);
  };
  const onAttachShotClick = () => {
    if (attachShotGateRef.current.echo()) return;
    if (!shotOn && !shot) toggleShot();
    else setAttachOpen(false);
  };
  const openPhotoPicker = () => {
    setAttachOpen(false);
    photoInputRef.current?.click?.();
  };
  const onAttachPhotoPointerUp = () => {
    attachPhotoGateRef.current.press();
    openPhotoPicker();
  };
  const onAttachPhotoClick = () => {
    if (attachPhotoGateRef.current.echo()) return;
    openPhotoPicker();
  };

  const onRootKeyDown = (event) => {
    if (event.key === 'Escape' && attachOpen) {
      event.preventDefault();
      setAttachOpen(false);
      return;
    }
    if (event.key === 'Escape' && foldable && !folded) {
      event.preventDefault();
      foldPrompt();
    }
  };

  const badge = foldBadge({ mode: effectiveMode, unread });
  const hiddenAway = featurePopupOpen || folded;

  return (
    <>
    {fieldFocused && touchEdit ? <AgentPromptFocusLift rootRef={rootRef} /> : null}
    <div
      ref={rootRef}
      className={`agent-prompt text-on-dark font-ui ${
        isMobile ? 'agent-prompt--compact' : 'surface-glass'
      }${featurePopupOpen ? ' agent-prompt--away' : ''}${folded ? ' agent-prompt--folded' : ''}${folded && foldSettled ? ' agent-prompt--folded-hidden' : ''}`}
      data-agent-prompt=""
      data-agent-prompt-compact={isMobile ? '1' : '0'}
      data-agent-prompt-working={working ? '1' : '0'}
      data-agent-prompt-state={effectiveMode}
      data-agent-session-state={session.mode}
      data-agent-prompt-folded={folded ? '1' : '0'}
      data-agent-prompt-shot={shotCue ? '1' : '0'}
      data-agent-prompt-away={featurePopupOpen ? '1' : '0'}
      data-agent-prompt-responding={responding ? '1' : '0'}
      aria-hidden={hiddenAway ? true : undefined}
      onKeyDown={onRootKeyDown}
      {...(hiddenAway ? { inert: '' } : {})}
    >
      <AgentPromptFrame isMobile={isMobile} rootRef={rootRef}>
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
              {foldable ? null : (
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
              )}
            </div>
          )}
          <div className="agent-prompt-chat" data-agent-chat="">
            {chat.messages.map((row) => (
              row.role === 'user' ? (
                <div
                  key={row.key}
                  className="agent-prompt-msg agent-prompt-msg--user surface-panel text-ui text-on-dark"
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
                  className="agent-prompt-msg agent-prompt-msg--agent agent-prompt-reply-body surface-dark text-ui text-on-dark"
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

      {notice?.kind === 'queued' && live.waiting ? (
        <p className="agent-prompt-ack text-ui-xs text-muted-on-dark" data-agent-prompt-ack="queued">
          Waiting for agent
        </p>
      ) : null}

      {typing.stalled ? (
        <p className="agent-prompt-stall text-ui-sm text-on-dark" data-agent-prompt-stall="">
          {agentPromptStallCopy()}
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
          <span className="text-ui-xs text-muted-on-dark" data-agent-prompt-shot-source={shotSource}>
            {shotSource === 'photo' ? 'Photo attached' : 'Screenshot attached'}
          </span>
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
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              const next = event.target.value.slice(0, AGENT_PROMPT_MAX_CHARS);
              setInput(next);
              adjustHeight();
            }}
            onFocus={() => setFieldFocused(true)}
            onBlur={() => setFieldFocused(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing && !composingRef.current) {
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
          {working && !input && !typing.stalled ? (
            <span className="agent-prompt-hint text-ui-sm text-on-dark" data-agent-working="">
              <Loader2 size={14} className="agent-prompt-spinner text-on-dark" aria-hidden />
              <span>Agent is working...</span>
            </span>
          ) : null}
        </div>
        {attachOpen ? (
          <div
            className="agent-prompt-attach"
            data-agent-prompt-attach=""
            role="group"
            aria-label="Attach an image"
          >
            <button
              type="button"
              className="agent-prompt-attach-btn surface-quiet text-on-dark text-ui-sm font-ui"
              onPointerDown={keepFieldFocus}
              onMouseDown={keepFieldFocus}
              onPointerUp={onAttachShotPointerUp}
              onClick={onAttachShotClick}
              data-ui-action="data-agent-prompt-attach-screenshot"
              data-agent-prompt-attach-screenshot=""
              disabled={!canCapture}
            >
              <Monitor size={16} aria-hidden />
              <span>Screenshot</span>
            </button>
            <button
              type="button"
              className="agent-prompt-attach-btn surface-quiet text-on-dark text-ui-sm font-ui"
              onPointerDown={keepFieldFocus}
              onMouseDown={keepFieldFocus}
              onPointerUp={onAttachPhotoPointerUp}
              onClick={onAttachPhotoClick}
              data-ui-action="data-agent-prompt-attach-photo"
              data-agent-prompt-attach-photo=""
            >
              <Camera size={16} aria-hidden />
              <span>Photo</span>
            </button>
          </div>
        ) : null}
        <input
          ref={photoInputRef}
          type="file"
          accept={AGENT_PROMPT_PHOTO_ACCEPT}
          className="agent-prompt-photo-input"
          data-agent-prompt-photo-input=""
          onChange={onPhotoChange}
          tabIndex={-1}
          aria-hidden="true"
        />
        <div className="agent-prompt-actions" data-agent-prompt-actions="">
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
            className={`agent-prompt-icon-btn agent-prompt-camera text-on-dark${
              shotCue ? ' surface-success' : ''
            }`}
            onPointerDown={keepFieldFocus}
            onMouseDown={keepFieldFocus}
            onPointerUp={onCameraPointerUp}
            onClick={onCameraClick}
            data-ui-action="data-agent-prompt-screenshot"
            data-agent-prompt-screenshot=""
            data-agent-prompt-shot-on={shotCue ? '1' : '0'}
            data-agent-prompt-attach-open={attachOpen ? '1' : '0'}
            aria-label={shotCue ? (shotSource === 'photo' ? 'Discard photo' : 'Discard screenshot') : 'Attach an image'}
            aria-pressed={shotCue}
            aria-expanded={shotCue ? undefined : attachOpen}
          >
            <ImagePlus size={18} aria-hidden />
          </button>
          {pending ? (
            <button
              type="submit"
              className="agent-prompt-icon-btn surface-quiet text-on-dark"
              onPointerDown={keepFieldFocus}
              onMouseDown={keepFieldFocus}
              onPointerUp={onActionPointerUp}
              data-ui-action="data-agent-prompt-stop"
              data-agent-prompt-stop=""
              aria-label="Stop agent"
            >
              <Square size={14} fill="currentColor" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              className={`agent-prompt-send${!input.trim() || overLimit ? ' agent-prompt-send--idle' : ''}`}
              onPointerDown={keepFieldFocus}
              onMouseDown={keepFieldFocus}
              onPointerUp={onActionPointerUp}
              data-ui-action="data-agent-prompt-send"
              data-agent-prompt-send=""
              aria-label="Send"
              disabled={overLimit || sessionWorks}
            >
              <Send size={18} aria-hidden />
            </button>
          )}
        </div>
      </form>
      </AgentPromptFrame>
    </div>
    {foldable ? (
      <button
        type="button"
        className={`agent-prompt-fold${featurePopupOpen || folded ? ' agent-prompt-fold--away' : ''}`}
        onClick={foldPrompt}
        data-ui-action="data-agent-prompt-fold"
        data-agent-prompt-fold=""
        data-agent-prompt-state={effectiveMode}
        aria-label="Hide agent prompt"
        tabIndex={featurePopupOpen || folded ? -1 : 0}
        aria-hidden={featurePopupOpen || folded ? true : undefined}
      >
        <ChevronDown size={16} aria-hidden />
      </button>
    ) : null}
    {foldable && folded && !featurePopupOpen ? (
      <button
        type="button"
        className="agent-prompt-unfold surface-glass text-on-dark font-ui"
        onClick={unfoldPrompt}
        data-ui-action="data-agent-prompt-unfold"
        data-agent-prompt-unfold=""
        data-agent-prompt-badge={badge}
        data-agent-prompt-state={effectiveMode}
        aria-label={badge === 'unread' ? 'Show agent prompt, new reply' : (badge ? `Show agent prompt, agent is ${badge}` : 'Show agent prompt')}
      >
        <ChevronUp size={16} aria-hidden />
        {badge === 'typing' ? (
          <span className="agent-prompt-badge" aria-hidden>
            <span className="agent-prompt-dots"><span /><span /><span /></span>
          </span>
        ) : null}
        {badge === 'working' ? (
          <span className="agent-prompt-badge" aria-hidden>
            <Loader2 size={12} className="agent-prompt-spinner" />
          </span>
        ) : null}
        {badge === 'unread' ? <span className="agent-prompt-badge agent-prompt-badge--unread" aria-hidden /> : null}
      </button>
    ) : null}
    <span className="sr-only" aria-live="polite" role="status" data-agent-prompt-live="">
      {announce}
    </span>
    </>
  );
}
