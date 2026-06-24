"""
Bokeh-on-SUBJECT (inverse of bokeh_demo.py) applied to a time window of a
full video — frames outside the window pass through untouched.

Per-frame pipeline (inside window only):
  1. Read frame
  2. MediaPipe Selfie Segmentation → soft alpha mask (0..1, human-aware)
  3. Gaussian-blur a copy of the same frame
  4. Composite INVERTED: blurred * mask + frame * (1-mask)
     → subject is blurred, background stays sharp
  5. Write to output

Outside the window: write source frame as-is. Full audio is muxed back from
the source so the resulting video is the same length with the same sound.

Usage:
  python tools/bokeh_subject_window.py --input <video.mp4> --output <out.mp4> \\
                                       --window-start 20 --window-duration 3 \\
                                       [--blur-sigma 28] [--feather 8]

The blur-sigma default is bumped vs bokeh_demo.py because the subject is
usually closer to camera than the background — needs a stronger blur to
read clearly as a "subject is out of focus" moment.
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
    p.add_argument('--window-start', type=float, required=True,
                   help='Effect window start time in seconds')
    p.add_argument('--window-duration', type=float, required=True,
                   help='Effect window duration in seconds')
    p.add_argument('--blur-sigma', type=float, default=28.0,
                   help='Gaussian blur strength on the subject (default 28)')
    p.add_argument('--feather', type=int, default=8,
                   help='Mask edge feathering in px (default 8)')
    return p.parse_args()


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

    tmp_video = out_path.with_suffix('.tmp.mp4')
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(str(tmp_video), fourcc, fps, (src_w, src_h))
    if not writer.isOpened():
        print(f'ERROR: could not open writer for {tmp_video}')
        sys.exit(1)

    mp_selfie = mp.solutions.selfie_segmentation
    segmenter = mp_selfie.SelfieSegmentation(model_selection=1)

    ksize = max(3, int(args.blur_sigma * 4) | 1)

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
            mask = result.segmentation_mask  # 0..1 float32, shape (H, W)
            if args.feather > 0:
                mask = cv2.GaussianBlur(mask, (args.feather * 2 + 1, args.feather * 2 + 1), args.feather)
            mask3 = np.dstack([mask, mask, mask])
            blurred = cv2.GaussianBlur(frame, (ksize, ksize), args.blur_sigma)
            # INVERTED vs bokeh_demo.py: blur the subject, keep bg sharp.
            composite = (blurred.astype(np.float32) * mask3 +
                         frame.astype(np.float32) * (1.0 - mask3))
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
