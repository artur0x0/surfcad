/**
 * In-memory stand-ins for the Mongoose models a route test touches, plus a
 * tiny Express app with real sessions + passport and a cookie-keeping client.
 * No live Mongo, no network. Not a test file on its own.
 */
import http from 'node:http';
import express from 'express';
import session from 'express-session';
import mongoose from 'mongoose';
import passport from 'passport';
import { enforceCredentialRevocation } from '../../auth/session.js';

function readPath(obj, path) {
  if (obj == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function same(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return String(a) === String(b);
}

/** Deep copy of plain objects/arrays. ObjectIds stay ObjectIds (JSON/structuredClone turn them into `{ buffer }`). */
function cloneRow(value) {
  if (value instanceof mongoose.Types.ObjectId) {
    return new mongoose.Types.ObjectId(String(value));
  }
  if (Array.isArray(value)) return value.map(cloneRow);
  if (value instanceof Date) return new Date(value.getTime());
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneRow(v)]));
  }
  return value;
}

function matchValue(actual, cond) {
  if (cond && typeof cond === 'object' && !Array.isArray(cond)
    && Object.keys(cond).some((k) => k.startsWith('$'))) {
    if ('$in' in cond && !cond.$in.some((v) => same(actual, v))) return false;
    if ('$ne' in cond && same(actual, cond.$ne)) return false;
    if ('$exists' in cond && (actual != null) !== !!cond.$exists) return false;
    if ('$regex' in cond && !new RegExp(cond.$regex).test(String(actual ?? ''))) return false;
    return true;
  }
  return same(actual, cond);
}

export function matches(row, query = {}) {
  return Object.entries(query).every(([key, cond]) => matchValue(readPath(row, key), cond));
}

/**
 * Replace a model's statics and `save` with an array-backed store.
 * Reads hydrate fresh documents, so unsaved mutations never leak back.
 * @returns {{ rows: object[], restore: () => void, insert: (data: object) => Promise<object> }}
 */
export function installFakeModel(Model, { unique = [] } = {}) {
  const rows = [];
  const saved = {};
  const statics = ['findOne', 'findById', 'find', 'deleteOne', 'updateOne', 'exists', 'countDocuments', 'create'];
  for (const name of statics) saved[name] = Object.getOwnPropertyDescriptor(Model, name);
  const protoSave = Model.prototype.save;

  const plain = (doc) => cloneRow(doc.toObject({ depopulate: true, virtuals: false, getters: false }));
  const hydrate = (row) => (row ? Model.hydrate(cloneRow(row)) : null);

  Model.findOne = async (query) => hydrate(rows.find((row) => matches(row, query)));
  Model.findById = async (id) => hydrate(rows.find((row) => same(row._id, id)));
  Model.find = (query) => {
    let list = rows.filter((row) => matches(row, query));
    const q = {
      sort(spec) {
        const [[key, dir] = []] = Object.entries(spec || {});
        if (key) {
          list = [...list].sort((a, b) => {
            const av = readPath(a, key);
            const bv = readPath(b, key);
            if (av < bv) return -dir;
            if (av > bv) return dir;
            return 0;
          });
        }
        return q;
      },
      limit(n) {
        list = list.slice(0, n);
        return q;
      },
      select() { return q; },
      then(onF, onR) { return Promise.resolve(list.map(hydrate)).then(onF, onR); },
    };
    return q;
  };
  Model.exists = async (query) => {
    const row = rows.find((r) => matches(r, query));
    return row ? { _id: row._id } : null;
  };
  Model.countDocuments = async (query) => rows.filter((row) => matches(row, query)).length;
  Model.deleteOne = async (query) => {
    const i = rows.findIndex((row) => matches(row, query));
    if (i >= 0) rows.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  };
  Model.updateOne = async (query, update = {}) => {
    const row = rows.find((r) => matches(r, query));
    if (!row) return { matchedCount: 0, modifiedCount: 0 };
    for (const [k, v] of Object.entries(update.$set || {})) row[k] = v;
    for (const [k, v] of Object.entries(update.$inc || {})) row[k] = (row[k] || 0) + v;
    return { matchedCount: 1, modifiedCount: 1 };
  };
  Model.create = async (data) => {
    const doc = new Model(data);
    await doc.save();
    return doc;
  };
  Model.prototype.save = async function save() {
    await this.validate();
    const row = plain(this);
    for (const field of unique) {
      const clash = rows.find((r) => !same(r._id, row._id) && same(r[field], row[field]));
      if (clash) {
        const err = new Error(`E11000 duplicate key error: ${field}`);
        err.code = 11000;
        throw err;
      }
    }
    const i = rows.findIndex((r) => same(r._id, row._id));
    if (i >= 0) rows[i] = row;
    else rows.push(row);
    this.isNew = false;
    return this;
  };

  return {
    rows,
    find: (query) => rows.find((row) => matches(row, query)) || null,
    async insert(data) {
      const doc = new Model(data);
      await doc.save();
      return doc;
    },
    restore() {
      for (const name of statics) {
        if (saved[name]) Object.defineProperty(Model, name, saved[name]);
        else delete Model[name];
      }
      Model.prototype.save = protoSave;
    },
  };
}

/** Patch methods on an object; returns a restore function. */
export function patch(target, overrides) {
  const before = {};
  for (const [key, value] of Object.entries(overrides)) {
    before[key] = target[key];
    target[key] = value;
  }
  return () => Object.assign(target, before);
}

/**
 * Express app with JSON bodies, a memory session store and passport sessions.
 * `mount(app)` adds the routers under test.
 */
export async function startApp(mount, { trustProxy = 1 } = {}) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'test-session-secret',
    resave: false,
    saveUninitialized: false,
    name: 'surfcad.sid',
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(enforceCredentialRevocation);
  mount(app);
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    return res.status(500).json({ error: 'Internal server error' });
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Cookie-keeping JSON client over node:http (independent of globalThis.fetch). */
export function client(port, { headers: baseHeaders = {} } = {}) {
  let cookie = '';
  return function request(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...baseHeaders,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          if (setCookie?.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = { _raw: raw }; }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
}
