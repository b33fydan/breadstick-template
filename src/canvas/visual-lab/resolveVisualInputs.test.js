import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VISUAL_PARAMS,
  createVisualParamsPacket,
  createVisualScene,
  normalizeVisualParams,
  normalizeVisualScene,
  validateVisualScene,
} from './contracts.js';
import { resolveVisualInputs } from './resolveVisualInputs.js';

describe('Visual Lab contracts', () => {
  it('exposes the art-directed Cube Flame defaults as an immutable contract', () => {
    expect(DEFAULT_VISUAL_PARAMS).toEqual({
      emission: { intensity: 1, count: 512, spread: 0.72, cubeSize: 0.065 },
      motion: { riseSpeed: 0.75, turbulence: 0.58, swirl: 0.22, flicker: 0.16 },
      material: {
        opacity: 0.82,
        bloom: 0.62,
        holoShift: 0.48,
        colors: ['#ffb000', '#ff0071', '#bdfcff'],
      },
      post: {
        dither: { enabled: true, mode: 'bayer4', amount: 0.18, pixelScale: 3, posterize: 12 },
      },
    });
    expect(Object.isFrozen(DEFAULT_VISUAL_PARAMS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_VISUAL_PARAMS.post.dither)).toBe(true);
  });

  it('clamps every numeric channel, normalizes colors, and ignores unknown input', () => {
    const raw = {
      emission: {
        intensity: -4,
        count: 4000,
        spread: 9,
        cubeSize: 0,
        surprise: 22,
      },
      motion: {
        riseSpeed: 8,
        turbulence: -1,
        swirl: -9,
        flicker: 2,
      },
      material: {
        opacity: 0,
        bloom: 3,
        holoShift: -1,
        colors: ['#ABC', 'not-a-color', '#123456'],
        shaderSource: 'void main() {}',
      },
      post: {
        dither: {
          enabled: false,
          mode: 'noise',
          amount: 5,
          pixelScale: 99,
          posterize: 1,
          arbitraryPass: true,
        },
      },
      audio: { bass: 1 },
    };

    const normalized = normalizeVisualParams(raw);

    expect(normalized).toEqual({
      emission: { intensity: 0, count: 1200, spread: 2, cubeSize: 0.01 },
      motion: { riseSpeed: 2.5, turbulence: 0, swirl: -2, flicker: 1 },
      material: {
        opacity: 0.05,
        bloom: 1.5,
        holoShift: 0,
        colors: ['#aabbcc', '#ff0071', '#123456'],
      },
      post: {
        dither: { enabled: false, mode: 'noise', amount: 1, pixelScale: 8, posterize: 2 },
      },
    });
    expect(normalized.emission).not.toHaveProperty('surprise');
    expect(normalized.material).not.toHaveProperty('shaderSource');
    expect(normalized).not.toHaveProperty('audio');
    expect(raw.material.colors[0]).toBe('#ABC');
  });

  it('ignores invalid known values and returns a fresh complete object', () => {
    const normalized = normalizeVisualParams({
      emission: { intensity: '2', count: Number.NaN },
      post: { dither: { enabled: 'yes', mode: 'ordered16' } },
    });

    expect(normalized).toEqual(DEFAULT_VISUAL_PARAMS);
    expect(normalized).not.toBe(DEFAULT_VISUAL_PARAMS);
    expect(normalized.material.colors).not.toBe(DEFAULT_VISUAL_PARAMS.material.colors);
  });

  it('creates a canonical visual-params@1 packet', () => {
    const packet = createVisualParamsPacket(
      { motion: { riseSpeed: 1.25 }, emission: { count: 303.8 } },
      { sourceKind: 'custom-controls', priority: 20000 },
    );

    expect(packet).toMatchObject({
      type: 'visual-params',
      version: 1,
      sourceKind: 'custom-controls',
      priority: 10000,
    });
    expect(packet.channels.motion.riseSpeed).toBe(1.25);
    expect(packet.channels.emission.count).toBe(304);
    expect(packet.channels.material.colors).toEqual(DEFAULT_VISUAL_PARAMS.material.colors);
  });

  it('creates, serializes, validates, and normalizes a visual-scene@1 recipe', () => {
    const scene = createVisualScene({
      seed: -10,
      loopDurationSec: 100,
      background: { mode: 'breadstick', color: '#123' },
      camera: { preset: 'unknown', fov: 500 },
      params: { emission: { intensity: 12 } },
      ignoredRuntimeCanvas: 'never serialized into the recipe',
    });

    expect(scene).toMatchObject({
      type: 'visual-scene',
      version: 1,
      preset: 'cube-flame',
      seed: 0,
      loopDurationSec: 60,
      background: { mode: 'breadstick', color: '#112233' },
      camera: { preset: 'three-quarter', fov: 179 },
      renderer: { engine: 'three', engineVersion: '0.166.1', presetVersion: 1 },
    });
    expect(scene.params.emission.intensity).toBe(2);
    expect(scene).not.toHaveProperty('ignoredRuntimeCanvas');

    const roundTrip = JSON.parse(JSON.stringify(scene));
    const validation = validateVisualScene(roundTrip);
    expect(validation).toEqual({ ok: true, value: scene, error: null });
    expect(normalizeVisualScene(roundTrip)).toEqual(scene);
  });

  it('rejects scene contract and renderer version mismatches readably', () => {
    const scene = createVisualScene();

    const sceneVersion = validateVisualScene({ ...scene, version: 2 });
    expect(sceneVersion.ok).toBe(false);
    expect(sceneVersion.error).toMatch(/expected visual-scene@1/i);
    expect(sceneVersion.error).toMatch(/visual-scene@2/i);

    const rendererVersion = validateVisualScene({
      ...scene,
      renderer: { ...scene.renderer, presetVersion: 2 },
    });
    expect(rendererVersion.ok).toBe(false);
    expect(rendererVersion.error).toMatch(/preset version mismatch/i);
  });
});
describe('resolveVisualInputs', () => {
  const targetId = 'field-1';
  const paramsEdge = {
    id: 'controls-to-field',
    source: 'controls-1',
    sourceHandle: 'params-out',
    target: targetId,
    targetHandle: 'params-in',
  };

  it('merges preset defaults and persisted local parameters without a wire', () => {
    const result = resolveVisualInputs({
      targetId,
      edges: [],
      nodeOutputs: {},
      localParams: {
        emission: { intensity: 1.4 },
        motion: { swirl: -0.8 },
      },
    });

    expect(result.connected).toBe(false);
    expect(result.packet).toBeNull();
    expect(result.error).toBeNull();
    expect(result.params.emission.intensity).toBe(1.4);
    expect(result.params.motion.swirl).toBe(-0.8);
    expect(result.params.material.bloom).toBe(DEFAULT_VISUAL_PARAMS.material.bloom);
  });

  it('applies only supplied wired channels over local values and clamps at the boundary', () => {
    const result = resolveVisualInputs({
      targetId,
      edges: [paramsEdge],
      nodeOutputs: {
        'controls-1': {
          type: 'visual-params',
          version: 1,
          sourceKind: 'field-controls',
          priority: 100,
          channels: {
            motion: { riseSpeed: 99, unknownMotion: 4 },
            post: { dither: { amount: -2 } },
            unknownChannel: { value: 1 },
          },
        },
      },
      localParams: {
        emission: { intensity: 1.6 },
        material: { bloom: 1.1 },
      },
    });

    expect(result).toMatchObject({ connected: true, sourceId: 'controls-1', error: null });
    expect(result.params.motion.riseSpeed).toBe(2.5);
    expect(result.params.post.dither.amount).toBe(0);
    expect(result.params.emission.intensity).toBe(1.6);
    expect(result.params.material.bloom).toBe(1.1);
    expect(result.params.motion).not.toHaveProperty('unknownMotion');
    expect(result.params).not.toHaveProperty('unknownChannel');
    expect(result.packet).toMatchObject({ type: 'visual-params', version: 1 });
  });

  it('ignores edges connected to other target handles', () => {
    const result = resolveVisualInputs({
      targetId,
      edges: [{ ...paramsEdge, targetHandle: 'scene-in' }],
      nodeOutputs: {
        'controls-1': createVisualParamsPacket({ emission: { intensity: 2 } }),
      },
      localParams: { emission: { intensity: 0.7 } },
    });

    expect(result.connected).toBe(false);
    expect(result.params.emission.intensity).toBe(0.7);
  });

  it('falls back to visual-controls node data before its first nodeOutputs publication', () => {
    const result = resolveVisualInputs({
      targetId,
      edges: [paramsEdge],
      nodeOutputs: {},
      nodes: [{
        id: 'controls-1',
        type: 'visual-controls',
        data: { params: { emission: { intensity: 1.8 }, motion: { turbulence: 1.2 } } },
      }],
      localParams: { material: { bloom: 0.9 } },
    });

    expect(result.error).toBeNull();
    expect(result.connected).toBe(true);
    expect(result.params.emission.intensity).toBe(1.8);
    expect(result.params.motion.turbulence).toBe(1.2);
    expect(result.params.material.bloom).toBe(0.9);
  });

  it('reports a readable version error and safely keeps local values', () => {
    const result = resolveVisualInputs({
      targetId,
      edges: [paramsEdge],
      nodeOutputs: {
        'controls-1': {
          type: 'visual-params',
          version: 2,
          channels: { emission: { intensity: 2 } },
        },
      },
      localParams: { emission: { intensity: 0.65 } },
    });

    expect(result.connected).toBe(true);
    expect(result.packet).toBeNull();
    expect(result.params.emission.intensity).toBe(0.65);
    expect(result.error).toMatch(/expected visual-params@1/i);
    expect(result.error).toMatch(/visual-params@2/i);
  });

  it('reads nodeOutputs fresh on every call', () => {
    const nodeOutputs = {
      'controls-1': createVisualParamsPacket({ motion: { riseSpeed: 0.3 } }),
    };
    const input = { targetId, edges: [paramsEdge], nodeOutputs, localParams: {} };

    expect(resolveVisualInputs(input).params.motion.riseSpeed).toBe(0.3);
    nodeOutputs['controls-1'] = createVisualParamsPacket({ motion: { riseSpeed: 2.1 } });
    expect(resolveVisualInputs(input).params.motion.riseSpeed).toBe(2.1);
  });

  it('treats a connected source with no packet yet as pending, not as a crash', () => {
    const result = resolveVisualInputs({
      targetId,
      edges: [paramsEdge],
      nodeOutputs: {},
      nodes: [],
      localParams: { emission: { intensity: 0.9 } },
    });

    expect(result).toMatchObject({
      connected: true,
      sourceId: 'controls-1',
      packet: null,
      error: null,
    });
    expect(result.params.emission.intensity).toBe(0.9);
  });
});
