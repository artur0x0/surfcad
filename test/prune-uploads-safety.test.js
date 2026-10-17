/**
 * Upload-prune safety (M5). Runs in root CI (`node --test`).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  assertUploadAwayFromWorking,
  isKnownUploadName,
  pruneUploadFolder,
  requireUploadFolder,
} from '../backend/scripts/prune-uploads.js';

const HEX = '0123456789abcdef0123456789abcdef';

async function touchOld(filePath, ageHours) {
  await fs.writeFile(filePath, 'leftover');
  const at = new Date(Date.now() - ageHours * 60 * 60 * 1000);
  await fs.utimes(filePath, at, at);
}

describe('M5 prune safety', () => {
  test('missing UPLOAD_FOLDER is refused (production message)', () => {
    assert.throws(
      () => requireUploadFolder(undefined, { production: true, workingFolder: '/opt/work' }),
      /UPLOAD_FOLDER is required in production/,
    );
    assert.throws(
      () => requireUploadFolder('undefined', { production: true, workingFolder: '/opt/work' }),
      /required in production|literal string "undefined"/,
    );
  });

  test('refuses equal folders and a parent of WORKING_FOLDER', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'surfcad-work-'));
    const child = path.join(parent, 'converter');
    await fs.mkdir(child);
    assert.throws(() => assertUploadAwayFromWorking(parent, parent), /same path/);
    assert.throws(() => assertUploadAwayFromWorking(parent, child), /parent of WORKING_FOLDER/);
  });

  test('deletes only known upload names', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'surfcad-uploads-'));
    const keepBin = path.join(dir, 'obj_converter');
    const keepTxt = path.join(dir, 'notes.txt');
    const drop = path.join(dir, HEX);
    await touchOld(keepBin, 48);
    await touchOld(keepTxt, 48);
    await touchOld(drop, 48);
    const result = await pruneUploadFolder(dir, { maxAgeHours: 24 });
    assert.equal(result.deleted, 1);
    await fs.access(keepBin);
    await fs.access(keepTxt);
    await assert.rejects(() => fs.access(drop));
    assert.equal(isKnownUploadName(HEX), true);
    assert.equal(isKnownUploadName('obj_converter'), false);
  });
});
