// src/canvas/engine/executeGraph.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { executeGraph } from './executeGraph.js';
import { registerExecutor, clearRegistry } from './registry.js';

const n = (id, type, data = {}) => ({ id, type, data });
const e = (source, target) => ({ id: `${source}->${target}`, source, target });

describe('executeGraph', () => {
  beforeEach(() => clearRegistry());

  it('runs executors upstream-first, passes upstream outputs as inputs', async () => {
    const seen = {};
    registerExecutor('script', { execute: async () => ({ status: 'done', script: '1. hello' }) });
    registerExecutor('art', {
      execute: async (ctx) => {
        seen.inputs = ctx.inputs;
        return { batchStatus: 'done', slides: [{ status: 'done', url: 'http://img/1.png' }] };
      },
    });
    const result = await executeGraph({
      nodes: [n('s1', 'script'), n('a1', 'art')],
      edges: [e('s1', 'a1')],
      targetId: 'a1',
      outputs: {},
      ctx: { server: 'http://x', keys: {}, report: () => {} },
    });
    expect(result.outputs.s1.script).toBe('1. hello');
    expect(result.outputs.a1.batchStatus).toBe('done');
    expect(seen.inputs).toEqual([
      { sourceId: 's1', sourceType: 'script', sourceData: {}, output: { status: 'done', script: '1. hello' }, edge: e('s1', 'a1') },
    ]);
  });

  it('inputs carry sourceData from passive source nodes (null when the node has no data)', async () => {
    // UGC head nodes (character/ingredient/type) are passive DATA nodes — their
    // payload lives in node.data, never in outputs. Executors read it here.
    const seen = {};
    registerExecutor('ugc-gen', { execute: async (ctx) => { seen.inputs = ctx.inputs; return { status: 'done' }; } });
    await executeGraph({
      nodes: [n('char1', 'character', { character: { name: 'Mia' } }), { id: 'bare1', type: 'character' }, n('g1', 'ugc-gen')],
      edges: [e('char1', 'g1'), e('bare1', 'g1')],
      targetId: 'g1',
      outputs: {},
      ctx: { server: 'http://x', keys: {}, report: () => {} },
    });
    expect(seen.inputs[0].sourceData).toEqual({ character: { name: 'Mia' } });
    expect(seen.inputs[1].sourceData).toBeNull();
  });

  it('passive nodes (no executor) contribute their existing output downstream', async () => {
    const seen = {};
    registerExecutor('art', { execute: async (ctx) => { seen.inputs = ctx.inputs; return { batchStatus: 'done' }; } });
    const result = await executeGraph({
      nodes: [n('char1', 'character'), n('a1', 'art')],
      edges: [e('char1', 'a1')],
      targetId: 'a1',
      outputs: { char1: { name: 'Mia' } },
      ctx: { server: 'http://x', keys: {}, report: () => {} },
    });
    expect(seen.inputs[0].output).toEqual({ name: 'Mia' });
    expect(result.outputs.char1).toEqual({ name: 'Mia' }); // untouched
  });

  it('skips nodes whose output is already done unless force', async () => {
    let ran = 0;
    registerExecutor('script', { execute: async () => { ran++; return { status: 'done', script: 'fresh' }; } });
    const base = {
      nodes: [n('s1', 'script')], edges: [], targetId: 's1',
      ctx: { server: 'http://x', keys: {}, report: () => {} },
    };
    const r1 = await executeGraph({ ...base, outputs: { s1: { status: 'done', script: 'cached' } } });
    expect(ran).toBe(0);
    expect(r1.outputs.s1.script).toBe('cached');
    const r2 = await executeGraph({ ...base, outputs: { s1: { status: 'done', script: 'cached' } }, force: true });
    expect(ran).toBe(1);
    expect(r2.outputs.s1.script).toBe('fresh');
  });

  it('halts the lane on executor failure and reports the error patch', async () => {
    const reported = [];
    registerExecutor('script', { execute: async () => { throw new Error('boom'); } });
    registerExecutor('art', { execute: async () => ({ batchStatus: 'done' }) });
    const result = await executeGraph({
      nodes: [n('s1', 'script'), n('a1', 'art')],
      edges: [e('s1', 'a1')],
      targetId: 'a1',
      outputs: {},
      ctx: { server: 'http://x', keys: {}, report: (id, patch) => reported.push([id, patch]) },
    });
    expect(result.error).toMatch(/boom/);
    expect(result.failedNodeId).toBe('s1');
    expect(result.outputs.a1).toBeUndefined(); // downstream never ran
    expect(reported.some(([id, p]) => id === 's1' && p.status === 'error')).toBe(true);
  });

  it('closes out an in-flight renderStatus when the executor fails after reporting it', async () => {
    // Live-fire 2026-06-12: carouselRender reports renderStatus:'rendering' then
    // throws on bad config. The old error patch ({status:'error'} only) left
    // renderStatus stuck at 'rendering', which disables the legacy Render button.
    const reported = [];
    registerExecutor('carousel', {
      execute: async (ctx) => {
        ctx.report({ renderStatus: 'rendering', renderedSlides: [], error: '' });
        throw new Error('render blew up');
      },
    });
    const result = await executeGraph({
      nodes: [n('c1', 'carousel')], edges: [], targetId: 'c1', outputs: {},
      ctx: { server: 'http://x', keys: {}, report: (id, patch) => reported.push([id, patch]) },
    });
    expect(result.error).toMatch(/render blew up/);
    const finalPatch = reported[reported.length - 1][1];
    expect(finalPatch.status).toBe('error');
    expect(finalPatch.renderStatus).toBe('error');
  });

  it('closes out an in-flight batchStatus when the executor fails after reporting it', async () => {
    const reported = [];
    registerExecutor('art', {
      execute: async (ctx) => {
        ctx.report({ batchStatus: 'generating', slides: [] });
        throw new Error('kie down');
      },
    });
    await executeGraph({
      nodes: [n('a1', 'art')], edges: [], targetId: 'a1', outputs: {},
      ctx: { server: 'http://x', keys: {}, report: (id, patch) => reported.push([id, patch]) },
    });
    const finalPatch = reported[reported.length - 1][1];
    expect(finalPatch.status).toBe('error');
    expect(finalPatch.batchStatus).toBe('error');
  });

  it('closes out an in-flight status restored from a previous interrupted session', async () => {
    // A reload can hydrate nodeOutputs with renderStatus:'rendering' from a run
    // that died mid-flight. If the node then fails before reporting anything,
    // the error patch must still clear the stale in-flight value.
    const reported = [];
    registerExecutor('carousel', {
      execute: async () => { throw new Error('immediate fail'); },
    });
    await executeGraph({
      nodes: [n('c1', 'carousel')], edges: [], targetId: 'c1',
      outputs: { c1: { renderStatus: 'rendering', renderedSlides: [] } },
      ctx: { server: 'http://x', keys: {}, report: (id, patch) => reported.push([id, patch]) },
    });
    const finalPatch = reported[reported.length - 1][1];
    expect(finalPatch.renderStatus).toBe('error');
  });

  it('does not invent status fields the executor never reported', async () => {
    // Invariant pin (passes before and after the closeout fix): the error patch
    // must not pollute node output shapes with fields the node type never uses.
    const reported = [];
    registerExecutor('script', { execute: async () => { throw new Error('boom'); } });
    await executeGraph({
      nodes: [n('s1', 'script')], edges: [], targetId: 's1', outputs: {},
      ctx: { server: 'http://x', keys: {}, report: (id, patch) => reported.push([id, patch]) },
    });
    const finalPatch = reported[reported.length - 1][1];
    expect(finalPatch.status).toBe('error');
    expect('renderStatus' in finalPatch).toBe(false);
    expect('batchStatus' in finalPatch).toBe(false);
  });

  it('exposes nodes and edges on executor ctx for upstream walks', async () => {
    // UGC live-fire 2026-06-12: ugc-gen needs the character TWO hops up
    // (char → ingredient → ugc-gen; house rule forbids wiring char directly).
    // Direct inputs cannot see it — executors get the graph to walk.
    let seen = null;
    registerExecutor('gen', { execute: async (ctx) => { seen = { nodes: ctx.nodes, edges: ctx.edges }; return { status: 'done' }; } });
    const nodes = [n('c1', 'character', { character: { name: 'Mia' } }), n('i1', 'ingredient', { kind: 'pp', index: 0 }), n('g1', 'gen')];
    const edges = [e('c1', 'i1'), e('i1', 'g1')];
    await executeGraph({
      nodes, edges, targetId: 'g1', outputs: {},
      ctx: { server: 'http://x', keys: {}, report: () => {} },
    });
    expect(seen.nodes).toBe(nodes);
    expect(seen.edges).toBe(edges);
  });

  it('retries retryable executors exactly once', async () => {
    let attempts = 0;
    registerExecutor('flaky', {
      retryable: true,
      execute: async () => {
        attempts++;
        if (attempts === 1) throw new Error('transient');
        return { status: 'done' };
      },
    });
    const result = await executeGraph({
      nodes: [n('f1', 'flaky')], edges: [], targetId: 'f1', outputs: {},
      ctx: { server: 'http://x', keys: {}, report: () => {} },
    });
    expect(attempts).toBe(2);
    expect(result.outputs.f1.status).toBe('done');
    expect(result.error).toBeNull();
  });
});
