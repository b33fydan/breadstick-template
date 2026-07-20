// server/bindHost.js — which interface the API proxy listens on.
//
// Extracted pure (like tunnelGuard.js / mcp/routeGate.js) so it's vitest-covered
// without spawning the server.
//
// Default is loopback. server.listen(PORT) with no host argument binds 0.0.0.0,
// which put every route — including the local-filesystem readers — on the LAN.
// Those routes now also require a loopback peer (see tunnelGuard.localBrowserOnly),
// so this is defence in depth rather than the only thing standing in the way.
//
// Set BREADSTICK_HOST=0.0.0.0 to opt back into LAN exposure when something off-box
// genuinely needs to reach the proxy. Failure mode of the default is loud
// (connection refused), never silent.

export function resolveBindHost(env = process.env) {
  const override = String(env.BREADSTICK_HOST || '').trim();
  return override || '127.0.0.1';
}
