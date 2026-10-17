/**
 * HTTP responses for the loopback popup bridge (`/bridge`, `/bridge.js`).
 * See `bridgePopup.mjs` for the browser side.
 */

import { readFileSync } from 'node:fs';

export const BRIDGE_PAGE_PATH = '/bridge';
export const BRIDGE_SCRIPT_PATH = '/bridge.js';

let cachedScript = null;

function bridgeScriptSource() {
  if (cachedScript == null) {
    cachedScript = readFileSync(new URL('./bridgePopup.mjs', import.meta.url), 'utf8');
  }
  return cachedScript;
}

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * The page must stay a top-level window: it cannot be framed, it does not
 * isolate its opener (COOP would null `window.opener`), and it sends no
 * Referer back out.
 *
 * @param {number} port
 */
export function bridgeSecurityHeaders(port) {
  return {
    'Content-Security-Policy': [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'unsafe-inline'",
      `connect-src ws://127.0.0.1:${port} ws://localhost:${port}`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'unsafe-none',
    'Cache-Control': 'no-store',
  };
}

/**
 * DNS-rebinding guard: only answer for the loopback host names the
 * SurfCAD tab actually opens.
 *
 * @param {string | undefined} hostHeader
 * @param {number} port
 */
export function isBridgeHostAllowed(hostHeader, port) {
  if (typeof hostHeader !== 'string') return false;
  const host = hostHeader.trim().toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/**
 * @param {{ extraOrigins?: string[] }} [opts]
 */
export function bridgePageHtml(opts = {}) {
  const extra = escapeHtmlAttr(JSON.stringify(opts.extraOrigins || []));
  return `<!doctype html>
<html lang="en" data-surfcad-bridge="1" data-extra-origins="${extra}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SurfCAD local agent bridge</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #15171a; color: #e6e8eb; }
  main { padding: 20px 22px; max-width: 420px; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  p { margin: 0 0 10px; color: #b3b8bf; }
  #bridge-status { color: #e6e8eb; padding: 8px 10px; border: 1px solid #2c3036; border-radius: 6px; background: #1c1f23; }
  html[data-status="connected"] #bridge-status { border-color: #1f6f4a; color: #7ee2b0; }
  html[data-status="forbidden"] #bridge-status, html[data-status="invalid"] #bridge-status { border-color: #7a2d2d; color: #f2a7a7; }
</style>
</head>
<body>
<main>
<h1>SurfCAD local agent bridge</h1>
<p>This window connects your SurfCAD tab to the local agent running on this computer (<code>npx surfcad-mcp</code>).</p>
<p><strong>Keep it open</strong> while the agent works. Closing it disconnects the agent.</p>
<p id="bridge-status" role="status" aria-live="polite">Starting…</p>
</main>
<script type="module" src="${BRIDGE_SCRIPT_PATH}"></script>
</body>
</html>
`;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ port: number, extraOrigins?: string[] }} opts
 * @returns {boolean} true when the request was a bridge route and has been answered
 */
export function handleBridgeRequest(req, res, opts) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let pathname;
  try {
    pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  } catch {
    return false;
  }
  if (pathname !== BRIDGE_PAGE_PATH && pathname !== BRIDGE_SCRIPT_PATH) return false;

  if (!isBridgeHostAllowed(req.headers.host, opts.port)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Host not allowed\n');
    return true;
  }

  const isPage = pathname === BRIDGE_PAGE_PATH;
  const body = isPage ? bridgePageHtml({ extraOrigins: opts.extraOrigins }) : bridgeScriptSource();
  res.writeHead(200, {
    ...bridgeSecurityHeaders(opts.port),
    'Content-Type': isPage ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
