import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ProfileChip.jsx'), 'utf8');

test('viewport wrap is absolute 36 chip positioning only', () => {
  assert.match(
    SRC,
    /const wrapClass = inline\s*\n\s*\? 'pointer-events-auto relative z-10 shrink-0 overflow-visible'\s*\n\s*: 'pointer-events-auto absolute top-4 lg:top-2 right-4 z-50 overflow-visible';/,
  );
  const wrapAssign = SRC.match(/const wrapClass = inline[\s\S]*?;/)?.[0] || '';
  assert.equal(wrapAssign.includes("z-50 relative"), false);
  // Desktop (lg, ≥1024) matches data-viewer-header-row `top-4 lg:top-2`.
  assert.match(wrapAssign, /lg:top-2/);
});

test('viewport chip button is relative; the ring is a wrap sibling so backdrop-filter cannot clip it', () => {
  assert.match(SRC, /relative flex h-9 w-9 items-center/);
  assert.match(
    SRC,
    /className=\{`agent-bridge-profile-ring agent-bridge-profile-ring--\$\{agentRing\} pointer-events-none`\}/,
  );
  const buttonBlock = SRC.slice(SRC.indexOf('<button'), SRC.indexOf('</button>'));
  assert.equal(buttonBlock.includes('agent-bridge-profile-ring'), false);
});

test('connection ring is driven by the live agentBridgeLink, not a boolean', () => {
  assert.match(SRC, /agentBridgeRingState\(agentBridgeLink\)/);
  assert.match(SRC, /data-agent-bridge-connection-ring=\{agentRing\}/);
  assert.equal(SRC.includes('showAgentRing'), false);
  assert.match(SRC, /useAgentBridgeHost\(\)/);
  assert.match(SRC, /offerSlot\(agentBridgeSlot\)/);
  assert.equal(SRC.includes('<AgentBridgePairing'), false);
});
