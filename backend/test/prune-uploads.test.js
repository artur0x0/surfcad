/**
 * Run: cd backend && node --test test/prune-uploads.test.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  assertSafeUploadDir,
  pruneUploadFolder,
} from '../scripts/prune-uploads.js';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'surfcad-prune-'));
}

async function touchOld(filePath, ageHours) {
  await fs.writeFile(filePath, 'x');
  const at = new Date(Date.now() - ageHours * 60 * 60 * 1000);
  await fs.utimes(filePath, at, at);
}

describe('assertSafeUploadDir', () => {
  test('refuses filesystem root', () => {
    assert.throws(() => assertSafeUploadDir('/'), /filesystem root/);
  });

  test('refuses home directory', () => {
    assert.throws(() => assertSafeUploadDir(os.homedir()), /home directory/);
  });

  test('refuses empty path', () => {
    assert.throws(() => assertSafeUploadDir('   '), /empty/);
  });
});

describe('pruneUploadFolder', () => {
  test('deletes only files older than max age', async () => {
    const dir = await makeTempDir();
    const oldFile = path.join(dir, 'old.bin');
    const newFile = path.join(dir, 'new.bin');
    await touchOld(oldFile, 25);
    await touchOld(newFile, 1);

    const result = await pruneUploadFolder(dir, { maxAgeHours: 24, dryRun: false });

    assert.equal(result.deleted, 1);
    assert.ok(result.bytesFreed >= 1);
    await assert.rejects(() => fs.access(oldFile));
    await fs.access(newFile);
  });

  test('dry-run deletes nothing', async () => {
    const dir = await makeTempDir();
    const oldFile = path.join(dir, 'stale.obj');
    await touchOld(oldFile, 30);

    const result = await pruneUploadFolder(dir, { maxAgeHours: 24, dryRun: true });

    assert.equal(result.dryRunListed.length, 1);
    assert.equal(result.deleted, 0);
    await fs.access(oldFile);
  });

  test('skips subdirectories', async () => {
    const dir = await makeTempDir();
    const sub = path.join(dir, 'nested');
    await fs.mkdir(sub);
    const nestedFile = path.join(sub, 'old.txt');
    await touchOld(nestedFile, 48);

    const result = await pruneUploadFolder(dir, { maxAgeHours: 24, dryRun: false });

    assert.equal(result.deleted, 0);
    await fs.access(nestedFile);
  });
});
