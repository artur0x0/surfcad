/**
 * Bounded ZIP reader for uploaded 3MF files. The central directory is read
 * and checked (entry count, declared sizes, compression ratio) before any
 * byte is inflated, and inflation streams with a hard byte cap so a header
 * that lies about its size still cannot allocate past the limit.
 * ZIP64, encryption, and methods other than stored/deflate are refused.
 */
import { createInflateRaw } from 'node:zlib';

export const ZIP_LIMITS = Object.freeze({
  maxEntries: 64,
  maxEntryBytes: 80 * 1024 * 1024,
  maxTotalBytes: 96 * 1024 * 1024,
  maxRatio: 100,
  ratioFloorBytes: 1024 * 1024,
});

export class ZipLimitError extends Error {
  /** @param {string} message @param {number} status 413 for size limits, 400 for malformed input */
  constructor(message, status = 400) {
    super(message);
    this.name = 'ZipLimitError';
    this.status = status;
  }
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const EOCD_MIN = 22;

function findEocd(buf) {
  const stop = Math.max(0, buf.length - EOCD_MIN - 0xffff);
  for (let i = buf.length - EOCD_MIN; i >= stop; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipLimitError('Not a zip file');
}

/**
 * @param {Buffer} buf
 * @returns {{ name: string, method: number, flags: number, compressedSize: number, uncompressedSize: number, localOffset: number }[]}
 */
export function readZipDirectory(buf, limits = ZIP_LIMITS) {
  if (!Buffer.isBuffer(buf) || buf.length < EOCD_MIN) throw new ZipLimitError('Not a zip file');
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipLimitError('ZIP64 archives are not supported');
  }
  if (count > limits.maxEntries) {
    throw new ZipLimitError(`Too many files in archive (max ${limits.maxEntries})`, 413);
  }
  if (cdOffset + cdSize > eocd) throw new ZipLimitError('Corrupt zip directory');

  const entries = [];
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CEN_SIG) throw new ZipLimitError('Corrupt zip directory');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > eocd) throw new ZipLimitError('Corrupt zip directory');
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipLimitError('ZIP64 archives are not supported');
    }
    if (flags & 0x1) throw new ZipLimitError('Encrypted archives are not supported');
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new ZipLimitError('A file in the archive is too large', 413);
    }
    total += uncompressedSize;
    if (total > limits.maxTotalBytes) {
      throw new ZipLimitError('Archive expands past the size limit', 413);
    }
    if (uncompressedSize > limits.ratioFloorBytes
      && uncompressedSize / Math.max(1, compressedSize) > limits.maxRatio) {
      throw new ZipLimitError('Archive compression ratio is too high', 413);
    }
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localOffset });
  }
  return entries;
}

function entryData(buf, entry) {
  const off = entry.localOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== LOC_SIG) {
    throw new ZipLimitError('Corrupt zip entry');
  }
  const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new ZipLimitError('Corrupt zip entry');
  return buf.subarray(start, end);
}

/**
 * Inflate one entry. Output never exceeds the entry's declared size or
 * limits.maxEntryBytes, whichever is smaller.
 * @returns {Promise<Buffer>}
 */
export function inflateZipEntry(buf, entry, limits = ZIP_LIMITS) {
  const cap = Math.min(entry.uncompressedSize, limits.maxEntryBytes);
  const data = entryData(buf, entry);
  if (entry.method === 0) {
    if (data.length > cap) return Promise.reject(new ZipLimitError('A file in the archive is too large', 413));
    return Promise.resolve(Buffer.from(data));
  }
  if (entry.method !== 8) {
    return Promise.reject(new ZipLimitError(`Unsupported zip compression method ${entry.method}`));
  }
  return new Promise((resolve, reject) => {
    const inflate = createInflateRaw({ chunkSize: 64 * 1024 });
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (err) => {
      if (done) return;
      done = true;
      chunks.length = 0;
      inflate.destroy();
      reject(err);
    };
    inflate.on('data', (chunk) => {
      size += chunk.length;
      if (size > cap) {
        fail(new ZipLimitError('A file in the archive expands past its declared size', 413));
        return;
      }
      chunks.push(chunk);
    });
    inflate.on('error', () => fail(new ZipLimitError('Corrupt compressed data')));
    inflate.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks, size));
    });
    inflate.end(data);
  });
}
