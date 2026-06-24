import { describe, it, expect } from 'vitest';
import { layoutSpec } from './layout';

const spec = {
  nodes: [
    { ref: 'a', type: 'character' },
    { ref: 'b', type: 'ingredient' },
    { ref: 'c', type: 'ingredient' },
    { ref: 'd', type: 'ugc-gen' },
  ],
  edges: [
    { from: 'a', to: 'b' }, { from: 'a', to: 'c' },
    { from: 'b', to: 'd' }, { from: 'c', to: 'd' },
  ],
};

describe('layoutSpec', () => {
  it('assigns columns by topological depth, left to right', () => {
    const pos = layoutSpec(spec, { x: 100, y: 80 });
    expect(pos.a.x).toBeLessThan(pos.b.x);
    expect(pos.b.x).toEqual(pos.c.x);          // same depth, same column
    expect(pos.c.x).toBeLessThan(pos.d.x);
  });

  it('stacks same-column branches vertically without overlap', () => {
    const pos = layoutSpec(spec, { x: 100, y: 80 });
    expect(Math.abs(pos.b.y - pos.c.y)).toBeGreaterThanOrEqual(220);
  });

  it('is deterministic — exact positions, not just self-agreement', () => {
    const pos = layoutSpec(spec, { x: 0, y: 0 });
    expect(pos.a).toEqual({ x: 0, y: 0 });
    expect(pos.b).toEqual({ x: 360, y: 0 });
    expect(pos.c).toEqual({ x: 360, y: 220 });
    expect(pos.d).toEqual({ x: 720, y: 0 });
  });

  it('respects the origin offset', () => {
    const p0 = layoutSpec(spec, { x: 0, y: 0 });
    const p1 = layoutSpec(spec, { x: 500, y: 300 });
    expect(p1.a.x - p0.a.x).toBe(500);
    expect(p1.a.y - p0.a.y).toBe(300);
  });

  it('handles disconnected nodes (depth 0)', () => {
    const pos = layoutSpec({ nodes: [{ ref: 'solo', type: 'qc-gate' }], edges: [] }, { x: 0, y: 0 });
    expect(pos.solo).toEqual({ x: 0, y: 0 });
  });

  it('does not throw on cyclic input — cycle members park at depth 0', () => {
    const cyclic = {
      nodes: [{ ref: 'x', type: 'qc-gate' }, { ref: 'y', type: 'qc-gate' }],
      edges: [{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }],
    };
    const pos = layoutSpec(cyclic, { x: 10, y: 20 });
    expect(pos.x).toBeDefined();
    expect(pos.y).toBeDefined();
    expect(pos.x.x).toBe(10);   // depth 0 column
  });

  it('ignores self-loop edges instead of quarantining the chain', () => {
    const looped = {
      nodes: [{ ref: 'x', type: 'qc-gate' }, { ref: 'z', type: 'qc-gate' }],
      edges: [{ from: 'x', to: 'x' }, { from: 'x', to: 'z' }],
    };
    const pos = layoutSpec(looped, { x: 0, y: 0 });
    expect(pos.z.x).toBe(360);  // z still gets depth 1, chain not lost
  });
});
