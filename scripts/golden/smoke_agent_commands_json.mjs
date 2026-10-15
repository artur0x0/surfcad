/**
 * Fails when src/agent/commands.json is stale or arg schemas are incomplete.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const testFile = join(root, 'src/agent/commandsExport.test.js');

const run = spawnSync(process.execPath, ['--test', testFile], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'pipe',
});

if (run.status !== 0) {
  console.error(run.stdout);
  console.error(run.stderr);
  process.exit(run.status || 1);
}
console.log('agent commands.json: ok');
