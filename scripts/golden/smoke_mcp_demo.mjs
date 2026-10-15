#!/usr/bin/env node
/**
 * CI: npm run demo:mcp in playtest auto-approve mode.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DEMO = join(ROOT, 'scripts/demo/mcp-demo.mjs');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('mcp demo golden: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (!existsSync(join(ROOT, 'dist/index.html'))) {
  console.log('  ❌ dist/ missing — run `npm run build` first');
  process.exit(1);
}

const result = spawnSync(process.execPath, [DEMO], {
  cwd: ROOT,
  env: {
    ...process.env,
    CHROME_PATH: exe,
    SURFCAD_PLAYTEST: '1',
  },
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.log(`mcp demo golden: failed (exit ${result.status})`);
  process.exit(result.status ?? 1);
}
console.log('mcp demo golden: ok');
