#!/usr/bin/env node
/**
 * Unit tests for CI.
 *
 * Non-FEA files stay in one `node --test` process. Each FEA file runs in its
 * own process, one at a time, with `--test-timeout` and a wall-clock kill.
 * A top-level hang (wasm init, Manifold, a blocked event loop) never enters
 * a test, so the per-test timeout does not fire. The kill prints the suite
 * path instead of waiting for the job limit. Serial FEA runs also keep the
 * heavy wasm suites off each other's cores: the hung CI attempt overlapped
 * fTetWild and the rotated-bar solve.
 *
 * Patterns match the previous CI step. `scripts/golden/*playtest*` is not
 * included. `backend/test` is not included.
 */
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Node applies `--test-timeout` to the file as well as to tests that do not
 * set their own. It has to cover the whole file: sheet metallica's tet
 * comparison alone is allowed 240s, and one local run passed 180s while that
 * test was still going. The external kill is this long plus a grace period,
 * so a blocked event loop (which never services the test timeout) still dies
 * and names the suite.
 */
const FEA_FILE_TIMEOUT_MS = {
  'src/fea/sheetMetallica.test.js': 12 * 60 * 1000,
  'src/fea/solveSolid.test.js': 8 * 60 * 1000,
  'src/fea/meshVolume.test.js': 6 * 60 * 1000,
  'src/fea/partTransform.test.js': 6 * 60 * 1000,
  'src/fea/meshCache.test.js': 5 * 60 * 1000,
};
const DEFAULT_FEA_FILE_TIMEOUT_MS = 4 * 60 * 1000;
const KILL_GRACE_MS = 30_000;

function rel(file) {
  return relative(ROOT, file).split('\\').join('/');
}

async function walk(dir, predicate, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return out;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, predicate, out);
    else if (predicate(entry.name)) out.push(full);
  }
  return out;
}

export async function collectUnitFiles() {
  const src = await walk(
    join(ROOT, 'src'),
    (name) => /\.test\.(js|mjs|cjs)$/.test(name),
    [],
  );
  const test = await walk(
    join(ROOT, 'test'),
    (name) => /\.(js|mjs|cjs)$/.test(name),
    [],
  );
  const tests = await walk(
    join(ROOT, 'tests'),
    (name) => /\.(js|mjs|cjs)$/.test(name),
    [],
  );
  const surfcadMcp = await walk(
    join(ROOT, 'packages/surfcad-mcp/test'),
    (name) => /\.test\.(js|mjs|cjs)$/.test(name),
    [],
  );
  return [...src, ...test, ...tests, ...surfcadMcp].sort();
}

export function isFeaSuite(file) {
  const name = rel(file);
  return name === 'src/fea' || name.startsWith('src/fea/');
}

export function feaFileTimeoutMs(file) {
  return FEA_FILE_TIMEOUT_MS[rel(file)] ?? DEFAULT_FEA_FILE_TIMEOUT_MS;
}

/**
 * A top-level await is not indented. Nested `await` inside a function is.
 * @returns {number} 1-based line, or 0
 */
export function topLevelAwaitLine(source) {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^(?:export\s+)?await\s/.test(line)) return i + 1;
    if (/^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*await\s/.test(line)) return i + 1;
  }
  return 0;
}

export function suiteLabel(file) {
  const text = String(file);
  if (text.startsWith(`${ROOT}/`) || text.startsWith(ROOT + '\\')) return rel(text);
  return text.split('\\').join('/');
}

export function timeoutMessage(file, timeoutMs) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return [
    `FEA suite timed out after ${seconds}s: ${suiteLabel(file)}`,
    'The process was still running, so this hang is outside the per-test timeout',
    '(module or suite setup, or a blocked event loop). Killing the suite.',
  ].join('\n');
}

export function runNode(args, { timeoutMs = 0, label = '' } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    let killed = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        killed = true;
        console.error(`\n${timeoutMessage(label, timeoutMs)}`);
        child.kill('SIGKILL');
      }, timeoutMs)
      : null;
    child.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      if (killed) {
        resolvePromise(1);
        return;
      }
      if (code === 0) resolvePromise(0);
      else resolvePromise(code === null ? 1 : code);
    });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      console.error(error);
      resolvePromise(1);
    });
  });
}

async function rejectTopLevelAwaits(feaFiles) {
  const hits = [];
  for (const file of feaFiles) {
    const line = topLevelAwaitLine(await readFile(file, 'utf8'));
    if (line) hits.push(`${rel(file)}:${line}`);
  }
  if (hits.length) {
    console.error('FEA test files must not await at top level. Move setup into before() or test():');
    for (const hit of hits) console.error(`  ${hit}`);
    return 1;
  }
  return 0;
}

export async function main() {
  const files = await collectUnitFiles();
  const fea = files.filter((file) => isFeaSuite(file));
  const rest = files.filter((file) => !isFeaSuite(file));
  const guard = await rejectTopLevelAwaits(fea);
  if (guard !== 0) return guard;

  if (rest.length) {
    const code = await runNode(['--test', '--test-reporter', 'spec', ...rest]);
    if (code !== 0) return code;
  }

  for (const file of fea) {
    const timeoutMs = feaFileTimeoutMs(file);
    const killMs = timeoutMs + KILL_GRACE_MS;
    const seconds = Math.round(killMs / 1000);
    console.log(`\n--- FEA suite ${rel(file)} (kill after ${seconds}s) ---`);
    const code = await runNode([
      '--test',
      '--test-reporter', 'spec',
      '--test-timeout', String(timeoutMs),
      '--test-force-exit',
      file,
    ], { timeoutMs: killMs, label: file });
    if (code !== 0) return code;
  }
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
