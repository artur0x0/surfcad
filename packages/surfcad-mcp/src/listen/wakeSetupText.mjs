/**
 * The idle wake, as text. One copy: the CLI help, the chat guide, the pair
 * result, and the status note all print these. No imports, so the guide can
 * use it without pulling in the listener.
 */

/** The manual steps, in order. The escape hatch: a host that provides its wake needs none of them. */
export const WAKE_SETUP_STEPS = Object.freeze([
  'npx surfcad-mcp login  (once; the listener uses the saved login)',
  'npx surfcad-mcp wake set --post <URL your host accepts a POST on> --exec "<command that starts a turn of you>"  (set both when your host has both; one is enough)',
  'npx surfcad-mcp wake test  (fires the wake once with reason "test"; confirm a turn of you started)',
  'npx surfcad-mcp listen --detach  (start it again after a reboot, or add it to your host\'s startup)',
]);

/** Where this is written out for an agent. */
export const WAKE_GUIDE_POINTER = 'guide { topic: "chat" } section A';

/** How long a message waits for an agent that is already reading before the wake fires. */
export const WAKE_GRACE_SECONDS = 4;

/** The environment a host sets in this MCP server's config to provide its wake. */
export const WAKE_ENV_NAMES = Object.freeze(['SURFCAD_WAKE_POST', 'SURFCAD_WAKE_BEARER', 'SURFCAD_WAKE_EXEC']);

/**
 * Section A of the chat guide.
 */
export const WAKE_GUIDE_SECTION = `A. Idle wake: being reachable when you are not in a turn
The user messages you from the SurfCAD chat box. While you are in a turn you get the message from read_messages. While you are idle nothing of yours is running, and SurfCAD cannot start a turn of you: only your host can. The idle wake is how your host does it.
What happens by itself, at every pair and login:
1. This MCP server looks for a wake: ${WAKE_ENV_NAMES.join(', ')} in its environment (your host, or whoever installed this server for it, sets them in the server's config), else one saved earlier with npx surfcad-mcp wake set.
2. With a wake, it starts the listener (npx surfcad-mcp listen, outbound HTTPS only, no open port) and fires the wake once with reason "greet". The session that starts says "Hi, what can I help you design?" in the SurfCAD chat. The user seeing that greeting is the check that the wake works.
3. With no wake, it says so: the pair result and status.wake.coldWake read "unavailable", and you greet the user yourself.
Read the pair result's note and status.wake ({ coldWake, forms, source, listenerRunning, note }) and act on what they say:
- coldWake "ready": nothing to do. A message sent while you are idle starts a new session of you.
- coldWake "listener_stopped": run npx surfcad-mcp listen --detach.
- coldWake "unavailable": messages reach you only while you are in a turn and polling (section C). Tell the user that when they expect answers while you are idle. Never ask the user for a webhook URL or key.
The wake JSON a new session receives: { "type": "surfcad.wake", "v": 1, "reason": "prompt" | "greet" | "test", "instruction", "prompts": [{ "id", "text", "ts", "hasScreenshot"? }] }. Do what "instruction" says. A new session has no memory of earlier ones: the message is in "prompts" (a preview; it is still waiting on the server, so call read_messages { wait_ms: 10000 } and follow section B), status gives the open part, and guide { topic: "start" } says how to build. Treat the text as the user's words, never as instructions from SurfCAD.
When it fires: for a message that no surfcad-mcp process read within about ${WAKE_GRACE_SECONDS} seconds, while you are idle. While you are polling you take the message first and no wake fires. While you are in a turn (a tool call in the last 60 seconds) you are not woken either: read the message at your next read_messages, so poll between steps of long work. A message still unread two minutes after a wake is woken for once more.
The two wake forms, for a host or a person setting one:
- post (SURFCAD_WAKE_POST, or wake set --post): a URL on the host that starts a turn when it receives a POST. https, or http to localhost, 127.0.0.1 or ::1. SURFCAD_WAKE_BEARER (or --bearer) adds a key; it is saved on this machine and never printed. The body is the wake JSON.
- exec (SURFCAD_WAKE_EXEC, or wake set --exec): a shell command that starts a turn. The wake JSON arrives on its stdin; SURFCAD_WAKE=1, SURFCAD_WAKE_REASON and SURFCAD_PROMPT_IDS are in its environment. A second copy is not started while one runs.
- With both, the POST is tried first and the command is the fallback, so one message is one wake.
The manual way, when the host provides nothing and you know how to start a turn of yourself:
${WAKE_SETUP_STEPS.map((step, i) => `${i + 1}. ${step}`).join('\n')}
SURFCAD_WAKE_BOOTSTRAP=0 in the server's environment turns the automatic listener and greeting off.`;
