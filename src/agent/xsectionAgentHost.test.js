import test from 'node:test';
import assert from 'node:assert/strict';
import { createXsectionAgentHandlers } from './xsectionAgentHost.js';

test('crossSectionExpand waits until optionsOpen settles', async () => {
  const enabledRef = { current: true };
  let optionsOpen = false;
  const panel = {
    readAgentState: () => ({ enabled: true, optionsOpen }),
    agentSetOptionsOpen(open) {
      setTimeout(() => { optionsOpen = open; }, 30);
      return true;
    },
  };
  const host = createXsectionAgentHandlers({
    panelRef: { current: panel },
    enabledRef,
    getMesh: () => ({ geometry: {} }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    settleMs: 200,
    pollMs: 10,
  });
  const out = await host.crossSectionExpand({ open: true });
  assert.equal(out.result?.optionsOpen, true);
});
