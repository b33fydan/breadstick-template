// src/canvas/engine/executors/carouselRender.test.js
import { describe, it, expect } from 'vitest';
import { carouselRenderExecutor } from './carouselRender.js';

const slides = (urls) => urls.map((url) => ({ status: 'done', url, taskId: '', elapsed: 1, error: '' }));

describe('carouselRenderExecutor', () => {
  it('posts config + upstream art urls, returns legacy render shape', async () => {
    let captured;
    const ctx = {
      node: { id: 'car1', type: 'carousel', data: { config: { template: 'plain-black', slides: [] } } },
      inputs: [
        { sourceId: 'ga1', sourceType: 'gami-art', output: { batchStatus: 'done', slides: slides(['http://a/1.png', 'http://a/2.png']) }, edge: {} },
      ],
      outputs: {}, report: () => {},
      server: 'http://test:3001', keys: {},
      fetchImpl: async (url, opts) => {
        captured = { url, body: JSON.parse(opts.body) };
        return { ok: true, status: 200, json: async () => ({ success: true, slides: ['slide_1.png'], zones: { slide_1: {} } }) };
      },
    };
    const out = await carouselRenderExecutor.execute(ctx);
    expect(captured.url).toBe('http://test:3001/api/carousel/render');
    expect(captured.body.imageUrls).toEqual(['http://a/1.png', 'http://a/2.png']);
    expect(captured.body.name).toMatch(/^carousel_car1_/);
    expect(out).toEqual({ renderStatus: 'done', renderedSlides: ['slide_1.png'], zones: { slide_1: {} }, error: '' });
  });

  it('throws on server failure payload', async () => {
    const ctx = {
      node: { id: 'car1', type: 'carousel', data: { config: {} } },
      inputs: [], outputs: {}, report: () => {},
      server: 'http://test:3001', keys: {},
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ success: false, error: 'render.py exploded' }) }),
    };
    await expect(carouselRenderExecutor.execute(ctx)).rejects.toThrow('render.py exploded');
  });
});
