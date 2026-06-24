import { describe, it, expect } from 'vitest';
import { createJobTypes } from './jobTypes.js';

// Fake runCli that records calls and returns a canned result.
function fakeCli(result) {
  const calls = [];
  const fn = async (script, args, timeout, opts) => { calls.push({ script, args, timeout, signal: opts?.signal }); return result; };
  fn.calls = calls;
  return fn;
}
// Mirror of server.js extractDriveFileUrl.
const extract = {
  drive: (stdout) => {
    const m = stdout.match(/Drive:[^(\n]*\(([A-Za-z0-9_-]{20,})\)/);
    return m ? `https://drive.google.com/file/d/${m[1]}/view` : null;
  },
};
const paths = { SHORTFORM_CLI: '/x/shortform-cli.js' };

describe('jobTypes shortform-process', () => {
  it('named pack → --overlay <pack> --no-grade, 30-min timeout', async () => {
    const runCli = fakeCli({ stdout: 'Drive: out.mp4 (abcdefghij0123456789)', stderr: '', exitCode: 0 });
    const jt = createJobTypes({ runCli, paths, extract });
    const result = await jt.run({ type: 'shortform-process', input: { pack: 'skyframe-5beat' } });
    expect(runCli.calls[0]).toEqual({ script: '/x/shortform-cli.js', args: ['process', '--overlay', 'skyframe-5beat', '--no-grade'], timeout: 1800000 });
    expect(result).toEqual({ driveUrl: 'https://drive.google.com/file/d/abcdefghij0123456789/view' });
  });

  it("pack 'none' → --no-overlay --no-grade", async () => {
    const runCli = fakeCli({ stdout: '', stderr: '', exitCode: 0 });
    const jt = createJobTypes({ runCli, paths, extract });
    await jt.run({ type: 'shortform-process', input: { pack: 'none' } });
    expect(runCli.calls[0].args).toEqual(['process', '--no-overlay', '--no-grade']);
  });

  it("pack 'default' (and undefined) → bare ['process'] (video-upload path behavior)", async () => {
    const runCli = fakeCli({ stdout: '', stderr: '', exitCode: 0 });
    const jt = createJobTypes({ runCli, paths, extract });
    await jt.run({ type: 'shortform-process', input: { pack: 'default' } });
    await jt.run({ type: 'shortform-process', input: {} });
    expect(runCli.calls[0].args).toEqual(['process']);
    expect(runCli.calls[1].args).toEqual(['process']);
  });

  it('non-zero exit throws with the code and stderr slice', async () => {
    const runCli = fakeCli({ stdout: '', stderr: 'kaboom', exitCode: 2 });
    const jt = createJobTypes({ runCli, paths, extract });
    await expect(jt.run({ type: 'shortform-process', input: { pack: 'none' } })).rejects.toThrow(/exit 2/);
  });

  it('null driveUrl when stdout has no Drive line', async () => {
    const runCli = fakeCli({ stdout: 'no drive here', stderr: '', exitCode: 0 });
    const jt = createJobTypes({ runCli, paths, extract });
    expect(await jt.run({ type: 'shortform-process', input: { pack: 'none' } })).toEqual({ driveUrl: null });
  });

  it('unknown job type throws', async () => {
    const jt = createJobTypes({ runCli: fakeCli({}), paths, extract });
    await expect(jt.run({ type: 'nope', input: {} })).rejects.toThrow(/unknown job type/);
  });

  it('formatDone / formatError wording matches the legacy handler', () => {
    const jt = createJobTypes({ runCli: fakeCli({}), paths, extract });
    expect(jt.formatDone('shortform-process', { driveUrl: 'http://x' })).toBe('Processed.\nhttp://x');
    expect(jt.formatDone('shortform-process', { driveUrl: null })).toBe('Processed — check /Short form OUT/.');
    expect(jt.formatError('shortform-process', 'exit 2: kaboom')).toBe('Process failed.\nexit 2: kaboom');
  });
});

describe('jobTypes longform', () => {
  it('builds longform --pov <fileId> args with a 60-min timeout', async () => {
    const runCli = fakeCli({ stdout: 'Drive: longform.mp4 (abcdefghij0123456789)', stderr: '', exitCode: 0 });
    const jt = createJobTypes({ runCli, paths, extract });
    const result = await jt.run({ type: 'longform', input: { fileId: 'drivefile123' } });
    expect(runCli.calls[0]).toEqual({ script: '/x/shortform-cli.js', args: ['longform', '--pov', 'drivefile123'], timeout: 3600000 });
    expect(result).toEqual({ driveUrl: 'https://drive.google.com/file/d/abcdefghij0123456789/view' });
  });

  it('appends --silence-cut when input.silenceCut is set', async () => {
    const runCli = fakeCli({ stdout: '', stderr: '', exitCode: 0 });
    const jt = createJobTypes({ runCli, paths, extract });
    await jt.run({ type: 'longform', input: { fileId: 'vid9', silenceCut: true } });
    expect(runCli.calls[0].args).toEqual(['longform', '--pov', 'vid9', '--silence-cut']);
  });

  it('non-zero exit throws with the code and stderr slice', async () => {
    const runCli = fakeCli({ stdout: '', stderr: 'boom', exitCode: 1 });
    const jt = createJobTypes({ runCli, paths, extract });
    await expect(jt.run({ type: 'longform', input: { fileId: 'x' } })).rejects.toThrow(/exit 1/);
  });

  it('formatDone / formatError wording', () => {
    const jt = createJobTypes({ runCli: fakeCli({}), paths, extract });
    expect(jt.formatDone('longform', { driveUrl: 'http://x' })).toBe('Longform done.\nhttp://x');
    expect(jt.formatDone('longform', { driveUrl: null })).toBe('Longform done — check /Short form OUT/.');
    expect(jt.formatError('longform', 'exit 1: boom')).toBe('Longform failed.\nexit 1: boom');
  });
});

describe('jobTypes registry', () => {
  it('has() recognizes known types and rejects unknown', () => {
    const jt = createJobTypes({ runCli: fakeCli({}), paths, extract });
    expect(jt.has('shortform-process')).toBe(true);
    expect(jt.has('longform')).toBe(true);
    expect(jt.has('nope')).toBe(false);
  });

  it('run forwards the abort signal to runCli', async () => {
    const runCli = fakeCli({ stdout: '', stderr: '', exitCode: 0 });
    const jt = createJobTypes({ runCli, paths, extract });
    const ac = new AbortController();
    await jt.run({ type: 'shortform-process', input: { pack: 'none' }, signal: ac.signal });
    expect(runCli.calls[0].signal).toBe(ac.signal);
  });
});

describe('jobTypes lifejournal-diary lane', () => {
  const fakeLj = (impl) => ({ assemble: async (...a) => (impl ? impl(...a) : { entryId: 'entry-0001', outPath: 'x.mp4', silent: true, clipsUsed: ['a'], durationSec: 12 }) });

  it('has() recognizes lifejournal-diary', () => {
    const jt = createJobTypes({ runCli: fakeCli({}), paths, extract, lifejournal: fakeLj() });
    expect(jt.has('lifejournal-diary')).toBe(true);
  });
  it('dispatches to lifejournal.assemble with (input, {signal})', async () => {
    const calls = [];
    const lifejournal = { assemble: async (input, ctx) => { calls.push({ input, ctx }); return { entryId: 'entry-0001', outPath: 'out.mp4', silent: true }; } };
    const jt = createJobTypes({ runCli: fakeCli({}), paths, extract, lifejournal });
    const ac = new AbortController();
    const r = await jt.run({ type: 'lifejournal-diary', input: { targetSec: 12 }, signal: ac.signal });
    expect(calls[0].input).toEqual({ targetSec: 12 });
    expect(calls[0].ctx.signal).toBe(ac.signal);
    expect(r.entryId).toBe('entry-0001');
  });
  it('formats lifejournal-diary done/error', () => {
    const jt = createJobTypes({ runCli: fakeCli({}), paths, extract, lifejournal: fakeLj() });
    expect(jt.formatDone('lifejournal-diary', { entryId: 'entry-0001', outputs: [{ series: 'cinematic', outPath: 'x.mp4', driveUrl: null }], silent: true })).toContain('entry-0001');
    expect(jt.formatError('lifejournal-diary', 'boom')).toContain('boom');
  });

  describe('lifejournal-diary done-message', () => {
    const jt = createJobTypes({ runCli: async () => ({}), paths: {}, extract: { drive: () => null },
      shipTemplate: { run: async () => ({}) }, lifejournal: { assemble: async () => ({}) } });
    const out = (series, driveUrl) => ({ series, outPath: `/o/${series}.mp4`, driveUrl });
    it('prefers driveUrl', () => {
      expect(jt.formatDone('lifejournal-diary', { entryId: 'entry-0007', outputs: [out('cinematic', 'https://drive/e7')] }))
        .toBe('Diary entry-0007 ready — 1 look.\n• cinematic: https://drive/e7');
    });
    it('notes cap-silence', () => {
      expect(jt.formatDone('lifejournal-diary', { entryId: 'e', silent: true, capped: true, outputs: [out('clean', null)] }))
        .toBe('Diary e ready (silent — daily TTS cap) — 1 look.\n• clean: /o/clean.mp4');
    });
    it('notes plain silence (no voice id)', () => {
      expect(jt.formatDone('lifejournal-diary', { entryId: 'e', silent: true, capped: false, outputs: [out('cinematic', null)] }))
        .toBe('Diary e ready (silent) — 1 look.\n• cinematic: /o/cinematic.mp4');
    });
  });
});

describe('lifejournal-diary done: looks', () => {
  const jt = createJobTypes({ runCli: async () => ({}), paths: {}, extract: { drive: () => null }, shipTemplate: { run: async () => ({}) }, lifejournal: { assemble: async () => ({}) } });
  const out = (series, driveUrl) => ({ series, outPath: `/o/${series}.mp4`, driveUrl });
  it('lists N looks with links', () => {
    expect(jt.formatDone('lifejournal-diary', { entryId: 'e1', outputs: [out('cinematic', 'd:c'), out('square', 'd:s')] }))
      .toBe('Diary e1 ready — 2 looks.\n• cinematic: d:c\n• square: d:s');
  });
  it('notes cap-silence + falls back to outPath', () => {
    expect(jt.formatDone('lifejournal-diary', { entryId: 'e1', silent: true, capped: true, outputs: [out('clean', null)] }))
      .toBe('Diary e1 ready (silent — daily TTS cap) — 1 look.\n• clean: /o/clean.mp4');
  });
  it('appends a failed note', () => {
    expect(jt.formatDone('lifejournal-diary', { entryId: 'e1', outputs: [out('clean', 'd:c')], failed: ['square'] }))
      .toBe('Diary e1 ready — 1 look (1 failed: square).\n• clean: d:c');
  });
});

describe('jobTypes ship-template lane', () => {
  const fakeShip = (impl) => ({ run: async (...a) => (impl ? impl(...a) : { ok: true }) });

  it('has() recognizes ship-template', () => {
    const jt = createJobTypes({ runCli: fakeCli({}), paths, extract, shipTemplate: fakeShip() });
    expect(jt.has('ship-template')).toBe(true);
  });

  it('dispatches ship-template to shipTemplate.run with (input, {signal})', async () => {
    const calls = [];
    const shipTemplate = { run: async (input, ctx) => { calls.push({ input, ctx }); return { ok: true, previewUrl: 'https://x', branch: 'ship/y-1', sha: 'z' }; } };
    const jt = createJobTypes({ runCli: fakeCli({}), paths, extract, shipTemplate });
    const ac = new AbortController();
    const r = await jt.run({ type: 'ship-template', input: { instruction: 'do x' }, signal: ac.signal });
    expect(calls[0].input).toEqual({ instruction: 'do x' });
    expect(calls[0].ctx.signal).toBe(ac.signal);
    expect(r.previewUrl).toBe('https://x');
  });

  it('formats ship-template done/error', () => {
    const jt = createJobTypes({ runCli: fakeCli({}), paths, extract, shipTemplate: fakeShip() });
    expect(jt.formatDone('ship-template', { previewUrl: 'https://x' })).toBe('Shipped 🚀 https://x');
    expect(jt.formatError('ship-template', 'gate: boom')).toBe("Couldn't ship — gate: boom");
  });

  it('regression: shortform-process still runs via the node CLI path when shipTemplate is also injected', async () => {
    const runCli = fakeCli({ stdout: 'Drive: out.mp4 (abcdefghij0123456789)', stderr: '', exitCode: 0 });
    const jt = createJobTypes({ runCli, paths, extract, shipTemplate: fakeShip() });
    const r = await jt.run({ type: 'shortform-process', input: { pack: 'none' } });
    expect(runCli.calls[0].args).toEqual(['process', '--no-overlay', '--no-grade']);
    expect(r.driveUrl).toContain('drive.google.com');
  });
});
