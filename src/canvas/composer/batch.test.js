import { describe, it, expect } from 'vitest';
import { acceptBatch, discardBatch, rejectNode } from './batch';

const ghost = (id) => ({
  id,
  type: 'qc-gate',
  position: { x: 0, y: 0 },
  className: 'cv-ghost',
  data: { ghost: true, composerBatch: 1 },
});

const solid = (id) => ({
  id,
  type: 'character',
  position: { x: 0, y: 0 },
  data: {},
});

const gEdge = (id, s, t) => ({
  id,
  source: s,
  target: t,
  type: 'pulse',
  className: 'cv-ghost-edge',
});

describe('batch helpers', () => {
  const nodes = [solid('keep'), ghost('cmp-1-a'), ghost('cmp-1-b')];
  const edges = [gEdge('cmp-1-e-a-b', 'cmp-1-a', 'cmp-1-b')];

  it('acceptBatch strips ghost state from batch nodes and edges, leaves others alone', () => {
    const r = acceptBatch(nodes, edges, 1);
    const a = r.nodes.find((n) => n.id === 'cmp-1-a');
    expect(a.data.ghost).toBe(false);
    expect(a.className).toBeUndefined();
    expect(r.edges[0].className).toBeUndefined();
    expect(r.nodes.find((n) => n.id === 'keep')).toEqual(solid('keep'));
  });

  it('discardBatch removes batch nodes and ALL edges touching them', () => {
    const extra = { id: 'hand-wired', source: 'keep', target: 'cmp-1-a', type: 'pulse' };
    const r = discardBatch(nodes, [...edges, extra], 1);
    expect(r.nodes.map((n) => n.id)).toEqual(['keep']);
    expect(r.edges).toEqual([]); // hand-wired edge dies with its ghost (spec edge case)
  });

  it('rejectNode removes one node and its edges, keeps the rest of the batch', () => {
    const r = rejectNode(nodes, edges, 'cmp-1-a');
    expect(r.nodes.map((n) => n.id)).toEqual(['keep', 'cmp-1-b']);
    expect(r.edges).toEqual([]);
  });
});
