import { describe, it, expect } from 'vitest';
import { buildAssembleCommands } from './assembler.js';

const chunks = [
  { rel: 'A/x.mp4', path: 'G:\\A\\x.mp4', lane: 'A', inSec: 20, durationSec: 12, applyLut: true },
  { rel: 'B/y.mp4', path: 'G:\\B\\y.mp4', lane: 'B', inSec: 5,  durationSec: 8,  applyLut: false },
];
const LUT = 'pipeline/luts/default.cube';

describe('buildAssembleCommands', () => {
  it('emits one extract per chunk plus one assemble', () => {
    const { cmds } = buildAssembleCommands({ chunks, outPath: 'out.mp4', tmpDir: 'tmp', lut: LUT });
    expect(cmds).toHaveLength(3);
    expect(cmds[0].args).toEqual(expect.arrayContaining(['-ss', '20', '-t', '12', '-i', 'G:\\A\\x.mp4', '-an']));
  });
  it('applies lut3d to LOG chunks only', () => {
    const { cmds } = buildAssembleCommands({ chunks, outPath: 'out.mp4', tmpDir: 'tmp', lut: LUT });
    const vf = (c) => c.args[c.args.indexOf('-vf') + 1];
    expect(vf(cmds[0])).toContain('lut3d=file=');
    expect(vf(cmds[1])).not.toContain('lut3d');
  });
  it('escapes the LUT path: correct option name, single-quoted, forward slashes (drive colon escaped)', () => {
    const { cmds } = buildAssembleCommands({ chunks, outPath: 'out.mp4', tmpDir: 'tmp', lut: LUT });
    const vf = cmds[0].args[cmds[0].args.indexOf('-vf') + 1];
    // Option name must be 'file' (not 'filename') — verified against lut3d AVOptions.
    const m = vf.match(/lut3d=file='([^']+)'/);
    expect(m).toBeTruthy();
    // On Windows the drive-letter colon is escaped as `E\:/` so libavfilter doesn't treat
    // it as a key:value separator. Only that one backslash is allowed.
    const pathPart = m[1].replace(/^[A-Za-z]\\:/, '');  // strip leading drive escape
    expect(pathPart).not.toContain('\\');
    expect(m[1]).toMatch(/default\.cube$/);
  });
  it('muxes VO when voPath set, silent otherwise', () => {
    const withVo = buildAssembleCommands({ chunks, voPath: 'vo.mp3', outPath: 'out.mp4', tmpDir: 'tmp', lut: LUT }).cmds.at(-1);
    expect(withVo.args).toEqual(expect.arrayContaining(['-map', '1:a:0', '-c:a', 'aac', '-shortest']));
    const silent = buildAssembleCommands({ chunks, outPath: 'out.mp4', tmpDir: 'tmp', lut: LUT }).cmds.at(-1);
    expect(silent.args).toContain('-an');
    expect(silent.args).not.toContain('1:a:0');
  });
  it('carries a concat list for the runner to write', () => {
    const last = buildAssembleCommands({ chunks, outPath: 'out.mp4', tmpDir: 'tmp', lut: LUT }).cmds.at(-1);
    expect(last.concatList.files).toHaveLength(2);
  });
});

describe('buildAssembleCommands: grain + fit', () => {
  const chunks = [{ rel: 'a.mp4', path: '/f/a.mp4', lane: 'L', inSec: 0, durationSec: 5, applyLut: true }];
  const base = { chunks, outPath: '/o/out.mp4', tmpDir: '/tmp', canvas: { w: 1080, h: 1080, fps: 30 }, lut: '/luts/x.cube' };
  const vfOf = (cmds) => cmds[0].args[cmds[0].args.indexOf('-vf') + 1];

  it('fit:crop uses scale-to-cover + crop, no pad', () => {
    const { cmds } = buildAssembleCommands({ ...base, fit: 'crop' });
    const vf = vfOf(cmds);
    expect(vf).toContain('force_original_aspect_ratio=increase');
    expect(vf).toContain('crop=1080:1080');
    expect(vf).not.toContain('pad=');
  });
  it('fit:pad (default) uses scale-decrease + pad', () => {
    const vf = vfOf(buildAssembleCommands({ ...base }).cmds);
    expect(vf).toContain('force_original_aspect_ratio=decrease');
    expect(vf).toContain('pad=1080:1080');
  });
  it('grain>0 appends a noise term after the lut', () => {
    const vf = vfOf(buildAssembleCommands({ ...base, grain: 12 }).cmds);
    expect(vf).toMatch(/lut3d=.*noise=alls=12:allf=t\+u/);
  });
  it('grain:0 adds no noise', () => {
    expect(vfOf(buildAssembleCommands({ ...base, grain: 0 }).cmds)).not.toContain('noise=');
  });
});
