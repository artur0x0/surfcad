/**
 * POST /api/convert/step: session, 429 at capacity, STAGE refused in
 * production, no converter output in the client body.
 * Run: cd backend && node --test test/convert-route.test.js
 */
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { requireAuth } from '../auth/session.js';
import { createRateLimiter } from '../services/rateLimiter.js';
import { GENERIC_CONVERT_ERROR, createConcurrencyGate } from '../services/convertGuards.js';
import { createConvertRouter } from '../routes/convert.js';

const CUBE_OBJ = `# cube placeholder so the file is over 200 bytes
${'#'.repeat(80)}
v 0 0 0
v 10 0 0
v 10 10 0
v 0 10 0
v 0 0 10
v 10 0 10
v 10 10 10
v 0 10 10
f 1 3 2
f 1 4 3
f 5 6 7
f 5 7 8
f 1 2 6
f 1 6 5
f 4 7 3
f 4 8 7
f 1 5 8
f 1 8 4
f 2 3 7
f 2 7 6
`;

function writeObjFromArgs(args) {
  const outputPath = args[args.length - 2];
  return writeFile(outputPath, CUBE_OBJ);
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function postStep(base, { user, filename = 'part.step', body = 'ISO-10303-21;' } = {}) {
  const form = new FormData();
  form.append('file', new Blob([body], { type: 'application/octet-stream' }), filename);
  form.append('deflection', '0.1');
  return fetch(`${base}/api/convert/step`, {
    method: 'POST',
    headers: user ? { 'x-test-user': user } : {},
    body: form,
  });
}

function attachAuth(app) {
  app.use((req, res, next) => {
    const id = req.get('x-test-user');
    req.user = id ? { _id: id } : undefined;
    req.isAuthenticated = () => Boolean(id);
    next();
  });
}

describe('/api/convert/step', () => {
  let uploadDir;

  before(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'surfcad-convert-'));
  });

  test('401 without a session and no converter run', async () => {
    let execs = 0;
    const app = express();
    attachAuth(app);
    app.use('/api/convert', createConvertRouter({
      config: { uploadFolder: uploadDir, workingFolder: uploadDir },
      requireAuth,
      execFileAsync: async () => { execs += 1; },
    }));
    const { server, base } = await listen(app);
    try {
      const res = await postStep(base);
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error, 'Authentication required');
      assert.equal(execs, 0);
    } finally {
      server.close();
    }
  });

  test('429 when the global queue is full', async () => {
    let unblock;
    let startResolve;
    const started = new Promise((resolve) => { startResolve = resolve; });
    const execFileAsync = () => {
      startResolve();
      return new Promise((resolve) => {
        unblock = () => resolve({ stdout: '', stderr: '' });
      });
    };
    const app = express();
    attachAuth(app);
    app.use('/api/convert', createConvertRouter({
      config: { uploadFolder: uploadDir, workingFolder: uploadDir },
      requireAuth,
      limiter: createRateLimiter({ limit: 20, windowMs: 60_000 }),
      gate: createConcurrencyGate({ maxActive: 1, maxQueued: 0 }),
      execFileAsync,
    }));
    const { server, base } = await listen(app);
    try {
      const first = postStep(base, { user: 'u1' });
      await started;
      const second = await postStep(base, { user: 'u2' });
      assert.equal(second.status, 429);
      const body = await second.json();
      assert.equal(body.success, false);
      assert.match(body.details, /Try again/);
      unblock();
      const firstRes = await first;
      assert.ok(firstRes.status === 422 || firstRes.status === 200);
    } finally {
      server.close();
    }
  });

  test('STAGE_OBJ_CONVERTER is refused in production and does not leak the path', async () => {
    let execs = 0;
    const app = express();
    attachAuth(app);
    app.use('/api/convert', createConvertRouter({
      config: { uploadFolder: uploadDir, workingFolder: uploadDir },
      requireAuth,
      env: { NODE_ENV: 'production', STAGE_OBJ_CONVERTER: '/tmp/leaky-converter' },
      execFileAsync: async () => { execs += 1; },
    }));
    const { server, base } = await listen(app);
    try {
      const res = await postStep(base, { user: 'u1' });
      assert.equal(res.status, 503);
      const text = await res.text();
      assert.doesNotMatch(text, /leaky-converter|STAGE_OBJ|obj_converter stdout/);
      assert.match(text, /temporarily unavailable|STEP conversion failed/);
      assert.equal(execs, 0);
    } finally {
      server.close();
    }
  });

  test('converter stdout/stderr never reach the client', async () => {
    const app = express();
    attachAuth(app);
    app.use('/api/convert', createConvertRouter({
      config: { uploadFolder: uploadDir, workingFolder: uploadDir },
      requireAuth,
      execFileAsync: async () => {
        const err = new Error('Command failed: SECRET_STDOUT');
        err.code = 127;
        err.stdout = 'SECRET_STDOUT volume=12 path=/home/artur/part.step';
        err.stderr = 'SECRET_STDERR firejail denied';
        throw err;
      },
    }));
    const { server, base } = await listen(app);
    try {
      const res = await postStep(base, { user: 'u1' });
      assert.equal(res.status, 422);
      const text = await res.text();
      assert.doesNotMatch(text, /SECRET_|volume=12|firejail denied|\/home\/artur/);
      assert.match(text, new RegExp(GENERIC_CONVERT_ERROR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    } finally {
      server.close();
    }
  });

  test('signed-in convert returns a mesh and does not echo converter output', async () => {
    const app = express();
    attachAuth(app);
    app.use('/api/convert', createConvertRouter({
      config: { uploadFolder: uploadDir, workingFolder: uploadDir },
      requireAuth,
      execFileAsync: async (file, args) => {
        assert.equal(typeof file, 'string');
        assert.ok(Array.isArray(args));
        await writeObjFromArgs(args);
        return { stdout: 'do-not-echo', stderr: '' };
      },
    }));
    const { server, base } = await listen(app);
    try {
      const res = await postStep(base, { user: 'u1' });
      assert.equal(res.status, 200, await res.clone().text());
      const body = await res.json();
      assert.equal(body.success, true);
      assert.ok(body.data.volume > 0);
      assert.ok(body.data.vertProperties.length >= 24);
      assert.doesNotMatch(JSON.stringify(body), /do-not-echo/);
    } finally {
      server.close();
    }
  });
});
