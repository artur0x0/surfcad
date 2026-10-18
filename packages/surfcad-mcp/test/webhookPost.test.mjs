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
      hits.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
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
    assert.equal(hits[0].type, 'surfcad.prompt');
    assert.equal(hits[0].text, 'hello');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
