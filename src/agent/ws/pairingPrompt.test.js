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

test('staging and plain http use that origin, and a missing host falls back', () => {
  const staging = { protocol: 'http:', host: '100.106.101.1' };
  assert.equal(agentPageOrigin(staging), 'http://100.106.101.1');
  assert.equal(agentApprovalUrl(staging), 'http://100.106.101.1/agent');
  assert.equal(serverLoginCommand(staging), 'npx surfcad-mcp login --server http://100.106.101.1');
  const prompt = serverPairingPrompt(staging);
  assert.match(prompt, /npx surfcad-mcp login --server http:\/\/100\.106\.101\.1/);
  assert.match(prompt, /http:\/\/100\.106\.101\.1\/agent/);
  assert.equal(agentPageOrigin(null), 'https://surfcad.com');
  assert.equal(agentApprovalUrl({ protocol: 'https:' }), 'https://surfcad.com/agent');
  assert.match(serverPairingPrompt({ protocol: 'https:', host: 'www.surfcad.com' }), /--server https:\/\/www\.surfcad\.com/);
});
