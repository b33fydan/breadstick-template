"""
ASCII-art on SUBJECT (background untouched) with L→R wave of 1s flipping
cells from 0 → 1 → 0. Applied to a time window of a full video; frames
outside the window pass through untouched.

Sibling of bokeh_subject_window.py + crt_background_window.py — same
MediaPipe matting substrate, ASCII-grid effect on the subject region.

Per-frame pipeline (inside window only):
  1. Read frame
  2. MediaPipe Selfie Segmentation → soft alpha mask (0..1)
  3. Build ASCII grid image: black background + green 0/1 chars
     - Cell size 24px, char color phosphor green #33ff66 (RGB 51,255,102)
     - Wave at time t passes from subject-bbox-left to subject-bbox-right
       over the window duration. Cells within wave width = '1', else '0'
  4. Composite: ascii_img * binary_mask + frame * (1 - binary_mask)
     → subject region replaced by ASCII grid; background unchanged
  5. Write to output

Outside the window: passthrough. Audio muxed from source.

Performance: pre-renders '0' and '1' as cell-sized bitmap tiles once at
startup, then pastes via numpy slice assignment per cell — avoids per-cell
PIL.draw.text overhead.

Usage:
  python tools/ascii_subject_window.py --input <video.mp4> --output <out.mp4> \\
                                       --window-start 38 --window-duration 3 \\
                                       [--cell-size 24] [--wave-width 150]
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
from PIL import Image, ImageDraw, ImageFont

FFMPEG = os.environ.get('FFMPEG', r'C:\ffmpeg\ffmpeg.exe')


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--window-start', type=float, required=True)
    p.add_argument('--window-duration', type=float, required=True)
    p.add_argument('--cell-size', type=int, default=24)
    p.add_argument('--wave-width', type=int, default=150,
                   help='Width of the "1" stripe sweeping L→R (px)')
    p.add_argument('--font-path', default=r'C:\Windows\Fonts\consola.ttf')
    p.add_argument('--font-size', type=int, default=18)
    p.add_argument('--char-color', nargs=3, type=int, default=[51, 255, 102],
                   help='ASCII char color as RGB (default = Skyframe phosphor green #33ff66)')
    p.add_argument('--mask-threshold', type=float, default=0.5,
                   help='Mask binarization threshold (0..1)')
    return p.parse_args()


def render_tile(ch, cell_size, font, color):
    """Render a single char centered in a cell-sized RGB tile (numpy array)."""
    img = Image.new('RGB', (cell_size, cell_size), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    bbox = draw.textbbox((0, 0), ch, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (cell_size - tw) // 2 - bbox[0]
    ty = (cell_size - th) // 2 - bbox[1]
    draw.text((tx, ty), ch, fill=tuple(color), font=font)
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def main():
    args = parse_args()

    in_path = Path(args.input)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        font = ImageFont.truetype(args.font_path, args.font_size)
    except Exception as e:
        print(f'WARN: could not load {args.font_path} — using PIL default. ({e})')
        font = ImageFont.load_default()

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
    win_duration_frames = max(1, win_end_frame - win_start_frame)
    print(f'  Effect window: frames {win_start_frame}..{win_end_frame} ({args.window_start}s–{args.window_start + args.window_duration}s)')
    print(f'  Settings: cell={args.cell_size}px · wave={args.wave_width}px · font_size={args.font_size}')

    # Pre-render tiles once
    cell = args.cell_size
    tile_0 = render_tile('0', cell, font, args.char_color)
    tile_1 = render_tile('1', cell, font, args.char_color)
    print(f'  Pre-rendered 0/1 tiles at {cell}x{cell}')

    cols = src_w // cell
    rows = src_h // cell

    tmp_video = out_path.with_suffix('.tmp.mp4')
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(str(tmp_video), fourcc, fps, (src_w, src_h))

    mp_selfie = mp.solutions.selfie_segmentation
    segmenter = mp_selfie.SelfieSegmentation(model_selection=1)

    half_wave = args.wave_width / 2

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
            binary_mask = (mask > args.mask_threshold).astype(np.float32)

            ys, xs = np.where(binary_mask > 0)
            if len(xs) == 0:
                writer.write(frame)
                effect_frames += 1
                continue
            subj_left = int(xs.min())
            subj_right = int(xs.max())
            subj_width = max(1, subj_right - subj_left)

            local_frame = i - win_start_frame
            t = local_frame / win_duration_frames
            wave_center_x = subj_left + t * subj_width

            # Build ASCII canvas via numpy tile paste
            ascii_np = np.zeros((src_h, src_w, 3), dtype=np.uint8)
            for r in range(rows):
                cy_top = r * cell
                if cy_top + cell > src_h:
                    continue
                for c in range(cols):
                    cx_left = c * cell
                    if cx_left + cell > src_w:
                        continue
                    cx_center = cx_left + cell // 2
                    # Only paste cells within (or near) the subject bbox horizontally
                    if cx_center < subj_left - cell or cx_center > subj_right + cell:
                        continue
                    dist = abs(cx_center - wave_center_x)
                    tile = tile_1 if dist < half_wave else tile_0
                    ascii_np[cy_top:cy_top + cell, cx_left:cx_left + cell] = tile

            # Composite: ASCII inside mask, original outside
            mask3 = np.dstack([binary_mask, binary_mask, binary_mask])
            composite = (ascii_np.astype(np.float32) * mask3 +
                         frame.astype(np.float32) * (1.0 - mask3))
            composite = np.clip(composite, 0, 255).astype(np.uint8)

            writer.write(composite)
            effect_frames += 1
        else:
            writer.write(frame)
            passthrough_frames += 1

        if (i + 1) % 30 == 0 or i == total_frames - 1:
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
