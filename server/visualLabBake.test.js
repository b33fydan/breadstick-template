import { describe, expect, it } from 'vitest';
import { createVisualScene } from '../src/canvas/visual-lab/contracts.js';
import {
  buildVisualBakeRenderArgs,
  createVisualBakeCacheParts,
  normalizeVisualBakeRequest,
  VisualLabBakeValidationError,
} from './visualLabBake.js';

const validBody = (overrides = {}) => ({
  scene: createVisualScene(),
  durationSec: 6,
  fps: 30,
  width: 1080,
  height: 1920,
  output: 'webm-alpha',
  quality: 'production',
  ...overrides,
});

describe('normalizeVisualBakeRequest', () => {
  it('normalizes a visual-scene@1 request and forces one canonical loop', () => {
    const request = normalizeVisualBakeRequest(validBody({
      scene: createVisualScene({
        seed: 87.8,
        loopDurationSec: 3,
        params: { emission: { intensity: 99 } },
      }),
      durationSec: 8,
      fps: 60,
      width: 1920,
      height: 1080,
      output: 'mp4-matte',
      quality: 'draft',
    }));

    expect(request).toMatchObject({
      durationSec: 8,
      durationFrames: 480,
      fps: 60,
      width: 1920,
      height: 1080,
      output: 'mp4-matte',
      quality: 'draft',
      extension: 'mp4',
      alpha: false,
    });
    expect(request.scene.loopDurationSec).toBe(8);
    expect(request.scene.seed).toBe(88);
    expect(request.scene.params.emission.intensity).toBe(2);
  });

  it('accepts every approved duration, frame rate, resolution, and output pair', () => {
    for (const durationSec of [3, 5, 6, 8, 10]) {
      expect(normalizeVisualBakeRequest(validBody({ durationSec })).durationSec).toBe(durationSec);
    }
    for (const fps of [30, 60]) {
      expect(normalizeVisualBakeRequest(validBody({ fps })).fps).toBe(fps);
    }
    for (const [width, height] of [[1080, 1920], [1920, 1080], [1080, 1080]]) {
      expect(normalizeVisualBakeRequest(validBody({ width, height }))).toMatchObject({ width, height });
    }
    for (const output of ['webm-alpha', 'mp4-matte']) {
      expect(normalizeVisualBakeRequest(validBody({ output })).output).toBe(output);
    }
  });

  it.each([
    [{ durationSec: 4 }, 'durationSec'],
    [{ fps: 24 }, 'fps'],
    [{ width: 1920, height: 1920 }, 'resolution'],
    [{ output: 'prores-alpha' }, 'output'],
    [{ quality: 'ultra' }, 'quality'],
  ])('rejects unsupported bake settings: %o', (patch, field) => {
    expect(() => normalizeVisualBakeRequest(validBody(patch))).toThrow(field);
  });

  it('rejects arbitrary fields and shader source at every renderer boundary', () => {
    expect(() => normalizeVisualBakeRequest({
      ...validBody(),
      shaderSource: 'void main() {}',
    })).toThrow('request.shaderSource is not supported');

    expect(() => normalizeVisualBakeRequest(validBody({
      scene: {
        ...createVisualScene(),
        fragmentShader: 'void main() {}',
      },
    }))).toThrow('scene.fragmentShader is not supported');

    expect(() => normalizeVisualBakeRequest(validBody({
      scene: {
        ...createVisualScene(),
        params: {
          ...createVisualScene().params,
          material: {
            ...createVisualScene().params.material,
            shaderSource: 'void main() {}',
          },
        },
      },
    }))).toThrow('scene.params.material.shaderSource is not supported');
  });

  it('uses a readable validation error for a version mismatch', () => {
    expect(() => normalizeVisualBakeRequest(validBody({
      scene: { ...createVisualScene(), version: 2 },
    }))).toThrow(VisualLabBakeValidationError);
    expect(() => normalizeVisualBakeRequest(validBody({
      scene: { ...createVisualScene(), version: 2 },
    }))).toThrow('visual-scene@1');
  });
});

describe('createVisualBakeCacheParts', () => {
  it('is deterministic after canonical normalization', () => {
    const scene = createVisualScene({
      seed: 9001,
      params: {
        motion: { turbulence: 0.9 },
        emission: { intensity: 1.2 },
      },
    });
    const reorderedScene = {
      renderer: { ...scene.renderer },
      params: {
        post: { dither: { ...scene.params.post.dither } },
        material: { ...scene.params.material, colors: [...scene.params.material.colors] },
        motion: { ...scene.params.motion },
        emission: { ...scene.params.emission },
      },
      camera: { ...scene.camera },
      background: { ...scene.background },
      loopDurationSec: scene.loopDurationSec,
      seed: scene.seed,
      preset: scene.preset,
      version: scene.version,
      type: scene.type,
    };

    const first = normalizeVisualBakeRequest(validBody({ scene }));
    const second = normalizeVisualBakeRequest(validBody({ scene: reorderedScene }));

    expect(JSON.stringify(createVisualBakeCacheParts(first))).toBe(
      JSON.stringify(createVisualBakeCacheParts(second)),
    );
  });

  it('changes when an output-defining setting changes', () => {
    const production = normalizeVisualBakeRequest(validBody());
    const draft = normalizeVisualBakeRequest(validBody({ quality: 'draft' }));

    expect(createVisualBakeCacheParts(draft)).not.toEqual(createVisualBakeCacheParts(production));
  });
});

describe('buildVisualBakeRenderArgs', () => {
  it('builds the VP9 yuva420p PNG recipe required for alpha', () => {
    const request = normalizeVisualBakeRequest(validBody());
    const target = '/tmp/visual lab/output.webm';
    const propsFile = '/tmp/visual lab/props.json';
    const args = buildVisualBakeRenderArgs({ target, propsFile, request });

    expect(args.slice(0, 4)).toEqual([
      'remotion',
      'render',
      'src/remotion/index.jsx',
      'VisualLabBake',
    ]);
    expect(args).toContain(target);
    expect(args).toContain(propsFile);
    expect(args).toContain('0-179');
    expect(args).toContain('vp9');
    expect(args).toContain('yuva420p');
    expect(args).toContain('png');
    expect(args).not.toContain('h264');
    expect(args).toContain('1');
    expect(args).toContain('angle');
  });

  it('builds an opaque H.264 MP4 recipe without alpha flags', () => {
    const request = normalizeVisualBakeRequest(validBody({
      durationSec: 5,
      fps: 60,
      output: 'mp4-matte',
    }));
    const args = buildVisualBakeRenderArgs({
      target: '/tmp/output.mp4',
      propsFile: '/tmp/props.json',
      request,
    });

    expect(args).toContain('0-299');
    expect(args).toContain('h264');
    expect(args).toContain('yuv420p');
    expect(args).toContain('jpeg');
    expect(args).not.toContain('vp9');
    expect(args).not.toContain('yuva420p');
  });

  it('rejects unsafe path arguments before invoking a process', () => {
    const request = normalizeVisualBakeRequest(validBody());
    expect(() => buildVisualBakeRenderArgs({
      target: '/tmp/output.webm\0--codec=h264',
      propsFile: '/tmp/props.json',
      request,
    })).toThrow('target');
  });
});
