// src/canvas/engine/executors/avatarFrames.test.js
import { describe, it, expect } from 'vitest';
import { avatarFramesExecutor } from './avatarFrames.js';

const baseCtx = (overrides = {}) => ({
  node: { id: 'af1', type: 'avatar-frame', data: { folderPath: 'C:\\Avatars\\Mia Chen' } },
  inputs: [], outputs: {}, report: () => {},
  server: 'http://test:3001', keys: {},
  ...overrides,
});

describe('avatarFramesExecutor', () => {
  it('scans the folder via encoded URL and passes images through verbatim', async () => {
    const images = [
      { path: 'C:\\Avatars\\Mia Chen\\a.png', name: 'a.png', size: 1234 },
      { path: 'C:\\Avatars\\Mia Chen\\b.jpg', name: 'b.jpg', size: 5678, extra: 'kept' },
    ];
    let captured;
    const reports = [];
    const ctx = baseCtx({
      report: (patch) => reports.push(patch),
      fetchImpl: async (url) => {
        captured = url;
        return { ok: true, status: 200, json: async () => ({ images }) };
      },
    });
    const out = await avatarFramesExecutor.execute(ctx);
    expect(captured).toBe(`http://test:3001/api/scan-folder?path=${encodeURIComponent('C:\\Avatars\\Mia Chen')}`);
    expect(captured).toContain('path=C%3A%5CAvatars%5CMia%20Chen');
    expect(reports[0]).toEqual({ status: 'scanning', images: [], error: '' });
    expect(out).toEqual({ status: 'done', images, error: '' });
    expect(out.images).toBe(images); // verbatim passthrough, extra fields intact
    expect(avatarFramesExecutor.retryable).toBeUndefined(); // folder scan is not retryable
  });

  it('throws when no folder is set', async () => {
    const ctx = baseCtx({
      node: { id: 'af1', type: 'avatar-frame', data: {} },
      fetchImpl: async () => { throw new Error('fetch should not be called'); },
    });
    await expect(avatarFramesExecutor.execute(ctx)).rejects.toThrow('avatar-frame node has no folder set');
    const emptyCtx = baseCtx({
      node: { id: 'af1', type: 'avatar-frame', data: { folderPath: '' } },
      fetchImpl: async () => { throw new Error('fetch should not be called'); },
    });
    await expect(avatarFramesExecutor.execute(emptyCtx)).rejects.toThrow('avatar-frame node has no folder set');
  });

  it('throws the server error message on failure payload', async () => {
    const ctx = baseCtx({
      fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: 'Folder not found' }) }),
    });
    await expect(avatarFramesExecutor.execute(ctx)).rejects.toThrow('Folder not found');
  });

  it('falls back to "Scan failed" when the server gives no error message', async () => {
    const ctx = baseCtx({
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    });
    await expect(avatarFramesExecutor.execute(ctx)).rejects.toThrow('Scan failed');
  });
});
