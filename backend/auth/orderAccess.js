// Order lookup access + public projection. No Stripe/IP/card/notes/address.
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

export function emailsMatch(left, right) {
  const a = String(left ?? '').trim().toLowerCase();
  const b = String(right ?? '').trim().toLowerCase();
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function orderOwnerId(order) {
  const id = order?.['user-id'];
  return id == null || id === '' ? '' : String(id);
}

export function canReadOrder(req, order) {
  const ownerId = orderOwnerId(order);
  if (ownerId) {
    if (!req.isAuthenticated?.() || !req.user?._id) {
      return { ok: false, status: 401, error: 'Authentication required' };
    }
    if (String(req.user._id) !== ownerId) {
      return { ok: false, status: 403, error: 'Not authorized' };
    }
    return { ok: true };
  }

  const guestEmail = typeof req.query?.email === 'string' ? req.query.email : '';
  if (!emailsMatch(order['guest-email'], guestEmail)) {
    return { ok: false, status: 403, error: 'Email verification required' };
  }
  return { ok: true };
}

function itemSummaryFromOrder(order) {
  if (Array.isArray(order.lines) && order.lines.length > 0) {
    return order.lines.map((line) => ({
      partName: line.partName,
      process: line.process,
      material: line.material,
      quantity: line.quantity,
    }));
  }
  const md = order['model-data'];
  if (!md) return [];
  return [{
    process: md.process,
    material: md.material,
    quantity: Number(md.quantity) || 1,
  }];
}

/** Status, items, totals, shipping/tracking. No IP, UA, Stripe, card, notes, or address. */
export function publicOrderView(order) {
  const quote = order.quote || {};
  const shipping = order.shipping || {};
  return {
    orderNumber: order['order-number'],
    status: order.status,
    createdAt: order['created-at'],
    quote: {
      subtotal: quote.subtotal,
      'shipping-cost': quote['shipping-cost'],
      tax: quote.tax,
      total: quote.total,
    },
    items: itemSummaryFromOrder(order),
    shipping: {
      method: shipping.method,
      service: shipping.service,
      'tracking-number': shipping['tracking-number'],
      'tracking-url': shipping['tracking-url'],
    },
  };
}

/**
 * express-rate-limit uses req.ip, which honors Express `trust proxy`
 * (set from TRUST_PROXY_HOPS in serverApp).
 */
export function createOrderLookupLimiter({
  windowMs = 15 * 60 * 1000,
  limit = 40,
} = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many order lookups. Try again later.' },
  });
}
