import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, utimesSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRenderCache } from './renderCache.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rcache-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('renderCache keyFor', () => {
  it('is deterministic for the same parts and changes when a part changes', () => {
    const rc = createRenderCache({});
    const a = rc.keyFor(['Comp', { x: 1 }, 'hashA']);
    const b = rc.keyFor(['Comp', { x: 1 }, 'hashA']);
    const c = rc.keyFor(['Comp', { x: 2 }, 'hashA']);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('renderCache hashFile', () => {
  it('is stable for identical bytes and differs for different bytes', () => {
    const rc = createRenderCache({});
    const p1 = join(dir, 'a.bin'); const p2 = join(dir, 'b.bin'); const p3 = join(dir, 'c.bin');
    writeFileSync(p1, 'hello'); writeFileSync(p2, 'hello'); writeFileSync(p3, 'world');
    expect(rc.hashFile(p1)).toBe(rc.hashFile(p2));
    expect(rc.hashFile(p1)).not.toBe(rc.hashFile(p3));
  });
});

describe('renderCache run', () => {
  it('miss: calls render with the output target and stores a copy in the cache', async () => {
    const rc = createRenderCache({});
    const cacheDir = join(dir, 'cache');
    const outputPath = join(dir, 'out', 'result.mp4');
    let renderedTo = null;
    const res = await rc.run({
      cacheDir, key: 'k1', ext: 'mp4', outputPath,
      render: async (target) => { renderedTo = target; writeFileSync(target, 'RENDERED'); },
    });
    expect(res.cached).toBe(false);
    expect(renderedTo).toBe(outputPath);
    expect(readFileSync(outputPath, 'utf8')).toBe('RENDERED');
    expect(readFileSync(join(cacheDir, 'k1.mp4'), 'utf8')).toBe('RENDERED');
  });

  it('hit: skips render and copies the cached file to outputPath', async () => {
    const rc = createRenderCache({});
    const cacheDir = join(dir, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'k1.mp4'), 'CACHED');
    const outputPath = join(dir, 'out', 'result.mp4');
    let called = false;
    const res = await rc.run({
      cacheDir, key: 'k1', ext: 'mp4', outputPath,
      render: async () => { called = true; },
    });
    expect(res.cached).toBe(true);
    expect(called).toBe(false);
    expect(readFileSync(outputPath, 'utf8')).toBe('CACHED');
  });

  it('skyframe mode (no outputPath): renders to the cache file on miss, returns it on hit without rendering', async () => {
    const rc = createRenderCache({});
    const cacheDir = join(dir, 'skyframe');
    let calls = 0;
    const miss = await rc.run({ cacheDir, key: 'sk', ext: 'webm', render: async (target) => { calls++; writeFileSync(target, 'WEBM'); } });
    expect(miss.cached).toBe(false);
    expect(miss.outputPath).toBe(join(cacheDir, 'sk.webm'));
    expect(readFileSync(miss.outputPath, 'utf8')).toBe('WEBM');
    const hit = await rc.run({ cacheDir, key: 'sk', ext: 'webm', render: async () => { calls++; } });
    expect(hit.cached).toBe(true);
    expect(calls).toBe(1);
  });
});

describe('renderCache prune', () => {
  it('deletes entries older than maxAgeMs, keeps fresh ones, tolerates a missing dir', () => {
    const rc = createRenderCache({ now: () => 10_000_000 });
    const cacheDir = join(dir, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const oldFile = join(cacheDir, 'old.mp4'); const freshFile = join(cacheDir, 'fresh.mp4');
    writeFileSync(oldFile, 'x'); writeFileSync(freshFile, 'y');
    utimesSync(oldFile, new Date(1_000), new Date(1_000));           // mtimeMs = 1000
    utimesSync(freshFile, new Date(9_999_000), new Date(9_999_000)); // mtimeMs = 9_999_000
    const res = rc.prune({ cacheDir, maxAgeMs: 5_000 });             // cutoff = 10_000_000 - 5_000 = 9_995_000
    expect(res.pruned).toBe(1);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(freshFile)).toBe(true);
    expect(rc.prune({ cacheDir: join(dir, 'nope'), maxAgeMs: 1000 })).toEqual({ pruned: 0 });
  });
});
