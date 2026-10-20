/**
 * `?agentPromptDemo=1` pins the floating prompt for goldens / screenshots
 * the same way `?agentGitConsentDemo=1` pins the git consent modal.
 *
 * `agentPromptState` seeds a visual state:
 *   hidden | idle | typing | reply-short | reply-long | reply-streaming | working | shot-off | shot-on
 *   | chat | chat-long
 */
export const AGENT_PROMPT_DEMO_STATES = Object.freeze([
  'hidden',
  'idle',
  'typing',
  'reply-short',
  'reply-long',
  'reply-streaming',
  'working',
  'shot-off',
  'shot-on',
  'chat',
  'chat-long',
]);

export const AGENT_PROMPT_TYPED = [
  'Add four M4 clearance holes 6 mm from each corner of the base plate.',
  'Countersink them for flat-head screws, keep the cut-out where it is,',
  'and check the wall still clears a 3 mm sheet metal bend.',
  'Then run FEA with the back wall fixed and 50 N on the front edge.',
].join('\n');

export const AGENT_PROMPT_REPLY_SHORT = 'Added four M4 clearance holes (Ø4.5 mm) 6 mm in from each corner of the base. Run is clean, 0 errors.';

export const AGENT_PROMPT_REPLY_LONG = [
  'Done. Here’s what I changed in Part (1):',
  '',
  '1. Replaced the four Ø4.4 holes with M4 clearance holes, Ø4.5 mm, centred 6 mm from each corner of the 80 × 60 base.',
  '2. Added 90° countersinks, Ø8.4 mm head, for M4 flat-head screws.',
  '3. Left the 40 × 26 mm cut-out in place. The nearest hole edge is 7.8 mm from it.',
  '4. Back wall is 4 mm thick. A 3 mm sheet bend needs about 4.5 mm inside clearance, so the wall clears it.',
  '',
  'FEA, back wall fixed, 50 N on the front edge, aluminium 6061:',
  '',
  '• Max displacement 0.21 mm at the front corners',
  '• Max von Mises stress 38 MPa next to the cut-out',
  '• Safety factor about 7 against yield',
  '',
  'Want me to add a 2 mm fillet on the cut-out corners to bring that stress peak down, or export a STEP for quoting?',
].join('\n');

/** A 1×1 PNG, the thumbnail a user message shows when a screenshot went with it. */
export const AGENT_PROMPT_DEMO_THUMB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** A short exchange: the pane reads like a chat. */
export const AGENT_PROMPT_CHAT = Object.freeze([
  { role: 'user', text: 'Did you get the reference photo and the side render?', thumb: AGENT_PROMPT_DEMO_THUMB },
  { role: 'agent', text: 'Yes, I got it. The webhook is registered now too, so your next message should reach me right away.' },
  { role: 'user', text: 'Rebuild the bike as separate parts with real joints.' },
  { role: 'agent', text: 'The bike is rebuilt as 9 parts with 15 mechanical joints. To save it to git, please click Allow on the git-write prompt in this tab.' },
]);

/** Enough turns to scroll inside the pane. */
export const AGENT_PROMPT_CHAT_LONG = Object.freeze([
  ...AGENT_PROMPT_CHAT,
  { role: 'user', text: AGENT_PROMPT_TYPED },
  { role: 'agent', text: AGENT_PROMPT_REPLY_LONG },
  { role: 'user', text: 'Yes, add the fillet and export the STEP.' },
  { role: 'agent', text: 'Added a 2 mm fillet on the four cut-out corners; peak stress is now 31 MPa. The STEP is exported as bracket-v3.step.' },
]);

function readImportMetaEnv() {
  try {
    return import.meta.env;
  } catch {
    return undefined;
  }
}

/** Demo pins canned replies. Prod builds must never show those. */
export function agentPromptDemoAllowed(env = readImportMetaEnv()) {
  return env?.DEV === true;
}

export function readAgentPromptDemo(search = '', env = readImportMetaEnv()) {
  if (!agentPromptDemoAllowed(env)) return null;
  let q = search;
  if (!q && typeof window !== 'undefined') {
    try { q = window.location.search || ''; } catch { q = ''; }
  }
  const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q);
  if (params.get('agentPromptDemo') !== '1') return null;
  const raw = params.get('agentPromptState') || 'idle';
  const state = AGENT_PROMPT_DEMO_STATES.includes(raw) ? raw : 'idle';
  return { enabled: true, state };
}

export function shouldShowAgentPrompt({
  paired,
  link,
  demo,
  shouldShowDisconnect,
  hasTransport = false,
  demoAllowed = false,
} = {}) {
  const pinDemo = demoAllowed === true && demo?.enabled === true;
  if (pinDemo && demo.state === 'hidden') return false;
  if (pinDemo) return true;
  if (hasTransport !== true) return false;
  return shouldShowDisconnect({ paired, link }) === true;
}
