import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../scripts/playtest/scenarios/agent-bridge-relay-retry.mjs'),
  'utf8',
);

test('vite preview does not steal the MCP-owned relay port when START_RELAY=0', () => {
  const plugin = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../scripts/vite-agent-bridge-ws.mjs'),
    'utf8',
  );
  assert.match(plugin, /SURFCAD_MCP_START_RELAY !== '0'/);
});

test('relay-retry playtest keeps MCP stdin open so the owned relay does not exit', () => {
  assert.match(SRC, /function spawnMcpRelay/);
  assert.match(SRC, /stdio:\s*\[\s*'pipe',\s*'ignore',\s*'pipe'\s*\]/);
  assert.match(SRC, /proc\.stdin\?\.end/);
});

test('relay-retry playtest asserts Allow/Deny does not cover the profile chrome', () => {
  assert.match(SRC, /assertApprovalClearsProfileChrome/);
  assert.match(SRC, /rectsOverlap/);
  assert.match(SRC, /data-profile-privacy-choices/);
  assert.match(SRC, /data-agent-bridge-approval-portal/);
  assert.match(SRC, /text-chrome-text/);
  assert.match(SRC, /rgb\(243, 244, 246\)/);
  assert.match(SRC, /assertApprovalLayoutAtWidths/);
  assert.match(SRC, /\[1280, 768, 390\]/);
});
