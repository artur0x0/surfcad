import { Router } from 'express';
import {
  checkAgentHandshakeVersion,
  readCommandRequest,
} from '../../packages/surfcad-mcp/src/commandProtocol.mjs';
import { forgetExpiredPairing } from './expirePairing.js';
import {
  approvePage,
  codeFormPage,
  donePage,
  entryErrorMessage,
  signInPage,
} from './approvalPage.js';
import { approvalFetchAllowed, browserReadAllowed, checkApprovalPost, ensureCsrfToken } from './csrf.js';
import { logRelay } from './log.js';
import { messageByteLength } from './limits.js';
import { revokeOneAgentToken } from './revokeToken.js';
import { hashApprovingSession } from './sessionKey.js';
import { sessionMessageProblem } from './sessionMessage.js';

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
 *   joinCodes: ReturnType<import('./joinCode.js').createJoinCodeService>,
 *   tokens: ReturnType<import('./tokens.js').createTokenService>,
 *   registry: ReturnType<import('./registry.js').createMemoryTabRegistry>,
 *   commandLimiter: { check: (key: string) => { allowed: boolean, retryAfterSec?: number } },
 *   browserLimiter: { check: (key: string) => { allowed: boolean, retryAfterSec?: number } },
 *   readLimiter: { check: (key: string) => { allowed: boolean, retryAfterSec?: number } },
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
    const carried = req.query?.userCode || req.query?.code;
    const note = message || (carried
      ? 'Type the code shown by the agent. A link does not fill this in or approve it.'
      : undefined);
    return codeFormPage(note, ensureCsrfToken(req));
  }

  /**
   * HTML approval uses the code from the typed claim, stored on the session.
   * The Allow button confirms it. The URL and a hidden field do not.
   * @param {import('express').Request} req
   */
  function claimedCode(req) {
    const code = req.session?.agentClaimCode;
    return typeof code === 'string' && code ? code : '';
  }

  /** @param {import('express').Request} req */
  function clearClaimedCode(req) {
    if (req.session) delete req.session.agentClaimCode;
  }

  /**
   * Form posts need the session token. Claim, approve, and deny also need
   * `Sec-Fetch-Site: same-origin` or an allowed Origin. Missing both is 403.
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

  /**
   * Cookie routes. Reads may omit Origin. A state change (revoke, tab select)
   * needs `Sec-Fetch-Site: same-origin` or an allowed Origin. A foreign Origin
   * or a cross-site `Sec-Fetch-Site` is refused either way.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {boolean} [stateChange]
   */
  function rejectBrowser(req, res, stateChange = false) {
    const allowed = stateChange ? approvalFetchAllowed(req) : browserReadAllowed(req);
    if (allowed) return false;
    if (wantsHtml(req)) {
      res.status(403).type('html').send('That request did not come from SurfCAD.');
    } else {
      res.status(403).json({ error: 'cross_origin' });
    }
    return true;
  }

  /**
   * @param {import('express').Response} res
   * @param {{ check: (key: string) => { allowed: boolean, retryAfterSec?: number } }} limiter
   * @param {string} key
   */
  function rejectLimited(res, limiter, key) {
    const hit = limiter.check(key);
    if (hit.allowed) return false;
    const retryAfterSec = hit.retryAfterSec || 1;
    res.set('Retry-After', String(retryAfterSec));
    res.status(429).json({ error: 'rate_limited', retryAfterSec: retryAfterSec });
    return true;
  }

  /** @param {import('express').Request} req */
  function browserKey(req) {
    return `ip:${req.ip || 'unknown'}`;
  }

  router.get('/', (req, res) => {
    if (rejectLimited(res, deps.browserLimiter, browserKey(req))) return undefined;
    const origin = req.get('origin');
    if (origin && !approvalFetchAllowed(req)) {
      return res.status(403).type('html').send('That request did not come from SurfCAD.');
    }
    if (!userFromRequest(req)) {
      return res.status(401).type('html').send(signInPage());
    }
    return res.type('html').send(codePage(req));
  });

  router.post('/pair', async (req, res, next) => {
    let city = null;
    if (typeof deps.lookupCity === 'function') {
      try {
        city = await deps.lookupCity(req.ip);
      } catch {
        city = null;
      }
    }
    let result;
    try {
      result = deps.pairing.start({
        name: req.body?.name,
        machine: req.body?.machine,
        city,
        ip: req.ip,
        deviceSecretHash: req.body?.deviceSecretHash,
      });
    } catch (error) {
      return next(error);
    }
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

  /**
   * A browser cookie is not authority on the redeem route. The code is the
   * credential. Counting the attempt still applies the IP and global limits.
   * @param {import('express').Request} req
   */
  function carriesBrowserCookie(req) {
    const cookie = req.get('cookie');
    return typeof cookie === 'string' && cookie.trim().length > 0;
  }

  router.post('/join', (req, res) => {
    if (rejectLimited(res, deps.browserLimiter, browserKey(req))) return undefined;
    if (rejectBrowser(req, res, true)) return undefined;
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const result = deps.joinCodes.create({
      userId: user.id,
      sessionKey: hashApprovingSession(req.sessionID),
    });
    if (!result.ok) {
      if (result.retryAfterSec) res.set('Retry-After', String(result.retryAfterSec));
      const status = result.error === 'rate_limited' ? 429 : 503;
      return res.status(status).json({
        error: result.error,
        ...(result.retryAfterSec ? { retryAfterSec: result.retryAfterSec } : {}),
      });
    }
    logRelay({ event: 'join-create', userId: user.id });
    return res.status(201).json({
      code: result.code,
      id: result.id,
      expiresAt: result.expiresAt,
    });
  });

  router.get('/join', (req, res) => {
    if (rejectLimited(res, deps.browserLimiter, browserKey(req))) return undefined;
    if (rejectBrowser(req, res)) return undefined;
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    return res.json(deps.joinCodes.status({ userId: user.id }));
  });

  router.post('/join/redeem', async (req, res, next) => {
    try {
      if (messageByteLength(req.body) > deps.maxMessageBytes) {
        return res.status(413).json({ error: 'Message exceeds the size cap' });
      }
      let city = null;
      if (!carriesBrowserCookie(req) && typeof deps.lookupCity === 'function') {
        try {
          city = await deps.lookupCity(req.ip);
        } catch {
          city = null;
        }
      }
      const result = await deps.joinCodes.redeem({
        code: req.body?.code,
        name: req.body?.name,
        machine: req.body?.machine,
        city,
        ip: req.ip,
        cookie: carriesBrowserCookie(req),
      });
      if (!result.ok) {
        if (result.retryAfterSec) res.set('Retry-After', String(result.retryAfterSec));
        const status = result.error === 'rate_limited' ? 429 : 400;
        logRelay({
          event: 'join-redeem',
          status: result.error === 'rate_limited' ? 'rate_limited' : 'invalid',
        });
        return res.status(status).json({
          error: result.error,
          ...(result.retryAfterSec ? { retryAfterSec: result.retryAfterSec } : {}),
        });
      }
      logRelay({ event: 'join-redeem', userId: result.userId, status: 'ok' });
      return res.json({ ok: true, token: result.token });
    } catch (error) {
      return next(error);
    }
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
      if (req.session) req.session.agentClaimCode = result.userCode;
      return res.type('html').send(approvePage({ ...result, csrf: ensureCsrfToken(req) }));
    }
    return res.json({
      sentence: result.sentence,
      name: result.name,
      machine: result.machine,
      city: result.city,
      ip: result.ip,
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
      const html = wantsHtml(req);
      const userCode = html ? claimedCode(req) : req.body?.userCode;
      if (html && !userCode) {
        return res.status(400).type('html').send(codePage(req, 'Enter the code shown by the agent.'));
      }
      const result = await deps.pairing.approve({
        userCode,
        userId: user.id,
        ip: req.ip,
        sessionKey: hashApprovingSession(req.sessionID),
      });
      if (html) clearClaimedCode(req);
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
    const html = wantsHtml(req);
    const userCode = html ? claimedCode(req) : req.body?.userCode;
    if (html && !userCode) {
      return res.status(400).type('html').send(codePage(req, 'Enter the code shown by the agent.'));
    }
    const result = deps.pairing.deny({
      userCode,
      userId: user.id,
      ip: req.ip,
    });
    if (html) clearClaimedCode(req);
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
      if (rejectLimited(res, deps.browserLimiter, browserKey(req))) return undefined;
      if (rejectBrowser(req, res)) return undefined;
      const user = userFromRequest(req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      const tokens = await deps.tokens.list(user.id);
      return res.json({ tokens });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/tokens/self', async (req, res, next) => {
    try {
      if (rejectLimited(res, deps.browserLimiter, browserKey(req))) return undefined;
      const live = await requireLiveAgent(deps, req, res);
      if (!live) return undefined;
      const { auth } = live;
      const revoked = await revokeOneAgentToken(deps, auth.userId, auth.id, {
        heldPrompts: 'account',
        dropPresence: true,
      });
      if (!revoked) return res.status(404).json({ error: 'not_found' });
      logRelay({ event: 'token-revoke', userId: auth.userId });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/tokens/:id', async (req, res, next) => {
    try {
      if (rejectLimited(res, deps.browserLimiter, browserKey(req))) return undefined;
      if (rejectBrowser(req, res, true)) return undefined;
      const user = userFromRequest(req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      const tokenId = String(req.params.id);
      const revoked = await revokeOneAgentToken(deps, user.id, tokenId, {
        heldPrompts: 'account',
        dropPresence: true,
      });
      if (!revoked) return res.status(404).json({ error: 'not_found' });
      logRelay({ event: 'token-revoke', userId: user.id });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/tabs', (req, res) => {
    if (rejectLimited(res, deps.browserLimiter, browserKey(req))) return undefined;
    if (rejectBrowser(req, res)) return undefined;
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    return res.json({ tabs: deps.registry.listTabs(user.id) });
  });

  router.post('/tabs/select', (req, res) => {
    if (rejectLimited(res, deps.browserLimiter, browserKey(req))) return undefined;
    if (rejectBrowser(req, res, true)) return undefined;
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
      const live = await requireLiveAgent(deps, req, res);
      if (!live) return undefined;
      const { auth, epoch } = live;
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
      if (!deps.registry.noteAgentSeen(auth.userId, { clearHold: true, epoch })) {
        return res.status(401).json({ error: 'Authentication required' });
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
      const live = await requireLiveAgent(deps, req, res);
      if (!live) return undefined;
      const { auth } = live;
      if (rejectLimited(res, deps.readLimiter, auth.id)) return undefined;
      const timeout = clampTimeout(req.query.timeout);
      res.status(200);
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      const result = await deps.registry.wait(auth.userId, String(req.params.id), timeout, auth.id);
      if (!result || result.status === 'revoked') {
        const error = result?.status === 'revoked' ? await authErrorCode(deps, auth) : 'not_found';
        const sseError = error === 'Authentication required' ? 'unauthorized' : error;
        res.write(`event: error\ndata: ${JSON.stringify({ error: sseError })}\n\n`);
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
      const live = await requireLiveAgent(deps, req, res);
      if (!live) return undefined;
      const { auth } = live;
      if (rejectLimited(res, deps.readLimiter, auth.id)) return undefined;
      const timeout = clampTimeout(req.query.timeout);
      const result = await deps.registry.wait(auth.userId, String(req.params.id), timeout, auth.id);
      if (!result) return res.status(404).json({ error: 'not_found' });
      if (result.status === 'revoked') {
        return res.status(401).json({ error: await authErrorCode(deps, auth) });
      }
      if (result.status === 'pending') {
        return res.json({ id: String(req.params.id), status: 'pending' });
      }
      return res.json({ id: String(req.params.id), status: 'done', response: result.response });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/prompts', async (req, res, next) => {
    /** @type {{ userId: string } | null} */
    let polling = null;
    let timeout = 0;
    let status = 'error';
    try {
      const live = await requireLiveAgent(deps, req, res);
      if (!live) return undefined;
      const { auth, epoch } = live;
      if (rejectLimited(res, deps.readLimiter, auth.id)) return undefined;
      if (!deps.registry.noteAgentSeen(auth.userId, { clearHold: true, epoch })) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      timeout = clampTimeout(req.query.timeout);
      polling = auth;
      logRelay({
        event: 'prompt-poll-start',
        userId: auth.userId,
        timeoutMs: timeout,
      });
      const result = await deps.registry.waitPrompts(auth.userId, timeout, auth.id);
      if (!result) {
        status = 'revoked';
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (result.status === 'revoked') {
        status = 'revoked';
        return res.status(401).json({ error: await authErrorCode(deps, auth) });
      }
      status = Array.isArray(result.messages) && result.messages.length > 0 ? 'messages' : 'empty';
      return res.json({ messages: result.messages });
    } catch (error) {
      return next(error);
    } finally {
      if (polling) {
        logRelay({
          event: 'prompt-poll-end',
          userId: polling.userId,
          status,
          timeoutMs: timeout,
        });
      }
    }
  });

  router.post('/prompts', async (req, res, next) => {
    try {
      const live = await requireLiveAgent(deps, req, res);
      if (!live) return undefined;
      const { auth, epoch } = live;
      const bytes = messageByteLength(req.body);
      if (bytes > deps.maxMessageBytes) {
        return res.status(413).json({ error: 'Message exceeds the size cap' });
      }
      const type = req.body && typeof req.body.type === 'string' ? req.body.type : '';
      if (!type.startsWith('agent.')) return res.status(400).json({ error: 'bad_call' });
      if (type === 'agent.close_session') {
        if (deps.registry.presenceEpoch(auth.userId) !== epoch) {
          return res.status(401).json({ error: 'Authentication required' });
        }
        deps.registry.endAgentSession(auth.userId);
        await deps.tokens.markUsed(auth);
        logRelay({ event: 'prompt', userId: auth.userId, type, bytes });
        return res.status(202).json({ ok: true });
      }
      if (!deps.registry.noteAgentSeen(auth.userId, { clearHold: true, epoch })) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (type === 'agent.progress') {
        deps.registry.forwardToTabs(auth.userId, { type: 'agent.progress', v: 1, working: true });
        await deps.tokens.markUsed(auth);
        logRelay({ event: 'prompt', userId: auth.userId, type, bytes });
        return res.status(202).json({ ok: true });
      }
      if (type === 'agent.message') {
        const problem = sessionMessageProblem(req.body);
        if (problem) return res.status(400).json({ error: problem });
        if (!deps.registry.allowSessionMessage(auth.userId)) {
          return res.status(429).json({ error: 'rate_limited' });
        }
      }
      deps.registry.forwardToTabs(auth.userId, req.body);
      await deps.tokens.markUsed(auth);
      logRelay({ event: 'prompt', userId: auth.userId, type, bytes });
      return res.status(202).json({ ok: true });
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

/**
 * Authenticate, then re-check the token. The presence epoch is captured
 * before that second check so a revoke in between cannot be cleared.
 * An expired pairing is `{ error: 'expired' }` and drops presence.
 * Does not stamp last-seen. Writes the 401 and returns null on failure.
 * @param {{
 *   tokens: {
 *     inspect: (raw: string | null) => Promise<{
 *       status: 'ok' | 'revoked' | 'expired' | 'missing',
 *       auth: { userId: string, id: string, tokenHash: string } | null,
 *     }>,
 *     status: (tokenHash: string) => Promise<'ok' | 'revoked' | 'expired' | 'missing'>,
 *   },
 *   registry: {
 *     presenceEpoch: (userId: string) => number,
 *     abortToken: (tokenId: string, userId: string) => void,
 *     expireAgentPairing: (userId: string) => void,
 *   },
 *   agentSockets?: { closeToken: (tokenId: string, code: number, reason: string) => number },
 * }} deps
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function requireLiveAgent(deps, req, res) {
  const found = await deps.tokens.inspect(readBearer(req.get('authorization')));
  if (found.status === 'expired') {
    forgetExpiredPairing(deps, found.auth);
    res.status(401).json({ error: 'expired' });
    return null;
  }
  if (found.status !== 'ok' || !found.auth) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  const epoch = deps.registry.presenceEpoch(found.auth.userId);
  const live = await deps.tokens.status(found.auth.tokenHash);
  if (live === 'expired') {
    forgetExpiredPairing(deps, found.auth);
    res.status(401).json({ error: 'expired' });
    return null;
  }
  if (live !== 'ok') {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return { auth: found.auth, epoch };
}

/**
 * A wait aborted after the request was accepted. Expiry is distinct from revoke.
 * @param {{ tokens: { status: (tokenHash: string) => Promise<string> } }} deps
 * @param {{ tokenHash: string }} auth
 */
async function authErrorCode(deps, auth) {
  const live = await deps.tokens.status(auth.tokenHash);
  return live === 'expired' ? 'expired' : 'Authentication required';
}
