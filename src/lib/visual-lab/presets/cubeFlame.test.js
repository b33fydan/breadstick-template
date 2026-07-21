import { describe, expect, it, vi } from 'vitest';
import {
  CUBE_FLAME_DEFAULTS,
  createCubeFrame,
  createCubeSeedTable,
  interpolateCubeFlameParams,
  normalizeCubeFlameParams,
  sampleCubeFlame,
  sampleCubeFlameInto,
} from './cubeFlame.js';

function expectFramesEqual(actual, expected) {
  expect(actual.count).toBe(expected.count);
  expect(actual.positions).toEqual(expected.positions);
  expect(actual.rotations).toEqual(expected.rotations);
  expect(actual.scales).toEqual(expected.scales);
  expect(actual.life).toEqual(expected.life);
  expect(actual.alpha).toEqual(expected.alpha);
  expect(actual.variation).toEqual(expected.variation);
}

describe('cube flame deterministic model', () => {
  it('creates identical seed traits and frames for the same seed and time', () => {
    const firstTable = createCubeSeedTable(4317, 96);
    const secondTable = createCubeSeedTable(4317, 96);

    expect(firstTable.phase).toEqual(secondTable.phase);
    expect(firstTable.radius).toEqual(secondTable.radius);
    expect(firstTable.angle).toEqual(secondTable.angle);
    expect(firstTable.variation).toEqual(secondTable.variation);

    const first = sampleCubeFlame({ seed: 4317, timeSec: 2.375, count: 96 });
    const second = sampleCubeFlame({ seed: 4317, timeSec: 2.375, count: 96 });
    expectFramesEqual(first, second);
  });

  it('matches the virtual loop-end frame exactly at t=0', () => {
    const atStart = sampleCubeFlame({
      seed: 'loop-proof',
      timeSec: 0,
      loopDurationSec: 6,
      count: 128,
    });
    const atLoopEnd = sampleCubeFlame({
      seed: 'loop-proof',
      timeSec: 6,
      loopDurationSec: 6,
      count: 128,
    });

    expectFramesEqual(atStart, atLoopEnd);
  });

  it('writes into caller-owned arrays without consulting Math.random', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used by deterministic frames');
    });
    const seedTable = createCubeSeedTable(19, 64);
    const target = createCubeFrame(64);
    const positions = target.positions;

    const result = sampleCubeFlameInto(
      seedTable,
      1.25,
      CUBE_FLAME_DEFAULTS,
      target,
      { loopDurationSec: 6, count: 64 },
    );

    expect(result).toBe(target);
    expect(result.positions).toBe(positions);
    expect(result.positions.some((value) => value !== 0)).toBe(true);
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it('clamps packet-shaped params and ignores unknown fields', () => {
    const normalized = normalizeCubeFlameParams({
      type: 'visual-params',
      version: 1,
      channels: {
        emission: { intensity: 99, count: 12, spread: -4, unknown: 123 },
        motion: { riseSpeed: '1.25', swirl: -99 },
        material: { colors: ['#fb0', 'invalid', '#123456'] },
        post: { dither: { mode: 'wat', posterize: 500 } },
      },
    });

    expect(normalized.emission).toEqual({
      intensity: 2,
      count: 64,
      spread: 0.1,
      cubeSize: CUBE_FLAME_DEFAULTS.emission.cubeSize,
    });
    expect(normalized.motion.riseSpeed).toBe(1.25);
    expect(normalized.motion.swirl).toBe(-2);
    expect(normalized.material.colors).toEqual(['#ffbb00', '#ff0071', '#123456']);
    expect(normalized.post.dither.mode).toBe('bayer4');
    expect(normalized.post.dither.posterize).toBe(32);
    expect(normalized.emission).not.toHaveProperty('unknown');
  });

  it('preserves exact normalized endpoints for disconnect interpolation', () => {
    const from = {
      emission: { intensity: 1.8, count: 900 },
      motion: { turbulence: 1.3, swirl: -0.7 },
      material: { colors: ['#112233', '#445566', '#778899'] },
    };
    const to = {
      emission: { intensity: 0.4, count: 128 },
      motion: { turbulence: 0.1, swirl: 1.4 },
      material: { colors: ['#abcdef', '#123456', '#fedcba'] },
    };

    expect(interpolateCubeFlameParams(from, to, 0)).toEqual(normalizeCubeFlameParams(from));
    expect(interpolateCubeFlameParams(from, to, 1)).toEqual(normalizeCubeFlameParams(to));
  });
});
