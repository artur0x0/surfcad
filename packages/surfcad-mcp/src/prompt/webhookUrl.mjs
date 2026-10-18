/**
 * Webhook URL checks for in-viewer prompts.
 * The URL stays in process memory. Callers must not log it and must not write it to disk.
 * `SURFCAD_WEBHOOK_TLS_INSECURE=1` is a test switch: it allows a loopback target and,
 * for that loopback target only, a self-signed certificate. `NODE_ENV=production`
 * ignores the switch, so production keeps rejecting localhost and private addresses.
 */
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export const WEBHOOK_TLS_INSECURE_ENV = 'SURFCAD_WEBHOOK_TLS_INSECURE';

const block = new BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['100.64.0.0', 10],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  block.addSubnet(addr, prefix, 'ipv4');
}
block.addAddress('::', 'ipv6');
block.addAddress('::1', 'ipv6');
block.addSubnet('fc00::', 7, 'ipv6');
block.addSubnet('fe80::', 10, 'ipv6');
block.addSubnet('ff00::', 8, 'ipv6');
block.addSubnet('2001:db8::', 32, 'ipv6');

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function webhookInsecureTlsAllowed(env = process.env) {
  if (!env || env.NODE_ENV === 'production') return false;
  return env[WEBHOOK_TLS_INSECURE_ENV] === '1';
}

/**
 * @param {string} hostname
 */
export function isLoopbackName(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === 'localhost' || host === 'localhost.localdomain' || host.endsWith('.localhost');
}

/**
 * @param {string} ip
 */
export function isLoopbackIp(ip) {
  const lower = String(ip || '').toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice('::ffff:'.length);
    return isIP(v4) === 4 && v4.startsWith('127.');
  }
  return isIP(lower) === 4 && lower.startsWith('127.');
}

/**
 * @param {string} hostname
 */
export function isLoopbackHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  return isLoopbackName(host) || isLoopbackIp(host);
}

/**
 * @param {string} hostname
 */
function isPrivateName(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return isLoopbackName(host) || host.endsWith('.local');
}

/**
 * @param {string} hostname
 */
function isObfuscatedIp(hostname) {
  if (/^0x[0-9a-f]+$/i.test(hostname)) return true;
  if (/^\d+$/.test(hostname)) return true;
  const parts = hostname.split('.');
  if (parts.length >= 2 && parts.length <= 4 && parts.every((part) => /^(0x[0-9a-f]+|\d+)$/i.test(part))) {
    if (isIP(hostname) !== 4) return true;
  }
  return false;
}

/**
 * @param {string} ip
 */
function expandedIps(ip) {
  const lower = String(ip || '').toLowerCase();
  const out = [lower];
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice('::ffff:'.length);
    if (isIP(v4) === 4) out.push(v4);
  }
  return out;
}

/**
 * @param {string} ip
 */
export function isBlockedIp(ip) {
  for (const candidate of expandedIps(ip)) {
    const kind = isIP(candidate);
    if (kind === 0) return true;
    if (block.check(candidate, kind === 4 ? 'ipv4' : 'ipv6')) return true;
  }
  return false;
}

/**
 * @param {string} message
 */
function fail(message) {
  return { ok: false, code: 'bad_webhook_url', message };
}

/**
 * @param {string} hostname
 */
export async function defaultResolveHost(hostname) {
  const pending = lookup(hostname, { all: true, verbatim: true });
  let timer;
  try {
    return await Promise.race([
      pending.then((rows) => rows.map((row) => row.address)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('dns_timeout')), 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * @param {unknown} raw
 * @param {{ allowLoopback?: boolean, resolveHost?: (hostname: string) => Promise<string[]> }} [options]
 * @returns {Promise<{ ok: true, host: string, addresses: string[] } | { ok: false, code: string, message: string }>}
 */
export async function validateWebhookUrl(raw, options = {}) {
  if (typeof raw !== 'string') return fail('Webhook URL is required');
  const text = raw.trim();
  if (!text || text.length > 2048 || /\s/.test(text) || text.includes('\0')) {
    return fail(text ? 'Webhook URL is not a valid URL' : 'Webhook URL is required');
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    return fail('Webhook URL is not a valid URL');
  }
  if (url.protocol !== 'https:') return fail('Webhook URL must use https');
  const authority = text.slice(text.indexOf('://') + 3).split('/')[0];
  if (url.username || url.password || authority.includes('@')) {
    return fail('Webhook URL must not include credentials');
  }
  if (url.port === '0') return fail('Webhook URL port is not allowed');
  const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
  if (!hostname || isObfuscatedIp(hostname)) {
    return fail(hostname ? 'Webhook URL must not target a private address' : 'Webhook URL is not a valid URL');
  }

  const allowLoopback = options.allowLoopback === true;
  if (isPrivateName(hostname)) {
    if (!(allowLoopback && isLoopbackName(hostname))) {
      return fail('Webhook URL must not target localhost or a private address');
    }
    return { ok: true, host: hostname, addresses: ['127.0.0.1'] };
  }

  let addresses;
  if (isIP(hostname) !== 0) {
    addresses = [hostname];
  } else {
    const resolveHost = options.resolveHost || defaultResolveHost;
    try {
      addresses = await resolveHost(hostname);
    } catch {
      return fail('Webhook host could not be resolved');
    }
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return fail('Webhook host could not be resolved');
  }
  for (const address of addresses) {
    if (typeof address !== 'string' || isIP(address) === 0) {
      return fail('Webhook host could not be resolved');
    }
    if (!isBlockedIp(address)) continue;
    if (allowLoopback && isLoopbackIp(address)) continue;
    return fail('Webhook URL must not target localhost or a private address');
  }
  return { ok: true, host: hostname, addresses };
}
