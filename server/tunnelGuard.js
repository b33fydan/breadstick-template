// server/tunnelGuard.js — reject requests that arrive via a public tunnel /
// reverse proxy. Extracted pure (like mcp/routeGate.js) so it's vitest-covered
// without spawning the server.
//
// The server sets no `trust proxy`, so req.ip is the raw socket peer (always
// 127.0.0.1 for a cloudflared-forwarded request — which is why localhostOnly
// does NOT catch tunneled traffic). Cloudflared injects x-forwarded-for /
// cf-ray / cf-connecting-ip on every forwarded request; their presence is the
// reliable tunnel signal. A genuine localhost browser sets none of them.

export function viaTunnel(req) {
  const h = req.headers || {};
  const xff = h['x-forwarded-for'];
  if (xff && String(xff).trim()) return true;
  if (h['cf-ray'] || h['cf-connecting-ip'] || h['x-real-ip'] || h['forwarded']) return true;
  return false;
}

export function notViaTunnel(req, res, next) {
  if (viaTunnel(req)) {
    return res.status(403).json({ error: 'Forbidden — not available via tunnel/proxy' });
  }
  next();
}

function isLoopback(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

// A local-path import is more sensitive than an ordinary not-via-tunnel
// route: a hostile website can make a victim's browser connect to localhost,
// so the socket peer alone is insufficient. Require both a loopback peer and,
// when a browser Origin is present, a loopback Origin hostname. Origin-less
// local CLI/native clients remain supported.
export function localBrowserOnly(req, res, next) {
  const peer = req.ip || req.socket?.remoteAddress || '';
  const origin = String(req.headers?.origin || '').trim();
  let originAllowed = true;

  if (origin) {
    try {
      originAllowed = isLoopback(new URL(origin).hostname);
    } catch {
      originAllowed = false;
    }
  }

  if (!isLoopback(peer) || !originAllowed) {
    return res.status(403).json({ error: 'Forbidden - local browser request required' });
  }
  next();
}
