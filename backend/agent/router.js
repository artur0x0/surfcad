import { Router } from 'express';
import {
  checkAgentHandshakeVersion,
  readCommandRequest,
} from '../../packages/surfcad-mcp/src/commandProtocol.mjs';
import {
  AGENT_SOCKET_CLOSE_CODE,
  TOKEN_REVOKED_REASON,
} from './agentSockets.js';
import { cityFromRequest } from './approvalCopy.js';
import {
  approvePage,
  codeFormPage,
  donePage,
  entryErrorMessage,
  signInPage,
} from './approvalPage.js';
import { checkApprovalPost, ensureCsrfToken } from './csrf.js';
import { logRelay } from './log.js';
import { messageByteLength } from './limits.js';

/**
 * @param {import('express').Request} req
 * @returns {{ id: string } | null}
 */
export function userFromRequest(req) {
  if (!req.isAuthenticated?.() || !req.user) return null;
  const id = req.user._id ?? req.user.id;
  if (id == null) return null;
  return { id: String(id) };
}

/**
 * @param {unknown} header
 * @returns {string | null}
 */
export function readBearer(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

/**
 * @param {import('express').Request} req
 */
function wantsHtml(req) {
  if (req.is('application/json')) return false;
  if (req.is('application/x-www-form-urlencoded')) return true;
  const accept = req.get('accept') || '';
  return !accept.includes('application/json');
}

/**
 * @param {string} error
 */
function entryStatus(error) {
  if (error === 'rate_limited' || error === 'too_many_wrong_tries') return 429;
  if (error === 'claimed' || error === 'csrf' || error === 'cross_origin') return 403;
  if (error === 'unknown_device') return 404;
  if (error === 'unavailable') return 503;
  return 400;
}

/**
 * @param {{
 *   pairing: ReturnType<import('./pairing.js').createPairingService>,
 *   tokens: ReturnType<import('./tokens.js').createTokenService>,
 *   registry: ReturnType<import('./registry.js').createMemoryTabRegistry>,
 *   commandLimiter: { check: (key: string) => { allowed: boolean, retryAfterSec?: number } },
 *   maxMessageBytes: number,
 *   agentSockets: { closeToken: (tokenId: string, code: number, reason: string) => number },
 * }} deps
 */
export function createAgentRouter(deps) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  /**
   * @param {import('express').Request} req
   * @param {string} [message]
   */
  function codePage(req, message) {
    return codeFormPage(message, ensureCsrfToken(req));
  }

  /**
   * Form posts need the session token. Every approval POST is refused when
   * Origin or Sec-Fetch-Site says the request is cross-site.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @returns {boolean}
   */
  function rejectApproval(req, res) {
    const problem = checkApprovalPost(req);
    if (problem === 'ok') return false;
    const message = problem === 'cross_origin'
      ? 'That request did not come from SurfCAD.'
      : 'Reload the page and try again.';
    if (wantsHtml(req)) res.status(403).type('html').send(codePage(req, message));
    else res.status(403).json({ error: problem });
    return true;
  }

  router.get('/', (req, res) => {
    if (!userFromRequest(req)) {
      return res.status(401).type('html').send(signInPage());
    }
    return res.type('html').send(codePage(req));
  });

  router.post('/pair', (req, res) => {
    const result = deps.pairing.start({
      name: req.body?.name,
      machine: req.body?.machine,
      city: cityFromRequest(req),
      ip: req.ip,
    });
    if (!result.ok) {
      if (result.retryAfterSec) res.set('Retry-After', String(result.retryAfterSec));
      return res.status(entryStatus(result.error)).json({
        error: result.error,
        ...(result.retryAfterSec ? { retryAfterSec: result.retryAfterSec } : {}),
      });
    }
    logRelay({ event: 'pair-start', bytes: messageByteLength({ name: req.body?.name, machine: req.body?.machine }) });
    return res.status(201).json({
      userCode: result.userCode,
      deviceSecret: result.deviceSecret,
      expiresAt: result.expiresAt,
      interval: result.interval,
    });
  });

  router.post('/pair/poll', (req, res) => {
    const result = deps.pairing.poll({
      deviceSecret: req.body?.deviceSecret,
      userCode: req.body?.userCode,
      ip: req.ip,
    });
    if (!result.ok) {
      if (result.retryAfterSec) res.set('Retry-After', String(result.retryAfterSec));
      return res.status(entryStatus(result.error)).json({
        error: result.error,
        ...(result.retryAfterSec ? { retryAfterSec: result.retryAfterSec } : {}),
      });
    }
    return res.json({
      status: result.status,
      ...(result.interval ? { interval: result.interval } : {}),
      ...(result.token ? { token: result.token } : {}),
    });
  });

  router.post('/pair/claim', (req, res) => {
    const user = userFromRequest(req);
    if (!user) {
      if (wantsHtml(req)) return res.status(401).type('html').send(signInPage());
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (rejectApproval(req, res)) return undefined;
    const result = deps.pairing.claim({
      userCode: req.body?.userCode,
      userId: user.id,
      ip: req.ip,
    });
    if (!result.ok) {
      if (result.retryAfterSec) res.set('Retry-After', String(result.retryAfterSec));
      if (wantsHtml(req)) {
        return res.status(entryStatus(result.error)).type('html').send(codePage(req, entryErrorMessage(result.error)));
      }
      return res.status(entryStatus(result.error)).json({
        error: result.error,
        ...(result.retryAfterSec ? { retryAfterSec: result.retryAfterSec } : {}),
      });
    }
    if (wantsHtml(req)) {
      return res.type('html').send(approvePage({ ...result, csrf: ensureCsrfToken(req) }));
    }
    return res.json({
      sentence: result.sentence,
      name: result.name,
      machine: result.machine,
      city: result.city,
      userCode: result.userCode,
    });
  });

  router.post('/pair/approve', async (req, res, next) => {
    try {
      const user = userFromRequest(req);
      if (!user) {
        if (wantsHtml(req)) return res.status(401).type('html').send(signInPage());
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (rejectApproval(req, res)) return undefined;
      const result = await deps.pairing.approve({
        userCode: req.body?.userCode,
        userId: user.id,
        ip: req.ip,
      });
      if (!result.ok) {
        if (result.retryAfterSec) res.set('Retry-After', String(result.retryAfterSec));
        if (wantsHtml(req)) {
          return res.status(entryStatus(result.error)).type('html').send(codePage(req, entryErrorMessage(result.error)));
        }
        return res.status(entryStatus(result.error)).json({ error: result.error });
      }
      logRelay({ event: 'pair-approve', userId: user.id });
      if (wantsHtml(req)) return res.type('html').send(donePage('Connected. You can close this page.'));
      return res.json({ ok: true, sentence: result.sentence });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/pair/deny', (req, res) => {
    const user = userFromRequest(req);
    if (!user) {
      if (wantsHtml(req)) return res.status(401).type('html').send(signInPage());
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (rejectApproval(req, res)) return undefined;
    const result = deps.pairing.deny({
      userCode: req.body?.userCode,
      userId: user.id,
      ip: req.ip,
    });
    if (!result.ok) {
      if (wantsHtml(req)) {
        return res.status(entryStatus(result.error)).type('html').send(codePage(req, entryErrorMessage(result.error)));
      }
      return res.status(entryStatus(result.error)).json({ error: result.error });
    }
    logRelay({ event: 'pair-deny', userId: user.id });
    if (wantsHtml(req)) return res.type('html').send(donePage('Denied. That agent cannot connect.'));
    return res.json({ ok: true });
  });

  router.get('/tokens', async (req, res, next) => {
    try {
      const user = userFromRequest(req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      const tokens = await deps.tokens.list(user.id);
      return res.json({ tokens });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/tokens/:id', async (req, res, next) => {
    try {
      const user = userFromRequest(req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      const tokenId = String(req.params.id);
      const revoked = await deps.tokens.revoke(user.id, tokenId);
      if (!revoked) return res.status(404).json({ error: 'not_found' });
      deps.agentSockets.closeToken(tokenId, AGENT_SOCKET_CLOSE_CODE, TOKEN_REVOKED_REASON);
      logRelay({ event: 'token-revoke', userId: user.id });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/tabs', (req, res) => {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    return res.json({ tabs: deps.registry.listTabs(user.id) });
  });

  router.post('/tabs/select', (req, res) => {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'tabId')) {
      return res.status(400).json({ error: 'tabId required' });
    }
    const tabId = req.body.tabId == null ? null : String(req.body.tabId);
    const selected = deps.registry.selectTab(user.id, tabId);
    if (!selected) return res.status(404).json({ error: 'not_found' });
    return res.json({ ok: true, tabs: deps.registry.listTabs(user.id) });
  });

  router.post('/commands', async (req, res, next) => {
    try {
      const auth = await deps.tokens.authenticate(readBearer(req.get('authorization')));
      if (!auth) return res.status(401).json({ error: 'Authentication required' });
      const bytes = messageByteLength(req.body);
      if (bytes > deps.maxMessageBytes) {
        return res.status(413).json({ error: 'Message exceeds the size cap' });
      }
      const version = checkAgentHandshakeVersion(req.body?.v);
      if (!version.ok) return res.status(400).json({ error: version.error });
      const frame = readCommandRequest(req.body);
      if (!frame || frame.id == null || frame.id === '') {
        return res.status(400).json({ error: 'bad_call' });
      }
      const limited = deps.commandLimiter.check(auth.id);
      if (!limited.allowed) {
        res.set('Retry-After', String(limited.retryAfterSec || 1));
        return res.status(429).json({ error: 'rate_limited', retryAfterSec: limited.retryAfterSec });
      }
      if (deps.registry.hasInFlight(auth.userId, frame.id)) {
        return res.status(409).json({ error: 'duplicate_id' });
      }
      const attempt = deps.registry.trySubmit({
        userId: auth.userId,
        tokenId: auth.id,
        frame,
      });
      if (!attempt.accepted) {
        const code = attempt.response.error?.code || 'too_many_pending';
        const status = code === 'duplicate_id' ? 409 : 429;
        return res.status(status).json({
          error: code,
          message: attempt.response.error?.message,
        });
      }
      await deps.tokens.markUsed(auth);
      logRelay({ event: 'command', userId: auth.userId, command: frame.command, bytes });
      return res.status(202).json({ id: frame.id, status: 'accepted' });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/commands/:id/events', async (req, res, next) => {
    try {
      const auth = await deps.tokens.authenticate(readBearer(req.get('authorization')));
      if (!auth) return res.status(401).json({ error: 'Authentication required' });
      const timeout = clampTimeout(req.query.timeout);
      res.status(200);
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      const result = await deps.registry.wait(auth.userId, String(req.params.id), timeout);
      if (!result) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'not_found' })}\n\n`);
        return res.end();
      }
      if (result.status === 'pending') {
        res.write(`event: pending\ndata: ${JSON.stringify({ status: 'pending' })}\n\n`);
        return res.end();
      }
      res.write(`event: result\ndata: ${JSON.stringify(result.response)}\n\n`);
      return res.end();
    } catch (error) {
      return next(error);
    }
  });

  router.get('/commands/:id', async (req, res, next) => {
    try {
      const auth = await deps.tokens.authenticate(readBearer(req.get('authorization')));
      if (!auth) return res.status(401).json({ error: 'Authentication required' });
      const timeout = clampTimeout(req.query.timeout);
      const result = await deps.registry.wait(auth.userId, String(req.params.id), timeout);
      if (!result) return res.status(404).json({ error: 'not_found' });
      if (result.status === 'pending') {
        return res.json({ id: String(req.params.id), status: 'pending' });
      }
      return res.json({ id: String(req.params.id), status: 'done', response: result.response });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

/**
 * @param {unknown} value
 */
function clampTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(30_000, parsed);
}
