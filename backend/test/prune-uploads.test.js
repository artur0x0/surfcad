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
  assertUploadAwayFromWorking,
  isKnownUploadName,
  pruneUploadFolder,
  requireUploadFolder,
} from '../scripts/prune-uploads.js';

const MULTER_OLD = 'a'.repeat(32);
const MULTER_NEW = 'b'.repeat(32);
const CONV_OLD = 'conv_part_1000000000000.obj';

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

  test('refuses the literal string undefined', () => {
    assert.throws(() => assertSafeUploadDir('undefined'), /literal string "undefined"/);
  });
});

describe('requireUploadFolder / working folder', () => {
  test('refuses a missing UPLOAD_FOLDER in production', () => {
    assert.throws(
      () => requireUploadFolder(undefined, { production: true, workingFolder: '/tmp/work' }),
      /UPLOAD_FOLDER is required in production/,
    );
    assert.throws(
      () => requireUploadFolder('undefined', { production: true, workingFolder: '/tmp/work' }),
      /required in production|literal string/,
    );
  });

  test('refuses when upload equals working', async () => {
    const dir = await makeTempDir();
    assert.throws(
      () => assertUploadAwayFromWorking(dir, dir),
      /same path as WORKING_FOLDER/,
    );
  });

  test('refuses when upload is a parent of working', async () => {
    const parent = await makeTempDir();
    const child = path.join(parent, 'converter');
    await fs.mkdir(child);
    assert.throws(
      () => assertUploadAwayFromWorking(parent, child),
      /parent of WORKING_FOLDER/,
    );
  });

  test('allows a sibling of working', async () => {
    const root = await makeTempDir();
    const upload = path.join(root, 'uploads');
    const work = path.join(root, 'converter');
    await fs.mkdir(upload);
    await fs.mkdir(work);
    assert.equal(requireUploadFolder(upload, { production: true, workingFolder: work }), path.resolve(upload));
  });

  test('production prune requires WORKING_FOLDER', () => {
    assert.throws(
      () => requireUploadFolder('/tmp/uploads-only', { production: true, workingFolder: '' }),
      /WORKING_FOLDER is required in production/,
    );
  });
});

describe('known upload names', () => {
  test('accepts multer hex and converter obj names', () => {
    assert.equal(isKnownUploadName(MULTER_OLD), true);
    assert.equal(isKnownUploadName(CONV_OLD), true);
    assert.equal(isKnownUploadName('obj_converter'), false);
    assert.equal(isKnownUploadName('notes.txt'), false);
    assert.equal(isKnownUploadName('stale.obj'), false);
  });
});

describe('pruneUploadFolder', () => {
  test('deletes only known leftover names older than max age', async () => {
    const dir = await makeTempDir();
    const oldFile = path.join(dir, MULTER_OLD);
    const newFile = path.join(dir, MULTER_NEW);
    const converter = path.join(dir, 'obj_converter');
    await touchOld(oldFile, 25);
    await touchOld(newFile, 1);
    await touchOld(converter, 48);

    const result = await pruneUploadFolder(dir, { maxAgeHours: 24, dryRun: false });

    assert.equal(result.deleted, 1);
    assert.ok(result.bytesFreed >= 1);
    await assert.rejects(() => fs.access(oldFile));
    await fs.access(newFile);
    await fs.access(converter);
  });

  test('dry-run deletes nothing', async () => {
    const dir = await makeTempDir();
    const oldFile = path.join(dir, CONV_OLD);
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
    const nestedFile = path.join(sub, MULTER_OLD);
    await touchOld(nestedFile, 48);

    const result = await pruneUploadFolder(dir, { maxAgeHours: 24, dryRun: false });

    assert.equal(result.deleted, 0);
    await fs.access(nestedFile);
  });
});
