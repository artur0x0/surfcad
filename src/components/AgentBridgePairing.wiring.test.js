import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(dir, 'AgentBridgePairing.jsx'), 'utf8');
const DIALOG = readFileSync(join(dir, 'AgentBridgePairingDialog.jsx'), 'utf8');
const POPUP = readFileSync(join(dir, 'AgentBridgeApprovalPopup.jsx'), 'utf8');
const CSS = readFileSync(join(dir, '../index.css'), 'utf8');
const CHIP = readFileSync(join(dir, 'ProfileChip.jsx'), 'utf8');
const TAB = readFileSync(join(dir, '../agent/ws/tabConnection.js'), 'utf8');

test('pairing reports paired plus link so the in-viewer prompt can show', () => {
  assert.match(SRC, /onPairingChange = null/);
  assert.match(SRC, /onPairingChange\?\.\(\{ paired: visiblePaired, link: visibleLink \}\)/);
});

test('Connect Agent opens a body-portal dialog and closes the profile menu', () => {
  assert.match(SRC, /onBeginFlow\?\.\(\)/);
  assert.match(SRC, /<AgentBridgePairingDialog/);
  assert.match(DIALOG, /data-agent-bridge-dialog=""/);
  assert.match(DIALOG, /data-agent-bridge-transport=\{transport\}/);
  assert.match(DIALOG, /createPortal\(/);
  assert.match(DIALOG, /pb-14/);
  assert.match(DIALOG, /items-center justify-center/);
  assert.doesNotMatch(DIALOG, /items-end/);
});

test('Safari and phone width open the server dialog and do not probe localhost', () => {
  assert.match(SRC, /forcesServerRelay/);
  assert.match(SRC, /serverJoinPrompt/);
  assert.match(SRC, /data-agent-join-code/);
  assert.match(SRC, /text-ui-code/);
  assert.match(SRC, /resumeJoinAction/);
  assert.match(SRC, /joinPollEvent/);
  assert.match(SRC, /stepJoinConnection/);
  assert.match(SRC, /visibilitychange/);
  const serverDeps = SRC.split('\n').find((line) => line.includes('serverKick, stopConnection'));
  assert.ok(serverDeps);
  assert.doesNotMatch(serverDeps, /\bnarrow\b/);
  assert.match(SRC, /narrowRef\.current/);
  assert.match(SRC, /sessionStorage/);
  assert.match(SRC, /SERVER_PAIRING_WAITING_COPY/);
  assert.match(SRC, /data-agent-bridge-waiting-server=""/);
  assert.match(SRC, /data-agent-bridge-server=""/);
  assert.match(SRC, /shouldProbeLocalRelay/);
  assert.match(SRC, /if \(forcedServerRef\.current\)/);
  assert.doesNotMatch(SRC, /isSecureContext/);
  assert.match(SRC, /readPhoneWidth/);
  assert.match(SRC, /copyTextWithFallback/);
  assert.match(SRC, /function AgentPromptBox/);
  assert.match(SRC, /readOnly/);
  assert.match(SRC, /rows=\{6\}/);
  assert.match(SRC, /aria-label="Prompt for your AI agent"/);
  assert.match(SRC, /text=\{AGENT_PAIRING_PROMPT\}/);
  assert.doesNotMatch(SRC, /text=\{serverPromptText\}/);
  assert.match(SRC, /value=\{text\}/);
  assert.match(SRC, /event\.currentTarget\.select\(\)/);
  assert.doesNotMatch(SRC, /clipPairingPrompt/);
  assert.doesNotMatch(SRC, /line-clamp-3/);
  const forced = SRC.slice(SRC.indexOf('if (forcedServerRef.current)'));
  assert.match(forced, /setFlowOpen\(true\)/);
  const beforePopup = forced.slice(0, forced.indexOf("startPairing('popup')"));
  assert.match(beforePopup, /return;/);
});

test('popup mode starts pairing from the Connect Agent click', () => {
  assert.match(SRC, /onBeginFlow\?\.\(\)/);
  assert.match(SRC, /if \(popupMode\) startPairing\('popup'\)/);
  assert.match(SRC, /<AgentBridgePopupStatus/);
  assert.match(SRC, /issue !== 'bridge_closed' && issue !== 'popup_blocked'/);
  assert.match(SRC, /setFlowOpen\(true\)/);
  assert.match(SRC, /Keep the SurfCAD local agent bridge window open/);
});

test('Esc and backdrop tap before pairing cancel the attempt', () => {
  assert.match(SRC, /event\.key === 'Escape'/);
  assert.match(SRC, /handleDialogDismiss/);
  assert.match(DIALOG, /event\.target === event\.currentTarget/);
});

test('the setup prompt is hidden once a relay is up', () => {
  assert.match(SRC, /shouldShowPairingPrompt\(stage\)/);
  assert.match(SRC, /showPrompt \?/);
  assert.doesNotMatch(SRC, /Relay connected/);
});

test('Allow/Deny replaces the pairing code in the same dialog', () => {
  assert.match(SRC, /shouldShowPairingCode\(stage\)/);
  assert.match(SRC, /shouldShowPairingApproval\(stage\)/);
  assert.match(SRC, /<AgentBridgeApprovalPopup/);
  assert.doesNotMatch(SRC, /embedded=\{false\}/);
  assert.doesNotMatch(POPUP, /fixed bottom-/);
  assert.doesNotMatch(POPUP, /approvalPopupPositionClass/);
});

test('Allow/Deny copy uses shared surface/text classes, not black on dark surface', () => {
  assert.match(POPUP, /text-ui-xs text-on-dark/);
  assert.match(POPUP, /surface-glass font-ui/);
  assert.match(POPUP, /surface-success text-on-dark/);
  assert.match(POPUP, /surface-quiet text-on-dark/);
  assert.doesNotMatch(POPUP, /hover:bg-emerald-500|bg-emerald-/);
  assert.doesNotMatch(POPUP, /text-chrome-text-secondary/);
  assert.doesNotMatch(POPUP, /text-black|text-gray-900|text-gray-950|#000\b/);
  assert.doesNotMatch(SRC, /text-chrome-text-secondary/);
});

test('popup auto-closes when connected and the toast lives 5 s with an X', () => {
  assert.match(SRC, /shouldClosePairingDialogOnConnect/);
  assert.match(SRC, /setToastOpen\(true\)/);
  assert.match(SRC, /AGENT_CONNECTED_TOAST_MS/);
  assert.match(SRC, /data-agent-bridge-connected-toast=""/);
  assert.match(SRC, /AGENT_CONNECTED_TOAST_COPY/);
  assert.match(SRC, /onDismiss=\{\(\) => setToastOpen\(false\)\}/);
});

test('connected toast is the shared toast card size: max-w-md wrapper, px-4 py-2 padding, green', () => {
  const toast = SRC.match(/data-agent-bridge-connected-toast=""[\s\S]*?<\/ErrorPopup>/)?.[0] ?? '';
  const wrapper = SRC.match(/className="([^"]*)"\s*\n\s*data-agent-bridge-connected-toast=""/)?.[1] ?? '';
  const wrapperClasses = wrapper.split(/\s+/);
  assert.ok(wrapperClasses.includes('w-[calc(100%-1.5rem)]'), `wrapper width class missing in "${wrapper}"`);
  assert.ok(wrapperClasses.includes('max-w-md'), `wrapper max-w-md missing in "${wrapper}"`);
  assert.match(toast, /tone="success"/);
  assert.match(toast, /className="px-4 py-2"/);
});

test('connection ring is a wrap sibling with a glow, not a rotated child of the glass chip', () => {
  assert.match(CHIP, /data-profile-chip-wrap=""/);
  assert.match(CHIP, /agent-bridge-profile-ring agent-bridge-profile-ring--\$\{agentRing\}/);
  assert.match(CHIP, /overflow-visible/);
  const buttonBlock = CHIP.slice(CHIP.indexOf('<button'), CHIP.indexOf('</button>'));
  assert.equal(buttonBlock.includes('agent-bridge-profile-ring'), false);
  assert.match(CSS, /agent-bridge-ring-glow/);
  assert.match(CSS, /agent-bridge-profile-ring--connected/);
  assert.doesNotMatch(CSS, /@keyframes agent-bridge-ring-spin/);
  assert.doesNotMatch(CSS, /animation: agent-bridge-ring-spin/);
});

test('unmount cleanup disposes the socket and poller so the connection cannot leak', () => {
  assert.match(SRC, /disposePairingHost\(\{ conn: connRef\.current, poller: pollerRef\.current \}\)/);
  assert.match(SRC, /disposePairingHost\(\{ conn: connRef\.current \}\)/);
});

test('resume key stays in relay/tab memory and is not persisted', () => {
  assert.match(TAB, /let resumeKey = null/);
  assert.doesNotMatch(TAB, /localStorage/);
  assert.doesNotMatch(TAB, /sessionStorage/);
});

test('Disconnect during an Allow prompt rejects the peer instead of dropping the socket silently', () => {
  assert.match(SRC, /stateRef\.current === 'pending'/);
  assert.match(SRC, /rejectPair\(\)/);
});

test('Connect agent is an inline plug-icon menu row, not a big emerald button', () => {
  assert.match(SRC, /from 'lucide-react'/);
  assert.match(SRC, /<Plug /);
  assert.match(SRC, /PROFILE_MENU_ITEM_CLASS/);
  assert.match(SRC, /Connect agent/);
  assert.match(SRC, /shouldShowAgentBridgeDisconnect/);
  const connectIdx = SRC.indexOf('data-agent-bridge-connect=""');
  const connectBlock = SRC.slice(Math.max(0, connectIdx - 280), connectIdx + 180);
  assert.match(connectBlock, /PROFILE_MENU_ITEM_CLASS/);
  assert.doesNotMatch(connectBlock, /CONNECT_AGENT_BUTTON_CLASS/);
  assert.doesNotMatch(connectBlock, /shadow-md/);
});

test('the connected banner shell does not take clicks outside the card', () => {
  const open = SRC.indexOf('data-agent-connected-banner=""');
  assert.ok(open > 0);
  const shell = SRC.slice(Math.max(0, open - 220), open);
  assert.match(shell, /pointer-events-none/);
  const card = SRC.slice(open, open + 900);
  assert.match(card, /pointer-events-auto/);
  assert.match(card, /data-ui-action="data-agent-connected-disconnect"/);
});

test('menu and dialog Disconnect are hidden until the agent is paired', () => {
  assert.match(SRC, /shouldShowAgentBridgeDisconnect\(\{ paired, link: visibleLink \}\)/);
  assert.equal((SRC.match(/shouldShowAgentBridgeDisconnect/g) || []).length >= 2, true);
});
