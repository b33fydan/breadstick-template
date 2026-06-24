// mcp/server.test.js — pure-logic coverage for the MCP server's manifest
// gate (mcp/routeGate.js). The stdio transport itself is exercised by
// mcp/smoke.mjs; these tests cover the permission boundary without spawning.
import { describe, it, expect } from 'vitest';
import { gateRequest } from './routeGate.js';

// Minimal manifest-shaped serverRoutes fixture mirroring the real entries
// the gate has to discriminate between.
const routes = [
  { method: 'POST', path: '/api/generate' },
  { method: 'GET', path: '/api/kie/status/:taskId' },
  { method: 'GET', path: '/api/scan-folder' },
  { method: 'POST', path: '/api/exec', streaming: true },
  { method: 'GET', path: '/api/ptt/stream', streaming: true },
  { method: 'DELETE', path: '/api/wire-buffer/:nodeId' },
  { method: 'POST', path: '/api/wire-buffer/:nodeId' },
  { method: 'USE', path: '/carousels' },
];

describe('gateRequest — exact path match', () => {
  it('allows a known POST route', () => {
    const res = gateRequest(routes, 'POST', '/api/generate');
    expect(res.ok).toBe(true);
    expect(res.route.path).toBe('/api/generate');
  });

  it('allows a known GET route with a query string (matches pathname only)', () => {
    const res = gateRequest(routes, 'GET', '/api/scan-folder?path=C:%5Cfoo');
    expect(res.ok).toBe(true);
    expect(res.route.path).toBe('/api/scan-folder');
  });

  it('normalizes lowercase method input', () => {
    expect(gateRequest(routes, 'post', '/api/generate').ok).toBe(true);
  });
});

describe('gateRequest — :param segment matching', () => {
  it('matches a :param segment against any non-empty value', () => {
    const res = gateRequest(routes, 'GET', '/api/kie/status/task_abc123');
    expect(res.ok).toBe(true);
    expect(res.route.path).toBe('/api/kie/status/:taskId');
  });

  it('rejects when the :param segment is empty', () => {
    expect(gateRequest(routes, 'GET', '/api/kie/status/').ok).toBe(false);
  });

  it('rejects when there are extra trailing segments', () => {
    expect(gateRequest(routes, 'GET', '/api/kie/status/abc/extra').ok).toBe(false);
  });

  it('picks the method-matching entry when one path has multiple verbs', () => {
    const res = gateRequest(routes, 'POST', '/api/wire-buffer/node-7');
    expect(res.ok).toBe(true);
    expect(res.route.method).toBe('POST');
  });
});

describe('gateRequest — streaming rejection', () => {
  it('rejects streaming POST routes with an SSE explanation', () => {
    const res = gateRequest(routes, 'POST', '/api/exec');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/SSE/);
  });

  it('rejects streaming GET routes', () => {
    const res = gateRequest(routes, 'GET', '/api/ptt/stream');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/streaming/i);
  });
});

describe('gateRequest — rejections', () => {
  it('rejects unknown paths with a pointer to the manifest', () => {
    const res = gateRequest(routes, 'GET', '/api/not-a-route');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/breadstick-manifest\.json/);
  });

  it('rejects a method mismatch on a known path, listing what is allowed', () => {
    const res = gateRequest(routes, 'GET', '/api/generate');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/POST/);
  });

  it('rejects DELETE outright — only GET/POST forwarded', () => {
    const res = gateRequest(routes, 'DELETE', '/api/wire-buffer/node-7');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/GET and POST only/);
  });

  it('does not prefix-match USE static mounts', () => {
    expect(gateRequest(routes, 'GET', '/carousels/foo/slide1.png').ok).toBe(false);
  });

  it('rejects paths missing the leading slash', () => {
    expect(gateRequest(routes, 'GET', 'api/generate').ok).toBe(false);
  });

  it('handles an empty/missing routes array without throwing', () => {
    expect(gateRequest([], 'GET', '/api/generate').ok).toBe(false);
    expect(gateRequest(undefined, 'GET', '/api/generate').ok).toBe(false);
  });
});
