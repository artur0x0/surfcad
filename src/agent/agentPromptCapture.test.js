import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_PROMPT_SHOT_MAX_BYTES,
  AGENT_PROMPT_SHOT_MIME,
  base64DecodedBytes,
  capAgentPromptScreenshot,
  screenshotFromDataUrl,
  stripDataUrlPrefix,
  viewerShotToPayload,
} from './agentPromptCapture.js';

function pngDataUrl(byteLength) {
  const raw = Math.max(0, Math.round(Number(byteLength) || 0));
  const b64Len = Math.ceil(raw / 3) * 4;
  return `data:image/png;base64,${'A'.repeat(b64Len)}`;
}

function fakeCanvas(width, height, log = []) {
  return {
    width,
    height,
    getContext() {
      return { drawImage() { log.push(['draw', width, height]); } };
    },
    toDataURL() {
      return pngDataUrl(width * height);
    },
    _hydrate() {
      log.push(['hydrate', width, height]);
    },
  };
}

test('stripDataUrlPrefix drops the data: prefix and leaves raw base64 alone', () => {
  assert.equal(stripDataUrlPrefix('data:image/png;base64,abc='), 'abc=');
  assert.equal(stripDataUrlPrefix('abc='), 'abc=');
  assert.equal(stripDataUrlPrefix(null), '');
});

test('screenshotFromDataUrl builds the transport payload without a data: prefix', () => {
  const shot = screenshotFromDataUrl('data:image/png;base64,QQ==', 12, 8);
  assert.deepEqual(shot, {
    mime: AGENT_PROMPT_SHOT_MIME,
    data: 'QQ==',
    width: 12,
    height: 8,
  });
  assert.equal(shot.data.startsWith('data:'), false);
});

test('viewerShotToPayload accepts a capturePng result and a raw data URL', () => {
  const fromObject = viewerShotToPayload({
    dataUrl: 'data:image/png;base64,QQ==',
    width: 4,
    height: 3,
  });
  assert.equal(fromObject.mime, 'image/png');
  assert.equal(fromObject.data, 'QQ==');
  assert.equal(fromObject.width, 4);
  assert.equal(fromObject.height, 3);

  const fromString = viewerShotToPayload('data:image/png;base64,QQ==');
  assert.equal(fromString.data, 'QQ==');
  assert.equal(viewerShotToPayload(null), null);
  assert.equal(viewerShotToPayload({}), null);
});

test('capAgentPromptScreenshot downscales until decoded bytes fit the 2 MB cap', () => {
  const log = [];
  const created = [];
  const oversized = pngDataUrl(3 * 1024 * 1024);
  assert.ok(base64DecodedBytes(stripDataUrlPrefix(oversized)) > AGENT_PROMPT_SHOT_MAX_BYTES);

  const payload = capAgentPromptScreenshot(
    { dataUrl: oversized, width: 2000, height: 1500 },
    {
      maxBytes: 8 * 1024,
      encode(canvas) {
        log.push(['encode', canvas.width, canvas.height]);
        return {
          dataUrl: pngDataUrl(canvas.width * 8),
          width: canvas.width,
          height: canvas.height,
        };
      },
      createCanvas(width, height) {
        created.push([width, height]);
        return fakeCanvas(width, height, log);
      },
    },
  );

  assert.equal(payload.mime, 'image/png');
  assert.equal(payload.data.startsWith('data:'), false);
  assert.ok(base64DecodedBytes(payload.data) <= 8 * 1024);
  assert.ok(payload.width < 2000);
  assert.ok(payload.height < 1500);
  assert.ok(created.length > 0);
});

test('capAgentPromptScreenshot still shrinks a huge data URL that omitted width and height', () => {
  const oversized = pngDataUrl(4 * 1024 * 1024);
  const payload = capAgentPromptScreenshot(
    { dataUrl: oversized },
    {
      maxBytes: 2048,
      encode(canvas) {
        return {
          dataUrl: pngDataUrl(Math.max(32, canvas.width)),
          width: canvas.width,
          height: canvas.height,
        };
      },
      createCanvas(width, height) {
        return fakeCanvas(width, height);
      },
    },
  );
  assert.ok(base64DecodedBytes(payload.data) <= 2048);
  assert.ok(payload.width <= 1920);
});
