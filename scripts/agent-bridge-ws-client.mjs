#!/usr/bin/env node
/**
 * Minimal local client for the M1 agent-bridge WebSocket relay.
 *
 *   npm run agent-bridge:client -- --token ABCDEF --command list_faces
 *
 * The SurfCAD tab must be showing the same pairing code and you must click
 * Allow connection when prompted.
 */
import { connectPeer, bridgeCall } from '../src/agent/ws/nodeClient.js';
import { defaultAgentBridgeWsUrl } from '../src/agent/ws/wsUrl.js';

function parseArgs(argv) {
  const out = { token: '', command: 'list_faces', args: {}, url: defaultAgentBridgeWsUrl() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--token' && argv[i + 1]) { out.token = argv[++i]; continue; }
    if (a === '--command' && argv[i + 1]) { out.command = argv[++i]; continue; }
    if (a === '--args' && argv[i + 1]) {
      out.args = JSON.parse(argv[++i]);
      continue;
    }
    if (a === '--url' && argv[i + 1]) { out.url = argv[++i]; continue; }
    if (a === '--help' || a === '-h') {
      console.log(`Usage: agent-bridge-ws-client.mjs --token CODE [--command name] [--args '{}'] [--url ${out.url}]`);
      process.exit(0);
    }
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.token) {
  console.error('Missing --token (copy from SurfCAD Local agent pairing panel)');
  process.exit(1);
}

const ws = await connectPeer(opts.url, opts.token);
try {
  const result = await bridgeCall(ws, opts.command, opts.args, 'cli-1');
  console.log(JSON.stringify(result, null, 2));
} finally {
  ws.close();
}
