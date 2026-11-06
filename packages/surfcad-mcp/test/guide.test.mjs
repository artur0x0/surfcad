/**
 * The guide tool: agent know-how from the MCP server itself. The initialize
 * instructions stay a short quick-start that points here; the topics carry
 * the long text; the build guidance appears once, in `start`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  ALL_GUIDE_TOPIC_NAMES,
  callGuideTool,
  GUIDE_TOPIC_NAMES,
  GUIDE_TOPICS,
  INSTRUCTIONS_MAX_BYTES,
  SERVER_INSTRUCTIONS,
} from '../src/prompt/guide.mjs';
import { BUILD_GUIDANCE, JOINT_PLACEMENT_GUIDANCE } from '../src/prompt/buildGuidance.mjs';
import {
  BUILDING_STATUS_GUIDANCE,
  CLOSING_REPLY_GUIDANCE,
  LONG_POLL_GUIDANCE,
  PROMPT_ONBOARDING_ASK,
  PROMPT_ONBOARDING_NOTE,
  PROMPT_SERVER_INSTRUCTIONS,
  PROMPT_TURN_GUIDANCE,
  READ_MESSAGES_MAX_WAIT_MS,
  READ_MESSAGES_POLL_MS,
  SESSION_PRESENCE_GUIDANCE,
  WEBHOOK_REQUIRED_GUIDANCE,
  promptToolDefinitions,
} from '../src/prompt/promptTools.mjs';
import { guideResourceContents, guideResourceList } from '../src/prompt/guide.mjs';
import { AGENT_PROMPT_STALL_MS, agentPromptStallMinutes } from '../src/prompt/promptStall.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');

test('the instructions are a short quick-start that keeps the webhook line first and points at guide start', () => {
  assert.ok(SERVER_INSTRUCTIONS.startsWith(PROMPT_SERVER_INSTRUCTIONS));
  assert.ok(Buffer.byteLength(SERVER_INSTRUCTIONS, 'utf8') < INSTRUCTIONS_MAX_BYTES, `${Buffer.byteLength(SERVER_INSTRUCTIONS, 'utf8')} bytes`);
  assert.match(SERVER_INSTRUCTIONS, /guide \{ topic: "start" \}/);
  assert.match(SERVER_INSTRUCTIONS, /no_selection/);
  assert.match(SERVER_INSTRUCTIONS, /consent_pending/);
  assert.match(SERVER_INSTRUCTIONS, /return: "status"/);
  assert.match(SERVER_INSTRUCTIONS, /list_faces \{ filter, page \}/);
  assert.match(SERVER_INSTRUCTIONS, /list_commands \{ group \}/);
  assert.ok(!SERVER_INSTRUCTIONS.includes(BUILD_GUIDANCE));
  assert.match(SERVER_INSTRUCTIONS, /joint_create/);
  assert.match(SERVER_INSTRUCTIONS, /fixed joint/);
  assert.match(SERVER_INSTRUCTIONS, /part_set_transform only for parts that touch nothing/);
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /part_set_transform or joints/);
  for (const name of GUIDE_TOPIC_NAMES) assert.ok(SERVER_INSTRUCTIONS.includes(name), name);
  assert.ok(SERVER_INSTRUCTIONS.includes(CLOSING_REPLY_GUIDANCE), 'initialize instructions require a closing reply');
  assert.match(SERVER_INSTRUCTIONS, /failure or partial completion/);
  assert.match(SERVER_INSTRUCTIONS, /what failed and why/);
  assert.match(SERVER_INSTRUCTIONS, /what is left/);
});

test('reply_to_user and the guide start topic require a closing reply, including on failure or partial completion', () => {
  const defs = Object.fromEntries(promptToolDefinitions().map((tool) => [tool.name, tool]));
  const reply = defs.reply_to_user.description;
  assert.ok(reply.includes(CLOSING_REPLY_GUIDANCE), reply);
  assert.match(reply, /final reply is expected/);
  assert.match(reply, /failure or partial completion/);
  assert.match(reply, /what was done, what failed and why, and what is left/);
  assert.match(reply, /summarising what was done/);
  assert.match(defs.reply_to_user.inputSchema.properties.final.description, /expected/);
  assert.match(defs.reply_to_user.inputSchema.properties.text.description, /failure or partial completion/);
  assert.ok(defs.read_messages.description.includes(CLOSING_REPLY_GUIDANCE));
  assert.match(defs.read_messages.description, /failure or partial completion/);
  assert.match(reply, /unknown_prompt/);
  assert.match(defs.read_messages.description, /recent/);
  assert.match(GUIDE_TOPICS.start.text, /unknown_prompt/);
  assert.match(GUIDE_TOPICS.start.text, /recent/);
  assert.match(defs.set_status.description, /set_status is for progress and does not close the task/);
  assert.match(defs.set_status.inputSchema.properties.state.description, /does not close the task/);
  assert.ok(defs.set_status.description.includes(CLOSING_REPLY_GUIDANCE));
  assert.equal(AGENT_PROMPT_STALL_MS, 15 * 60 * 1000);
  const stallMinutes = agentPromptStallMinutes();
  assert.match(defs.set_status.description, new RegExp(`${stallMinutes} minutes, while responding or building`));
  assert.match(defs.set_status.description, /stall notice/);
  assert.doesNotMatch(defs.set_status.description, /120 seconds/);
  assert.doesNotMatch(defs.set_status.description, /\b5 minutes\b/);
  const readme = readFileSync(join(PKG_ROOT, 'README.md'), 'utf8');
  assert.match(readme, new RegExp(`${stallMinutes} minutes, while responding or building`));
  assert.doesNotMatch(readme, /120 seconds/);
  assert.doesNotMatch(readme, /for 5 minutes/);
  assert.ok(GUIDE_TOPICS.start.text.includes(CLOSING_REPLY_GUIDANCE));
  assert.match(GUIDE_TOPICS.start.text, /set_status is for progress and does not close the task/);
  assert.ok(GUIDE_TOPICS.start.text.includes(BUILDING_STATUS_GUIDANCE));
  assert.ok(PROMPT_SERVER_INSTRUCTIONS.includes(BUILDING_STATUS_GUIDANCE));
  assert.ok(PROMPT_SERVER_INSTRUCTIONS.includes(SESSION_PRESENCE_GUIDANCE));
  assert.match(SESSION_PRESENCE_GUIDANCE, /fresh process per tool call is normal/);
  assert.match(SESSION_PRESENCE_GUIDANCE, /long-lived process is optional, never required/);
  assert.doesNotMatch(SESSION_PRESENCE_GUIDANCE, /when the runtime allows/);
  assert.match(GUIDE_TOPICS.start.text, /long-lived process is optional and nothing depends on it/);
  assert.ok(defs.set_status.description.includes(BUILDING_STATUS_GUIDANCE));
  assert.match(PROMPT_SERVER_INSTRUCTIONS, /failure or partial completion/);
});

test('instructions and read_messages require the ack-first order and a long-poll', () => {
  const defs = Object.fromEntries(promptToolDefinitions().map((tool) => [tool.name, tool]));
  const read = defs.read_messages.description;
  const phrases = [
    /set_status \{ state: "responding", id/,
    /before any other tool/,
    /wait_ms: 10000/,
    /register_webhook/,
    /empty immediate read does not mean the user never sent/,
    /10 seconds/,
  ];
  for (const text of [PROMPT_SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS, read, GUIDE_TOPICS.start.text, PROMPT_TURN_GUIDANCE]) {
    for (const phrase of phrases) assert.match(text, phrase, phrase.toString());
  }
  assert.match(read, /set_status responding is the ack/);
  assert.match(GUIDE_TOPICS.start.text, /no separate ack tool/);
  assert.match(defs.set_status.description, /before any other tool/);
  assert.match(defs.read_messages.inputSchema.properties.wait_ms.description, /empty immediate read does not mean the user never sent/);
});

test('guide chat is the required in-viewer workflow: the full sequence, the webhook step, and the 10 s long-poll', () => {
  const chat = GUIDE_TOPICS.chat.text;
  assert.match(chat, /requirement, not a tip/);
  assert.match(GUIDE_TOPICS.chat.summary, /^REQUIRED in-viewer chat workflow/);

  // The normative sequence, in order (brief 2026-11-05 §4).
  const order = [
    /The user's message appears in the chat box/,
    /first tool call after you receive the prompt is set_status \{ state: "responding", id: <prompt id> \}/,
    /reply_to_user \{ in_reply_to: <id>, text: "Got it\. Starting on <one-line plan>\.", final: false \}/,
    /keeps that reply on screen for about 10 seconds/,
    /set_status \{ state: "building", id: <id> \}, or post_progress/,
    /Call post_progress occasionally while you are connected/,
    /reply_to_user \{ in_reply_to: <id>, text, final: true \}/,
    /The user dismisses the chat and reviews/,
  ];
  let at = -1;
  for (const step of order) {
    const found = chat.slice(at + 1).search(step);
    assert.ok(found >= 0, `${step} after index ${at}`);
    at += 1 + found;
  }
  assert.match(chat, /No modeling, no list_\*, no screenshot, no other tool before this/);
  assert.match(chat, /jumping dots/);
  assert.match(chat, /chat folds and the spinner shows on the Bot control of the window that paired you/);
  assert.match(chat, /spinner stops, the chat opens again with your confirmation, and you are idle/);

  // Webhook step (§5): required after every pair, memory only, and never neither.
  assert.ok(chat.includes(WEBHOOK_REQUIRED_GUIDANCE));
  assert.match(WEBHOOK_REQUIRED_GUIDANCE, /right after every successful pair or login, before you wait for a prompt/);
  assert.match(WEBHOOK_REQUIRED_GUIDANCE, /again in every new process/);
  assert.match(chat, /status\.webhookRegistered is then true until this process exits/);
  assert.match(chat, /never logged, never written to disk, never returned/);
  assert.ok(chat.includes(PROMPT_ONBOARDING_ASK), 'the onboarding ask stays');
  assert.match(chat, /Never run with neither a webhook nor the poll/);

  // Long-poll (§6): required, 10 s, and not activity.
  assert.equal(READ_MESSAGES_POLL_MS, 10_000);
  assert.ok(READ_MESSAGES_POLL_MS <= READ_MESSAGES_MAX_WAIT_MS);
  assert.ok(chat.includes(LONG_POLL_GUIDANCE));
  assert.match(LONG_POLL_GUIDANCE, /read_messages \{ wait_ms: 10000 \} in a loop/);
  assert.match(LONG_POLL_GUIDANCE, /required whenever no webhook wakes you, and the safety net when one is registered/);
  assert.match(LONG_POLL_GUIDANCE, /Polling is not activity/);
  assert.match(chat, /Keep the loop running after a final reply/);
  assert.match(chat, /second message sent within a minute of your final reply must reach you without a webhook/);
  assert.match(chat, new RegExp(`does not restart the "No activity from the agent for ${agentPromptStallMinutes()} min" stall window`));
  assert.match(chat, /Activity is set_status, a model-changing tool, post_progress, and reply_to_user/);

  // Served as a tool topic and as a resource.
  const out = callGuideTool({ topic: 'chat' });
  assert.equal(out.isError, false);
  assert.equal(out.content[0].text, chat);
  assert.match(out.content[1].text, /^Resource: surfcad:\/\/guide\/chat /);
  assert.ok(guideResourceList().some((row) => row.uri === 'surfcad://guide/chat' && row.name === 'chat'));
  assert.equal(guideResourceContents('surfcad://guide/chat').contents[0].text, chat);
});

test('start, the instructions, the pair note, and the tool descriptions point at guide chat as required', () => {
  const defs = Object.fromEntries(promptToolDefinitions().map((tool) => [tool.name, tool]));
  assert.match(GUIDE_TOPICS.start.text, /In-viewer chat is a required workflow, not a tip: read guide \{ topic: "chat" \} after every pair/);
  assert.match(GUIDE_TOPICS.start.text, /follow it for every prompt the user sends from the SurfCAD chat box/);
  assert.match(GUIDE_TOPICS.start.text, /"molding" \| "chat"/);
  for (const text of [PROMPT_SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS]) {
    assert.match(text, /Required after every in-viewer prompt \(full order: guide \{ topic: "chat" \}\)/);
    assert.match(text, /Required after every pair: register_webhook again/);
    assert.match(text, /No webhook: loop read_messages \{ wait_ms: 10000 \} while connected; polling is not activity/);
  }
  assert.match(PROMPT_TURN_GUIDANCE, /required, not tips: guide \{ topic: "chat" \} is the whole workflow/);
  assert.ok(PROMPT_TURN_GUIDANCE.includes(LONG_POLL_GUIDANCE));
  assert.ok(defs.read_messages.description.includes(LONG_POLL_GUIDANCE));
  assert.match(defs.read_messages.description, /read_messages is a poll, not activity/);
  assert.match(defs.read_messages.inputSchema.properties.wait_ms.description, /required cycle while connected is 10000/);
  assert.ok(defs.register_webhook.description.includes(WEBHOOK_REQUIRED_GUIDANCE));
  assert.ok(defs.register_webhook.description.includes(LONG_POLL_GUIDANCE));
  assert.match(defs.register_webhook.description, /required fallback is the long-poll, not silence/);
  assert.match(defs.set_status.description, /a read_messages poll is not/);
  assert.match(PROMPT_ONBOARDING_NOTE, /call register_webhook again after every pair/);
  assert.match(PROMPT_ONBOARDING_NOTE, /If the user declines, long-poll read_messages \{ wait_ms: 10000 \} in a loop while connected: that fallback is required, never neither/);
});

test('the topics are the planned set, each under 1,500 words, and start carries the build guidance verbatim', () => {
  assert.deepEqual([...GUIDE_TOPIC_NAMES], ['start', 'dialect', 'features', 'selection', 'paint', 'limits', 'camera', 'assembly', 'modeling', 'molding', 'chat']);
  for (const name of GUIDE_TOPIC_NAMES) {
    const words = GUIDE_TOPICS[name].text.trim().split(/\s+/).length;
    assert.ok(words > 80 && words < 1500, `${name}: ${words} words`);
    assert.ok(GUIDE_TOPICS[name].summary.length > 20, name);
  }
  assert.ok(GUIDE_TOPICS.start.text.includes(BUILD_GUIDANCE));
  assert.ok(BUILD_GUIDANCE.includes(JOINT_PLACEMENT_GUIDANCE));
  assert.ok(GUIDE_TOPICS.assembly.text.includes(JOINT_PLACEMENT_GUIDANCE));
  assert.match(GUIDE_TOPICS.assembly.text, /joint_create \{ type, picks \} is the call/);
  assert.match(GUIDE_TOPICS.assembly.text, /Joints card is the advanced path/);
  assert.doesNotMatch(GUIDE_TOPICS.assembly.text, /part_set_transform or joints/);
  // Facts that other PRs pinned: single-use picks (#679), lean results (#680, #684), stale (#682).
  assert.match(GUIDE_TOPICS.selection.text, /no_selection/);
  assert.match(GUIDE_TOPICS.selection.text, /usedSelection/);
  assert.match(GUIDE_TOPICS.limits.text, /stale: true/);
  assert.match(GUIDE_TOPICS.limits.text, /30 seconds/);
  assert.match(GUIDE_TOPICS.camera.text, /right \(camera on \+X/);
  assert.match(GUIDE_TOPICS.features.text, /@contour id=/);
  assert.match(GUIDE_TOPICS.paint.text, /paint_confirm/);
  assert.match(GUIDE_TOPICS.assembly.text, /part_set_transform/);
  // 0.3.6: modeling and molding guidelines, cross-linked from start and the tool descriptions.
  assert.match(GUIDE_TOPICS.start.text, /guide \{ topic: "modeling" \}; molded parts: guide \{ topic: "molding" \}/);
  assert.match(GUIDE_TOPICS.start.text, /"assembly" \| "modeling" \| "molding"/);
  assert.match(GUIDE_TOPICS.modeling.text, /Do not call create_part for the first part/);
  assert.match(GUIDE_TOPICS.modeling.text, /insert_shell first, then fillet the concave/);
  assert.match(GUIDE_TOPICS.modeling.text, /insert_mirror/);
  assert.match(GUIDE_TOPICS.molding.text, /mold_fit and mold_draft before you call it done/);
  assert.match(GUIDE_TOPICS.molding.text, /Do not fillet a rib base/);
});

test('callGuideTool lists topics with no args, returns one topic, and names the topics on an unknown one', () => {
  const list = callGuideTool({});
  assert.equal(list.isError, false);
  for (const name of GUIDE_TOPIC_NAMES) assert.match(list.content[0].text, new RegExp(`^- ${name}: `, 'm'));
  const one = callGuideTool({ topic: 'camera' });
  assert.equal(one.isError, false);
  assert.equal(one.content[0].text, GUIDE_TOPICS.camera.text);
  assert.match(one.content[1].text, /^Resource: surfcad:\/\/guide\/camera \(surfcad-mcp \d/);
  const bad = callGuideTool({ topic: 'nope' });
  assert.equal(bad.isError, true);
  const body = JSON.parse(bad.content[0].text);
  assert.equal(body.code, 'unknown_topic');
  assert.deepEqual(body.topics, [...ALL_GUIDE_TOPIC_NAMES]);
  assert.match(body.message, /start, dialect, features/);
  assert.match(body.hint, /guide \{\}/);
});

test('over stdio: guide is listed, works before pairing, and the instructions are the quick-start', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BIN],
    env: { ...process.env, SURFCAD_MCP_START_RELAY: '0', SURFCAD_PAIRING_CODE: '' },
  });
  const client = new Client({ name: 'surfcad-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    assert.equal(client.getInstructions(), SERVER_INSTRUCTIONS);
    const { tools } = await client.listTools();
    const guide = tools.find((t) => t.name === 'guide');
    assert.ok(guide, 'guide tool listed');
    assert.deepEqual(guide.inputSchema.properties.topic.enum, [...ALL_GUIDE_TOPIC_NAMES]);
    assert.match(guide.description, /start/);

    // No pairing needed: the guide is local text.
    const list = await client.callTool({ name: 'guide', arguments: {} });
    assert.equal(list.isError, false);
    assert.match(list.content[0].text, /- start: /);
    const start = await client.callTool({ name: 'guide', arguments: { topic: 'start' } });
    assert.equal(start.isError, false);
    assert.ok(start.content[0].text.includes(BUILD_GUIDANCE));
    const bad = await client.callTool({ name: 'guide', arguments: { topic: 'nope' } });
    assert.equal(bad.isError, true);
    assert.equal(JSON.parse(bad.content[0].text).code, 'unknown_topic');
  } finally {
    await client.close();
  }
});
