// mcp/routeGate.js — manifest-as-permission-boundary matcher for call_endpoint.
//
// The MCP server's generic proxy tool only forwards a request when the
// (method, path) pair resolves to a route the capability manifest knows
// about. This module is the pure decision logic, extracted so it can be
// vitest-covered without spawning the stdio server.

// Methods the proxy will forward at all. SSE routes are excluded separately
// (streaming never fits a single MCP request/response), and DELETE/PUT/USE
// routes stay browser-only on purpose.
const ALLOWED_METHODS = new Set(['GET', 'POST']);

// Express-style segment match: ':param' segments accept any single non-empty
// segment; everything else must match exactly. No prefix matching — `USE`
// static mounts are intentionally unreachable through the gate.
function pathMatches(routePath, requestPath) {
  const routeSegs = routePath.split('/');
  const reqSegs = requestPath.split('/');
  if (routeSegs.length !== reqSegs.length) return false;
  return routeSegs.every((seg, i) =>
    seg.startsWith(':') ? reqSegs[i].length > 0 : seg === reqSegs[i]
  );
}

// Decide whether a request may pass. `routes` is the manifest's serverRoutes
// array ([{ method, path, streaming?, description? }]). Returns
//   { ok: true,  route }            — forward it
//   { ok: false, error: '...' }     — reject with this message
export function gateRequest(routes, method, path) {
  const verb = String(method || '').toUpperCase();
  if (!ALLOWED_METHODS.has(verb)) {
    return { ok: false, error: `Method ${verb || '(empty)'} not allowed — call_endpoint forwards GET and POST only.` };
  }
  if (!path || !path.startsWith('/')) {
    return { ok: false, error: `Path must start with "/" (got: ${JSON.stringify(path)}).` };
  }

  // Match on the pathname only; the query string rides along untouched when
  // the request is forwarded (e.g. GET /api/scan-folder?path=...).
  const pathname = path.split('?')[0];

  const pathHits = (routes || []).filter((r) => pathMatches(r.path, pathname));
  if (pathHits.length === 0) {
    return { ok: false, error: `No route in breadstick-manifest.json matches ${pathname}. Run breadstick_capabilities({ section: "serverRoutes" }) to see the route surface, or "npm run manifest" if the manifest is stale.` };
  }

  const route = pathHits.find((r) => r.method === verb);
  if (!route) {
    const allowed = pathHits.map((r) => r.method).join(', ');
    return { ok: false, error: `${pathname} exists but not for ${verb} (manifest allows: ${allowed}).` };
  }

  if (route.streaming) {
    return { ok: false, error: `${verb} ${route.path} is a streaming (SSE) route — it emits events over a held-open connection, which does not fit MCP's single request/response shape. Use the canvas Terminal / Command Runner UI for this route.` };
  }

  return { ok: true, route };
}
