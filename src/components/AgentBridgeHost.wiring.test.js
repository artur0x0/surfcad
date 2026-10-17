import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(dir, 'AgentBridgeHost.jsx'), 'utf8');
const CHIP = readFileSync(join(dir, 'ProfileChip.jsx'), 'utf8');
const APP = readFileSync(join(dir, '../App.jsx'), 'utf8');

test('pairing host stays mounted on App across the desktop/mobile remount', () => {
  assert.match(SRC, /shouldKeepAgentBridgeHostMounted\(\{ agentBridgeLive: enabled \}\)/);
  assert.match(SRC, /<AgentBridgePairing/);
  assert.match(SRC, /uiTarget=\{slot\}/);
  assert.match(APP, /<AgentBridgeHost enabled=\{agentBridgeLive\}>/);
  assert.equal((APP.match(/<AgentBridgeHost enabled=\{agentBridgeLive\}>/g) || []).length, 2);
});

test('ProfileChip offers the panel slot and does not own the socket', () => {
  assert.match(CHIP, /useAgentBridgeHost\(\)/);
  assert.match(CHIP, /offerSlot\(agentBridgeSlot\)/);
  assert.equal(CHIP.includes('<AgentBridgePairing'), false);
});
