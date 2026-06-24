"""
Bokeh / blurred-background demo using MediaPipe Selfie Segmentation + OpenCV.

Per-frame pipeline:
  1. Read frame
  2. Run MediaPipe segmentation → soft alpha mask (0..1, human-aware)
  3. Gaussian-blur a copy of the same frame
  4. Composite: subject (sharp) over blurred (background) via alpha matte
  5. Write to output

Audio is muxed back from the source via ffmpeg in a final step so the result
has both video + original sound.

Usage:
  python tools/bokeh_demo.py --input <video.mov> --output <out.mp4> \
                             [--start-sec 0] [--duration-sec 15] \
                             [--blur-sigma 18] [--max-dim 1280]

--start-sec / --duration-sec let us preview on a clip without processing the
whole thing. --max-dim downscales for speed (MediaPipe at 1280p is ~4x faster
than 4K on CPU); output is rescaled back up if --no-restore not passed.
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
    p.add_argument('--start-sec', type=float, default=0.0)
    p.add_argument('--duration-sec', type=float, default=15.0,
                   help='Clip duration to process (default 15s for fast preview)')
    p.add_argument('--blur-sigma', type=float, default=18.0,
                   help='Gaussian blur strength for background (default 18)')
    p.add_argument('--max-dim', type=int, default=1280,
                   help='Max width/height for processing (downscale for speed). 0 = native res')
    p.add_argument('--feather', type=int, default=5,
                   help='Edge feathering (px) on the mask — softens the segmentation edge')
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

    # Decide working resolution
    if args.max_dim > 0 and max(src_w, src_h) > args.max_dim:
        scale = args.max_dim / max(src_w, src_h)
        work_w = int(round(src_w * scale / 2) * 2)
        work_h = int(round(src_h * scale / 2) * 2)
        print(f'  Working at {work_w}x{work_h} for speed (downscaled from {src_w}x{src_h})')
    else:
        work_w, work_h = src_w, src_h
        print(f'  Working at native {work_w}x{work_h}')

    # Seek to start
    start_frame = int(args.start_sec * fps)
    end_frame = min(total_frames, int((args.start_sec + args.duration_sec) * fps))
    n_frames = end_frame - start_frame
    if n_frames <= 0:
        print('ERROR: empty frame range')
        sys.exit(1)
    print(f'  Processing frames {start_frame}..{end_frame} ({n_frames} frames, {n_frames/fps:.1f}s)')

    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    # Output to an intermediate file (no audio yet) — mux audio at the end
    tmp_video = out_path.with_suffix('.tmp.mp4')
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(str(tmp_video), fourcc, fps, (work_w, work_h))
    if not writer.isOpened():
        print(f'ERROR: could not open writer for {tmp_video}')
        sys.exit(1)

    # MediaPipe Selfie Segmentation — model_selection=1 is the general model
    # (works for full-body shots and selfies). =0 is faster but tighter crop.
    mp_selfie = mp.solutions.selfie_segmentation
    segmenter = mp_selfie.SelfieSegmentation(model_selection=1)

    # Kernel size for gaussian: derived from sigma so the blur is honest.
    # OpenCV requires odd kernel; round up.
    ksize = max(3, int(args.blur_sigma * 4) | 1)

    t0 = time.time()
    processed = 0
    for i in range(n_frames):
        ret, frame = cap.read()
        if not ret:
            break
        if (work_w, work_h) != (src_w, src_h):
            frame = cv2.resize(frame, (work_w, work_h), interpolation=cv2.INTER_AREA)

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = segmenter.process(rgb)
        mask = result.segmentation_mask  # 0..1 float32, shape (H, W)

        # Optional feathering — softens the edge so the blur transition isn't
        # a hard cookie-cutter line.
        if args.feather > 0:
            mask = cv2.GaussianBlur(mask, (args.feather * 2 + 1, args.feather * 2 + 1), args.feather)

        # Reshape to (H, W, 3) for broadcasting
        mask3 = np.dstack([mask, mask, mask])

        blurred = cv2.GaussianBlur(frame, (ksize, ksize), args.blur_sigma)
        composite = (frame.astype(np.float32) * mask3 +
                     blurred.astype(np.float32) * (1.0 - mask3))
        composite = np.clip(composite, 0, 255).astype(np.uint8)

        writer.write(composite)
        processed += 1

        # Progress every ~30 frames (1 sec at 30fps)
        if (i + 1) % 30 == 0 or i == n_frames - 1:
            elapsed = time.time() - t0
            fps_now = (i + 1) / max(elapsed, 0.01)
            eta = (n_frames - i - 1) / max(fps_now, 0.01)
            print(f'  Frame {i+1}/{n_frames} · {fps_now:.1f} fps · ETA {eta:.0f}s')

    cap.release()
    writer.release()
    segmenter.close()

    proc_elapsed = time.time() - t0
    print(f'  Segmentation done in {proc_elapsed:.1f}s ({processed} frames, {processed/proc_elapsed:.1f} fps)')

    # Mux audio from source clip into the rendered video
    # ffmpeg: -ss to trim audio to the same window as the video clip
    print('  Muxing audio from source...')
    audio_cmd = [
        FFMPEG, '-y',
        '-i', str(tmp_video),
        '-ss', str(args.start_sec),
        '-t', str(args.duration_sec),
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
