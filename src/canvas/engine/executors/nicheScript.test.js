// src/canvas/engine/executors/nicheScript.test.js
import { describe, it, expect } from 'vitest';
import { nicheScriptExecutor } from './nicheScript.js';

const fakeFetch = (handler) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  const r = handler(url, body);
  return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.json };
};

const baseCtx = (overrides = {}) => ({
  node: { id: 'ng1', type: 'niche-gen', data: { topic: 'zero trust', tone: 'dramatic', length: 'medium' } },
  inputs: [],
  outputs: {},
  report: () => {},
  server: 'http://test:3001',
  keys: { anthropic: 'ak', kie: 'kk', model: 'claude-sonnet-4-6' },
  ...overrides,
});

describe('nicheScriptExecutor', () => {
  it('posts to /api/generate and returns the legacy output shape', async () => {
    let captured;
    const ctx = baseCtx({
      fetchImpl: fakeFetch((url, body) => {
        captured = { url, body };
        return { json: { content: [{ type: 'text', text: '1. Hook line.\n2. Payoff.' }] } };
      }),
    });
    const out = await nicheScriptExecutor.execute(ctx);
    expect(captured.url).toBe('http://test:3001/api/generate');
    expect(captured.body.model).toBe('claude-sonnet-4-6');
    expect(captured.body.system).toContain('visual storytelling scriptwriter');
    expect(captured.body.messages[0].content).toContain('zero trust');
    expect(out).toEqual({ status: 'done', script: '1. Hook line.\n2. Payoff.', error: '' });
  });

  it('throws on missing topic or key (engine converts throw to error patch)', async () => {
    await expect(nicheScriptExecutor.execute(baseCtx({ node: { id: 'x', type: 'niche-gen', data: {} } })))
      .rejects.toThrow(/topic/i);
    await expect(nicheScriptExecutor.execute(baseCtx({ keys: { anthropic: '', model: 'm' } })))
      .rejects.toThrow(/anthropic/i);
  });

  it('reports generating status before the call', async () => {
    const patches = [];
    const ctx = baseCtx({
      report: (p) => patches.push(p),
      fetchImpl: fakeFetch(() => ({ json: { content: [{ type: 'text', text: 'x' }] } })),
    });
    await nicheScriptExecutor.execute(ctx);
    expect(patches[0]).toEqual({ status: 'generating', script: '', error: '' });
  });

  it('throws on HTTP error', async () => {
    const ctx = baseCtx({
      fetchImpl: fakeFetch(() => ({ status: 503, json: {} })),
    });
    await expect(nicheScriptExecutor.execute(ctx)).rejects.toThrow(/API error 503/);
  });

  it('throws on empty content', async () => {
    const ctx = baseCtx({
      fetchImpl: fakeFetch(() => ({ json: { content: [] } })),
    });
    await expect(nicheScriptExecutor.execute(ctx)).rejects.toThrow(/empty script/i);
  });
});
