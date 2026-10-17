// Guest-to-account conversion proof: emailed code + paid order in this session.
import crypto from 'crypto';

export const EXISTING_ACCOUNT_MESSAGE = 'An account with this email already exists. Please sign in.';
export const CONVERT_CODE_TTL_MS = 15 * 60 * 1000;
export const CONVERT_CODE_MAX_ATTEMPTS = 5;
export const CONVERT_CODE_RESEND_MS = 60 * 1000;

/** Statuses that mean the guest actually paid. */
export const PAID_ORDER_STATUSES = Object.freeze([
  'paid',
  'processing',
  'quality-check',
  'shipped',
  'delivered',
]);

export function hashGuestConvertCode(code) {
  return crypto.createHash('sha256').update(String(code).trim(), 'utf8').digest('hex');
}

export function guestConvertCodesMatch(provided, storedHash) {
  if (typeof storedHash !== 'string' || storedHash.length !== 64) return false;
  const hashed = hashGuestConvertCode(provided);
  try {
    return crypto.timingSafeEqual(Buffer.from(hashed, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

export function paidOrderQuery(guestEmail, guestId) {
  return {
    'guest-email': guestEmail,
    'guest-session-id': guestId,
    status: { $in: [...PAID_ORDER_STATUSES] },
  };
}

export function createGuestConvertProof({ email, guestId, code, now = Date.now() }) {
  return {
    email,
    guestId,
    codeHash: hashGuestConvertCode(code),
    expiresAt: now + CONVERT_CODE_TTL_MS,
    attempts: 0,
    sentAt: now,
  };
}

export function evaluateGuestConvertProof(proof, { email, guestId, code, now = Date.now() }) {
  if (!proof || proof.email !== email || proof.guestId !== guestId) {
    return { ok: false, status: 400, error: 'Request a verification code first.' };
  }
  if (now > proof.expiresAt) {
    return { ok: false, status: 400, error: 'Verification code has expired. Please request a new one.' };
  }
  if (proof.attempts >= CONVERT_CODE_MAX_ATTEMPTS) {
    return { ok: false, status: 400, error: 'Too many attempts. Please request a new code.' };
  }
  proof.attempts += 1;
  if (!guestConvertCodesMatch(code, proof.codeHash)) {
    const remaining = CONVERT_CODE_MAX_ATTEMPTS - proof.attempts;
    if (proof.attempts >= CONVERT_CODE_MAX_ATTEMPTS) {
      return { ok: false, status: 400, error: 'Too many attempts. Please request a new code.' };
    }
    return {
      ok: false,
      status: 400,
      error: `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
    };
  }
  return { ok: true };
}

export function convertCodeResendWait(proof, now = Date.now()) {
  if (!proof?.sentAt) return 0;
  const elapsed = now - proof.sentAt;
  if (elapsed >= CONVERT_CODE_RESEND_MS) return 0;
  return Math.ceil((CONVERT_CODE_RESEND_MS - elapsed) / 1000);
}

export function newGuestConvertCode() {
  return crypto.randomInt(100000, 999999).toString();
}
