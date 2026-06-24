// Pure ffmpeg-command builder. Pass 1: extract+normalize each chunk (+lut3d if LOG).
// Pass 2: concat demuxer → mux VO (or -an silent). The runner writes the concat list + spawns.
import path from 'node:path';

// Filtergraph-safe LUT term: absolute, forward-slashed, single-quoted.
// On Windows the drive-letter colon must be backslash-escaped (e.g. E\:/) so that
// libavfilter's option parser does not treat it as a key:value separator.
// The option name is 'file' (not 'filename') per libavfilter lut3d AVOptions.
function lutTerm(lut) {
  const abs = path.resolve(lut).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
  return `lut3d=file='${abs}'`;
}

export function buildAssembleCommands({ chunks, voPath = null, outPath, tmpDir, canvas = { w: 1920, h: 1080, fps: 30 }, lut, grain = 0, fit = 'pad', muteOriginal = true }) {
  const { w, h, fps } = canvas;
  const cmds = [];
  const normPaths = [];

  chunks.forEach((c, i) => {
    const norm = path.join(tmpDir, `chunk-${String(i).padStart(3, '0')}.mp4`);
    normPaths.push(norm);
    const vf = fit === 'crop'
      ? [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`]
      : [`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`];
    vf.push(`fps=${fps}`, 'setsar=1');
    if (c.applyLut && lut) vf.push(lutTerm(lut));
    if (grain > 0) vf.push(`noise=alls=${grain}:allf=t+u`);
    cmds.push({ bin: 'ffmpeg', args: [
      '-y', '-ss', String(c.inSec), '-t', String(c.durationSec), '-i', c.path,
      '-vf', vf.join(','), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', norm,
    ] });
  });

  const listPath = path.join(tmpDir, 'concat.txt');
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath];
  if (voPath) {
    args.push('-i', voPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', outPath);
  } else {
    args.push('-map', '0:v:0', '-an', '-c:v', 'copy', outPath);
  }
  cmds.push({ bin: 'ffmpeg', args, concatList: { path: listPath, files: normPaths } });

  // muteOriginal is implicit: pass-1 always drops audio (-an), so originals are never heard. Kept in the
  // signature for forward-compat (a future ambient-bed knob would consult it).
  void muteOriginal;
  return { cmds, normPaths, listPath, outPath };
}
