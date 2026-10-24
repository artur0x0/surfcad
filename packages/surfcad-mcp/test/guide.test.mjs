/**
 * The guide tool: agent know-how from the MCP server itself. The initialize
 * instructions stay a short quick-start that points here; the topics carry
 * the long text; the build guidance appears once, in `start`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
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
import { BUILD_GUIDANCE } from '../src/prompt/buildGuidance.mjs';
import { PROMPT_SERVER_INSTRUCTIONS } from '../src/prompt/promptTools.mjs';

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
  for (const name of GUIDE_TOPIC_NAMES) assert.ok(SERVER_INSTRUCTIONS.includes(name), name);
});

test('the topics are the planned set, each under 1,500 words, and start carries the build guidance verbatim', () => {
  assert.deepEqual([...GUIDE_TOPIC_NAMES], ['start', 'dialect', 'features', 'selection', 'paint', 'limits', 'camera', 'assembly']);
  for (const name of GUIDE_TOPIC_NAMES) {
    const words = GUIDE_TOPICS[name].text.trim().split(/\s+/).length;
    assert.ok(words > 80 && words < 1500, `${name}: ${words} words`);
    assert.ok(GUIDE_TOPICS[name].summary.length > 20, name);
  }
  assert.ok(GUIDE_TOPICS.start.text.includes(BUILD_GUIDANCE));
  // Facts that other PRs pinned: single-use picks (#679), lean results (#680, #684), stale (#682).
  assert.match(GUIDE_TOPICS.selection.text, /no_selection/);
  assert.match(GUIDE_TOPICS.selection.text, /usedSelection/);
  assert.match(GUIDE_TOPICS.limits.text, /stale: true/);
  assert.match(GUIDE_TOPICS.limits.text, /30 seconds/);
  assert.match(GUIDE_TOPICS.camera.text, /right \(camera on \+X/);
  assert.match(GUIDE_TOPICS.features.text, /@contour id=/);
  assert.match(GUIDE_TOPICS.paint.text, /paint_confirm/);
  assert.match(GUIDE_TOPICS.assembly.text, /part_set_transform/);
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
