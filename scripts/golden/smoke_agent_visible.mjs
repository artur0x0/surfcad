#!/usr/bin/env node
/**
 * Visible agent mode: same CAD end state as headless after a short command script.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findChrome,
  installApiMocks,
  launchBrowser,
  startPreviewServer,
  waitForServer,
} from '../playtest/lib/harness.mjs';

const PORT = Number(process.env.SMOKE_PORT || 4176);
const BOX = `// @surf-id smoke-visible
part = makeBox(20, 20, 20);
`;

const USER = 'user-smoke-visible';
const ASSEMBLY = {
  name: 'VisibleHarness',
  activeId: 'local:part1',
  parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
  source: 'local',
};
const PARTS = [{ id: 'local:part1', script: BOX }];

const exe = findChrome();
if (!exe) {
  console.log('agent visible golden: no Chrome — skip');
  process.exit(0);
}

if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.error('  ❌ dist/ missing — run `npm run build`');
  process.exit(1);
}

const { stop } = startPreviewServer(PORT);
let browser;
try {
  if (!(await waitForServer(`http://127.0.0.1:${PORT}/`))) {
    throw new Error('preview did not start');
  }
  browser = await launchBrowser(exe);

  const headlessPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await installApiMocks(headlessPage);
  const headlessUrl = `http://127.0.0.1:${PORT}/?agent=1`;
  await headlessPage.goto(new URL(headlessUrl).origin + '/', { waitUntil: 'domcontentloaded' });
  const { seedAssembly, waitForBridge, agentCall: call } = await import('../playtest/lib/harness.mjs');
  await seedAssembly(headlessPage, { userId: USER, assembly: ASSEMBLY, parts: PARTS });
  await headlessPage.goto(headlessUrl, { waitUntil: 'domcontentloaded' });
  await waitForBridge(headlessPage);
  await call(headlessPage, 'set_script', { source: BOX });
  await call(headlessPage, 'invoke_helper', { id: 'cube', params: { width: 12, depth: 12, height: 12 } });
  await call(headlessPage, 'camera_set', { view: 'top' });
  await call(headlessPage, 'run', {});
  const headStatus = await call(headlessPage, 'status', {});
  const headTree = await call(headlessPage, 'feature_tree', {});
  await headlessPage.close();

  const visiblePage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await installApiMocks(visiblePage);
  await visiblePage.goto(new URL(headlessUrl).origin + '/', { waitUntil: 'domcontentloaded' });
  await seedAssembly(visiblePage, { userId: USER, assembly: ASSEMBLY, parts: PARTS });
  const visibleUrl = `http://127.0.0.1:${PORT}/?agent=1&visible=1&visibleDelay=40`;
  await visiblePage.goto(visibleUrl, { waitUntil: 'domcontentloaded' });
  await waitForBridge(visiblePage);
  const layer = await visiblePage.$('[data-agent-visible-layer]');
  assert.ok(layer, 'visible layer mounts when ?visible=1');
  await call(visiblePage, 'set_script', { source: BOX });
  await call(visiblePage, 'invoke_helper', { id: 'cube', params: { width: 12, depth: 12, height: 12 } });
  await call(visiblePage, 'camera_set', { view: 'top' });
  await call(visiblePage, 'run', {});
  const visStatus = await call(visiblePage, 'status', {});
  const visTree = await call(visiblePage, 'feature_tree', {});
  await visiblePage.close();

  assert.equal(headStatus.ok, true);
  assert.equal(visStatus.ok, true);
  assert.equal(headStatus.result?.featureCount, visStatus.result?.featureCount);
  assert.deepEqual(
    headTree.result?.features?.map((f) => f.id),
    visTree.result?.features?.map((f) => f.id),
  );

  const outDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'agent-visible');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'visible-parity.json'), JSON.stringify({
    headless: headStatus.result,
    visible: visStatus.result,
  }, null, 2));

  console.log('agent visible golden: ok — headless and visible end states match');
} finally {
  if (browser) await browser.close();
  stop();
}
