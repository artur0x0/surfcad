import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_PAIRING_PROMPT,
  MCP_LOGIN_COMMAND,
  agentApprovalUrl,
  agentPageOrigin,
  serverLoginCommand,
  serverPairingPrompt,
} from './pairingPrompt.js';

test('the server prompt tells the agent to log in at the page origin', () => {
  const prod = serverPairingPrompt({ protocol: 'https:', host: 'surfcad.com' });
  assert.match(prod, new RegExp(MCP_LOGIN_COMMAND));
  assert.match(prod, /https:\/\/surfcad\.com\/agent/);
  assert.equal(serverLoginCommand({ protocol: 'https:', host: 'surfcad.com' }), 'npx surfcad-mcp login');
  assert.doesNotMatch(prod, /npx -y/);
  assert.doesNotMatch(prod, /Install and run/);
  assert.doesNotMatch(prod, /local server/i);
  assert.doesNotMatch(prod, /\bEdge\b/);
  assert.match(AGENT_PAIRING_PROMPT, /npx -y surfcad-mcp/);
});

test('https staging and loopback http keep that origin, and a missing host falls back', () => {
  assert.equal(agentPageOrigin(null), 'https://surfcad.com');
  assert.equal(agentApprovalUrl({ protocol: 'https:' }), 'https://surfcad.com/agent');
  assert.match(serverPairingPrompt({ protocol: 'https:', host: 'www.surfcad.com' }), /--server https:\/\/www\.surfcad\.com/);
  const loopback = { protocol: 'http:', host: '127.0.0.1:5173' };
  assert.equal(serverLoginCommand(loopback), 'npx surfcad-mcp login --server http://127.0.0.1:5173');
  assert.doesNotMatch(serverPairingPrompt(loopback), /machine serving this page/);
  assert.equal(serverLoginCommand({ protocol: 'http:', host: 'localhost:5173' }), 'npx surfcad-mcp login --server http://localhost:5173');
});

test('plain http to a non-loopback host logs in via localhost on that machine', () => {
  const staging = { protocol: 'http:', host: '100.106.101.1:5173' };
  assert.equal(agentPageOrigin(staging), 'http://100.106.101.1:5173');
  assert.equal(agentApprovalUrl(staging), 'http://100.106.101.1:5173/agent');
  assert.equal(serverLoginCommand(staging), 'npx surfcad-mcp login --server http://localhost:5173');
  const prompt = serverPairingPrompt(staging);
  assert.match(prompt, /npx surfcad-mcp login --server http:\/\/localhost:5173/);
  assert.doesNotMatch(prompt, /--server http:\/\/100\.106\.101\.1/);
  assert.match(prompt, /http:\/\/100\.106\.101\.1:5173\/agent/);
  assert.match(prompt, /machine serving this page/);
  assert.doesNotMatch(prompt, /npx -y/);
  assert.doesNotMatch(prompt, /Install and run/);
  assert.doesNotMatch(prompt, /local server/i);
  assert.doesNotMatch(prompt, /\bEdge\b/);
  assert.equal(
    serverLoginCommand({ protocol: 'http:', host: '100.106.101.1' }),
    'npx surfcad-mcp login --server http://localhost',
  );
});
