import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importJsx } from '../../test/jsxTestModule.js';

const pairing = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'AgentBridgePairing.jsx'),
  'utf8',
);

test('profile Disconnect renders the unplug icon and still disconnects', async () => {
  const { default: AgentBridgeDisconnectMenuItem } = await importJsx(
    new URL('./AgentBridgeDisconnectMenuItem.jsx', import.meta.url),
  );
  const calls = [];
  const node = AgentBridgeDisconnectMenuItem({
    onDisconnect: () => calls.push('disconnect'),
  });
  node.props.onClick();
  assert.deepEqual(calls, ['disconnect']);

  const html = renderToStaticMarkup(React.createElement(AgentBridgeDisconnectMenuItem, {
    onDisconnect: () => {},
  }));
  assert.match(html, /class="lucide lucide-unplug"/);
  assert.match(html, /width="14"/);
  assert.match(html, /height="14"/);
  assert.match(html, /stroke-width="2"/);
  assert.match(html, /data-ui-action="data-agent-bridge-disconnect"/);
  assert.match(html, /data-agent-bridge-chip=""/);
  assert.match(html, />Disconnect</);
  assert.match(html, /gap-2/);

  assert.match(pairing, /<AgentBridgeDisconnectMenuItem onDisconnect=\{disconnectFromUser\} \/>/);
  assert.match(pairing, /data-agent-bridge-connected-toast/);
  assert.doesNotMatch(pairing, /data-agent-connected-banner|data-agent-connected-disconnect/);
  const viewport = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Viewport.jsx'), 'utf8');
  const partFeed = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PartFeed.jsx'), 'utf8');
  const chip = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ProfileChip.jsx'), 'utf8');
  assert.match(viewport, /<ProfileChip/);
  assert.match(partFeed, /<ProfileChip/);
  assert.match(chip, /offerSlot\(agentBridgeSlot\)/);
});
