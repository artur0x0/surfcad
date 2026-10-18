import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBlockedIp,
  validateWebhookUrl,
  webhookInsecureTlsAllowed,
  WEBHOOK_TLS_INSECURE_ENV,
} from '../src/prompt/webhookUrl.mjs';

const publicResolve = async () => ['8.8.8.8'];

test('webhookInsecureTlsAllowed is ignored in production', () => {
  assert.equal(webhookInsecureTlsAllowed({ NODE_ENV: 'production', [WEBHOOK_TLS_INSECURE_ENV]: '1' }), false);
  assert.equal(webhookInsecureTlsAllowed({ NODE_ENV: 'test', [WEBHOOK_TLS_INSECURE_ENV]: '1' }), true);
  assert.equal(webhookInsecureTlsAllowed({ NODE_ENV: 'test' }), false);
  assert.equal(webhookInsecureTlsAllowed({ [WEBHOOK_TLS_INSECURE_ENV]: '1' }), true);
  assert.equal(webhookInsecureTlsAllowed({}), false);
});

test('validateWebhookUrl rejects http, credentials, localhost, and private addresses', async () => {
  const http = await validateWebhookUrl('http://8.8.8.8/hook');
  assert.equal(http.ok, false);
  assert.match(http.message, /https/);

  const creds = await validateWebhookUrl('https://user:pass@8.8.8.8/hook');
  assert.equal(creds.ok, false);
  assert.match(creds.message, /credentials/);
  assert.equal(JSON.stringify(creds).includes('user:pass'), false);

  const userOnly = await validateWebhookUrl('https://user@8.8.8.8/hook');
  assert.equal(userOnly.ok, false);

  const localhost = await validateWebhookUrl('https://localhost/hook', { allowLoopback: false });
  assert.equal(localhost.ok, false);
  assert.match(localhost.message, /localhost|private/);

  const loopback = await validateWebhookUrl('https://127.0.0.1/hook', { allowLoopback: false });
  assert.equal(loopback.ok, false);

  const v6 = await validateWebhookUrl('https://[::1]/hook', { allowLoopback: false });
  assert.equal(v6.ok, false);

  const ten = await validateWebhookUrl('https://10.1.2.3/hook');
  assert.equal(ten.ok, false);

  const mapped = await validateWebhookUrl('https://[::ffff:127.0.0.1]/hook');
  assert.equal(mapped.ok, false);

  const localName = await validateWebhookUrl('https://printer.local/hook', {
    allowLoopback: true,
    resolveHost: publicResolve,
  });
  assert.equal(localName.ok, false);

  const obfuscated = await validateWebhookUrl('https://2130706433/hook');
  assert.equal(obfuscated.ok, false);

  const lan = await validateWebhookUrl('https://hooks.example/hook', {
    resolveHost: async () => ['192.168.1.9'],
  });
  assert.equal(lan.ok, false);
  assert.equal(JSON.stringify(lan).includes('hooks.example'), false);
});

test('validateWebhookUrl accepts a public https URL and loopback only when the test switch is on', async () => {
  const ip = await validateWebhookUrl('https://8.8.8.8/hook');
  assert.equal(ip.ok, true);
  assert.deepEqual(ip.addresses, ['8.8.8.8']);

  const named = await validateWebhookUrl('https://hooks.example/v1', {
    resolveHost: publicResolve,
  });
  assert.equal(named.ok, true);
  assert.equal(named.host, 'hooks.example');

  const blocked = await validateWebhookUrl('https://127.0.0.1:8443/hook', { allowLoopback: false });
  assert.equal(blocked.ok, false);

  const allowed = await validateWebhookUrl('https://127.0.0.1:8443/hook', { allowLoopback: true });
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.addresses, ['127.0.0.1']);

  const localhost = await validateWebhookUrl('https://localhost/hook', { allowLoopback: true });
  assert.equal(localhost.ok, true);

  assert.equal(isBlockedIp('8.8.8.8'), false);
  assert.equal(isBlockedIp('127.0.0.1'), true);
  assert.equal(isBlockedIp('10.0.0.1'), true);
  assert.equal(isBlockedIp('::1'), true);
});
