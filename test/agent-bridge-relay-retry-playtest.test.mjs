import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(ROOT, '../scripts/playtest/scenarios/agent-bridge-relay-retry.mjs'),
  'utf8',
);
const HARNESS = readFileSync(
  join(ROOT, '../scripts/playtest/lib/harness.mjs'),
  'utf8',
);

test('vite preview does not steal the MCP-owned relay port when START_RELAY=0', () => {
  const plugin = readFileSync(
    join(ROOT, '../scripts/vite-agent-bridge-ws.mjs'),
    'utf8',
  );
  assert.match(plugin, /SURFCAD_MCP_START_RELAY !== '0'/);
});

test('relay-retry playtest keeps MCP stdin open so the owned relay does not exit', () => {
  assert.match(SRC, /function spawnMcpRelay/);
  assert.match(SRC, /stdio:\s*\[\s*'pipe',\s*'ignore',\s*'pipe'\s*\]/);
  assert.match(SRC, /proc\.stdin\?\.end/);
});

test('fake backend seeds a signed-in GitHub user before /me settles', () => {
  assert.match(HARNESS, /await seedGithubToken\(page\)/);
  assert.match(HARNESS, /addInitScript\(applyGithubPlaytestToken\)/);
  assert.match(HARNESS, /surfcad\.github\.tokenBundle/);
  assert.match(HARNESS, /sessionStorage\.setItem\('surfcad\.github\.token'/);
  assert.doesNotMatch(HARNESS, /sessionStorage\?\.removeItem\('surfcad\.github\.token'\)/);
  assert.match(HARNESS, /data-profile-chip-state.*=.*signed-in/);
  assert.match(SRC, /waitForSignedInChip/);
  assert.match(SRC, /Connect Agent needs a signed-in chip/);
});

test('relay-retry playtest asserts the pairing popup never covers footer Privacy choices', () => {
  assert.match(SRC, /assertPairingClearsFooterPrivacy/);
  assert.match(SRC, /rectsOverlap/);
  assert.match(SRC, /data-privacy-choices-link/);
  assert.match(SRC, /data-profile-privacy-choices/);
  assert.match(SRC, /data-profile-panel/);
  assert.match(SRC, /data-agent-bridge-dialog-card/);
  assert.match(SRC, /text-on-dark/);
  assert.match(SRC, /rgb\(243, 244, 246\)/);
  assert.match(SRC, /assertApprovalLayoutAtWidths/);
  assert.match(SRC, /\[1280, 768, 390\]/);
  assert.match(SRC, /menuOpen: false/);
  assert.match(SRC, /menuOpen: true/);
});

test('Connect Agent closes the profile menu at 390, 768, and 1280', () => {
  assert.match(SRC, /assertConnectAgentClosesMenuAt/);
  assert.match(SRC, /Connect Agent must close the profile menu/);
  assert.match(SRC, /\{ width: 1280, height: 800 \}/);
  assert.match(SRC, /\{ width: 768, height: 800 \}/);
  assert.match(SRC, /\{ width: 390, height: 844 \}/);
  assert.match(SRC, /dismissPairingDialog/);
});

test('relay restart prompts a fresh Allow and does not persist the resume secret', () => {
  assert.match(SRC, /A process restart must prompt Allow again/);
  assert.match(SRC, /waitForSelector\('\[data-agent-bridge-approval\]'/);
  const tab = readFileSync(join(ROOT, '../src/agent/ws/tabConnection.js'), 'utf8');
  assert.match(tab, /let resumeKey = null/);
  assert.doesNotMatch(tab, /localStorage/);
  assert.doesNotMatch(tab, /sessionStorage/);
  assert.doesNotMatch(SRC, /localStorage\.setItem\([^)]*resume/);
});
