// src/canvas/engine/executors/ugcVideo.test.js
import { describe, it, expect } from 'vitest';
import { ugcVideoExecutor } from './ugcVideo.js';

const instant = () => Promise.resolve();

// Fake server: kie upload-file derives a kie-CDN URL from the basename
// (the PRIMARY frame-delivery path), resolve-public-url derives a different
// public URL from the basename (the FALLBACK), kie create returns a taskId
// derived from the prompt, kie status succeeds with a video URL derived from
// the taskId — so both the resolve route taken and result→pair attribution are
// fully observable in assertions.
function fakeFetch({ failResolvePaths = [], failUploadPaths = [] } = {}) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method || 'GET', body });
    if (url.includes('/api/kie/upload-file')) {
      if (failUploadPaths.some((p) => body.path.includes(p))) {
        return { ok: false, status: 502, json: async () => ({ error: 'kie upload failed' }) };
      }
      const base = body.path.split(/[\\/]/).pop();
      return { ok: true, status: 200, json: async () => ({ url: `http://kie/${base}`, method: 'kie-upload' }) };
    }
    if (url.includes('/api/resolve-public-url')) {
      if (failResolvePaths.some((p) => body.path.includes(p))) {
        return { ok: false, status: 503, json: async () => ({ error: 'all hosts down' }) };
      }
      const base = body.path.split(/[\\/]/).pop();
      return { ok: true, status: 200, json: async () => ({ url: `http://pub/${base}` }) };
    }
    if (url.includes('/api/kie/create')) {
      return { ok: true, status: 200, json: async () => ({ data: { taskId: `t-${body.input.prompt}` } }) };
    }
    if (url.includes('/api/kie/status/')) {
      const taskId = url.split('/api/kie/status/')[1];
      return {
        ok: true, status: 200,
        json: async () => ({ data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://vid/${taskId}.mp4`] }) } }),
      };
    }
    throw new Error(`no fake route for ${url}`);
  };
  impl.uploadCalls = () => calls.filter((c) => c.url.includes('/api/kie/upload-file'));
  impl.resolveCalls = () => calls.filter((c) => c.url.includes('/api/resolve-public-url'));
  impl.createCalls = () => calls.filter((c) => c.url.includes('/api/kie/create'));
  impl.calls = calls;
  return impl;
}

const frame = (path) => ({ path, name: path.split(/[\\/]/).pop() });

const makeCtx = ({ clips, images, data = {}, keys, fetchImpl, inputs, outputs, reports = [] } = {}) => ({
  node: { id: 'uv1', type: 'ugc-video', data },
  inputs: inputs ?? [
    { sourceId: 'cs1', sourceType: 'clip-splitter', sourceData: null, output: { status: 'done', clips, error: '' }, edge: {} },
    { sourceId: 'af1', sourceType: 'avatar-frame', sourceData: null, output: { status: 'done', images, error: '' }, edge: {} },
  ],
  outputs: outputs ?? {},
  report: (patch) => reports.push(patch),
  server: 'http://test:3001',
  keys: keys ?? { anthropic: 'ak', kie: 'kk', model: 'm' },
  fetchImpl: fetchImpl ?? fakeFetch(),
  sleepImpl: instant,
});

describe('ugcVideoExecutor', () => {
  it('pairs min(clips, frames) and returns the legacy batch shape', async () => {
    const f = fakeFetch();
    const out = await ugcVideoExecutor.execute(makeCtx({
      clips: [{ prompt: 'p0', duration: 9 }, { prompt: 'p1', duration: 9 }, { prompt: 'p2', duration: 9 }],
      images: [frame('https://cdn.example/a.png'), frame('https://cdn.example/b.png')],
      fetchImpl: f,
    }));
    expect(out.batchStatus).toBe('done');
    expect(out.videos).toHaveLength(2); // min(3 clips, 2 frames)
    expect(f.createCalls()).toHaveLength(2);
    expect(out.videos[0]).toMatchObject({ status: 'done', url: 'http://vid/t-p0.mp4', taskId: 't-p0', error: '' });
    expect(out.videos[1]).toMatchObject({ status: 'done', url: 'http://vid/t-p1.mp4', taskId: 't-p1', error: '' });
  });

  it('uploads only local frame paths to kie; http URLs pass through untouched', async () => {
    const f = fakeFetch();
    await ugcVideoExecutor.execute(makeCtx({
      clips: [{ prompt: 'c-a', duration: 9 }, { prompt: 'c-b' }, { prompt: 'c-c', duration: 3 }],
      images: [frame('C:\\frames\\a.png'), frame('https://cdn.example/b.png'), frame('/data/c.png')],
      fetchImpl: f,
    }));
    const uploads = f.uploadCalls();
    expect(uploads).toHaveLength(2); // windows-drive + leading-slash paths only
    expect(uploads.map((c) => c.body.path)).toEqual(['C:\\frames\\a.png', '/data/c.png']);
    expect(f.resolveCalls()).toHaveLength(0); // upload succeeded — fallback untouched

    const byPrompt = Object.fromEntries(f.createCalls().map((c) => [c.body.input.prompt, c.body]));
    expect(Object.keys(byPrompt)).toHaveLength(3);
    // Exact legacy kling-3.0 payload, frame uploaded via kie File Upload API:
    expect(byPrompt['c-a']).toEqual({
      apiKey: 'kk',
      model: 'kling-3.0/video',
      input: {
        prompt: 'c-a', image_urls: ['http://kie/a.png'], sound: true, duration: '9',
        aspect_ratio: '9:16', mode: 'pro', multi_shots: false, multi_prompt: [],
      },
    });
    // http frame passes through, missing duration defaults to '5':
    expect(byPrompt['c-b'].input.image_urls).toEqual(['https://cdn.example/b.png']);
    expect(byPrompt['c-b'].input.duration).toBe('5');
    expect(byPrompt['c-c'].input.image_urls).toEqual(['http://kie/c.png']);
  });

  it('excludes frames that fail both kie-upload and resolve, remapping batch indexes to absolute slots', async () => {
    const f = fakeFetch({ failUploadPaths: ['bad.png'], failResolvePaths: ['bad.png'] });
    const reports = [];
    const out = await ugcVideoExecutor.execute(makeCtx({
      clips: [{ prompt: 'p0' }, { prompt: 'p1' }, { prompt: 'p2' }],
      images: [frame('C:\\f\\bad.png'), frame('C:\\f\\ok1.png'), frame('C:\\f\\ok2.png')],
      fetchImpl: f, reports,
    }));

    // Slot 0 keeps the failure (upload AND fallback failed) — final, never submitted.
    expect(out.videos[0]).toEqual({ status: 'error', url: '', taskId: '', elapsed: 0, error: 'Frame resolve failed: all hosts down' });
    // Slots 1-2 carry batch results at their ABSOLUTE indexes (batch was 0..1).
    expect(out.videos[1]).toMatchObject({ status: 'done', url: 'http://vid/t-p1.mp4', taskId: 't-p1' });
    expect(out.videos[2]).toMatchObject({ status: 'done', url: 'http://vid/t-p2.mp4', taskId: 't-p2' });
    expect(out.batchStatus).toBe('done');

    // Only the two resolvable pairs hit kie, each uploaded via the File Upload API.
    const byPrompt = Object.fromEntries(f.createCalls().map((c) => [c.body.input.prompt, c.body]));
    expect(Object.keys(byPrompt).sort()).toEqual(['p1', 'p2']);
    expect(byPrompt['p1'].input.image_urls).toEqual(['http://kie/ok1.png']);
    expect(byPrompt['p2'].input.image_urls).toEqual(['http://kie/ok2.png']);

    // Snapshot semantics: all-resolving first, then error/submitting after resolve.
    expect(reports[0].batchStatus).toBe('generating');
    expect(reports[0].videos.map((v) => v.status)).toEqual(['resolving', 'resolving', 'resolving']);
    expect(reports[1].videos.map((v) => v.status)).toEqual(['error', 'submitting', 'submitting']);
    expect(reports[1].videos[0].error).toMatch(/Frame resolve failed/);
  });

  it('prefers the kie File Upload API and forwards the kie key, never touching the fallback on success', async () => {
    const f = fakeFetch();
    await ugcVideoExecutor.execute(makeCtx({
      clips: [{ prompt: 'p0', duration: 9 }],
      images: [frame('C:\\frames\\a.png')],
      fetchImpl: f,
    }));
    const uploads = f.uploadCalls();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].body).toEqual({ apiKey: 'kk', path: 'C:\\frames\\a.png' });
    expect(f.resolveCalls()).toHaveLength(0); // fallback never reached
    expect(f.createCalls()[0].body.input.image_urls).toEqual(['http://kie/a.png']);
  });

  it('falls back to resolve-public-url when the kie File Upload API fails', async () => {
    const f = fakeFetch({ failUploadPaths: ['a.png'] });
    const out = await ugcVideoExecutor.execute(makeCtx({
      clips: [{ prompt: 'p0', duration: 9 }],
      images: [frame('C:\\frames\\a.png')],
      fetchImpl: f,
    }));
    // Both routes were attempted, in order: upload first, then the fallback.
    expect(f.uploadCalls()).toHaveLength(1);
    expect(f.resolveCalls()).toHaveLength(1);
    expect(f.resolveCalls()[0].body.path).toBe('C:\\frames\\a.png');
    // The fallback URL is what reaches kie, and the pair still completes.
    expect(f.createCalls()[0].body.input.image_urls).toEqual(['http://pub/a.png']);
    expect(out.videos[0]).toMatchObject({ status: 'done', url: 'http://vid/t-p0.mp4' });
  });

  it('falls back to scanning ctx.outputs when inputs lack done outputs', async () => {
    const out = await ugcVideoExecutor.execute(makeCtx({
      inputs: [{ sourceId: 'x1', sourceType: 'mystery', sourceData: null, output: undefined, edge: {} }],
      outputs: {
        cs1: { status: 'done', clips: [{ prompt: 'p0', duration: 9 }], error: '' },
        af1: { status: 'done', images: [frame('https://cdn.example/a.png')], error: '' },
      },
    }));
    expect(out.videos).toHaveLength(1);
    expect(out.videos[0]).toMatchObject({ status: 'done', url: 'http://vid/t-p0.mp4' });
  });

  it('throws on hf: routes without touching the network', async () => {
    const f = fakeFetch();
    await expect(ugcVideoExecutor.execute(makeCtx({
      clips: [{ prompt: 'p0' }], images: [frame('https://cdn.example/a.png')],
      data: { route: 'hf:kling-3.0' }, fetchImpl: f,
    }))).rejects.toThrow(/Higgsfield route not supported by Run Lane yet/);
    expect(f.calls).toHaveLength(0);
  });

  it('throws when the kie key is missing', async () => {
    await expect(ugcVideoExecutor.execute(makeCtx({
      clips: [{ prompt: 'p0' }], images: [frame('https://cdn.example/a.png')],
      keys: { anthropic: 'ak', model: 'm' },
    }))).rejects.toThrow('kie.ai API key missing');
  });

  it('throws when clips or frames are missing upstream', async () => {
    await expect(ugcVideoExecutor.execute(makeCtx({ inputs: [], outputs: {} })))
      .rejects.toThrow('ugc-video: need clips and avatar frames wired in');
    // Clips alone are not enough — pairing needs both sides.
    await expect(ugcVideoExecutor.execute(makeCtx({
      inputs: [{ sourceId: 'cs1', sourceType: 'clip-splitter', sourceData: null, output: { status: 'done', clips: [{ prompt: 'p0' }], error: '' }, edge: {} }],
      outputs: {},
    }))).rejects.toThrow('ugc-video: need clips and avatar frames wired in');
  });
});
