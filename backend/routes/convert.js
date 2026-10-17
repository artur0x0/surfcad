// routes/convert.js
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Module from 'manifold-3d';
import config from '../config/index.js';
import { requireAuth } from '../auth/session.js';
import { createRateLimiter, rateLimitMiddleware, userKey } from '../services/rateLimiter.js';
import {
  GENERIC_CONVERT_ERROR,
  claimConvertSlot,
  concurrencyMiddleware,
  converterCommand,
  createConcurrencyGate,
  publicConvertError,
  resolveConverter,
} from '../services/convertGuards.js';

const defaultExecFile = promisify(execFile);

let wasmReady = null;

export function getManifoldWasm() {
  if (!wasmReady) {
    wasmReady = Module().then((wasm) => {
      wasm.setup();
      return wasm;
    });
  }
  return wasmReady;
}

export function tryDelete(obj) {
  if (obj && typeof obj.delete === 'function') {
    try { obj.delete(); } catch { /* already freed */ }
  }
}

function makeUpload(dest) {
  return multer({
    dest: dest || undefined,
    limits: {
      fileSize: 64 * 1024 * 1024,
      fields: 8,
      files: 1,
      parts: 20,
    },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.step' && ext !== '.stp') {
        return cb(new Error('Only .step / .stp files allowed'));
      }
      cb(null, true);
    },
  });
}

function safeParseFloat(str, fallback, min, max) {
  const v = parseFloat(str);
  if (isNaN(v) || !isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

async function safeParseOBJ(filepath) {
  const text = await fs.readFile(filepath, 'utf8');

  const vertices = [];
  const triangles = [];

  const lines = text.split(/\r?\n/);
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'v') {
      if (parts.length < 4) continue;
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
        console.warn(`[OBJ] Invalid vertex on line ${lineNumber}`);
        continue;
      }
      vertices.push([x, y, z]);
      if (vertices.length > 400_000) {
        throw new Error('OBJ has too many vertices (>400k)');
      }
    } else if (cmd === 'f') {
      if (parts.length < 4) continue;
      const indices = [];
      for (let i = 1; i < parts.length; i++) {
        const idxStr = parts[i].split('/')[0];
        const idx = parseInt(idxStr, 10);
        if (!idx || isNaN(idx)) continue;
        indices.push(idx - 1);
      }
      if (indices.length < 3) continue;

      if (indices.length === 3) {
        triangles.push(indices);
      } else if (indices.length === 4) {
        triangles.push([indices[0], indices[1], indices[2]]);
        triangles.push([indices[0], indices[2], indices[3]]);
      } else {
        console.warn(`[OBJ] Skipping face with ${indices.length} vertices on line ${lineNumber}`);
      }

      if (triangles.length > 800_000) {
        throw new Error('OBJ has too many triangles (>800k)');
      }
    }
  }

  console.log(`[OBJ] Parsed ${vertices.length} verts, ${triangles.length} tris`);
  return { vertices, triangles };
}

function tryToMakeManifold(wasm, mesh) {
  let manifold = null;
  try {
    manifold = new wasm.Manifold(mesh);
    if (manifold && !manifold.isEmpty()) {
      const vol = manifold.volume();
      if (!isFinite(vol) || vol < 0) {
        tryDelete(manifold);
        return null;
      }
      return manifold;
    }
  } catch (e) {
    tryDelete(manifold);
    if (e.message?.includes('Not manifold')) {
      return null;
    }
    throw e;
  }
  tryDelete(manifold);
  return null;
}

function meshToManifold(wasm, meshData, tolerance) {
  const mesh = new wasm.Mesh({
    numProp: meshData.numProp,
    vertProperties: meshData.vertProperties,
    triVerts: meshData.triVerts,
  });

  try {
    let manifold = tryToMakeManifold(wasm, mesh);
    if (manifold) return { manifold, mesh };

    if (typeof mesh.merge === 'function') {
      mesh.merge();
      manifold = tryToMakeManifold(wasm, mesh);
      if (manifold) return { manifold, mesh };
    }

    if (tolerance > 0 && typeof mesh.merge === 'function') {
      mesh.tolerance = tolerance;
      mesh.merge();
      manifold = tryToMakeManifold(wasm, mesh);
      if (manifold) return { manifold, mesh };
    }

    throw new Error('Could not construct valid manifold geometry');
  } catch (err) {
    tryDelete(mesh);
    throw err;
  }
}

const CONVERT_BUSY = 'Too many STEP conversions are running. Try again shortly.';
const CONVERT_RATE = 'Too many STEP imports. Try again shortly.';

/**
 * @param {{
 *   config?: typeof config,
 *   requireAuth?: Function,
 *   limiter?: ReturnType<typeof createRateLimiter>,
 *   gate?: ReturnType<typeof createConcurrencyGate>,
 *   execFileAsync?: typeof defaultExecFile,
 *   getWasm?: typeof getManifoldWasm,
 *   resolveConverter?: typeof resolveConverter,
 *   env?: NodeJS.ProcessEnv,
 * }} [deps]
 */
export function createConvertRouter(deps = {}) {
  const cfg = deps.config || config;
  const auth = deps.requireAuth || requireAuth;
  const limiter = deps.limiter || createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });
  const gate = deps.gate || createConcurrencyGate({ maxActive: 2, maxQueued: 4 });
  const runExec = deps.execFileAsync || defaultExecFile;
  const loadWasm = deps.getWasm || getManifoldWasm;
  const pickConverter = deps.resolveConverter || resolveConverter;
  const env = deps.env || process.env;
  const upload = makeUpload(cfg.uploadFolder);

  const router = Router();
  router.post(
    '/step',
    auth,
    rateLimitMiddleware(limiter, userKey, CONVERT_RATE, { success: false, details: CONVERT_RATE }),
    concurrencyMiddleware(gate, CONVERT_BUSY),
    upload.single('file'),
    async (req, res) => {
      const release = claimConvertSlot(res);
      let inputPath = null;
      let outputPath = null;
      let mesh = null;
      let manifold = null;
      let finalMesh = null;
      try {
        if (!req.file) {
          return res.status(400).json({ success: false, error: 'No file uploaded', details: 'No file uploaded' });
        }
        const deflection = safeParseFloat(req.body.deflection, 0.1, 0.01, 5.0);
        const tolerance = safeParseFloat(req.body.tolerance, 0.001, 1e-6, 0.1);

        inputPath = req.file.path;
        const tempDir = path.dirname(inputPath);
        const name = path.parse(req.file.originalname).name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const outputName = `conv_${name}_${Date.now()}.obj`;
        outputPath = path.join(tempDir, outputName);

        const resolved = pickConverter({ env, workingFolder: cfg.workingFolder });
        const cmd = converterCommand(resolved, {
          inputPath,
          outputPath,
          deflection,
          workingFolder: cfg.workingFolder,
          env,
        });
        console.log(`[Convert] execFile ${cmd.file}`);
        try {
          await runExec(cmd.file, cmd.args, cmd.options);
        } catch (execErr) {
          console.error('[Convert] converter failed', {
            code: execErr.code,
            signal: execErr.signal,
          });
          throw new Error('converter-failed');
        }

        let stats;
        try {
          stats = await fs.stat(outputPath);
        } catch {
          throw new Error('converter-no-output');
        }
        if (stats.size < 200) {
          throw new Error('converter-empty-output');
        }

        const { vertices, triangles } = await safeParseOBJ(outputPath);
        if (vertices.length === 0 || triangles.length === 0) {
          throw new Error('converter-empty-mesh');
        }

        const vertProperties = new Float32Array(vertices.length * 3);
        for (let i = 0; i < vertices.length; i++) {
          vertProperties[i * 3 + 0] = vertices[i][0];
          vertProperties[i * 3 + 1] = vertices[i][1];
          vertProperties[i * 3 + 2] = vertices[i][2];
        }
        const triVerts = new Uint32Array(triangles.length * 3);
        for (let i = 0; i < triangles.length; i++) {
          triVerts[i * 3 + 0] = triangles[i][0];
          triVerts[i * 3 + 1] = triangles[i][1];
          triVerts[i * 3 + 2] = triangles[i][2];
        }

        const wasm = await loadWasm();
        ({ manifold, mesh } = meshToManifold(wasm, {
          numProp: 3,
          vertProperties,
          triVerts,
        }, tolerance));
        const volume = manifold.volume();
        if (!isFinite(volume) || volume <= 0) {
          throw new Error('invalid-volume');
        }
        finalMesh = manifold.getMesh();
        const result = {
          success: true,
          filename: req.file.originalname,
          data: {
            vertProperties: Array.from(finalMesh.vertProperties),
            triVerts: Array.from(finalMesh.triVerts),
            numProp: finalMesh.numProp || 3,
            volume,
            boundingBox: manifold.boundingBox(),
          },
        };
        return res.json(result);
      } catch (err) {
        console.error('[Convert] Failed:', err?.name || 'Error');
        const { status, details } = publicConvertError(err);
        return res.status(status).json({
          success: false,
          error: 'STEP conversion failed',
          details,
        });
      } finally {
        tryDelete(finalMesh);
        tryDelete(manifold);
        tryDelete(mesh);
        [inputPath, outputPath].forEach((p) => {
          if (p) fs.unlink(p).catch(() => {});
        });
        release();
      }
    },
  );
  return router;
}

const router = createConvertRouter();
export { GENERIC_CONVERT_ERROR };
export default router;
