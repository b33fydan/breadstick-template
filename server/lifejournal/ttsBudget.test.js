import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTtsBudget } from './ttsBudget.js';

let dir, usagePath;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsb-')); usagePath = path.join(dir, 'tts-usage.jsonl'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const DAY1 = Date.parse('2026-06-18T10:00:00Z');
const DAY2 = Date.parse('2026-06-19T10:00:00Z');

describe('ttsBudget', () => {
  it('starts empty: spentToday 0, check passes, remaining = cap', () => {
    const b = createTtsBudget({ usagePath, cap: 4000, now: () => DAY1 });
    expect(b.spentToday()).toBe(0);
    expect(b.check(100)).toBe(true);
    expect(b.remaining()).toBe(4000);
  });
  it('accumulates within a day and blocks at the cap', () => {
    const b = createTtsBudget({ usagePath, cap: 4000, now: () => DAY1 });
    b.record(3000);
    expect(b.spentToday()).toBe(3000);
    expect(b.check(1000)).toBe(true);   // 3000+1000 == 4000, fits
    expect(b.check(1001)).toBe(false);  // would exceed
  });
  it('rolls over at the UTC day boundary', () => {
    let t = DAY1;
    const b = createTtsBudget({ usagePath, cap: 4000, now: () => t });
    b.record(3500);
    t = DAY2;
    expect(b.spentToday()).toBe(0);
    expect(b.check(3500)).toBe(true);
  });
  it('blocks a single script larger than the whole cap', () => {
    const b = createTtsBudget({ usagePath, cap: 4000, now: () => DAY1 });
    expect(b.check(4001)).toBe(false);
  });
  it('treats a non-finite cap as unlimited', () => {
    const b = createTtsBudget({ usagePath, cap: Infinity, now: () => DAY1 });
    expect(b.check(10_000_000)).toBe(true);
  });
  it('skips a corrupt ledger line and still counts valid ones', () => {
    fs.writeFileSync(usagePath,
      JSON.stringify({ date: '2026-06-18', chars: 1000, ts: 'x' }) + '\n' +
      '{ not valid json\n' +
      JSON.stringify({ date: '2026-06-18', chars: 500, ts: 'y' }) + '\n');
    const b = createTtsBudget({ usagePath, cap: 4000, now: () => DAY1 });
    expect(b.spentToday()).toBe(1500);
  });
});
