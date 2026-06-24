// src/canvas/engine/executors/frameSandwich.test.js
import { describe, it, expect } from 'vitest';
import { frameSandwichExecutor } from './frameSandwich.js';

const instant = () => Promise.resolve();

function kieFakeFetch(captured) {
  let counter = 0;
  return async (url, opts = {}) => {
    if (url.includes('/api/kie/create')) {
      captured.push(JSON.parse(opts.body));
      counter++;
      return { ok: true, status: 200, json: async () => ({ data: { taskId: `t-${counter}` } }) };
    }
    const taskId = url.split('/api/kie/status/')[1];
    return {
      ok: true, status: 200,
      json: async () => ({ data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://vid/${taskId}.mp4`] }) } }),
    };
  };
}

const slides = (urls) => urls.map((url) => ({ status: 'done', url, taskId: '', elapsed: 1, error: '' }));

describe('frameSandwichExecutor', () => {
  it('pairs title[i]+art[i], submits kling-3.0/video per pair, returns { batchStatus, videos }', async () => {
    const captured = [];
    const ctx = {
      node: { id: 'fs1', type: 'frame-sandwich', data: { duration: '5', aspectRatio: '9:16', videoMode: 'pro' } },
      inputs: [
        { sourceId: 'tc1', sourceType: 'title-card', output: { batchStatus: 'done', slides: slides(['http://t/1.png', 'http://t/2.png']) }, edge: {} },
        { sourceId: 'ga1', sourceType: 'gami-art', output: { batchStatus: 'done', slides: slides(['http://a/1.png', 'http://a/2.png']) }, edge: {} },
      ],
      outputs: {}, report: () => {},
      server: 'http://test:3001', keys: { kie: 'kk' },
      fetchImpl: kieFakeFetch(captured), sleepImpl: instant,
    };
    const out = await frameSandwichExecutor.execute(ctx);
    expect(out.batchStatus).toBe('done');
    expect(out.videos).toHaveLength(2);
    expect(out.videos.every((v) => v.status === 'done')).toBe(true);
    expect(captured[0].model).toBe('kling-3.0/video');
    expect(captured[0].input.image_urls).toEqual(['http://t/1.png', 'http://a/1.png']); // title first, art second
    expect(captured[0].input.mode).toBe('pro');
  });

  it('throws when either upstream batch is missing', async () => {
    const ctx = {
      node: { id: 'fs1', type: 'frame-sandwich', data: {} },
      inputs: [], outputs: {}, report: () => {},
      server: 'http://x', keys: { kie: 'kk' }, fetchImpl: async () => {}, sleepImpl: instant,
    };
    await expect(frameSandwichExecutor.execute(ctx)).rejects.toThrow(/title-card|gami-art/i);
  });
});
