/**
 * Validation for POST /api/partners.
 */
import { PARTNER_TYPES, PARTNER_TYPE_VALUES } from '../../src/utils/partnerForm.js';

export { PARTNER_TYPES };

const LIMITS = {
  name: 200,
  email: 320,
  company: 200,
  website: 500,
  partnerTypeOther: 200,
  message: 5000,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @returns {{ ok: true, data: object } | { ok: false, status: number, error: string }}
 */
export function validatePartnerPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'Invalid request body' };
  }

  const honeypot = trimString(body.company_fax);
  if (honeypot) {
    return { ok: false, status: 200, honeypot: true };
  }

  const name = trimString(body.name);
  const email = trimString(body.email).toLowerCase();
  const company = trimString(body.company);
  const website = trimString(body.website);
  const partnerType = trimString(body.partnerType);
  const partnerTypeOther = trimString(body.partnerTypeOther);
  const message = trimString(body.message);

  if (!name) return { ok: false, status: 400, error: 'Name is required' };
  if (!email) return { ok: false, status: 400, error: 'Email is required' };
  if (!EMAIL_RE.test(email)) return { ok: false, status: 400, error: 'Email is invalid' };
  if (!company) return { ok: false, status: 400, error: 'Company is required' };
  if (!partnerType || !PARTNER_TYPE_VALUES.has(partnerType)) {
    return { ok: false, status: 400, error: 'Partner type is required' };
  }
  if (partnerType === 'other' && !partnerTypeOther) {
    return { ok: false, status: 400, error: 'Please describe what you offer' };
  }
  if (!message) return { ok: false, status: 400, error: 'Message is required' };

  const lengths = {
    name,
    email,
    company,
    website,
    partnerTypeOther,
    message,
  };
  for (const [field, max] of Object.entries(LIMITS)) {
    if (lengths[field].length > max) {
      return { ok: false, status: 400, error: `${field} is too long` };
    }
  }

  return {
    ok: true,
    data: {
      name,
      email,
      company,
      website,
      partnerType,
      partnerTypeOther: partnerType === 'other' ? partnerTypeOther : '',
      message,
    },
  };
}

export function partnerTypeLabel(value, otherText = '') {
  const hit = PARTNER_TYPES.find((row) => row.value === value);
  if (value === 'other' && otherText) return `Other — ${otherText}`;
  return hit?.label || value;
}
