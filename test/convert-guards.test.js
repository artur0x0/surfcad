/**
 * STEP convert guards (H5 / M7 / L1).
 * Run via root `node --test` (CI).
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import {
  ConverterConfigError,
  GENERIC_CONVERT_ERROR,
  concurrencyMiddleware,
  converterCommand,
  createConcurrencyGate,
  publicConvertError,
  resolveConverter,
} from '../backend/services/convertGuards.js';

describe('resolveConverter', () => {
  test('refuses STAGE_OBJ_CONVERTER when NODE_ENV=production', () => {
    assert.throws(
      () => resolveConverter({
        env: { NODE_ENV: 'production', STAGE_OBJ_CONVERTER: '/tmp/obj_converter' },
        workingFolder: '/opt/work',
      }),
      (err) => err instanceof ConverterConfigError && /not allowed/.test(err.message),
    );
  });

  test('allows the stage override outside production', () => {
    const out = resolveConverter({
      env: { NODE_ENV: 'development', STAGE_OBJ_CONVERTER: '/tmp/native-conv' },
      workingFolder: '/opt/work',
    });
    assert.equal(out.mode, 'stage');
    assert.equal(out.converterPath, '/tmp/native-conv');
  });

  test('production without STAGE uses firejail + WORKING_FOLDER', () => {
    const out = resolveConverter({
      env: { NODE_ENV: 'production' },
      workingFolder: '/opt/work',
    });
    assert.equal(out.mode, 'firejail');
    assert.equal(out.converterPath, '/opt/work/obj_converter');
  });
});

describe('converterCommand', () => {
  test('firejail is execFile argv, not a shell string', () => {
    const cmd = converterCommand(
      { mode: 'firejail', converterPath: '/opt/work/obj_converter', libDir: '/usr/local/lib' },
      { inputPath: '/tmp/in.step', outputPath: '/tmp/out.obj', deflection: 0.1, workingFolder: '/opt/work' },
    );
    assert.equal(cmd.file, 'firejail');
    assert.ok(Array.isArray(cmd.args));
    assert.equal(cmd.args.includes('--'), true);
    assert.equal(cmd.args.at(-4), '/opt/work/obj_converter');
    assert.equal(cmd.args.at(-1), '0.1000');
    assert.equal(cmd.options.shell, undefined);
  });

  test('stage mode execs the converter path directly', () => {
    const cmd = converterCommand(
      { mode: 'stage', converterPath: '/tmp/native', libDir: '/opt/occt' },
      { inputPath: '/tmp/in.step', outputPath: '/tmp/out.obj', deflection: 0.25, workingFolder: '/opt/work' },
    );
    assert.equal(cmd.file, '/tmp/native');
    assert.deepEqual(cmd.args, ['/tmp/in.step', '/tmp/out.obj', '0.2500']);
  });
});

describe('publicConvertError', () => {
  test('never returns converter stdout or internal paths', () => {
    const err = new Error('Converter process failed (code 127: SECRET_STDOUT | /tmp/leaky)');
    const out = publicConvertError(err);
    assert.equal(out.status, 422);
    assert.equal(out.details, GENERIC_CONVERT_ERROR);
    assert.doesNotMatch(out.details, /SECRET|leaky|127/);
  });

  test('STAGE-in-production is 503 without the path', () => {
    const out = publicConvertError(new ConverterConfigError('STAGE_OBJ_CONVERTER is not allowed when NODE_ENV=production'));
    assert.equal(out.status, 503);
    assert.doesNotMatch(out.details, /STAGE_OBJ|\/tmp/);
  });
});

describe('concurrency gate', () => {
  test('refuses when full and middleware answers 429', async () => {
    const gate = createConcurrencyGate({ maxActive: 1, maxQueued: 0 });
    const release = await gate.tryAcquire();
    assert.equal(gate.tryAcquire(), null);
    const mw = concurrencyMiddleware(gate, 'busy');
    const res = {
      statusCode: 200,
      headers: {},
      body: undefined,
      set(name, value) { this.headers[name] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    let nexted = false;
    await mw({}, res, () => { nexted = true; });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['Retry-After'], '30');
    release();
    assert.ok(await gate.tryAcquire());
  });
});

test('convert route uses execFile and requireAuth; frontend asks signed-out users to sign in', async () => {
  const convert = await readFile(new URL('../backend/routes/convert.js', import.meta.url), 'utf8');
  assert.match(convert, /from 'child_process'/);
  assert.match(convert, /execFile/);
  assert.doesNotMatch(convert, /shell:\s*'\/bin\/bash'/);
  assert.match(convert, /requireAuth/);
  assert.match(convert, /concurrencyMiddleware/);
  const frontend = await readFile(new URL('../src/utils/importModel.js', import.meta.url), 'utf8');
  assert.match(frontend, /credentials:\s*'include'/);
  assert.match(frontend, /Sign in to import STEP/);
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /Sign in to import STEP/);
  assert.match(app, /isBackendFormat/);
});
