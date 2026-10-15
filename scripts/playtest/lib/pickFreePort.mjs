import { createServer } from 'node:net';

/**
 * @param {string} [host]
 * @returns {Promise<number>}
 */
export function pickFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, host, () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    srv.on('error', reject);
  });
}
