#!/usr/bin/env node
/**
 * CI entry: full scripted agent playtest against vite preview (?agent=1).
 * Requires dist/ and CHROME_PATH (CI installs Chrome explicitly).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('agent playtest: no system Chrome found — set CHROME_PATH. Skipping.');
  process.exit(0);
}

if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  console.log('  ❌ dist/ missing — run `npm run build:playtest` first');
  process.exit(1);
}

const outDir = process.env.GOLDEN_SHOT_DIR || join(tmpdir(), 'agent-playtest');
const runPath = join(fileURLToPath(new URL('../playtest/run.mjs', import.meta.url)));

const result = spawnSync(process.execPath, [runPath], {
  env: {
    ...process.env,
    CHROME_PATH: exe,
    PLAYTEST_OUT: outDir,
    PLAYTEST_PORT: process.env.SMOKE_PORT || '4175',
  },
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.log(`agent playtest: failed (exit ${result.status})`);
  process.exit(result.status ?? 1);
}
console.log('agent playtest: ok');
