import { describe, it, expect } from 'vitest';
import { clampFrequency, envelope } from './audioPalettes.js';

describe('clampFrequency', () => {
  it('passes through values in human-audible range', () => {
    expect(clampFrequency(440)).toBe(440);
    expect(clampFrequency(20)).toBe(20);
    expect(clampFrequency(20000)).toBe(20000);
  });

  it('clamps below 20 Hz to 20', () => {
    expect(clampFrequency(5)).toBe(20);
    expect(clampFrequency(-100)).toBe(20);
    expect(clampFrequency(0)).toBe(20);
  });

  it('clamps above 20000 Hz to 20000', () => {
    expect(clampFrequency(25000)).toBe(20000);
    expect(clampFrequency(Infinity)).toBe(20000);
  });
});

describe('envelope', () => {
  it('returns ADSR points summing to total duration', () => {
    const env = envelope({ attack: 0.1, decay: 0.2, sustain: 0.3, release: 0.4 });
    expect(env.attack).toBe(0.1);
    expect(env.decay).toBe(0.2);
    expect(env.sustain).toBe(0.3);
    expect(env.release).toBe(0.4);
    expect(env.totalDuration).toBeCloseTo(1.0, 5);
  });

  it('clamps negative values to 0', () => {
    const env = envelope({ attack: -0.1, decay: 0.2, sustain: 0.3, release: 0.4 });
    expect(env.attack).toBe(0);
  });
});
