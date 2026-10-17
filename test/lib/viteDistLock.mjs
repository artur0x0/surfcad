/**
 * Serialize unit tests that rewrite `dist/` (production vs playtest builds).
 */
import { closeSync, constants, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCK = join(dirname(fileURLToPath(import.meta.url)), '../../dist/.unit-vite.lock');

export async function withViteDistLock(fn) {
  mkdirSync(dirname(LOCK), { recursive: true });
  const deadline = Date.now() + 180_000;
  let fd;
  for (;;) {
    try {
      fd = openSync(LOCK, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() > deadline) throw new Error('timed out waiting for vite dist lock');
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    return await fn();
  } finally {
    try { closeSync(fd); } catch { /* gone */ }
    try { unlinkSync(LOCK); } catch { /* gone */ }
  }
}
