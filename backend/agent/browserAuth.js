import { ServerResponse } from 'node:http';
import passport from 'passport';
import { enforceCredentialRevocation } from '../auth/session.js';
import { hashApprovingSession } from './sessionKey.js';

/**
 * Run the same session and passport stack a normal request uses, against
 * the WebSocket upgrade. The fake response is never flushed.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('express').RequestHandler} sessionMiddleware
 * @returns {Promise<{ id: string, sessionKey: string | null } | null>}
 */
export function authenticateBrowserUpgrade(req, sessionMiddleware) {
  const res = new ServerResponse(req);
  res.on('error', () => {});
  return new Promise((resolve, reject) => {
    sessionMiddleware(req, res, (err) => {
      if (err) return reject(err);
      passport.initialize()(req, res, (errInit) => {
        if (errInit) return reject(errInit);
        passport.session()(req, res, (errSession) => {
          if (errSession) return reject(errSession);
          enforceCredentialRevocation(req, res, (errRevoke) => {
            if (errRevoke) return reject(errRevoke);
            if (!req.isAuthenticated?.() || !req.user) return resolve(null);
            const id = req.user._id ?? req.user.id;
            if (id == null) return resolve(null);
            return resolve({
              id: String(id),
              sessionKey: hashApprovingSession(req.sessionID),
            });
          });
        });
      });
    });
  });
}
