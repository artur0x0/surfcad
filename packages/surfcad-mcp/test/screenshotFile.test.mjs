import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  augmentScreenshotTool,
  callPairedBridgeTool,
  prepareScreenshotCall,
} from '../src/screenshotFile.mjs';

const PNG = `data:image/png;base64,${Buffer.from('hello').toString('base64')}`;
const JPEG = `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`;

function session(result, seen) {
  return {
    async call(name, args) {
      seen.push({ name, args });
      return result;
    },
  };
}

test('prepareScreenshotCall strips file paths from the browser args', () => {
  const prepared = prepareScreenshotCall({
    format: 'jpeg',
    max_width: 400,
    scale: 0.5,
    quality: 0.4,
    save_to: '/tmp/secret.png',
    overwrite: false,
  });
  assert.deepEqual(prepared.browserArgs, {
    format: 'jpeg',
    max_width: 400,
    scale: 0.5,
    quality: 0.4,
  });
  assert.equal(JSON.stringify(prepared.browserArgs).includes('secret'), false);
  assert.equal(prepared.save.path, '/tmp/secret.png');
  assert.equal(prepared.save.overwrite, false);

  const untouched = prepareScreenshotCall({ format: 'png' });
  assert.equal(untouched.save, null);
  assert.deepEqual(untouched.browserArgs, { format: 'png' });
});

test('screenshot save_to writes the file and does not send the path to the browser', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfcad-shot-'));
  try {
    const target = join(dir, 'view.png');
    const seen = [];
    const out = await callPairedBridgeTool(session({ dataUrl: PNG, width: 400, height: 300 }, seen), 'screenshot', {
      max_width: 400,
      save_to: target,
    });
    assert.equal(out.isError, false);
    assert.equal(out.value.path, target);
    assert.equal(out.value.size, 5);
    assert.equal(out.value.dataUrl, undefined);
    assert.equal(out.value.width, 400);
    assert.equal(readFileSync(target).toString(), 'hello');
    assert.deepEqual(seen, [{ name: 'screenshot', args: { max_width: 400 } }]);
    assert.equal(JSON.stringify(seen).includes(target), false);

    const again = await callPairedBridgeTool(session({ dataUrl: PNG }, []), 'screenshot', {
      save_to: target,
    });
    assert.equal(again.isError, false);
    assert.notEqual(again.value.path, target);
    assert.equal(readFileSync(target).toString(), 'hello');
    assert.equal(readFileSync(again.value.path).toString(), 'hello');

    writeFileSync(target, 'old');
    const replaced = await callPairedBridgeTool(session({ dataUrl: PNG }, []), 'screenshot', {
      save_to: target,
      overwrite: true,
    });
    assert.equal(replaced.value.path, target);
    assert.equal(readFileSync(target).toString(), 'hello');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('screenshot save_to true uses a unique file in the OS temp dir', async () => {
  const seen = [];
  const out = await callPairedBridgeTool(session({ dataUrl: JPEG }, seen), 'screenshot', {
    format: 'jpeg',
    save_to: true,
  });
  try {
    assert.equal(out.isError, false);
    assert.equal(out.value.format, 'jpeg');
    assert.equal(out.value.size, Buffer.from('jpeg-bytes').length);
    assert.ok(out.value.path.startsWith(tmpdir()));
    assert.ok(out.value.path.endsWith('.jpg'));
    assert.equal(out.value.dataUrl, undefined);
    assert.deepEqual(seen[0].args, { format: 'jpeg' });
  } finally {
    if (out.value?.path) rmSync(out.value.path, { force: true });
  }
});

test('an invalid save path is rejected before the browser is called', async () => {
  const seen = [];
  const out = await callPairedBridgeTool(session({ dataUrl: PNG }, seen), 'screenshot', {
    save_to: 'bad\0path.png',
    max_width: 400,
  });
  assert.equal(out.isError, true);
  assert.equal(out.value.code, 'bad_args');
  assert.equal(seen.length, 0);
});

test('a screenshot without save_to still returns the data URL', async () => {
  const seen = [];
  const out = await callPairedBridgeTool(session({ dataUrl: PNG }, seen), 'screenshot', { format: 'png' });
  assert.equal(out.isError, false);
  assert.equal(out.value.dataUrl, PNG);
  assert.equal(out.value.path, undefined);
  assert.deepEqual(seen[0].args, { format: 'png' });
});

test('the MCP screenshot tool advertises save_to without putting it in the browser schema', () => {
  const tool = augmentScreenshotTool({
    name: 'screenshot',
    description: 'Capture the viewport.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { format: { type: 'string' } },
    },
  });
  assert.equal(typeof tool.inputSchema.properties.save_to, 'object');
  assert.match(tool.description, /never sent to the browser/i);
  assert.equal(augmentScreenshotTool({ name: 'status', inputSchema: { properties: {} } }).inputSchema.properties.save_to, undefined);
});
