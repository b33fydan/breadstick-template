import { describe, it, expect, vi } from 'vitest';
import { localBrowserOnly, viaTunnel, notViaTunnel } from './tunnelGuard.js';

const mkRes = () => { const r = { status: vi.fn(() => r), json: vi.fn(() => r) }; return r; };

describe('viaTunnel', () => {
  it('true when x-forwarded-for present and non-empty', () => {
    expect(viaTunnel({ headers: { 'x-forwarded-for': '1.2.3.4' } })).toBe(true);
  });
  it('true on cf-ray / cf-connecting-ip', () => {
    expect(viaTunnel({ headers: { 'cf-ray': 'abc' } })).toBe(true);
    expect(viaTunnel({ headers: { 'cf-connecting-ip': '9.9.9.9' } })).toBe(true);
  });
  it('false for a bare localhost request', () => {
    expect(viaTunnel({ headers: {} })).toBe(false);
  });
  it('false when x-forwarded-for is empty/whitespace', () => {
    expect(viaTunnel({ headers: { 'x-forwarded-for': '   ' } })).toBe(false);
  });
});

describe('notViaTunnel', () => {
  it('403s a tunneled request and does not call next', () => {
    const res = mkRes(); const next = vi.fn();
    notViaTunnel({ headers: { 'cf-ray': 'x' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
  it('calls next for a clean localhost request', () => {
    const res = mkRes(); const next = vi.fn();
    notViaTunnel({ headers: {} }, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('localBrowserOnly', () => {
  it('allows loopback browsers and origin-less local clients', () => {
    for (const request of [
      { ip: '::1', headers: { origin: 'http://127.0.0.1:5173' } },
      { ip: '::ffff:127.0.0.1', headers: { origin: 'http://localhost:5173' } },
      { socket: { remoteAddress: '127.0.0.1' }, headers: {} },
    ]) {
      const res = mkRes(); const next = vi.fn();
      localBrowserOnly(request, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('rejects LAN peers and hostile or opaque browser origins', () => {
    for (const request of [
      { ip: '192.168.1.50', headers: { origin: 'http://localhost:5173' } },
      { ip: '127.0.0.1', headers: { origin: 'https://evil.example' } },
      { ip: '127.0.0.1', headers: { origin: 'null' } },
      { ip: '127.0.0.1', headers: { origin: 'https://localhost.evil.example' } },
    ]) {
      const res = mkRes(); const next = vi.fn();
      localBrowserOnly(request, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });
});
