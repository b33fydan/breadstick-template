// src/canvas/engine/registry.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { registerExecutor, getExecutor, clearRegistry } from './registry.js';

describe('executor registry', () => {
  beforeEach(() => clearRegistry());

  it('registers and retrieves by node type', () => {
    const spec = { execute: async () => ({ status: 'done' }) };
    registerExecutor('niche-gen', spec);
    expect(getExecutor('niche-gen')).toBe(spec);
  });

  it('returns null for unregistered types (passive nodes)', () => {
    expect(getExecutor('character')).toBeNull();
  });

  it('rejects specs without an execute function', () => {
    expect(() => registerExecutor('bad', {})).toThrow(/execute/);
  });

  it('rejects duplicate registration (catch wiring mistakes loudly)', () => {
    registerExecutor('x', { execute: async () => ({}) });
    expect(() => registerExecutor('x', { execute: async () => ({}) })).toThrow(/already registered/);
  });
});
