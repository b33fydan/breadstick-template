// server/areciboEncoder.test.js
import {describe, it, expect} from 'vitest';
import {encodeWeek, GRID, SECTIONS, CATEGORIES, CATEGORY_COLS} from './areciboEncoder.js';

const FIXTURE = {
  weekLabel: '2026-W23', weekNumber: 23, year: 2026,
  counts: {script: 14, image: 9, video: 6, carousel: 2, post: 5},
  daily: [3, 7, 0, 5, 9, 8, 4],
  highlight: 'video', total: 36,
};
const bit = (bits, row, col) => bits[row * GRID.cols + col];
const rowSum = (bits, row) => Array.from({length: GRID.cols}, (_, c) => bit(bits, row, c)).reduce((a, b) => a + b, 0);

describe('encodeWeek invariants', () => {
  it('emits exactly 943 bits of 0/1', () => {
    const {bits} = encodeWeek(FIXTURE);
    expect(bits).toHaveLength(943);
    expect(bits.every((b) => b === 0 || b === 1)).toBe(true);
  });

  it('is deterministic', () => {
    expect(encodeWeek(FIXTURE).bits.join('')).toBe(encodeWeek(FIXTURE).bits.join(''));
  });

  it('keeps separator rows 4, 14, 25, 34, 35, 39 empty', () => {
    const {bits} = encodeWeek(FIXTURE);
    for (const r of [4, 14, 25, 34, 35, 39]) expect(rowSum(bits, r)).toBe(0);
  });

  it('encodes week 23 in binary on row 3 (cols 2-7 MSB-first = 010111)', () => {
    const {bits} = encodeWeek(FIXTURE);
    expect([2, 3, 4, 5, 6, 7].map((c) => bit(bits, 3, c)).join('')).toBe('010111');
  });

  it('encodes script=14 as 001110 down rows 6-11 at col 2', () => {
    const {bits} = encodeWeek(FIXTURE);
    expect([6, 7, 8, 9, 10, 11].map((r) => bit(bits, r, 2)).join('')).toBe('001110');
  });

  it('saturates counts above 63 and sets the overflow marker', () => {
    const {bits} = encodeWeek({...FIXTURE, counts: {...FIXTURE.counts, script: 99}});
    expect(bit(bits, 5, 2)).toBe(1); // overflow marker
    expect([6, 7, 8, 9, 10, 11].map((r) => bit(bits, r, 2)).join('')).toBe('111111'); // 63
  });

  it('raises the highlight marker one row (video → col 10 row 32, row 33 empty there)', () => {
    const {bits} = encodeWeek(FIXTURE);
    expect(bit(bits, 32, 10)).toBe(1);
    expect(bit(bits, 33, 10)).toBe(0);
    expect(bit(bits, 33, 2)).toBe(1); // non-highlight stays on the line
  });

  it('puts all five markers on row 33 when highlight is null', () => {
    const {bits} = encodeWeek({...FIXTURE, highlight: null});
    for (const c of CATEGORY_COLS) expect(bit(bits, 33, c)).toBe(1);
    expect(rowSum(bits, 32)).toBe(0);
  });

  it('clamps negative inputs to zero instead of corrupting the grid', () => {
    const {bits} = encodeWeek({...FIXTURE, weekNumber: -5, year: -3, counts: {...FIXTURE.counts, image: -7}, daily: [-1, 7, 0, 5, 9, 8, 4]});
    expect(bits).toHaveLength(943);
    expect(bits.every((b) => b === 0 || b === 1)).toBe(true);
    expect([2, 3, 4, 5, 6, 7].map((c) => bit(bits, 3, c)).join('')).toBe('000000'); // week clamped to 0
    expect([6, 7, 8, 9, 10, 11].map((r) => bit(bits, r, 6)).join('')).toBe('000000'); // image clamped to 0
  });

  it('tolerates a daily array shorter than 7', () => {
    const {bits} = encodeWeek({...FIXTURE, daily: [3, 7]});
    expect(bits).toHaveLength(943);
    expect(bit(bits, 24, 4)).toBe(1);  // Mon baseline painted
    expect(bit(bits, 24, 8)).toBe(0);  // Wed (missing) untouched
  });

  it('treats an unknown highlight as no raised marker', () => {
    const {bits} = encodeWeek({...FIXTURE, highlight: 'bogus'});
    expect(rowSum(bits, 32)).toBe(0);
    for (const c of CATEGORY_COLS) expect(bit(bits, 33, c)).toBe(1);
  });

  it('renders rhythm bar Tue=7 → height 3 (rows 21-23 at col 6), zero day shows only baseline', () => {
    const {bits} = encodeWeek(FIXTURE);
    expect([21, 22, 23].map((r) => bit(bits, r, 6)).join('')).toBe('111');
    expect(bit(bits, 20, 6)).toBe(0);
    expect(bit(bits, 23, 8)).toBe(0); // Wed n=0 → no bar
    expect(bit(bits, 24, 8)).toBe(1); // but baseline present
  });

  it('returns the all-zero silence grid for an empty week', () => {
    const {bits} = encodeWeek({...FIXTURE, counts: {script: 0, image: 0, video: 0, carousel: 0, post: 0}, daily: [0, 0, 0, 0, 0, 0, 0], highlight: null, total: 0});
    expect(bits.every((b) => b === 0)).toBe(true);
  });

  it('exposes the section map and grid constants', () => {
    expect(GRID).toEqual({cols: 23, rows: 41, bits: 943});
    expect(SECTIONS.counting).toEqual({rowStart: 0, rowEnd: 3});
    expect(SECTIONS.elements).toEqual({rowStart: 5, rowEnd: 13});
    expect(SECTIONS.rhythm).toEqual({rowStart: 15, rowEnd: 24});
    expect(SECTIONS.operator).toEqual({rowStart: 26, rowEnd: 33});
    expect(SECTIONS.instrument).toEqual({rowStart: 36, rowEnd: 40});
    expect(CATEGORIES).toEqual(['script', 'image', 'video', 'carousel', 'post']);
  });

  it('golden: fixture week bit pattern is frozen', () => {
    expect(encodeWeek(FIXTURE).bits.join('')).toMatchSnapshot();
  });
});
