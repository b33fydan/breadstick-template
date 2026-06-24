import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logPerf, readPerfWindow, setPerfDir } from './perfLedger.js';

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'perf-test-'));
  setPerfDir(dir);
});

describe('logPerf', () => {
  it('appends a month-sharded snapshot with the full shape', () => {
    const ok = logPerf({
      postId: 'p1',
      lane: 'tiktok-shop',
      angle: 'shop-demo-first',
      source: 'postiz',
      state: 'DRAFT',
      metrics: { views: 0 },
    });
    expect(ok).toBe(true);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}\.jsonl$/);
    const ev = JSON.parse(readFileSync(join(dir, files[0]), 'utf8').trim());
    expect(ev).toMatchObject({ postId: 'p1', lane: 'tiktok-shop', source: 'postiz', state: 'DRAFT' });
    expect(Number.isNaN(Date.parse(ev.ts))).toBe(false);
  });

  it('refuses snapshots without a postId', () => {
    expect(logPerf({ lane: 'pov' })).toBe(false);
    expect(readdirSync(dir)).toHaveLength(0);
  });
});

describe('readPerfWindow', () => {
  it('returns only events inside the [from, to) window', () => {
    logPerf({ postId: 'p1' });
    logPerf({ postId: 'p2' });
    const now = Date.now();
    const all = readPerfWindow(new Date(now - 60_000).toISOString(), new Date(now + 60_000).toISOString());
    expect(all.map((e) => e.postId).sort()).toEqual(['p1', 'p2']);
    const none = readPerfWindow(new Date(now + 60_000).toISOString(), new Date(now + 120_000).toISOString());
    expect(none).toHaveLength(0);
  });

  it('returns empty for windows with no ledger files', () => {
    expect(readPerfWindow('2020-01-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z')).toEqual([]);
  });
});
