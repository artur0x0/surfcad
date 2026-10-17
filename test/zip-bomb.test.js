/**
 * 3MF zip-bomb guard: declared sizes, entry count, and ratio are checked
 * before inflating, and inflation is hard-capped even when headers lie.
 * Run via root `node --test` (CI).
 */
import assert from 'node:assert/strict';
import { deflateRawSync, createDeflateRaw } from 'node:zlib';
import { describe, test } from 'node:test';
import { performance } from 'node:perf_hooks';
import {
  MODEL_TOO_LARGE_ERROR,
  UNMEASURABLE_PART_ERROR,
  measureExportedPart,
} from '../backend/services/measurePart.js';
import { ZIP_LIMITS, ZipLimitError, inflateZipEntry, readZipDirectory } from '../backend/services/safeZip.js';

const CUBE_XML = `<model><mesh><vertices>
<vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="10" y="10" z="0"/><vertex x="0" y="10" z="0"/>
<vertex x="0" y="0" z="10"/><vertex x="10" y="0" z="10"/><vertex x="10" y="10" z="10"/><vertex x="0" y="10" z="10"/>
</vertices><triangles>
<triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="3" v3="2"/><triangle v1="4" v2="5" v3="6"/><triangle v1="4" v2="6" v3="7"/>
<triangle v1="0" v2="1" v3="5"/><triangle v1="0" v2="5" v3="4"/><triangle v1="3" v2="6" v3="2"/><triangle v1="3" v2="7" v3="6"/>
<triangle v1="0" v2="4" v3="7"/><triangle v1="0" v2="7" v3="3"/><triangle v1="1" v2="2" v3="6"/><triangle v1="1" v2="6" v3="5"/>
</triangles></mesh></model>`;

/**
 * Minimal zip writer. `size` overrides the declared uncompressed size so a
 * test can build a header that lies.
 * @param {{ name: string, data: Buffer, method?: number, size?: number, flags?: number }[]} files
 */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const method = file.method ?? 8;
    const body = method === 8 && !file.raw ? deflateRawSync(file.data) : file.data;
    const size = file.size ?? (file.raw ? file.rawSize : file.data.length);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(file.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(file.flags ?? 0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(size, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** Deflate `bytes` zeros without allocating them all at once. */
async function deflatedZeros(bytes) {
  const deflate = createDeflateRaw({ level: 9 });
  const out = [];
  deflate.on('data', (c) => out.push(c));
  const done = new Promise((resolve) => deflate.on('end', resolve));
  const chunk = Buffer.alloc(1024 * 1024);
  for (let left = bytes; left > 0; left -= chunk.length) {
    if (!deflate.write(left >= chunk.length ? chunk : chunk.subarray(0, left))) {
      await new Promise((resolve) => deflate.once('drain', resolve));
    }
  }
  deflate.end();
  await done;
  return Buffer.concat(out);
}

function payload(zip) {
  return { modelFile: { data: zip.toString('base64') } };
}

describe('safe 3MF unzip', () => {
  test('a normal 3MF still measures', async () => {
    const zip = buildZip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: '3D/3dmodel.model', data: Buffer.from(CUBE_XML) },
    ]);
    const out = await measureExportedPart(payload(zip));
    assert.equal(out.ok, true);
    assert.equal(Math.round(out.geometry.volume), 1000);
  });

  test('stored (method 0) entries work', async () => {
    const zip = buildZip([{ name: '3D/3dmodel.model', data: Buffer.from(CUBE_XML), method: 0 }]);
    const out = await measureExportedPart(payload(zip));
    assert.equal(out.ok, true);
  });

  test('honest 1 GB bomb is rejected from the directory, before inflating', async () => {
    const body = await deflatedZeros(1024 * 1024 * 1024);
    const zip = buildZip([{ name: '3D/3dmodel.model', data: body, raw: true, rawSize: 1024 * 1024 * 1024 }]);
    assert.ok(zip.length < 2 * 1024 * 1024, `bomb is ${zip.length} bytes`);
    const t0 = performance.now();
    const out = await measureExportedPart(payload(zip));
    const ms = performance.now() - t0;
    assert.equal(out.ok, false);
    assert.equal(out.status, 413);
    assert.equal(out.error, MODEL_TOO_LARGE_ERROR);
    assert.ok(ms < 500, `took ${ms} ms`);
  });

  test('ratio cap rejects a small-but-dense entry', () => {
    const size = 50 * 1024 * 1024;
    const zip = buildZip([{ name: 'a.model', data: Buffer.alloc(1000), raw: true, rawSize: size }]);
    assert.throws(() => readZipDirectory(zip), (err) => err instanceof ZipLimitError && err.status === 413 && /ratio/.test(err.message));
  });

  test('lying header: inflation stops at the declared size with bounded memory', async () => {
    const real = 256 * 1024 * 1024;
    const body = await deflatedZeros(real);
    const declared = 4096;
    const zip = buildZip([{ name: '3D/3dmodel.model', data: body, raw: true, rawSize: declared }]);
    const before = process.memoryUsage();
    const t0 = performance.now();
    const out = await measureExportedPart(payload(zip));
    const ms = performance.now() - t0;
    const after = process.memoryUsage();
    assert.equal(out.ok, false);
    assert.equal(out.status, 413);
    assert.ok(ms < 1000, `took ${ms} ms`);
    const grew = (after.rss - before.rss) + (after.arrayBuffers - before.arrayBuffers);
    assert.ok(grew < 64 * 1024 * 1024, `memory grew ${Math.round(grew / 1048576)} MB`);
  });

  test('lying header within the ratio cap is still hard-capped by maxEntryBytes', async () => {
    const limits = { ...ZIP_LIMITS, maxEntryBytes: 2 * 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 };
    const body = await deflatedZeros(64 * 1024 * 1024);
    const zip = buildZip([{ name: 'x.model', data: body, raw: true, rawSize: 2 * 1024 * 1024 }]);
    const [entry] = readZipDirectory(zip, limits);
    await assert.rejects(inflateZipEntry(zip, entry, limits), (err) => err.status === 413);
  });

  test('too many entries is 413', () => {
    const files = Array.from({ length: ZIP_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `f${i}`, data: Buffer.from('x') }));
    assert.throws(() => readZipDirectory(buildZip(files)), (err) => err.status === 413);
  });

  test('declared total across entries is capped', () => {
    const each = 40 * 1024 * 1024;
    const files = [0, 1, 2].map((i) => ({ name: `p${i}.model`, data: Buffer.alloc(each / 50), raw: true, rawSize: each }));
    assert.throws(() => readZipDirectory(buildZip(files)), (err) => err.status === 413 && /size limit/.test(err.message));
  });

  test('encrypted, garbage, and corrupt inputs are a clean 400-class rejection', async () => {
    const enc = buildZip([{ name: '3D/3dmodel.model', data: Buffer.from(CUBE_XML), flags: 1 }]);
    const garbage = Buffer.from('not a zip at all, just text padding the buffer');
    const corrupt = buildZip([{ name: '3D/3dmodel.model', data: Buffer.from('zzzzzzzzzzzz'), raw: true, rawSize: 100 }]);
    for (const zip of [enc, garbage, corrupt]) {
      const out = await measureExportedPart(payload(zip));
      assert.equal(out.ok, false);
      assert.equal(out.status, undefined);
      assert.equal(out.error, UNMEASURABLE_PART_ERROR);
    }
  });
});
