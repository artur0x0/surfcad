// Per-IP cooldown for /register code sends. Per-email uses User.canResendCode.
import { CONVERT_CODE_RESEND_MS, convertCodeResendWait } from './guestConvert.js';

const ipSentAt = new Map();

export function registerIpWait(ip, now = Date.now()) {
  return convertCodeResendWait(ipSentAt.get(String(ip || '')), now);
}

export function recordRegisterIp(ip, now = Date.now()) {
  const key = String(ip || '');
  if (!key) return;
  ipSentAt.set(key, now);
}

export function resetRegisterCooldowns() {
  ipSentAt.clear();
}

export { CONVERT_CODE_RESEND_MS as REGISTER_CODE_RESEND_MS };
