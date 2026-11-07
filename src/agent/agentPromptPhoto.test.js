import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_PROMPT_PHOTO_ACCEPT,
  AGENT_PROMPT_PHOTO_MAX_EDGE,
  AGENT_PROMPT_PHOTO_MAX_FILE_BYTES,
  photoFileAccepted,
  photoFileToShot,
  photoTargetSize,
} from './agentPromptPhoto.js';
import { AGENT_PROMPT_SHOT_MIME, base64DecodedBytes } from './agentPromptCapture.js';

function pngDataUrl(byteLength) {
  const raw = Math.max(0, Math.round(Number(byteLength) || 0));
  const b64Len = Math.ceil(raw / 3) * 4;
  return `data:image/png;base64,${'A'.repeat(b64Len)}`;
}

/** A canvas whose PNG weighs one byte per pixel, so the cap is predictable. */
function fakeCanvas(width, height, log = []) {
  return {
    width,
    height,
    getContext() {
      return { drawImage(src, x, y, w, h) { log.push(['draw', w, h]); } };
    },
    toDataURL() {
      return pngDataUrl(width * height);
    },
    _hydrate() {},
  };
}

const encode = (canvas) => ({ dataUrl: canvas.toDataURL(), width: canvas.width, height: canvas.height });

test('the file input takes any image, and iOS gets the camera and the library (no capture attribute)', () => {
  assert.equal(AGENT_PROMPT_PHOTO_ACCEPT, 'image/*');
});

test('photoFileAccepted: image mime or image extension, under the file cap', () => {
  assert.deepEqual(photoFileAccepted({ type: 'image/jpeg', name: 'IMG_0001.JPG', size: 3_000_000 }), { ok: true, reason: null });
  assert.deepEqual(photoFileAccepted({ type: '', name: 'scan.HEIC', size: 10 }), { ok: true, reason: null });
  assert.deepEqual(photoFileAccepted({ type: 'application/pdf', name: 'drawing.pdf', size: 10 }), { ok: false, reason: 'photo_unsupported' });
  assert.deepEqual(photoFileAccepted({ type: 'image/png', name: 'big.png', size: AGENT_PROMPT_PHOTO_MAX_FILE_BYTES + 1 }), { ok: false, reason: 'photo_too_large' });
  assert.deepEqual(photoFileAccepted(null), { ok: false, reason: 'photo_unsupported' });
});

test('photoTargetSize caps the long side and never upscales', () => {
  assert.deepEqual(photoTargetSize(4032, 3024), { width: AGENT_PROMPT_PHOTO_MAX_EDGE, height: 1200 });
  assert.deepEqual(photoTargetSize(3024, 4032), { width: 1200, height: AGENT_PROMPT_PHOTO_MAX_EDGE });
  assert.deepEqual(photoTargetSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(photoTargetSize(0, 0), { width: 1, height: 1 });
});

test('photoFileToShot decodes, scales to the long-side cap, and returns a PNG screenshot payload', async () => {
  const log = [];
  let closed = 0;
  const decode = async () => ({ source: 'bitmap', width: 4032, height: 3024, close: () => { closed += 1; } });
  const out = await photoFileToShot({ type: 'image/jpeg', name: 'a.jpg', size: 100 }, {
    decode,
    createCanvas: (w, h) => fakeCanvas(w, h, log),
    encode,
  });
  assert.equal(out.ok, true);
  assert.equal(out.attached, true);
  assert.equal(out.shot.mime, AGENT_PROMPT_SHOT_MIME);
  assert.equal(out.shot.width, 1600);
  assert.equal(out.shot.height, 1200);
  assert.equal(out.shot.data.startsWith('data:'), false);
  assert.deepEqual(log[0], ['draw', 1600, 1200]);
  assert.equal(closed, 1, 'the decoded bitmap is released');
});

test('photoFileToShot keeps shrinking a heavy image until it fits the screenshot byte cap', async () => {
  const decode = async () => ({ source: 'bitmap', width: 1600, height: 1600, close() {} });
  const maxBytes = 200_000;
  const out = await photoFileToShot({ type: 'image/png', name: 'a.png', size: 100 }, {
    decode,
    createCanvas: (w, h) => fakeCanvas(w, h),
    encode,
    maxBytes,
  });
  assert.equal(out.ok, true);
  assert.ok(base64DecodedBytes(out.shot.data) <= maxBytes, `bytes ${base64DecodedBytes(out.shot.data)}`);
  assert.ok(out.shot.width < 1600 && out.shot.height < 1600);
});

test('photoFileToShot refuses a non-image before decoding and reports a decode failure', async () => {
  let decoded = 0;
  const pdf = await photoFileToShot({ type: 'application/pdf', name: 'd.pdf', size: 10 }, { decode: async () => { decoded += 1; } });
  assert.deepEqual(pdf, { ok: false, reason: 'photo_unsupported', attached: false, shot: null });
  assert.equal(decoded, 0);

  const broken = await photoFileToShot({ type: 'image/heic', name: 'x.heic', size: 10 }, {
    decode: async () => { throw new Error('no codec'); },
    createCanvas: (w, h) => fakeCanvas(w, h),
    encode,
  });
  assert.deepEqual(broken, { ok: false, reason: 'photo_failed', attached: false, shot: null });

  const empty = await photoFileToShot({ type: 'image/png', name: 'x.png', size: 10 }, {
    decode: async () => ({ source: null, width: 0, height: 0 }),
    createCanvas: (w, h) => fakeCanvas(w, h),
    encode,
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'photo_failed');
});
