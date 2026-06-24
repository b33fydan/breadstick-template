// src/canvas/engine/executors/imageBatch.test.js
import { describe, it, expect } from 'vitest';
import { gamiArtExecutor, titleCardExecutor } from './imageBatch.js';

const instant = () => Promise.resolve();

function kieFakeFetch() {
  let counter = 0;
  return async (url, opts = {}) => {
    if (url.includes('/api/kie/create')) {
      const body = JSON.parse(opts.body);
      counter++;
      return { ok: true, status: 200, json: async () => ({ data: { taskId: `t-${counter}--${body.input.aspect_ratio}` } }) };
    }
    const taskId = url.split('/api/kie/status/')[1];
    return {
      ok: true, status: 200,
      json: async () => ({ data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://img/${taskId}.png`] }) } }),
    };
  };
}

const ctxWithScript = (executorNodeType, data = {}) => ({
  node: { id: 'b1', type: executorNodeType, data },
  inputs: [{ sourceId: 'ng1', sourceType: 'niche-gen', output: { status: 'done', script: '1. Alpha.\n2. Beta.' }, edge: {} }],
  outputs: {},
  report: () => {},
  server: 'http://test:3001',
  keys: { anthropic: 'ak', kie: 'kk', model: 'm' },
  fetchImpl: kieFakeFetch(),
  sleepImpl: instant,
});

describe('gamiArtExecutor', () => {
  it('builds slides+1 CTA prompts from upstream script, returns legacy batch shape', async () => {
    const out = await gamiArtExecutor.execute(ctxWithScript('gami-art', { aspectRatio: '1:1', resolution: '2K' }));
    expect(out.batchStatus).toBe('done');
    expect(out.slides).toHaveLength(3); // 2 slides + 1 CTA
    expect(out.slides.every((s) => s.status === 'done' && s.url.startsWith('http://img/'))).toBe(true);
  });
  it('throws when no upstream script exists', async () => {
    const ctx = ctxWithScript('gami-art');
    ctx.inputs = [];
    await expect(gamiArtExecutor.execute(ctx)).rejects.toThrow(/script/i);
  });
});

describe('titleCardExecutor', () => {
  it('builds slides+1 follow-CTA title cards in 9:16 by default', async () => {
    const out = await titleCardExecutor.execute(ctxWithScript('title-card'));
    expect(out.batchStatus).toBe('done');
    expect(out.slides).toHaveLength(3);
    expect(out.slides[0].url).toContain('9:16'); // default ar reached the create call
  });
});
