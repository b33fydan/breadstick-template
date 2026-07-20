// server/fsRouteGuards.test.js — wiring guard for local-filesystem routes.
//
// tunnelGuard.test.js proves localBrowserOnly BEHAVES correctly (loopback peer
// + loopback Origin pass; a LAN peer 403s). This suite proves it is actually
// WIRED onto every route that reads a caller-supplied path off local disk.
//
// notViaTunnel alone is not sufficient for these: it blocks proxy-forwarded
// traffic by header signature, but says nothing about the socket peer, so a
// direct LAN request to the machine's IP sails through it. Since server.js
// registers routes at import time (crons, WS server), this scans the source
// the same way tools/build_manifest.js does rather than booting the app.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const text = readFileSync(serverPath, 'utf8');

// Mirrors the route scan in tools/build_manifest.js, plus the middleware slice
// between the path string and the handler.
const ROUTE_RE = /app\.(get|post|patch|delete|put|use)\(\s*['"`]([^'"`]+)['"`]([^)]*)/g;

// Match any identifier ENDING in Path rather than a fixed list of names —
// a name list drifts the moment someone picks a new variable; the suffix does not.
const CALLER_PATH_IDENT = String.raw`\w*[Pp]ath|dir|folder|src|file`;
const DIRECT_PATH_RE = new RegExp(String.raw`req\.(query|body|params)\.(${CALLER_PATH_IDENT})\b`);
const DESTRUCTURED_PATH_RE = new RegExp(
  String.raw`\{[^}]*\b(${CALLER_PATH_IDENT})\b[^}]*\}\s*=\s*req\.(body|query|params)`,
);

function fsPathRoutes() {
  const matches = [];
  let m;
  while ((m = ROUTE_RE.exec(text)) !== null) {
    matches.push({ method: m[1].toUpperCase(), path: m[2], mw: m[3], index: m.index });
  }
  const out = [];
  for (let i = 0; i < matches.length; i++) {
    const r = matches[i];
    const body = text.slice(r.index, i + 1 < matches.length ? matches[i + 1].index : text.length);
    // Two shapes reach a caller path: direct (req.query.path) and destructured
    // (`const { path: filePath } = req.body`).
    const takesCallerPath = DIRECT_PATH_RE.test(body) || DESTRUCTURED_PATH_RE.test(body);
    // Disk reads also hide behind aliased dynamic imports —
    // `const { readFile: rf } = await import('fs/promises')` then `rf(filePath)`.
    const touchesDisk =
      /(sendFile|readFileSync|readFile|readdir|createReadStream|existsSync|statSync)\s*\(/.test(body) ||
      /\breadFile\s*:\s*\w+/.test(body);
    if (!takesCallerPath || !touchesDisk) continue;
    out.push({
      route: `${r.method} ${r.path}`,
      line: text.slice(0, r.index).split('\n').length,
      hasLocalBrowserOnly: /localBrowserOnly/.test(r.mw),
    });
  }
  return out;
}

describe('local-filesystem routes', () => {
  it('finds the known caller-supplied-path routes (scan sanity check)', () => {
    const paths = fsPathRoutes().map(r => r.route);
    // If this fails the scan heuristic drifted — fix the scan, not the expectation.
    expect(paths).toEqual(expect.arrayContaining([
      'GET /api/scan-folder',
      'GET /api/fs/browse',
      'GET /api/local-image',
      'GET /api/local-text',
      'GET /api/scan-videos',
      'GET /api/local-video',
      'GET /api/probe-media',
      // POST routes that read a local path AND ship the bytes to a public CDN —
      // the exfil surface, not just a read surface.
      'POST /api/kie/upload-file',
      'POST /api/upload-image',
      'POST /api/resolve-public-url',
      'POST /api/higgsfield/upload',
      // camelCase path params — invisible to a naive `\bpath\b` scan.
      'POST /api/remotion/animate-terminal',
    ]));
  });

  it('guards every caller-supplied-path route with localBrowserOnly', () => {
    const unguarded = fsPathRoutes()
      .filter(r => !r.hasLocalBrowserOnly)
      .map(r => `server.js:${r.line}  ${r.route}`);
    expect(unguarded).toEqual([]);
  });
});
