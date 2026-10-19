import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postPromptWebhook } from '../src/prompt/webhookPost.mjs';

test('postPromptWebhook retries once and does not record the URL', async () => {
  let calls = 0;
  const seen = [];
  const request = async (url, payload, opts) => {
    calls += 1;
    seen.push({ insecureTls: opts.insecureTls, bytes: payload.length });
    if (calls === 1) throw new Error('down');
    const body = JSON.parse(payload.toString('utf8'));
    assert.equal(body.type, 'surfcad.prompt');
    assert.equal(url.startsWith('https://'), true);
    return { ok: true };
  };
  const out = await postPromptWebhook('https://8.8.8.8/hook', { type: 'surfcad.prompt', id: '1' }, {
    request,
    insecureTls: false,
  });
  assert.equal(out.ok, true);
  assert.equal(calls, 2);
  assert.equal(seen[0].insecureTls, false);
  assert.equal(JSON.stringify(out).includes('8.8.8.8'), false);
});

test('postPromptWebhook sends the bearer on each attempt and omits it from the result', async () => {
  const seen = [];
  const request = async (_url, _payload, opts) => {
    seen.push(opts.bearer);
    const err = new Error('down test-bearer');
    err.name = 'Error';
    throw err;
  };
  const out = await postPromptWebhook('https://8.8.8.8/hook', { type: 'surfcad.prompt' }, {
    request,
    bearer: 'test-bearer',
  });
  assert.deepEqual(seen, ['test-bearer', 'test-bearer']);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'webhook_failed');
  assert.equal(JSON.stringify(out).includes('test-bearer'), false);
});

test('postPromptWebhook reports timeout after the retry and stops', async () => {
  let calls = 0;
  const request = async () => {
    calls += 1;
    const err = new Error('slow');
    err.name = 'TimeoutError';
    throw err;
  };
  const out = await postPromptWebhook('https://8.8.8.8/hook', { type: 'surfcad.prompt' }, { request });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'webhook_timeout');
  assert.equal(calls, 2);
});

test('insecure TLS is required for a self-signed loopback webhook and refused otherwise', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfcad-webhook-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', keyPath,
    '-out', certPath,
    '-days', '1',
    '-nodes',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' });
  const hits = [];
  const server = https.createServer({
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  }, (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      hits.push({
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        authorization: req.headers.authorization ?? null,
      });
      res.writeHead(204);
      res.end();
    });
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const url = `https://127.0.0.1:${port}/hook`;
    const body = { type: 'surfcad.prompt', v: 1, id: 'abc', text: 'hello' };
    const rejected = await postPromptWebhook(url, body, { insecureTls: false, timeoutMs: 2000 });
    assert.equal(rejected.ok, false);
    assert.equal(hits.length, 0);

    const accepted = await postPromptWebhook(url, body, {
      insecureTls: true,
      pinAddress: '127.0.0.1',
      timeoutMs: 2000,
    });
    assert.equal(accepted.ok, true);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].authorization, null);
    assert.equal(hits[0].body.type, 'surfcad.prompt');
    assert.equal(hits[0].body.text, 'hello');

    const logs = [];
    const prevError = console.error;
    console.error = (...args) => logs.push(args.map(String).join(' '));
    let authed;
    try {
      authed = await postPromptWebhook(url, { ...body, text: 'with-bearer' }, {
        insecureTls: true,
        pinAddress: '127.0.0.1',
        timeoutMs: 2000,
        bearer: 'test-bearer',
      });
    } finally {
      console.error = prevError;
    }
    assert.equal(authed.ok, true);
    assert.equal(hits.length, 2);
    assert.equal(hits[1].authorization, 'Bearer test-bearer');
    assert.equal(hits[1].body.text, 'with-bearer');
    assert.equal(JSON.stringify(authed).includes('test-bearer'), false);
    assert.equal(logs.some((line) => line.includes('test-bearer')), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
