/**
 * Error hints and guide resources (MVP-2 steps 4 and 10). One table maps a
 * code to its recovery; every error payload the server returns carries it,
 * the codes with a longer story are errors.<code> topics, and every topic is
 * also a surfcad://guide/<topic> resource versioned with the package.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  ERROR_HINTS,
  ERROR_TOPIC_CODES,
  EXTRA_ERROR_TOPICS,
  hintFor,
  withErrorHint,
  withRowHints,
} from '../src/prompt/errorHints.mjs';
import {
  ALL_GUIDE_TOPIC_NAMES,
  ALL_GUIDE_TOPICS,
  ERROR_GUIDE_TOPIC_NAMES,
  GUIDE_TOPIC_NAMES,
  guideResourceContents,
  guideResourceList,
  guideResourceUri,
  topicFromResourceUri,
} from '../src/prompt/guide.mjs';
import { PROMPT_TOOL_NAMES } from '../src/prompt/promptTools.mjs';
import { loadCommandsCatalog } from '../src/catalog.mjs';
import { loadPackageVersion } from '../src/packageVersion.mjs';
import { UNJOINTED_PART_HINT } from '../../../src/agent/state/unjointedParts.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');

/** Codes the MCP process itself raises (errors.mjs, relay.mjs, promptTools.mjs, guide.mjs, screenshotFile.mjs). */
const MCP_SIDE_CODES = [
  'not_paired', 'pairing_lost', 'pair_pending', 'pair_rejected', 'pair_cancelled', 'pair_failed', 'bad_pairing_code',
  'tab_asleep', 'too_many_pending', 'token_revoked', 'client_update_required', 'prompts_need_websocket',
  'bridge_error', 'unknown_tool', 'unknown_topic', 'bad_webhook_url', 'no_request', 'unknown_prompt', 'reply_too_long', 'bad_call',
  'screenshot_save_failed', 'bad_args',
];

/** Rows inside a successful result that carry a code. */
const ROW_CODES = ['feature_failed', 'feature_timeout', 'geometry_worker_crashed'];

test('every error code the catalog or the server can return has a hint of its own', () => {
  const catalog = loadCommandsCatalog();
  const codes = new Set([...MCP_SIDE_CODES, ...ROW_CODES]);
  for (const row of catalog.commands) for (const code of row.errors || []) codes.add(code);
  const missing = [...codes].filter((code) => !ERROR_HINTS[code]);
  assert.deepEqual(missing, [], `codes without a hint: ${missing.join(', ')}`);
  for (const [code, row] of Object.entries(ERROR_HINTS)) {
    assert.ok(row.hint.length > 30 && row.hint.length < 320, `${code}: hint length ${row.hint.length}`);
    assert.ok(!/\n/.test(row.hint), `${code}: hint is one line`);
  }
});

test('every tool a hint or topic names is a real tool', () => {
  const catalog = loadCommandsCatalog();
  const tools = new Set([...catalog.commands.map((row) => row.name), 'pair', 'guide', ...PROMPT_TOOL_NAMES]);
  const argNames = new Set([
    'use_selection', 'body_index', 'face_id', 'part_id', 'assembly_id', 'in_reply_to', 'retry_after_ms', 'wait_ms',
    'save_to', 'polygon_preset', 'timeout_ms', 'joint_id', 'accept_plane', 'front_of_model', 'normal_to_sketch',
    'out_of_memory', 'wasm_abort', 'sweep_path',
  ]);
  const codes = new Set(Object.keys(ERROR_HINTS));
  const text = Object.values(ERROR_HINTS).map((row) => `${row.hint}\n${row.guide || ''}`).join('\n')
    + Object.values(EXTRA_ERROR_TOPICS).map((row) => row.text).join('\n');
  const unknown = new Set();
  for (const m of text.matchAll(/\b([a-z]+(?:_[a-z0-9]+)+)\b/g)) {
    const name = m[1];
    if (tools.has(name) || argNames.has(name) || codes.has(name)) continue;
    unknown.add(name);
  }
  assert.deepEqual([...unknown], [], `names that are not tools: ${[...unknown].join(', ')}`);
});

test('hintFor reads the message for insert_failed, keeps a bridge hint, and names the tool in the fallback', () => {
  const sweep = hintFor('insert_failed', 'Sweep path needs a selected edge. Pick an edge or a tangent chain, then insert again.');
  assert.match(sweep.hint, /sweepPoints/);
  assert.equal(sweep.see, 'guide { topic: "errors.sweep_path" }');
  const empty = hintFor('insert_failed', 'Fillet needs a body first. Insert a Block');
  assert.match(empty.hint, /insert_cube/);
  assert.equal(empty.see, undefined);
  const plain = hintFor('no_selection');
  assert.match(plain.hint, /select_faces/);
  assert.equal(plain.see, 'guide { topic: "errors.no_selection" }');
  const unknown = hintFor('never_seen_before', 'x', { tool: 'insert_tube' });
  assert.match(unknown.hint, /list_commands \{ names: \["insert_tube"\] \}/);

  const kept = withErrorHint({ code: 'upgrade_required', message: 'm', hint: 'from the tab' });
  assert.equal(kept.hint, 'from the tab');
  assert.equal(withErrorHint('not an object'), 'not an object');
  assert.deepEqual(withErrorHint({ message: 'no code' }), { message: 'no code' });
});

test('withRowHints annotates errors rows and the crash record, and leaves other results alone', () => {
  const out = withRowHints({
    ok: false,
    errors: [{ code: 'feature_timeout', message: 'Fillet did not finish' }, 'plain text row'],
    crash: { code: 'geometry_worker_crashed', reason: 'timeout' },
    status: { runState: 'failed' },
  });
  assert.match(out.errors[0].hint, /30 s budget/);
  assert.equal(out.errors[0].see, 'guide { topic: "errors.feature_timeout" }');
  assert.equal(out.errors[1], 'plain text row');
  assert.match(out.crash.hint, /simplify/);
  assert.deepEqual(out.status, { runState: 'failed' });
  const same = { ok: true, errors: [], status: {} };
  assert.equal(withRowHints(same), same);
  const list = { faces: [] };
  assert.equal(withRowHints(list), list);

  const warned = withRowHints({
    partId: 'wheel',
    warning: { code: 'unjointed_part', part_id: 'wheel', hint: UNJOINTED_PART_HINT },
  });
  assert.equal(ERROR_HINTS.unjointed_part.hint, UNJOINTED_PART_HINT);
  assert.equal(warned.warning.hint, UNJOINTED_PART_HINT);
  assert.equal(warned.warning.see, 'guide { topic: "errors.unjointed_part" }');
  assert.equal(warned.warning.code, 'unjointed_part');
});

test('the error topics come from the hint table, start with their code, and stay short', () => {
  for (const code of ERROR_TOPIC_CODES) {
    const topic = ALL_GUIDE_TOPICS[`errors.${code}`];
    assert.ok(topic, `errors.${code} is a topic`);
    assert.ok(topic.text.startsWith(`${code}. ${ERROR_HINTS[code].hint}`), code);
    const words = topic.text.trim().split(/\s+/).length;
    assert.ok(words > 40 && words < 400, `${code}: ${words} words`);
  }
  assert.ok(ERROR_GUIDE_TOPIC_NAMES.includes('errors.sweep_path'));
  assert.match(ALL_GUIDE_TOPICS['errors.sweep_path'].text, /sweepPoints/);
  for (const code of ['no_selection', 'feature_timeout', 'geometry_worker_crashed', 'not_paired', 'unknown_face', 'no_feature_edit', 'consent_pending']) {
    assert.ok(ERROR_TOPIC_CODES.includes(code), code);
  }
  assert.deepEqual(ALL_GUIDE_TOPIC_NAMES, [...GUIDE_TOPIC_NAMES, ...ERROR_GUIDE_TOPIC_NAMES]);
});

test('resource rows cover every topic with the package version, and a URI reads back its topic', () => {
  const version = loadPackageVersion();
  const rows = guideResourceList();
  assert.deepEqual(rows.map((r) => r.name), [...ALL_GUIDE_TOPIC_NAMES]);
  for (const row of rows) {
    assert.equal(row.uri, `surfcad://guide/${row.name}`);
    assert.equal(row.mimeType, 'text/plain');
    assert.equal(row._meta.version, version);
    assert.equal(row.description, ALL_GUIDE_TOPICS[row.name].summary);
  }
  assert.equal(topicFromResourceUri(guideResourceUri('camera')), 'camera');
  assert.equal(topicFromResourceUri('surfcad://guide/nope'), null);
  assert.equal(topicFromResourceUri('file:///etc/passwd'), null);
  const read = guideResourceContents('surfcad://guide/errors.no_selection');
  assert.equal(read.contents[0].text, ALL_GUIDE_TOPICS['errors.no_selection'].text);
  assert.equal(read.contents[0]._meta.version, version);
  assert.equal(guideResourceContents('surfcad://guide/nope'), null);
});

test('over stdio: resources list and read, error payloads carry hint and see, guide points at the resource', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BIN],
    env: { ...process.env, SURFCAD_MCP_START_RELAY: '0', SURFCAD_PAIRING_CODE: '' },
  });
  const client = new Client({ name: 'surfcad-mcp-hints-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const version = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version;
    assert.ok(client.getServerCapabilities().resources, 'resources capability');

    const { resources } = await client.listResources();
    assert.deepEqual(resources.map((r) => r.name), [...ALL_GUIDE_TOPIC_NAMES]);
    assert.equal(resources[0]._meta.version, version);

    const start = await client.readResource({ uri: 'surfcad://guide/start' });
    assert.equal(start.contents[0].text, ALL_GUIDE_TOPICS.start.text);
    assert.equal(start.contents[0].mimeType, 'text/plain');
    await assert.rejects(client.readResource({ uri: 'surfcad://guide/nope' }), /Unknown resource/);

    const topic = await client.callTool({ name: 'guide', arguments: { topic: 'errors.not_paired' } });
    assert.equal(topic.isError, false);
    assert.equal(topic.content[0].text, ALL_GUIDE_TOPICS['errors.not_paired'].text);
    assert.equal(topic.content[1].text, `Resource: surfcad://guide/errors.not_paired (surfcad-mcp ${version}).`);

    const bad = await client.callTool({ name: 'guide', arguments: { topic: 'nope' } });
    const badBody = JSON.parse(bad.content[0].text);
    assert.equal(badBody.code, 'unknown_topic');
    assert.match(badBody.hint, /guide \{\}/);

    // Not paired: a bridge tool answers not_paired with the pairing hint and its topic.
    const notPaired = await client.callTool({ name: 'status', arguments: {} });
    assert.equal(notPaired.isError, true);
    const np = JSON.parse(notPaired.content[0].text);
    assert.equal(np.code, 'not_paired');
    assert.ok(np.hint, 'hint present');
    assert.equal(np.see, 'guide { topic: "errors.not_paired" }');

    const noCode = await client.callTool({ name: 'pair', arguments: {} });
    const nc = JSON.parse(noCode.content[0].text);
    assert.equal(nc.code, 'bad_pairing_code');
    assert.match(nc.hint, /Show pairing code/);
    assert.equal(nc.see, 'guide { topic: "errors.bad_pairing_code" }');

    const unknownTool = await client.callTool({ name: 'no_such_tool', arguments: {} });
    const ut = JSON.parse(unknownTool.content[0].text);
    assert.equal(ut.code, 'unknown_tool');
    assert.match(ut.hint, /list_commands/);

    const promptErr = await client.callTool({ name: 'read_messages', arguments: { wait_ms: -1 } });
    assert.equal(promptErr.isError, true);
    const pe = JSON.parse(promptErr.content[0].text);
    assert.equal(pe.code, 'bad_args');
    assert.ok(pe.hint, 'prompt tool errors carry a hint too');
  } finally {
    await client.close().catch(() => {});
  }
});
