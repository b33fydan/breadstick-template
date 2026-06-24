// src/canvas/engine/graphOrder.test.js
import { describe, it, expect } from 'vitest';
import { subgraphOrder } from './graphOrder.js';

const n = (id) => ({ id, type: id.split('-')[0] });
const e = (source, target) => ({ id: `${source}->${target}`, source, target });

describe('subgraphOrder', () => {
  it('orders a linear chain upstream-first', () => {
    const nodes = [n('script-1'), n('art-1'), n('carousel-1')];
    const edges = [e('script-1', 'art-1'), e('art-1', 'carousel-1')];
    expect(subgraphOrder(nodes, edges, 'carousel-1').map(x => x.id))
      .toEqual(['script-1', 'art-1', 'carousel-1']);
  });

  it('handles diamonds — both branches before the join, each exactly once', () => {
    const nodes = [n('script-1'), n('art-1'), n('title-1'), n('sandwich-1')];
    const edges = [
      e('script-1', 'art-1'), e('script-1', 'title-1'),
      e('art-1', 'sandwich-1'), e('title-1', 'sandwich-1'),
    ];
    const order = subgraphOrder(nodes, edges, 'sandwich-1').map(x => x.id);
    expect(order).toHaveLength(4);
    expect(order[0]).toBe('script-1');
    expect(order[3]).toBe('sandwich-1');
    expect(order.slice(1, 3).sort()).toEqual(['art-1', 'title-1']);
  });

  it('ignores nodes not upstream of the target', () => {
    const nodes = [n('script-1'), n('art-1'), n('stray-1')];
    const edges = [e('script-1', 'art-1'), e('stray-1', 'stray-1x')];
    expect(subgraphOrder(nodes, edges, 'art-1').map(x => x.id))
      .toEqual(['script-1', 'art-1']);
  });

  it('throws on unknown target', () => {
    expect(() => subgraphOrder([n('a-1')], [], 'nope')).toThrow(/unknown target/i);
  });

  it('throws on cycles', () => {
    const nodes = [n('a-1'), n('b-1')];
    const edges = [e('a-1', 'b-1'), e('b-1', 'a-1')];
    expect(() => subgraphOrder(nodes, edges, 'b-1')).toThrow(/cycle/i);
  });
});
