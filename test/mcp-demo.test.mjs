/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { withViteDistLock } from './lib/viteDistLock.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = join(ROOT, 'scripts/demo/mcp-demo.mjs');

/** Same gate as smoke goldens: only run when CI installs Chrome explicitly. */
const chromePath = process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
  ? process.env.CHROME_PATH
  : null;

test('demo:mcp playtest (headless)', { skip: !chromePath }, async () => {
  await withViteDistLock(async () => {
    const playtestBuild = spawnSync('npm', ['run', 'build:playtest'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.equal(playtestBuild.status, 0, playtestBuild.stderr || playtestBuild.stdout);

    const result = spawnSync(process.execPath, [DEMO], {
      cwd: ROOT,
      env: {
        ...process.env,
        SURFCAD_PLAYTEST: '1',
        CHROME_PATH: chromePath,
      },
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const out = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (result.status !== 0) {
      console.error(out);
    }
    assert.equal(result.status, 0, out);
    assert.match(out, /demo:mcp: ok/);
  });
});
