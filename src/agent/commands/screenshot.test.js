import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { encodeCanvasImage, targetImageSize } from '../screenshotImage.js';

function fakeCanvas(width, height, log) {
  return {
    width,
    height,
    getContext() {
      return { drawImage() { log.push('draw'); } };
    },
    toDataURL(mime, quality) {
      log.push(['url', mime, quality, width, height]);
      return `data:${mime};base64,${width}x${height}`;
    },
  };
}

test('targetImageSize applies scale then max_width and does not upscale', () => {
  assert.deepEqual(targetImageSize(800, 600, {}), { width: 800, height: 600 });
  assert.deepEqual(targetImageSize(800, 600, { scale: 0.5 }), { width: 400, height: 300 });
  assert.deepEqual(targetImageSize(800, 600, { max_width: 400 }), { width: 400, height: 300 });
  assert.deepEqual(targetImageSize(800, 600, { scale: 0.5, max_width: 100 }), { width: 100, height: 75 });
  assert.deepEqual(targetImageSize(320, 200, { max_width: 800 }), { width: 320, height: 200 });
  assert.deepEqual(targetImageSize(800, 600, { scale: 1 }), { width: 800, height: 600 });
});

test('encodeCanvasImage keeps a full png on the source canvas and downscales jpeg', () => {
  const log = [];
  const source = fakeCanvas(800, 600, log);
  const png = encodeCanvasImage(source, {});
  assert.equal(png.dataUrl, 'data:image/png;base64,800x600');
  assert.equal(png.width, 800);
  assert.equal(png.format, 'png');
  assert.equal(log.some((row) => row === 'draw'), false);

  const created = [];
  const jpeg = encodeCanvasImage(source, { format: 'jpeg', max_width: 400, quality: 0.5 }, {
    createCanvas(width, height) {
      const canvas = fakeCanvas(width, height, log);
      created.push([width, height]);
      return canvas;
    },
  });
  assert.deepEqual(created, [[400, 300]]);
  assert.equal(jpeg.dataUrl, 'data:image/jpeg;base64,400x300');
  assert.equal(jpeg.width, 400);
  assert.equal(jpeg.height, 300);
  assert.equal(jpeg.format, 'jpeg');
});

function bridge(screenshot) {
  return createSurfcadBridge({
    getScript: () => '',
    screenshot,
  });
}

test('screenshot default stays a png data URL and forwards resize options', async () => {
  let seen = null;
  const api = bridge((opts) => {
    seen = opts;
    if (opts?.format === 'jpeg') {
      return { dataUrl: 'data:image/jpeg;base64,QQ==', width: 400, height: 300, format: 'jpeg' };
    }
    return 'data:image/png;base64,iVBORw0KGgo=';
  });
  const omitted = await api.call('screenshot', {});
  assert.equal(omitted.ok, true);
  assert.equal(omitted.result.dataUrl.startsWith('data:image/png'), true);
  assert.equal(seen.format, 'png');
  assert.equal(seen.max_width, undefined);
  assert.equal(seen.save_to, undefined);

  const small = await api.call('screenshot', {
    format: 'jpeg',
    max_width: 400,
    scale: 0.5,
    quality: 0.6,
    save_to: '/tmp/secret.png',
  });
  assert.equal(small.ok, true);
  assert.equal(small.result.dataUrl.startsWith('data:image/jpeg'), true);
  assert.equal(small.result.width, 400);
  assert.equal(small.result.path, undefined);
  assert.deepEqual(seen, { format: 'jpeg', quality: 0.6, max_width: 400, scale: 0.5 });

  const gif = await api.call('screenshot', { format: 'gif' });
  assert.equal(gif.ok, false);
  assert.equal(gif.error.code, 'unsupported_format');
  const jpg = await api.call('screenshot', { format: 'jpg' });
  assert.equal(jpg.error.code, 'unsupported_format');
  const wide = await api.call('screenshot', { max_width: 0 });
  assert.equal(wide.error.code, 'bad_args');
});

test('a run that reports no bodies sets bodyCount 0 and a reserved-name error is plain', async () => {
  const api = createSurfcadBridge({
    getScript: () => 'const cut = 1;\n',
    setEditor() {},
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory() {},
    async execute() {
      const message = "Identifier 'cut' has already been declared";
      return {
        ok: false,
        errors: [message],
        runFailure: { message },
        volume: null,
        bbox: null,
        partName: 'Part',
      };
    },
  });
  const failed = await api.call('run', {});
  assert.equal(failed.ok, true);
  assert.equal(failed.result.ok, false);
  assert.deepEqual(failed.result.errors, [
    '`cut` is a reserved SurfCAD helper name; rename your variable',
  ]);
  const errors = await api.call('errors', {});
  assert.equal(errors.result.errors[0].message, '`cut` is a reserved SurfCAD helper name; rename your variable');

  const empty = createSurfcadBridge({
    getScript: () => 'return null;\n',
    setEditor() {},
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory() {},
    async execute() {
      return { ok: true, errors: [], volume: null, bbox: null, partName: 'Part', bodyCount: 0 };
    },
  });
  await empty.call('run', {});
  const status = await empty.call('status', {});
  assert.equal(status.result.bodyCount, 0);
});
