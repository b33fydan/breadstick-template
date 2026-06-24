import { describe, it, expect } from 'vitest';
import { resolveSeriesConfig } from './series.js';

const FLAT = { lut: 'L.cube', canvas: { w: 1920, h: 1080, fps: 30 }, voiceId: 'v1', outDir: '/o' };

describe('resolveSeriesConfig', () => {
  it('synthesizes a clean series from flat lut/canvas when none given', () => {
    const r = resolveSeriesConfig({ ...FLAT });
    expect(r.series).toEqual({ clean: { lut: 'L.cube', canvas: { w: 1920, h: 1080, fps: 30 }, grain: 0, fit: 'pad' } });
    expect(r.defaultSeries).toEqual(['clean']);
    expect(r.voiceId).toBe('v1');          // preserves other fields
  });
  it('preserves given series and fills grain/fit defaults', () => {
    const r = resolveSeriesConfig({ ...FLAT, series: { square: { lut: 'L.cube', canvas: { w: 1080, h: 1080, fps: 30 }, fit: 'crop' } }, defaultSeries: ['square'] });
    expect(r.series.square).toEqual({ lut: 'L.cube', canvas: { w: 1080, h: 1080, fps: 30 }, grain: 0, fit: 'crop' });
  });
  it('clamps grain to 0..100', () => {
    const r = resolveSeriesConfig({ ...FLAT, series: { a: { lut: 'L', canvas: {}, grain: 999 }, b: { lut: 'L', canvas: {}, grain: -5 } } });
    expect(r.series.a.grain).toBe(100);
    expect(r.series.b.grain).toBe(0);
  });
  it('throws if a series lacks lut or canvas', () => {
    expect(() => resolveSeriesConfig({ ...FLAT, series: { bad: { lut: 'L' } } })).toThrow(/canvas/);
  });
  it('drops unknown defaultSeries names; empty → first key', () => {
    const r = resolveSeriesConfig({ ...FLAT, series: { x: { lut: 'L', canvas: {} }, y: { lut: 'L', canvas: {} } }, defaultSeries: ['nope', 'y'] });
    expect(r.defaultSeries).toEqual(['y']);
    const r2 = resolveSeriesConfig({ ...FLAT, series: { x: { lut: 'L', canvas: {} } }, defaultSeries: ['nope'] });
    expect(r2.defaultSeries).toEqual(['x']);
  });
});
