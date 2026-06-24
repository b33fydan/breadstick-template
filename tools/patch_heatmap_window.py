"""
PATCH-HEATMAP overlay window: DINOv3-style green heatmap grid driven by
hand landmark proximity. Dark green tint everywhere, bright green on the
hand/arm area. 16-bit blocky aesthetic from grid quantization.

Sibling of hand_label_window.py / ascii_subject_window.py — same per-frame
pipeline shape, different visual output.

Per-frame pipeline (inside window only):
  1. Read frame
  2. MediaPipe Hands → up to 2 hands, 21 landmarks each
  3. Build NxM grid of cells, each colored by Gaussian proximity to the
     nearest hand landmark
  4. Alpha-blend the grid overlay onto the frame
  5. Write frame

Outside the window: passthrough. Audio muxed from source.

Usage:
  python tools/patch_heatmap_window.py --input <video.mp4> --output <out.mp4> \
                                       --window-start 22 --window-duration 3 \
                                       [--grid-cols 28] [--grid-rows 16] \
                                       [--sigma 0.12] [--alpha 0.62]
"""

import argparse
import math
import os
import subprocess
import sys
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import cv2
import mediapipe as mp
import numpy as np

FFMPEG = os.environ.get('FFMPEG', r'C:\ffmpeg\ffmpeg.exe')

COLD_COLOR = np.array([0, 20, 0], dtype=np.float32)       # dark green
HOT_COLOR = np.array([0, 255, 102], dtype=np.float32)      # bright green #00ff66
BORDER_DIM = 0.3


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--window-start', type=float, required=True)
    p.add_argument('--window-duration', type=float, default=3.0)
    p.add_argument('--grid-cols', type=int, default=28)
    p.add_argument('--grid-rows', type=int, default=16)
    p.add_argument('--sigma', type=float, default=0.12,
                   help='Gaussian falloff width (normalized coords). Smaller = tighter glow.')
    p.add_argument('--alpha', type=float, default=0.62,
                   help='Base overlay alpha (0-1). Hot cells get alpha + 0.15.')
    p.add_argument('--max-hands', type=int, default=2)
    p.add_argument('--min-detection-confidence', type=float, default=0.5)
    p.add_argument('--min-tracking-confidence', type=float, default=0.5)
    return p.parse_args()


def build_cell_centers(cols, rows):
    """Pre-compute normalized (x, y) center of each grid cell."""
    centers = np.zeros((rows, cols, 2), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            centers[r, c, 0] = (c + 0.5) / cols
            centers[r, c, 1] = (r + 0.5) / rows
    return centers


def compute_heat_grid(cell_centers, landmarks_norm, sigma, aspect):
    """Compute heat value (0-1) for each grid cell based on proximity to landmarks.

    cell_centers: (rows, cols, 2) normalized positions
    landmarks_norm: list of (x, y) normalized landmark positions
    sigma: Gaussian width
    aspect: frame width / height for distance correction
    """
    rows, cols = cell_centers.shape[:2]
    heat = np.zeros((rows, cols), dtype=np.float32)

    if not landmarks_norm:
        return heat

    sigma2_2 = 2.0 * sigma * sigma
    pts = np.array(landmarks_norm, dtype=np.float32)  # (N, 2)

    for i in range(len(pts)):
        dx = (cell_centers[:, :, 0] - pts[i, 0]) * aspect
        dy = cell_centers[:, :, 1] - pts[i, 1]
        d2 = dx * dx + dy * dy
        h = np.exp(-d2 / sigma2_2)
        np.maximum(heat, h, out=heat)

    return heat


def render_heatmap_overlay(heat, cols, rows, frame_w, frame_h, base_alpha):
    """Render the heatmap grid as an RGBA numpy array (frame_h, frame_w, 4)."""
    overlay = np.zeros((frame_h, frame_w, 4), dtype=np.uint8)

    cell_w = frame_w / cols
    cell_h = frame_h / rows

    for r in range(rows):
        y0 = int(r * cell_h)
        y1 = int((r + 1) * cell_h)
        for c in range(cols):
            x0 = int(c * cell_w)
            x1 = int((c + 1) * cell_w)

            h = heat[r, c]
            color = COLD_COLOR * (1.0 - h) + HOT_COLOR * h
            alpha = int((base_alpha + h * 0.15) * 255)
            alpha = min(255, alpha)

            overlay[y0:y1, x0:x1, 0] = int(color[0])
            overlay[y0:y1, x0:x1, 1] = int(color[1])
            overlay[y0:y1, x0:x1, 2] = int(color[2])
            overlay[y0:y1, x0:x1, 3] = alpha

            # Thin cell borders — darken edge pixels
            bw = max(1, int(min(cell_w, cell_h) * 0.06))
            border_alpha = int(alpha * BORDER_DIM)
            # top
            overlay[y0:y0+bw, x0:x1, 3] = border_alpha
            # bottom
            overlay[y1-bw:y1, x0:x1, 3] = border_alpha
            # left
            overlay[y0:y1, x0:x0+bw, 3] = border_alpha
            # right
            overlay[y0:y1, x1-bw:x1, 3] = border_alpha

    return overlay


def composite_rgba_onto_bgr(frame_bgr, overlay_rgba):
    """Alpha-blend RGBA overlay onto BGR frame in-place."""
    rgb = overlay_rgba[:, :, :3].astype(np.float32)
    alpha = overlay_rgba[:, :, 3:4].astype(np.float32) / 255.0
    frame_f = frame_bgr.astype(np.float32)
    # overlay is RGB, frame is BGR — swap channels
    rgb_bgr = rgb[:, :, ::-1]
    blended = rgb_bgr * alpha + frame_f * (1.0 - alpha)
    np.clip(blended, 0, 255, out=blended)
    frame_bgr[:] = blended.astype(np.uint8)


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
    aspect = src_w / src_h
    print(f'  Source: {src_w}x{src_h} @ {fps:.2f}fps, {total_frames} frames')

    win_start_frame = int(args.window_start * fps)
    win_end_frame = win_start_frame + int(args.window_duration * fps)
    print(f'  Effect window: frames {win_start_frame}..{win_end_frame} '
          f'({args.window_start}s-{args.window_start + args.window_duration}s)')
    print(f'  Grid: {args.grid_cols}x{args.grid_rows}, sigma={args.sigma}, alpha={args.alpha}')

    cell_centers = build_cell_centers(args.grid_cols, args.grid_rows)

    tmp_video = out_path.with_suffix('.tmp.mp4')
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(str(tmp_video), fourcc, fps, (src_w, src_h))

    mp_hands = mp.solutions.hands
    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=args.max_hands,
        min_detection_confidence=args.min_detection_confidence,
        min_tracking_confidence=args.min_tracking_confidence,
    )

    t0 = time.time()
    effect_frames = 0
    detected_frames = 0

    for i in range(total_frames):
        ret, frame = cap.read()
        if not ret:
            break

        if win_start_frame <= i < win_end_frame:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = hands.process(rgb)

            landmarks_norm = []
            if result.multi_hand_landmarks:
                for hand_lm in result.multi_hand_landmarks:
                    for pt in hand_lm.landmark:
                        landmarks_norm.append((pt.x, pt.y))
                detected_frames += 1

            heat = compute_heat_grid(cell_centers, landmarks_norm, args.sigma, aspect)
            overlay = render_heatmap_overlay(
                heat, args.grid_cols, args.grid_rows,
                src_w, src_h, args.alpha,
            )
            composite_rgba_onto_bgr(frame, overlay)
            effect_frames += 1

        writer.write(frame)

        if (i + 1) % 30 == 0 or i == total_frames - 1:
            elapsed = time.time() - t0
            fps_now = (i + 1) / max(elapsed, 0.01)
            eta = (total_frames - i - 1) / max(fps_now, 0.01)
            print(f'  Frame {i+1}/{total_frames} | {fps_now:.1f} fps | ETA {eta:.0f}s')

    cap.release()
    writer.release()
    hands.close()

    proc_elapsed = time.time() - t0
    print(f'  Pipeline done in {proc_elapsed:.1f}s | '
          f'{effect_frames} effect frames ({detected_frames} with hands) | '
          f'{total_frames - effect_frames} passthrough')

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
