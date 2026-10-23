import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  feaFileTimeoutMs,
  isFeaSuite,
  runNode,
  suiteLabel,
  timeoutMessage,
  topLevelAwaitLine,
} from '../scripts/ci/run-unit-tests.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a top-level await is named and an indented one is not', () => {
  assert.equal(topLevelAwaitLine('await init();\n'), 1);
  assert.equal(topLevelAwaitLine('const bytes = await readFile(url);\n'), 1);
  assert.equal(topLevelAwaitLine('export const bytes = await readFile(url);\n'), 1);
  const nested = 'before(async () => {\n  await init();\n});\n';
  assert.equal(topLevelAwaitLine(nested), 0);
});

test('the kill message names the FEA suite', () => {
  const message = timeoutMessage('src/fea/sheetMetallica.test.js', 180_000);
  assert.match(message, /FEA suite timed out after 180s: src\/fea\/sheetMetallica\.test\.js/);
  assert.match(message, /outside the per-test timeout/);
  assert.equal(
    suiteLabel(join(root, 'src/fea/sheetMetallica.test.js')),
    'src/fea/sheetMetallica.test.js',
  );
});

test('FEA files are the ones under src/fea and the long suites have a longer kill', () => {
  assert.equal(isFeaSuite(join(root, 'src/fea/sheetMetallica.test.js')), true);
  assert.equal(isFeaSuite(join(root, 'src/utils/displayUnit.test.js')), false);
  // Two coarse fTetWild meshes and the shell solves: about a minute, with
  // room for a slow runner. The fine tet comparison is a committed reference.
  assert.ok(feaFileTimeoutMs(join(root, 'src/fea/sheetMetallica.test.js')) >= 6 * 60 * 1000);
  assert.ok(feaFileTimeoutMs(join(root, 'src/fea/sheetMetallica.test.js')) <= 8 * 60 * 1000);
  assert.ok(feaFileTimeoutMs(join(root, 'src/fea/colormap.test.js')) < 6 * 60 * 1000);
});

test('a process that never exits is killed', async () => {
  const code = await runNode(
    ['-e', 'setInterval(() => {}, 1e6)'],
    { timeoutMs: 400, label: 'src/fea/watchdog-probe.test.js' },
  );
  assert.equal(code, 1);
});
