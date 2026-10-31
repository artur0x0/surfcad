import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, test } from 'node:test';
import express from 'express';
import { clientAddress } from '../agent/clientIp.js';

describe('client address behind a proxy', () => {
  test('one trusted hop matches Express req.ip and ignores a spoofed prefix', async () => {
    const app = express();
    app.set('trust proxy', 1);
    /** @type {{ express: string, direct: string } | null} */
    let seen = null;
    app.get('/', (req, res) => {
      seen = { express: req.ip, direct: clientAddress(req, 1) };
      res.end('ok');
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' },
      });
      assert.equal(res.status, 200);
      assert.equal(seen.express, '203.0.113.9');
      assert.equal(seen.direct, seen.express);
      assert.equal(clientAddress({
        headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' },
        socket: { remoteAddress: '127.0.0.1' },
      }, 0), '127.0.0.1');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
