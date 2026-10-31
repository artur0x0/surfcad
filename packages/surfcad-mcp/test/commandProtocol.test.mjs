import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_PROTOCOL_VERSION,
  commandRequest,
  commandResponse,
  isSupportedProtocolVersion,
  readCommandRequest,
  readCommandResponse,
} from '../src/commandProtocol.mjs';

test('command frames carry protocol version 1', () => {
  assert.equal(AGENT_PROTOCOL_VERSION, 1);
  const request = commandRequest({ id: 'c1', command: 'list_faces', args: { part_id: 'p' } });
  assert.deepEqual(request, {
    v: 1,
    id: 'c1',
    command: 'list_faces',
    args: { part_id: 'p' },
  });
  const ok = commandResponse({ id: 'c1', ok: true, result: { faces: [] } });
  assert.deepEqual(JSON.parse(JSON.stringify(ok)), {
    v: 1,
    id: 'c1',
    ok: true,
    result: { faces: [] },
  });
  const failed = commandResponse({
    id: 7,
    ok: false,
    error: { code: 'unknown_command', message: 'no' },
  });
  assert.equal(failed.v, 1);
  assert.equal(failed.id, 7);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'unknown_command');
});

test('a missing v is version 1, and any other v is not this protocol', () => {
  assert.equal(isSupportedProtocolVersion({ command: 'status' }), true);
  assert.equal(isSupportedProtocolVersion({ v: 1, command: 'status' }), true);
  assert.equal(isSupportedProtocolVersion({ v: 2, command: 'status' }), false);
  assert.equal(isSupportedProtocolVersion(null), false);

  const request = readCommandRequest({ id: 'c', command: 'status' });
  assert.equal(request.v, 1);
  assert.deepEqual(request.args, {});
  assert.equal(readCommandRequest({ v: 1, id: 'c', command: 'status', args: { a: 1 } }).args.a, 1);
  assert.equal(readCommandRequest({ v: 2, id: 'c', command: 'status' }), null);
  assert.equal(readCommandRequest({ type: 'pair', command: 'status' }), null);
  assert.equal(readCommandRequest({ id: 'c' }), null);
  assert.deepEqual(readCommandRequest({ id: 'c', command: 'status', args: 'nope' }).args, {});

  const response = readCommandResponse({ id: 'c', ok: true, result: 0 });
  assert.equal(response.v, 1);
  assert.equal(response.ok, true);
  assert.equal(response.result, 0);
  assert.equal(readCommandResponse({ v: 1, id: 'c', ok: false, error: { code: 'x' } }).error.code, 'x');
  assert.equal(readCommandResponse({ v: 2, id: 'c', ok: true, result: 1 }), null);
  assert.equal(readCommandResponse({ type: 'pair', ok: true }), null);
  assert.equal(readCommandResponse({ id: 'c', command: 'status' }), null);
});
