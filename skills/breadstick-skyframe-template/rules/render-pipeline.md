# Render pipeline

The exact commands to render a Skyframe composition and composite it onto the source video.

## 1. Render the alpha overlay (Remotion)

```bash
npx remotion render src/remotion/index.jsx PracticeOverlay009 \
  renders/popped/test009_overlay.webm \
  --codec=vp9 --pixel-format=yuva420p --image-format=png \
  --gl=angle --concurrency=2 --frames=0-1163
```

Notes:
- `PracticeOverlay009` = composition ID registered in `src/remotion/Root.jsx`. Replace with your new composition.
- `--codec=vp9 --pixel-format=yuva420p` is required for transparent video output. Don't change.
- `--image-format=png` is required for VP9 alpha. JPEG drops alpha.
- `--gl=angle` enables the WebGL renderer (only matters if any effect uses `<HtmlInCanvas>` shaders, but harmless otherwise; matches `remotion.config.mjs`).
- `--frames=0-N` = inclusive range. Compute as `videoDurationSec * fps - 1` rounded down.
- Output goes to `.webm` since VP9 alpha lives there. **Do not rename to `.mp4`** — alpha will be lost.

## 2. Composite onto the source video (FFmpeg)

The base video gets a 0–3s `gblur` for the RayBanIntro hook backdrop, then the alpha overlay layers on top. Audio mixes the original voice with the embedded sound cues (bubble/whoosh/chime).

```bash
ffmpeg -y \
  -i renders/popped/test007.mp4 \
  -c:v libvpx-vp9 -i renders/popped/test009_overlay.webm \
  -filter_complex "\
    [0:v]gblur=sigma=22:enable='between(t,0,3)'[blurred];\
    [blurred][1:v]overlay=0:0:eof_action=pass[vout];\
    [0:a]volume=1.0[a0];\
    [1:a]volume=0.85[a1];\
    [a0][a1]amix=inputs=2:duration=longest:dropout_transition=0[aout]" \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -preset fast -crf 18 \
  -c:a aac -b:a 256k \
  -movflags +faststart \
  renders/popped/test009_v1.mp4
```

### Critical detail: VP9 alpha preservation

`-c:v libvpx-vp9` MUST appear **before** the overlay input (`-i renders/popped/test009_overlay.webm`). This is a decoder hint; without it, FFmpeg silently drops alpha and the overlay composites as opaque black. `ffprobe` will lie about it (reports `yuv420p` even when alpha was present in the source).

If the composite renders with black rectangles instead of transparent overlays, this is almost always the cause.

### Audio mix weights

`volume=1.0` for the base voice and `volume=0.85` for the overlay sounds keeps voice prominent while letting bubble/whoosh/chime register. Tune `0.85` up for more punch, down for more subtlety.

### Blur enable expression

`gblur=sigma=22:enable='between(t,0,3)'` blurs the first 3 seconds (matches `RayBanIntro` window). For a different intro length, change the `0,3` range.

## 3. Spot-check with frame extraction

Pull keyframes at each beat's mid-point to verify the composite reads correctly:

```bash
ffmpeg -y -ss 1.5  -i renders/popped/test009_v1.mp4 -frames:v 1 -q:v 2 renders/popped/check_intro.jpg
ffmpeg -y -ss 8.3  -i renders/popped/test009_v1.mp4 -frames:v 1 -q:v 2 renders/popped/check_beat2.jpg
ffmpeg -y -ss 18.0 -i renders/popped/test009_v1.mp4 -frames:v 1 -q:v 2 renders/popped/check_beat3.jpg
ffmpeg -y -ss 25.0 -i renders/popped/test009_v1.mp4 -frames:v 1 -q:v 2 renders/popped/check_beat4.jpg
ffmpeg -y -ss 37.0 -i renders/popped/test009_v1.mp4 -frames:v 1 -q:v 2 renders/popped/check_opus.jpg
ffmpeg -y -ss 40.5 -i renders/popped/test009_v1.mp4 -frames:v 1 -q:v 2 renders/popped/check_planet.jpg
```

Especially: `check_intro.jpg` is your portrait thumbnail. If the hero phrase doesn't read at thumbnail size, the hook needs work.

## 4. Iteration

If a beat needs tuning:
1. Edit `src/remotion/compositions/PracticeOverlay###.jsx` (or the underlying skyframe component if it's a vocabulary-wide change).
2. Re-render the overlay (step 1).
3. Re-composite (step 2). The base video doesn't change so this is fast (~30s).
4. Re-extract the relevant frame (step 3).

Keep `_v1.mp4`, `_v2.mp4`, etc. so you can A/B side-by-side. Delete intermediate `.webm` overlays once you've confirmed a final.

## 5. Render time expectations

- Bundle phase (one-time per render): ~30–90s (dominated by `public/` dir copy)
- Encode phase: ~3–4 frames/sec on a typical workstation
- 1164-frame (48.5s) video: ~5–8 min total

If the bundle phase is consistently slow, audit `public/` for stale render outputs that can be moved out of the way.
