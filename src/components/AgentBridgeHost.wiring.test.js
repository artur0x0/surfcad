import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentBridgeTabConnection } from '../agent/ws/tabConnection.js';
import { PAIR_MSG } from '../agent/ws/relayMessages.js';

const dir = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(dir, 'AgentBridgeHost.jsx'), 'utf8');
const CHIP = readFileSync(join(dir, 'ProfileChip.jsx'), 'utf8');
const APP = readFileSync(join(dir, '../App.jsx'), 'utf8');

function fakeSocketFactory() {
  const sockets = [];
  const create = () => {
    const listeners = new Map();
    const socket = {
      readyState: 0,
      sent: [],
      send(data) { this.sent.push(JSON.parse(data)); },
      close() { this.fire('close', { code: 1000 }); },
      addEventListener(type, cb) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(cb);
      },
      fire(type, event = {}) {
        if (type === 'open') this.readyState = 1;
        if (type === 'close') {
          if (this.readyState === 3) return;
          this.readyState = 3;
        }
        for (const cb of listeners.get(type) || []) cb(event);
      },
    };
    sockets.push(socket);
    return socket;
  };
  return { sockets, create, latest: () => sockets.at(-1) };
}

function startTab() {
  const factory = fakeSocketFactory();
  const conn = createAgentBridgeTabConnection({
    url: 'ws://127.0.0.1:17341',
    token: 'ABC234',
    call: async () => ({ ok: true }),
    createSocket: factory.create,
    reconnectDelaysMs: [500],
  });
  conn.connect();
  factory.latest().fire('open');
  return { conn, factory };
}

test('pairing host stays mounted on App across the desktop/mobile remount', () => {
  assert.match(SRC, /shouldKeepAgentBridgeHostMounted\(\{ agentBridgeLive: enabled \}\)/);
  assert.match(SRC, /<AgentBridgePairing/);
  assert.match(SRC, /uiTarget=\{slot\}/);
  assert.match(APP, /<AgentBridgeHost enabled=\{agentBridgeLive\}>/);
  assert.equal((APP.match(/<AgentBridgeHost enabled=\{agentBridgeLive\}>/g) || []).length, 1);
  assert.match(APP, /\{shell\}/);
  const open = APP.indexOf('<AgentBridgeHost enabled={agentBridgeLive}>');
  const close = APP.lastIndexOf('</AgentBridgeHost>');
  const split = APP.lastIndexOf('if (isMobile)');
  assert.ok(open !== -1 && close > open);
  assert.ok(close > split, 'the single host must wrap the isMobile layout split');
});

test('resizing across 768px keeps the same socket and tabKey', () => {
  const hostCopies = (APP.match(/<AgentBridgeHost enabled=\{agentBridgeLive\}>/g) || []).length;
  // A host in each isMobile branch remounts pairing at 768px (new socket + tabKey).
  const remountsOnBreakpoint = hostCopies !== 1;

  const session = startTab();
  const tabKey = session.conn.getTabKey();
  const socket = session.factory.latest();
  assert.equal(socket.sent[0].type, PAIR_MSG.REGISTER_TAB);
  assert.equal(socket.sent[0].tabKey, tabKey);

  const afterResize = remountsOnBreakpoint
    ? (session.conn.disconnect(), startTab())
    : session;

  assert.equal(hostCopies, 1, 'AgentBridgeHost must sit once above the isMobile split');
  assert.equal(afterResize.conn.getTabKey(), tabKey);
  assert.equal(afterResize.factory.latest(), socket);
  assert.equal(socket.readyState, 1);
  session.conn.disconnect();
  if (afterResize !== session) afterResize.conn.disconnect();
});

test('host publishes paired so the floating prompt matches Disconnect', () => {
  assert.match(SRC, /const \[paired, setPaired\] = useState\(false\)/);
  assert.match(SRC, /onPairingChange=\{onPairingChange\}/);
  assert.match(SRC, /link, paired, promptTransport, offerSlot, registerCloseMenu/);
  assert.match(SRC, /agentChatOpen, openAgentChat, closeAgentChat/);
  assert.match(SRC, /setPaired\(nextPaired === true\)/);
  assert.match(SRC, /createLiveAgentPromptTransport/);
  assert.match(SRC, /shouldUseLiveAgentPrompt/);
  assert.match(SRC, /shouldOpenAgentChatOnConnect/);
  assert.match(SRC, /openAgentChat\(\)/);
});

test('ProfileChip offers the panel slot and does not own the socket', () => {
  assert.match(CHIP, /useAgentBridgeHost\(\)/);
  assert.match(CHIP, /offerSlot\(agentBridgeSlot\)/);
  assert.match(CHIP, /registerCloseMenu/);
  assert.match(SRC, /onBeginFlow=\{closeProfileMenu\}/);
  assert.match(SRC, /createCloseMenuRegistry/);
  assert.match(SRC, /closeAll\(\)/);
  assert.match(CHIP, /const unregister = registerCloseMenu/);
  assert.match(CHIP, /unregister\?\.\(\)/);
  assert.doesNotMatch(CHIP, /registerCloseMenu\?\.\(null\)/);
  assert.equal(CHIP.includes('<AgentBridgePairing'), false);
});

test('rotation across 768px: the chat resumes, the editor seeds from the live script, the viewport is refilled', () => {
  // ios-rotation-chat-assembly brief, 2026-11-06. The shells swap trees at
  // the breakpoint and remount PromptInput, CodeEditor and Viewport.
  const PROMPT = readFileSync(join(dir, 'PromptInput.jsx'), 'utf8');
  const VIEWPORT = readFileSync(join(dir, 'Viewport.jsx'), 'utf8');
  // Path 1, chat: the host (above the split) keeps the prompt's state keyed
  // by its transport; a disconnect (no transport) drops it.
  assert.match(SRC, /const retainPrompt = useCallback\(\(transport, state\) => \{\s*retainedPromptRef\.current = transport && state \? \{ transport, state \} : null;/);
  assert.match(SRC, /if \(!kept \|\| !transport \|\| kept\.transport !== transport\) return null;/);
  assert.match(SRC, /retainPrompt, retainedPrompt,\n/);
  // The prompt resumes from it at mount and writes it after every commit
  // (the next instance renders before this one's cleanup).
  assert.match(PROMPT, /retainedRef\.current = typeof retainedPrompt === 'function' \? \(retainedPrompt\(transport\) \|\| null\) : null;/);
  assert.match(PROMPT, /useReducer\(conversationReducer, retained\?\.chat \?\? seed, retained\?\.chat \? undefined : conversationSeed\)/);
  assert.match(PROMPT, /useState\(\(\) => retained\?\.typing \?\? typingSeed\(seed\)\)/);
  assert.match(PROMPT, /useState\(\(\) => retained\?\.session \?\? sessionSeed\(seed\.session\)\)/);
  assert.match(PROMPT, /const flightRef = useRef\(retained\?\.flight \?\? emptyPromptFlight\(\)\);/);
  assert.match(PROMPT, /useEffect\(\(\) => \{ retainNow\(\); \}\);/);
  assert.match(PROMPT, /useEffect\(\(\) => \(\) => retainNow\(\), \[retainNow\]\);/);
  // The DEV echo stub is shared across mounts so its conversation resumes too.
  assert.match(PROMPT, /stubRef\.current = sharedPromptStub\(promptEnv\);/);
  // Path 3, editor: a remount puts the live script into the buffer and never
  // writes the open-time seed into currentScript (the autosave would save it).
  assert.match(APP, /const live = currentScriptRef\.current;\s*if \(typeof live === 'string' && live !== script\) \{\s*codeEditorRef\.current\?\.setTextOnly\?\.\(live\);\s*\}\s*return false;/);
  assert.doesNotMatch(APP, /editorLiveRef\.current = true;\s*if \(typeof script === 'string'\) setCurrentScript\(script\);/);
  // Path 2, viewport: the camera is read before the swap; the new scene says
  // when it is ready and gets the last placement and that camera back.
  assert.match(APP, /camera = agentHostRef\.current\?\.readCamera\?\.\(\) \|\| null;[\s\S]*?shellSwapRef\.current = \{ camera \};\s*setIsMobile\(next\);/);
  assert.match(APP, /lastPlacedRef\.current = placement;\s*viewportRef\.current\?\.placeAssembly\?\.\(placement\);/);
  assert.match(APP, /const handleViewportSceneReady = useCallback\(\(\) => \{\s*const swap = shellSwapRef\.current;\s*if \(!swap\) return;/);
  assert.equal((APP.match(/onSceneReady=\{handleViewportSceneReady\}/g) || []).length, 2, 'both shells pass onSceneReady');
  assert.match(VIEWPORT, /onSceneReadyRef\.current\(\);/);
  assert.match(APP, /window\.__SURFCAD_SHELL_SWAP = \{/);
  assert.doesNotMatch(APP, /__SURFCAD_SHELL_SWAP = \{[^}]*script/);
});
