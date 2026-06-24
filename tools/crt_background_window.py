"""
CRT-scanlines on BACKGROUND only (subject stays sharp) applied to a time
window of a full video. Frames outside the window pass through untouched.

Sibling of bokeh_subject_window.py — same MediaPipe matting substrate,
different effect on the inverse-mask region.

Per-frame pipeline (inside window only):
  1. Read frame
  2. MediaPipe Selfie Segmentation → soft alpha mask (0..1)
  3. Apply CRT effect (scanlines + phosphor tint + glow) to a copy of frame
  4. Composite: frame * mask + crt_frame * (1 - mask)
     → subject stays sharp, background gets the CRT treatment
  5. Write to output

Outside the window: passthrough. Audio is muxed back from source.

CRT effect components:
  - Horizontal scanlines: every other row darkened (default 50%)
  - Phosphor tint: slight green cast for that "monitoring terminal" feel
  - Glow: gaussian blur add-back for the phosphor-bleed look

Usage:
  python tools/crt_background_window.py --input <video.mp4> --output <out.mp4> \\
                                        --window-start 5 --window-duration 3 \\
                                        [--scanline-intensity 0.5] [--feather 8]
"""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

FFMPEG = os.environ.get('FFMPEG', r'C:\ffmpeg\ffmpeg.exe')


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--window-start', type=float, required=True)
    p.add_argument('--window-duration', type=float, required=True)
    p.add_argument('--scanline-intensity', type=float, default=0.5,
                   help='How much to darken every other row (0 = none, 1 = black)')
    p.add_argument('--phosphor-tint', nargs=3, type=float, default=[0.78, 1.0, 0.78],
                   help='BGR multipliers for the phosphor cast (default = mild green)')
    p.add_argument('--glow-sigma', type=float, default=2.0,
                   help='Gaussian glow added back over the scanlines (default 2)')
    p.add_argument('--feather', type=int, default=8,
                   help='Mask edge feathering in px (default 8)')
    return p.parse_args()


def apply_crt(frame, scanline_intensity, phosphor_tint, glow_sigma):
    """Apply CRT scanlines + phosphor tint + glow to a BGR frame."""
    out = frame.astype(np.float32)
    # Phosphor tint (BGR order)
    out[:, :, 0] *= phosphor_tint[0]
    out[:, :, 1] *= phosphor_tint[1]
    out[:, :, 2] *= phosphor_tint[2]
    # Horizontal scanlines — darken every even row
    out[::2, :, :] *= (1.0 - scanline_intensity)
    out = np.clip(out, 0, 255).astype(np.uint8)
    # Glow / phosphor bleed
    if glow_sigma > 0:
        ksize = max(3, int(glow_sigma * 4) | 1)
        glow = cv2.GaussianBlur(out, (ksize, ksize), glow_sigma)
        out = cv2.addWeighted(out, 0.85, glow, 0.25, 0)
    return out


def main():
    args = parse_args()

    in_path = Path(args.input)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(in_path))
    if not cap.isOpened():
        print(f'ERROR: could not open {in_path}')
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    src_dur = total_frames / fps if fps else 0
    print(f'  Source: {src_w}x{src_h} @ {fps:.2f}fps · {total_frames} frames · {src_dur:.1f}s')

    win_start_frame = int(args.window_start * fps)
    win_end_frame = win_start_frame + int(args.window_duration * fps)
    print(f'  Effect window: frames {win_start_frame}..{win_end_frame} ({args.window_start}s–{args.window_start + args.window_duration}s)')
    print(f'  CRT settings: scanline={args.scanline_intensity} · phosphor=BGR{tuple(args.phosphor_tint)} · glow_sigma={args.glow_sigma}')

    tmp_video = out_path.with_suffix('.tmp.mp4')
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(str(tmp_video), fourcc, fps, (src_w, src_h))
    if not writer.isOpened():
        print(f'ERROR: could not open writer for {tmp_video}')
        sys.exit(1)

    mp_selfie = mp.solutions.selfie_segmentation
    segmenter = mp_selfie.SelfieSegmentation(model_selection=1)

    t0 = time.time()
    effect_frames = 0
    passthrough_frames = 0
    for i in range(total_frames):
        ret, frame = cap.read()
        if not ret:
            break

        if win_start_frame <= i < win_end_frame:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = segmenter.process(rgb)
            mask = result.segmentation_mask
            if args.feather > 0:
                mask = cv2.GaussianBlur(mask, (args.feather * 2 + 1, args.feather * 2 + 1), args.feather)
            mask3 = np.dstack([mask, mask, mask])

            crt_bg = apply_crt(frame, args.scanline_intensity, args.phosphor_tint, args.glow_sigma)

            # Subject (sharp) over CRT-bg via mask:
            #   subject_mask=1 → keep original
            #   subject_mask=0 → CRT
            composite = (frame.astype(np.float32) * mask3 +
                         crt_bg.astype(np.float32) * (1.0 - mask3))
            composite = np.clip(composite, 0, 255).astype(np.uint8)
            writer.write(composite)
            effect_frames += 1
        else:
            writer.write(frame)
            passthrough_frames += 1

        if (i + 1) % 60 == 0 or i == total_frames - 1:
            elapsed = time.time() - t0
            fps_now = (i + 1) / max(elapsed, 0.01)
            eta = (total_frames - i - 1) / max(fps_now, 0.01)
            print(f'  Frame {i+1}/{total_frames} · {fps_now:.1f} fps · ETA {eta:.0f}s')

    cap.release()
    writer.release()
    segmenter.close()

    proc_elapsed = time.time() - t0
    print(f'  Pipeline done in {proc_elapsed:.1f}s · {effect_frames} effect frames · {passthrough_frames} passthrough frames')

    print('  Muxing audio from source...')
    audio_cmd = [
        FFMPEG, '-y',
        '-i', str(tmp_video),
        '-i', str(in_path),
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k',
        '-map', '0:v:0', '-map', '1:a:0?',
        '-shortest',
        str(out_path),
    ]
    subprocess.run(audio_cmd, check=True, capture_output=True)
    tmp_video.unlink(missing_ok=True)

    print(f'  Done -> {out_path}')


if __name__ == '__main__':
    main()
