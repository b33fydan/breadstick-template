import { describe, it, expect } from 'vitest';
import { selectChunks } from './selector.js';

const lane = (n, count, dur) =>
  Array.from({ length: count }, (_, i) => ({ rel: `${n}/c${i}.mp4`, path: `G:/${n}/c${i}.mp4`, lane: n, durationSec: dur, colorTransfer: 'bt709' }));

describe('selectChunks', () => {
  it('fills to the target with windowSec beats', () => {
    const r = selectChunks({ availableByLane: { A: lane('A', 10, 100) }, targetSec: 60, beats: 10, windowSec: 12, seed: 1 });
    expect(r.totalSec).toBeCloseTo(60, 1);
    expect(r.chunks.length).toBe(5);
    expect(r.exhausted).toBe(false);
  });
  it('spreads across lanes', () => {
    const r = selectChunks({ availableByLane: { A: lane('A', 5, 100), B: lane('B', 5, 100) }, targetSec: 48, beats: 10, windowSec: 12, seed: 1 });
    const lanes = r.chunks.map((c) => c.lane);
    expect(lanes).toContain('A');
    expect(lanes).toContain('B');
  });
  it('is deterministic for a given seed', () => {
    const opts = { availableByLane: { A: lane('A', 10, 100) }, targetSec: 36, beats: 10, windowSec: 12, seed: 7 };
    const r1 = selectChunks(opts);
    const r2 = selectChunks(opts);
    expect(r1.consumedRels).toEqual(r2.consumedRels);
  });
  it('never takes a window longer than the clip, and flags exhaustion', () => {
    const r = selectChunks({ availableByLane: { A: lane('A', 3, 5) }, targetSec: 60, beats: 10, windowSec: 12, seed: 1 });
    for (const c of r.chunks) expect(c.durationSec).toBeLessThanOrEqual(5);
    expect(r.exhausted).toBe(true);
  });
  it('tags applyLut from isLogFn', () => {
    const r = selectChunks({ availableByLane: { A: lane('A', 2, 100) }, targetSec: 12, beats: 10, windowSec: 12, seed: 1, isLogFn: () => false });
    expect(r.chunks[0].applyLut).toBe(false);
  });
});
