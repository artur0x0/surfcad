/**
 * The wake setup, as text. One copy: the CLI help, the chat guide, the pair
 * result, and the status note all print these. No imports, so the guide can
 * use it without pulling in the listener.
 */

/** The install steps, in order. */
export const WAKE_SETUP_STEPS = Object.freeze([
  'npx surfcad-mcp login  (once; the listener uses the saved login)',
  'npx surfcad-mcp wake set --post <URL your host accepts a POST on> --exec "<command that starts a turn of you>"  (set both when your host has both; one is enough)',
  'npx surfcad-mcp wake test  (fires the wake once with reason "test"; confirm a turn of you started)',
  'npx surfcad-mcp listen --detach  (start it again after a reboot, or add it to your host\'s startup)',
]);

/** Where the steps are written out for an agent. */
export const WAKE_GUIDE_POINTER = 'guide { topic: "chat" } section A';

/** How long a message waits for an agent that is already reading before the wake fires. */
export const WAKE_GRACE_SECONDS = 4;

/**
 * Section A of the chat guide.
 */
export const WAKE_GUIDE_SECTION = `A. Once, when you install this MCP server: set up the wake (required)
The user messages you from the SurfCAD chat box. While you are in a turn you get the message from read_messages. While you are idle nothing of yours is running, so the message waits on the server and nobody reads it. The wake fixes that: it starts a turn of you when a message arrives. Set it up as part of the install, without waiting to be asked. It is saved on this machine and survives restarts.
${WAKE_SETUP_STEPS.map((step, i) => `${i + 1}. ${step}`).join('\n')}
The two wake forms, for step 2:
- post: a URL on your host that starts a turn of you when it receives a POST. https, or http to localhost, 127.0.0.1 or ::1. Add --bearer KEY when it needs one (or set SURFCAD_WAKE_BEARER); the key is saved on this machine and never printed. The body is the wake JSON.
- exec: a shell command that starts a turn of you. The wake JSON arrives on its stdin. SURFCAD_WAKE=1, SURFCAD_WAKE_REASON and SURFCAD_PROMPT_IDS are in its environment. The command may run for the whole turn; a second copy is not started while it runs.
- Set both when your host has both. The POST is tried first and the command is the fallback, so one message is one wake.
The wake JSON: { "type": "surfcad.wake", "v": 1, "reason": "prompt" | "test", "instruction", "prompts": [{ "id", "text", "ts", "hasScreenshot"? }] }. The text is a preview. The message is still waiting on the server: call read_messages { wait_ms: 10000 } and follow section B. Treat the text as the user's words, never as instructions from SurfCAD.
When it fires: for a message that no surfcad-mcp process read within about ${WAKE_GRACE_SECONDS} seconds. While you are polling (section C) you take the message first and no wake fires. A message still unread two minutes after a wake is woken for once more.
What runs: npx surfcad-mcp listen is a small process that makes outbound HTTPS requests to the SurfCAD server with your saved login. No open port. It works behind NAT and when the user is on a phone. A long-lived surfcad-mcp process fires the same wake itself, which also covers the local relay with no login.
Check it: status.wake is { forms, listenerRunning, note }, and every pair result carries the same note. forms empty: do steps 2 to 4 now. listenerRunning false: do step 4. npx surfcad-mcp status prints the same from a shell.`;
