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

  assert.match(pairing, /<AgentBridgeDisconnectMenuItem onDisconnect=\{disconnectPairing\} \/>/);
});
