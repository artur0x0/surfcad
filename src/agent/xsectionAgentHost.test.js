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
    clearAgentSnap() {},
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

test('crossSectionPlane waits for applied gen, not the optimistic snap', async () => {
  const enabledRef = { current: true };
  let planeType = 'XY';
  let appliedGen = 0;
  let applied = { normal: [0, 0, 1], originOffset: 0, gen: 0 };
  const panel = {
    readAgentState: () => ({
      enabled: true,
      optionsOpen: true,
      preset: 'XZ',
      plane: 'XZ',
      normal: [0, 1, 0],
      offset: 0,
      originOffset: 0,
    }),
    agentSetPreset(preset) {
      planeType = preset;
      setTimeout(() => {
        appliedGen += 1;
        applied = { normal: [0, 1, 0], originOffset: 0, gen: appliedGen };
      }, 40);
    },
    clearAgentSnap() {},
  };
  const host = createXsectionAgentHandlers({
    panelRef: { current: panel },
    enabledRef,
    getMesh: () => ({ geometry: {} }),
    getAppliedPlane: () => applied,
    getAppliedGen: () => appliedGen,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    settleMs: 200,
    applyMs: 300,
    pollMs: 10,
  });
  const out = await host.crossSectionPlane({ plane: 'XZ' });
  assert.equal(out.result?.preset, 'XZ');
  assert.deepEqual(out.result?.normal, [0, 1, 0]);
  assert.ok(out.result?.appliedGen > 0);
  assert.equal(planeType, 'XZ');
});

test('crossSectionOffset returns the applied offset, not a stale clamp', async () => {
  const enabledRef = { current: true };
  let appliedGen = 1;
  let applied = { normal: [0, 0, 1], originOffset: 0, gen: 1 };
  const panel = {
    readAgentState: () => ({
      enabled: true,
      optionsOpen: true,
      preset: 'XY',
      plane: 'XY',
      normal: [0, 0, 1],
      offset: applied.originOffset,
      originOffset: applied.originOffset,
      offsetMin: -10,
      offsetMax: 10,
    }),
    agentSetOffset(value) {
      setTimeout(() => {
        appliedGen += 1;
        applied = { normal: [0, 0, 1], originOffset: value, gen: appliedGen };
      }, 30);
    },
    clearAgentSnap() {},
  };
  const host = createXsectionAgentHandlers({
    panelRef: { current: panel },
    enabledRef,
    getMesh: () => ({ geometry: {} }),
    getAppliedPlane: () => applied,
    getAppliedGen: () => appliedGen,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    applyMs: 300,
    pollMs: 10,
  });
  const out = await host.crossSectionOffset({ offset: 4 });
  assert.equal(out.result?.offset, 4);
  assert.equal(out.result?.originOffset, 4);
  assert.equal(out.result?.appliedGen, 2);
});
