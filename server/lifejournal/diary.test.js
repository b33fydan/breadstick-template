// server/lifejournal/diary.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiary } from './diary.js';
import { createFootagePool } from './footagePool.js';
import { createClipLedger } from './clipLedger.js';

let dir, indexPath, ledgerPath, config;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lj-diary-'));
  indexPath = join(dir, 'index.json');
  ledgerPath = join(dir, 'used.jsonl');
  writeFileSync(indexPath, JSON.stringify({ clips: [
    { rel: 'A\\a1.mp4', path: 'G:\\A\\a1.mp4', lane: 'A', durationSec: 100, colorTransfer: 'bt709' },
    { rel: 'A\\a2.mp4', path: 'G:\\A\\a2.mp4', lane: 'A', durationSec: 100, colorTransfer: 'bt709' },
    { rel: 'B\\b1.mp4', path: 'G:\\B\\b1.mp4', lane: 'B', durationSec: 100, colorTransfer: 'arib-std-b67' },
  ] }));
  config = { targetSec: 24, beats: 6, windowSec: 12, canvas: { w: 1920, h: 1080, fps: 30 },
    lut: 'default.cube', logDefault: true, nonLogLanes: [], nonLogRels: [],
    muteOriginal: true, outDir: join(dir, 'out'), voiceId: null,
    series: { default: { lut: 'default.cube', canvas: { w: 1920, h: 1080, fps: 30 }, grain: 0, fit: 'pad' } },
    defaultSeries: ['default'],
  };
});

// makeDiary: phase-2/3 helper — overrides tts, ttsBudget, deliver, voiceId (on config), shapeScript.
// runCmd + probeDuration are no-op stubs; voiceId sets config.voiceId so assemble picks it up.
// Phase-3a extensions: accepts series/defaultSeries for config, runCmd override, and exposes d.spies.
// d.spies.selectChunks wraps pool.available (1:1 with selectChunks calls inside assemble).
// d.spies.ledgerAppend wraps ledger.append.
const makeDiary = ({ tts, ttsBudget, deliver, voiceId, shapeScript, series, defaultSeries, runCmd: runCmdOverride } = {}) => {
  const cfg = {
    ...config,
    voiceId: voiceId !== undefined ? voiceId : config.voiceId,
    ...(series !== undefined ? { series } : {}),
    ...(defaultSeries !== undefined ? { defaultSeries } : {}),
  };

  const runCmd = runCmdOverride ?? vi.fn(async () => ({ ok: true }));

  // Build real pool and ledger, then wrap their key methods with spies.
  const realPool = createFootagePool({ indexPath });
  const selectChunksSpy = vi.fn((...args) => realPool.available(...args));
  const spiedPool = {
    ...realPool,
    available: selectChunksSpy,
  };

  const realLedger = createClipLedger({ ledgerPath });
  const ledgerAppendSpy = vi.fn((...args) => realLedger.append(...args));
  const spiedLedger = {
    ...realLedger,
    append: ledgerAppendSpy,
  };

  const diaryInst = createDiary({
    indexPath, ledgerPath, lutDir: '/luts', config: cfg,
    tts: tts ?? vi.fn(async ({ outPath }) => ({ path: outPath, bytes: 10 })),
    probeDuration: vi.fn(async () => 24),
    runCmd,
    now: () => 1700000000000,
    shapeScript,
    ttsBudget,
    deliver,
    pool: spiedPool,
    ledger: spiedLedger,
  });

  return {
    ...diaryInst,
    spies: { selectChunks: selectChunksSpy, ledgerAppend: ledgerAppendSpy, runCmd },
  };
};

// Legacy helper kept for existing tests (identical to old mkDiary).
// config (from beforeEach) now carries series/defaultSeries matching production shape.
const mkDiary = (over = {}) => createDiary({
  indexPath, ledgerPath, lutDir: '/luts', config,
  tts: vi.fn(async ({ outPath }) => ({ path: outPath, bytes: 10 })),
  probeDuration: vi.fn(async () => 24),
  runCmd: vi.fn(async () => ({ ok: true })),
  now: () => 1700000000000,
  ...over,
});

describe('diary.draft', () => {
  it('returns chunks + entryId without rendering', async () => {
    const r = await mkDiary().draft({ targetSec: 24 });
    expect(r.entryId).toBe('entry-0001');
    expect(r.chunks.length).toBeGreaterThan(0);
  });
});

describe('diary.assemble (silent)', () => {
  it('runs ffmpeg, appends the ledger, returns a silent result', async () => {
    const runCmd = vi.fn(async () => ({ ok: true }));
    const r = await mkDiary({ runCmd }).assemble({ targetSec: 24 }, {});
    expect(runCmd).toHaveBeenCalled();
    expect(r.silent).toBe(true);
    expect(r.clipsUsed.length).toBeGreaterThan(0);
    expect(readFileSync(ledgerPath, 'utf8')).toContain('entry-0001');
  });
  it('does not reuse footage across entries', async () => {
    const d = mkDiary();
    const a = await d.assemble({ targetSec: 12 }, {});
    const b = await d.assemble({ targetSec: 12 }, {});
    expect(a.clipsUsed.filter((r) => b.clipsUsed.includes(r))).toHaveLength(0);
  });
  it('calls tts + probeDuration when script and voiceId present', async () => {
    const tts = vi.fn(async ({ outPath }) => ({ path: outPath, bytes: 1 }));
    const probeDuration = vi.fn(async () => 18);
    const r = await mkDiary({ tts, probeDuration }).assemble({ scriptText: 'a thought', voiceId: 'V1', targetSec: 24 }, {});
    expect(tts).toHaveBeenCalled();
    expect(probeDuration).toHaveBeenCalled();
    expect(r.silent).toBe(false);
  });
});

// --- Phase-2: cap + deliver ---
describe('diary phase-2: cap + deliver', () => {
  it('renders narrated when under budget: tts + record called', async () => {
    const tts = vi.fn(async ({ outPath }) => {});
    const record = vi.fn();
    const ttsBudget = { check: () => true, record };
    const d = makeDiary({ tts, ttsBudget, voiceId: 'v1', shapeScript: async () => 'hello world script' });
    const r = await d.assemble({ thought: 'today' });
    expect(tts).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith('hello world script'.length);
    expect(r.silent).toBe(false);
    expect(r.capped).toBe(false);
  });

  it('skips VO and marks capped when over budget: tts + record NOT called', async () => {
    const tts = vi.fn();
    const record = vi.fn();
    const ttsBudget = { check: () => false, record };
    const d = makeDiary({ tts, ttsBudget, voiceId: 'v1', shapeScript: async () => 'a long reflection' });
    const r = await d.assemble({ thought: 'today' });
    expect(tts).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(r.silent).toBe(true);
    expect(r.capped).toBe(true);
  });

  it('no-voice path stays silent but not capped', async () => {
    const d = makeDiary({ voiceId: null, shapeScript: async () => 'script' });
    const r = await d.assemble({ thought: 'today' });
    expect(r.silent).toBe(true);
    expect(r.capped).toBe(false);
  });

  it('surfaces driveUrl from deliver', async () => {
    const deliver = vi.fn(async ({ entryId }) => `https://drive/${entryId}`);
    const d = makeDiary({ deliver });
    const r = await d.assemble({});
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ entryId: r.entryId, outPath: r.outputs[0].outPath }));
    expect(r.outputs[0].driveUrl).toBe(`https://drive/${r.entryId}`);
  });

  it('swallows deliver failure: driveUrl null, no throw', async () => {
    const deliver = vi.fn(async () => { throw new Error('drive down'); });
    const d = makeDiary({ deliver });
    const r = await d.assemble({});
    expect(r.outputs[0].driveUrl).toBeNull();
    expect(r.outputs[0].outPath).toBeTruthy();
  });
});

// --- Phase-3a: multi-look output ---
const SERIES_FIXTURE = {
  clean:  { lut: 'L.cube', canvas: { w: 1920, h: 1080, fps: 30 }, grain: 0,  fit: 'pad'  },
  square: { lut: 'L.cube', canvas: { w: 1080, h: 1080, fps: 30 }, grain: 10, fit: 'crop' },
};

describe('diary phase-3a: multi-look output', () => {
  it('renders one output per requested look, sharing selection + VO', async () => {
    const tts = vi.fn(async () => {});
    const record = vi.fn();
    const deliver = vi.fn(async ({ outPath }) => `drive:${outPath}`);
    const d = makeDiary({
      series: SERIES_FIXTURE,
      defaultSeries: ['clean'],
      voiceId: 'v1',
      shapeScript: async () => 'script',
      tts,
      ttsBudget: { check: () => true, record },
      deliver,
    });
    const r = await d.assemble({ thought: 'today', series: ['clean', 'square'] });
    expect(r.outputs.map((o) => o.series)).toEqual(['clean', 'square']);
    expect(r.outputs.every((o) => o.driveUrl)).toBe(true);
    expect(tts).toHaveBeenCalledOnce();         // VO once
    expect(record).toHaveBeenCalledOnce();       // budget recorded once
    expect(d.spies.selectChunks).toHaveBeenCalledOnce();  // selection once
    expect(d.spies.ledgerAppend).toHaveBeenCalledOnce();  // no-reuse once
  });

  it('defaults to config.defaultSeries when none given', async () => {
    const d = makeDiary({ series: SERIES_FIXTURE, defaultSeries: ['square'] });
    const r = await d.assemble({});
    expect(r.outputs.map((o) => o.series)).toEqual(['square']);
  });

  it('throws on an unknown series', async () => {
    const d = makeDiary({ series: SERIES_FIXTURE, defaultSeries: ['clean'] });
    await expect(d.assemble({ series: ['nope'] })).rejects.toThrow(/unknown series/);
  });

  it('keeps successful looks when one look fails; ledger still appended once', async () => {
    const d = makeDiary({
      series: SERIES_FIXTURE,
      defaultSeries: ['clean'],
      runCmd: vi.fn(async ({ args }) => {
        if (String(args).includes('square')) throw new Error('ffmpeg boom');
        return {};
      }),
    });
    const r = await d.assemble({ series: ['clean', 'square'] });
    expect(r.outputs.map((o) => o.series)).toEqual(['clean']);
    expect(r.failed).toEqual(['square']);
    expect(d.spies.ledgerAppend).toHaveBeenCalledOnce();
  });
});
