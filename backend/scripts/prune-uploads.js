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
  if (!trimmed || trimmed === 'undefined') {
    throw new Error(
      trimmed === 'undefined'
        ? 'UPLOAD_FOLDER is the literal string "undefined" (the environment variable is unset). Refusing to prune.'
        : 'Upload folder path is empty',
    );
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

/**
 * Multer dest names are 32 hex chars. Converter leftovers are
 * `conv_<sanitized>_<timestamp>.obj` (see routes/convert.js).
 */
export const KNOWN_UPLOAD_NAME = /^(?:[a-f0-9]{32}|conv_[A-Za-z0-9_-]+_\d+\.obj)$/;

export function isKnownUploadName(name) {
  return KNOWN_UPLOAD_NAME.test(name);
}

/**
 * Refuse when upload is WORKING_FOLDER or a parent of it (would delete obj_converter).
 */
export function assertUploadAwayFromWorking(uploadDir, workingDir, { required = false } = {}) {
  const workRaw = String(workingDir ?? '').trim();
  if (!workRaw || workRaw === 'undefined') {
    if (required) {
      throw new Error(
        'WORKING_FOLDER is required in production so prune can refuse a folder that holds obj_converter',
      );
    }
    return assertSafeUploadDir(uploadDir);
  }
  const upload = assertSafeUploadDir(uploadDir);
  const work = path.normalize(path.resolve(workRaw));
  if (upload === work) {
    throw new Error('Refusing to prune: UPLOAD_FOLDER is the same path as WORKING_FOLDER');
  }
  if (isPathInside(upload, work)) {
    throw new Error('Refusing to prune: UPLOAD_FOLDER is a parent of WORKING_FOLDER');
  }
  return upload;
}

/**
 * Resolve and check the folder we will prune.
 * @param {string | null | undefined} uploadFolder
 * @param {{ production?: boolean, workingFolder?: string }} [opts]
 */
export function requireUploadFolder(uploadFolder, { production = false, workingFolder } = {}) {
  const raw = String(uploadFolder ?? '').trim();
  if (!raw || raw === 'undefined') {
    throw new Error(
      production
        ? 'UPLOAD_FOLDER is required in production. Set it in the backend environment; an unset value becomes the path "undefined" and must never be pruned.'
        : 'UPLOAD_FOLDER is not configured (use --dir for an explicit path)',
    );
  }
  const dir = assertSafeUploadDir(raw);
  assertUploadAwayFromWorking(dir, workingFolder, { required: production });
  return dir;
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

    if (!isKnownUploadName(entry.name)) {
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

export async function resolveUploadDir(cliDir, loadConfig = () => import('../config/index.js')) {
  const production = process.env.NODE_ENV === 'production';
  if (cliDir) {
    const config = production ? (await loadConfig()).default : { workingFolder: process.env.WORKING_FOLDER };
    return requireUploadFolder(cliDir, {
      production,
      workingFolder: config.workingFolder || process.env.WORKING_FOLDER,
    });
  }
  const config = (await loadConfig()).default;
  return requireUploadFolder(config.uploadFolder, {
    production: production || config.env === 'production',
    workingFolder: config.workingFolder,
  });
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
