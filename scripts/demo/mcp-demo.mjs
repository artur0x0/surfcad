#!/usr/bin/env node
/**
 * MCP demo: preview tab + surfcad-mcp over the M1 relay.
 * Box → hole → fillet → two parts + coincident joint → undo → status.
 *
 * Env:
 *   SURFCAD_PLAYTEST=1 — set localStorage auto-approve (CI / harness only)
 *   DEMO_PORT, SURFCAD_AGENT_BRIDGE_WS_PORT, CHROME_PATH
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  assertLocalhost,
  enableAgentBridgeAutoApprove,
  findChrome,
  launchBrowser,
  openAgentPage,
  showAgentBridgePairingCode,
  startPreviewServer,
  waitForServer,
} from '../playtest/lib/harness.mjs';
import { pickFreePort } from '../playtest/lib/pickFreePort.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../packages/surfcad-mcp');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');
const PLAYTEST = process.env.SURFCAD_PLAYTEST === '1' || process.env.SURFCAD_PLAYTEST === 'true';
const PORT = Number(process.env.DEMO_PORT || process.env.PLAYTEST_PORT || 4182);

const USER_ID = 'user-mcp-demo';
const SEED_SCRIPT = `// --- cube begin ---
let part = Manifold.cube([10, 10, 10], true);
// --- cube end ---
return part;
`;

function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'mcp-demo',
    activeId: 'local:part1',
    source: 'local',
    parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
    joints: [],
  };
}

function seedParts() {
  return [{ id: 'local:part1', script: SEED_SCRIPT }];
}

function logStep(label, detail = '') {
  console.log(`\n→ ${label}${detail ? ` — ${detail}` : ''}`);
}

function parseToolResult(out) {
  const text = out?.content?.[0]?.text;
  const parsed = text ? JSON.parse(text) : {};
  if (out?.isError) {
    const err = new Error(parsed.message || parsed.code || 'tool error');
    err.code = parsed.code;
    err.details = parsed.details;
    throw err;
  }
  return parsed;
}

async function mcpCall(client, name, args = {}) {
  const out = await client.callTool({ name, arguments: args });
  return parseToolResult(out);
}

function topFace(faces) {
  return (faces || []).find((row) => (row.normal?.[2] ?? row.n?.[2] ?? 0) > 0.9);
}

function bottomFace(faces) {
  const list = faces || [];
  let best = null;
  let bestZ = Infinity;
  for (const row of list) {
    const at = row.center || row.at || row.key?.at;
    const z = Array.isArray(at) ? at[2] : null;
    const nz = row.normal?.[2] ?? row.n?.[2] ?? row.key?.n?.[2] ?? 0;
    if (z != null && z < bestZ && nz < -0.5) {
      bestZ = z;
      best = row;
    }
  }
  return best;
}

async function waitForPairApprove(page, timeoutMs = 20000) {
  const approve = page.locator('[data-ui-action="data-agent-bridge-approve"]');
  await approve.waitFor({ state: 'visible', timeout: timeoutMs });
  await approve.click();
}

const exe = findChrome();
if (!exe) {
  console.error('demo:mcp — no system Chrome (set CHROME_PATH)');
  process.exit(1);
}

const relayPort = process.env.SURFCAD_AGENT_BRIDGE_WS_PORT
  ? Number(process.env.SURFCAD_AGENT_BRIDGE_WS_PORT)
  : await pickFreePort();
const relayUrl = `ws://127.0.0.1:${relayPort}`;
const baseUrl = `http://127.0.0.1:${PORT}/?agent=1&agentBridgeWs=${encodeURIComponent(relayUrl)}`;
assertLocalhost(baseUrl);

const { stop } = startPreviewServer(PORT, {
  SURFCAD_AGENT_BRIDGE_WS_PORT: String(relayPort),
});

let browser;
let client;
let failed = 0;

try {
  if (!(await waitForServer(`http://127.0.0.1:${PORT}/`))) {
    throw new Error('preview server did not start');
  }

  browser = await launchBrowser(exe);
  const { page } = await openAgentPage(browser, {
    width: 1280,
    height: 800,
    baseUrl,
    userId: USER_ID,
    assembly: seedDoc(),
    parts: seedParts(),
  });

  if (PLAYTEST) {
    await enableAgentBridgeAutoApprove(page);
    logStep('playtest', 'local agent pairing will auto-approve');
  } else {
    console.log('\nPairing: in SurfCAD open Local agent → Show pairing code, or use the code printed below.');
    console.log('When surfcad-mcp connects, click Allow connection in the tab (this demo will also click Allow in the automated tab).');
  }

  const pairingCode = await showAgentBridgePairingCode(page);
  if (!pairingCode || pairingCode.length < 4) {
    throw new Error('pairing code not shown');
  }
  logStep('pairing code', pairingCode);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BIN],
    env: {
      ...process.env,
      SURFCAD_AGENT_BRIDGE_WS_URL: relayUrl,
      SURFCAD_PAIRING_CODE: '',
    },
  });

  client = new Client({ name: 'surfcad-mcp-demo', version: '1.0.0' });
  await client.connect(transport);

  const pairPromise = client.callTool({ name: 'pair', arguments: { code: pairingCode } });
  if (!PLAYTEST) {
    await waitForPairApprove(page).catch(() => { /* playtest auto-approves */ });
  }
  await pairPromise;
  logStep('pair', 'connected through relay');

  const st0 = await mcpCall(client, 'status', {});
  logStep('status (start)', `features=${st0.featureCount ?? 0}`);

  await mcpCall(client, 'insert_cube', { width: 40, depth: 30, height: 20, center: true });
  await mcpCall(client, 'run', {});
  logStep('insert_cube + run');

  const facesEnv = await mcpCall(client, 'list_faces', {});
  const faceCount = facesEnv.faces?.length ?? 0;
  if (faceCount < 6) throw new Error('expected box faces');
  await mcpCall(client, 'insert_cylinder', {
    height: 50,
    radius: 6,
    combine: 'subtract',
  });
  await mcpCall(client, 'run', {});
  logStep('hole', 'cylinder subtract through box');

  const edgesEnv = await mcpCall(client, 'list_feature_edges', {});
  const edgeKey = edgesEnv.edges?.[0]?.key;
  if (!edgeKey) throw new Error('no feature edge for fillet');
  await mcpCall(client, 'select_edges', { keys: [edgeKey] });
  await mcpCall(client, 'insert_fillet_edges', { use_selection: true, radius: 2, strategy: 'sweep' });
  await mcpCall(client, 'run', {});
  logStep('fillet', `edge ${edgeKey}`);

  await mcpCall(client, 'create_part', { name: 'Pin' });
  const partsEnv = await mcpCall(client, 'parts', {});
  const pinPartId = partsEnv.activeId
    || partsEnv.parts?.find((p) => p.name === 'Pin')?.id
    || partsEnv.parts?.[1]?.id;
  const basePartId = partsEnv.parts?.[0]?.id;
  await mcpCall(client, 'insert_cube', { width: 12, depth: 12, height: 20, center: true });
  await mcpCall(client, 'run', {});
  logStep('create_part + pin cube');

  await mcpCall(client, 'set_active_part', { part_id: basePartId });
  await mcpCall(client, 'run', {});
  const baseFaces = await mcpCall(client, 'list_faces', {});
  const baseTop = topFace(baseFaces.faces);
  await mcpCall(client, 'set_active_part', { part_id: pinPartId });
  await mcpCall(client, 'run', {});
  const pinFaces = await mcpCall(client, 'list_faces', {});
  const pinBottom = bottomFace(pinFaces.faces);
  const baseTopKey = baseTop?.key || baseTop;
  const pinBottomKey = pinBottom?.key || pinBottom;
  if (baseTopKey && pinBottomKey) {
    await mcpCall(client, 'joint_open', {});
    await mcpCall(client, 'joint_pick', {
      picks: [
        { part_id: basePartId, key: baseTopKey },
        { part_id: pinPartId, key: pinBottomKey },
      ],
    });
    await mcpCall(client, 'joint_set_params', { type: 'coincident' });
    await mcpCall(client, 'joint_commit', {});
    logStep('joint', 'coincident');
  } else {
    logStep('joint', 'skipped (face keys missing)');
  }

  await mcpCall(client, 'undo', {});
  logStep('undo');

  const st1 = await mcpCall(client, 'status', {});
  logStep('status (end)', `volume=${st1.volume ?? 'null'} features=${st1.featureCount ?? 0}`);

  await page.close();
} catch (err) {
  failed += 1;
  console.error('\ndemo:mcp failed:', err?.message || err);
  if (err?.code) console.error('  code:', err.code);
} finally {
  if (client) {
    try { await client.close(); } catch { /* noop */ }
  }
  if (browser) await browser.close();
  stop();
}

if (failed) {
  process.exit(1);
}
console.log('\ndemo:mcp: ok');
