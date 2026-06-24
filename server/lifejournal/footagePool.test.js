import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFootagePool } from './footagePool.js';

let indexPath;
beforeEach(() => {
  indexPath = join(mkdtempSync(join(tmpdir(), 'lj-pool-')), 'index.json');
  writeFileSync(indexPath, JSON.stringify({ clips: [
    { rel: 'Drone\\A\\clip_D_stabilized.mp4', path: 'G:\\Drone\\A\\clip_D_stabilized.mp4', lane: 'Drone/A', durationSec: 100, colorTransfer: 'bt709' },
    { rel: 'Drone\\A\\clip_D.MP4',            path: 'G:\\Drone\\A\\clip_D.MP4',            lane: 'Drone/A', durationSec: 100, colorTransfer: 'bt709' },
    { rel: 'Osmo\\b.mp4',                     path: 'G:\\Osmo\\b.mp4',                     lane: 'Osmo',    durationSec: 50,  colorTransfer: 'bt709' },
  ] }));
});

describe('footagePool', () => {
  it('dedupes stabilized+raw twins, preferring stabilized', () => {
    const all = createFootagePool({ indexPath }).dedupe(createFootagePool({ indexPath }).load());
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.lane === 'Drone/A').rel).toMatch(/_stabilized/);
  });
  it('available groups by lane and excludes used rels', () => {
    const byLane = createFootagePool({ indexPath }).available(new Set(['Osmo\\b.mp4']), {});
    expect(Object.keys(byLane)).toEqual(['Drone/A']);
    expect(byLane['Drone/A']).toHaveLength(1);
  });
  it('lane filter narrows the pool', () => {
    const byLane = createFootagePool({ indexPath }).available(new Set(), { lanes: ['Osmo'] });
    expect(Object.keys(byLane)).toEqual(['Osmo']);
  });
});
