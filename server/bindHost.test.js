import { describe, it, expect } from 'vitest';
import { resolveBindHost } from './bindHost.js';

describe('resolveBindHost', () => {
  it('defaults to loopback so the API is not exposed to the LAN', () => {
    expect(resolveBindHost({})).toBe('127.0.0.1');
    expect(resolveBindHost({ BREADSTICK_HOST: '' })).toBe('127.0.0.1');
    expect(resolveBindHost({ BREADSTICK_HOST: '   ' })).toBe('127.0.0.1');
  });

  it('honours an explicit BREADSTICK_HOST opt-in', () => {
    expect(resolveBindHost({ BREADSTICK_HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveBindHost({ BREADSTICK_HOST: '192.168.1.20' })).toBe('192.168.1.20');
  });

  it('trims surrounding whitespace from the override', () => {
    expect(resolveBindHost({ BREADSTICK_HOST: '  0.0.0.0  ' })).toBe('0.0.0.0');
  });
});
