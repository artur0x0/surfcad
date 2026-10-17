#!/usr/bin/env node
/**
 * Safety-net prune for multer upload leftovers (crash / kill -9).
 * Normal requests delete input/output in convert.js finally blocks.
 *
 * Usage:
 *   node scripts/prune-uploads.js [--dir PATH] [--max-age-hours N] [--dry-run]
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const opts = {
    dir: null,
    maxAgeHours: 24,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--dir') {
      opts.dir = argv[i + 1];
      i += 1;
    } else if (arg === '--max-age-hours') {
      const n = Number(argv[i + 1]);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error('--max-age-hours must be a non-negative number');
      }
      opts.maxAgeHours = n;
      i += 1;
    } else if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

export function assertSafeUploadDir(dirPath) {
  const trimmed = String(dirPath ?? '').trim();
  if (!trimmed) {
    throw new Error('Upload folder path is empty');
  }
  const resolved = path.resolve(trimmed);
  const normalized = path.normalize(resolved);
  if (normalized === path.sep || normalized === '/') {
    throw new Error('Refusing to prune the filesystem root');
  }
  const home = path.resolve(os.homedir());
  if (normalized === home) {
    throw new Error('Refusing to prune the home directory');
  }
  return normalized;
}

function isPathInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * @returns {Promise<{ deleted: number, bytesFreed: number, dryRunListed: string[] }>}
 */
export async function pruneUploadFolder(uploadDir, { maxAgeHours = 24, dryRun = false } = {}) {
  const dir = assertSafeUploadDir(uploadDir);
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAgeMs;

  let deleted = 0;
  let bytesFreed = 0;
  const dryRunListed = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { deleted: 0, bytesFreed: 0, dryRunListed: [] };
    }
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    let stat;
    try {
      stat = await fs.lstat(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      continue;
    }

    if (stat.isSymbolicLink()) {
      let target;
      try {
        target = await fs.realpath(fullPath);
      } catch {
        continue;
      }
      if (!isPathInside(dir, target)) {
        continue;
      }
      // Symlink whose target stays inside the folder is still not a regular file.
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    if (stat.mtimeMs > cutoff) {
      continue;
    }

    if (dryRun) {
      dryRunListed.push(fullPath);
      continue;
    }

    await fs.unlink(fullPath);
    deleted += 1;
    bytesFreed += stat.size;
  }

  return { deleted, bytesFreed, dryRunListed };
}

async function resolveUploadDir(cliDir) {
  if (cliDir) {
    return assertSafeUploadDir(cliDir);
  }
  const config = (await import('../config/index.js')).default;
  if (!config.uploadFolder) {
    throw new Error('UPLOAD_FOLDER is not configured (use --dir for a explicit path)');
  }
  return assertSafeUploadDir(config.uploadFolder);
}

function printHelp() {
  console.log(`Usage: node scripts/prune-uploads.js [options]

Options:
  --dir PATH            Upload folder (default: config.uploadFolder / UPLOAD_FOLDER)
  --max-age-hours N     Delete regular files older than N hours (default: 24)
  --dry-run             List files that would be deleted; do not delete
  -h, --help            Show this help
`);
}

export async function main(argv = process.argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  const uploadDir = await resolveUploadDir(opts.dir);
  const result = await pruneUploadFolder(uploadDir, {
    maxAgeHours: opts.maxAgeHours,
    dryRun: opts.dryRun,
  });

  if (opts.dryRun) {
    for (const file of result.dryRunListed) {
      console.log(`would delete: ${file}`);
    }
    console.log(
      `dry-run: ${result.dryRunListed.length} file(s) would be removed from ${uploadDir}`,
    );
    return 0;
  }

  console.log(
    `pruned ${result.deleted} file(s), freed ${result.bytesFreed} byte(s) from ${uploadDir}`,
  );
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
