"""
HAND-LABEL overlay window: detects subject's hand via MediaPipe Hands,
composites a white-stroked rounded square over the palm with a floating
text label above it (the beat's key word). Square size locks on first
detection so it stays consistent across the window; position is smoothed
over N frames so it tracks the hand without jitter. Frames outside the
window pass through untouched.

Sibling of ascii_subject_window.py / bokeh_subject_window.py /
crt_background_window.py — same per-frame pipeline shape, hand tracking
instead of subject matting.

Per-frame pipeline (inside window only):
  1. Read frame
  2. MediaPipe Hands → first hand's 21 landmarks (or skip frame if none)
  3. Compute palm center (avg of WRIST + 4 MCP landmarks)
  4. Smooth position via N-frame moving average
  5. On first detection: lock hand bbox size + pre-render overlay tile
     (rounded-square outline + label text above) at the locked scale
  6. Composite overlay tile onto frame at smoothed palm center
  7. Write frame

Outside the window: passthrough. Audio muxed from source.

Performance: overlay tile rendered ONCE at first detection (PIL RGBA),
then numpy-alpha-blended per frame — no per-frame PIL.draw.

Usage:
  python tools/hand_label_window.py --input <video.mp4> --output <out.mp4> \\
                                    --window-start 30 --window-duration 4 \\
                                    --label-text "AUDIT" \\
                                    [--square-min-frac 0.07] [--square-max-frac 0.30] \\
                                    [--smoothing-frames 3]
"""

import argparse
import os
import subprocess
import sys
import time
from collections import deque
from pathlib import Path
from statistics import median

# Windows default stdout is cp1252 which can't encode `->` arrows or other
# unicode in our progress prints. Reconfigure to UTF-8 so log lines never
# raise UnicodeEncodeError mid-run.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import cv2
import mediapipe as mp
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FFMPEG = os.environ.get('FFMPEG', r'C:\ffmpeg\ffmpeg.exe')

# Hand landmark indices (MediaPipe Hands convention)
WRIST = 0
INDEX_MCP = 5
MIDDLE_MCP = 9
RING_MCP = 13
PINKY_MCP = 17
PALM_LANDMARKS = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--window-start', type=float, required=True)
    p.add_argument('--window-duration', type=float, required=True)
    p.add_argument('--label-text', required=True, help='Text to display above the square')
    p.add_argument('--font-path', default=r'C:\Windows\Fonts\segoeui.ttf')
    p.add_argument('--font-size', type=int, default=0,
                   help='Text size in px. 0 = auto (~18%% of square side)')
    p.add_argument('--square-color', nargs=3, type=int, default=[255, 255, 255],
                   help='Square stroke color as RGB (default white)')
    p.add_argument('--text-color', nargs=3, type=int, default=[255, 255, 255],
                   help='Text color as RGB (default white)')
    p.add_argument('--stroke-px', type=int, default=4,
                   help='Square stroke width (px)')
    p.add_argument('--corner-radius', type=int, default=10,
                   help='Square corner radius (px)')
    p.add_argument('--text-gap', type=int, default=14,
                   help='Vertical gap between text and square (px)')
    p.add_argument('--square-min-frac', type=float, default=0.07,
                   help='Min square side as fraction of frame width')
    p.add_argument('--square-max-frac', type=float, default=0.30,
                   help='Max square side as fraction of frame width')
    p.add_argument('--square-hand-scale', type=float, default=0.9,
                   help='Square side = scale * detected hand bbox size')
    p.add_argument('--smoothing-frames', type=int, default=3,
                   help='Moving average over last N detected positions')
    p.add_argument('--size-lock-samples', type=int, default=5,
                   help='Median hand size over first N detections, then lock')
    p.add_argument('--landmark-anchor', choices=['palm', 'wrist'], default='palm',
                   help='Anchor point — palm center (default) or wrist')
    p.add_argument('--min-detection-confidence', type=float, default=0.5)
    p.add_argument('--min-tracking-confidence', type=float, default=0.5)
    return p.parse_args()


def render_overlay_tile(label, square_side, font_size, font_path,
                        square_color, text_color, stroke_px, corner_radius, text_gap):
    """Pre-render the overlay (text + rounded square outline) as a PIL RGBA image.

    Returns the PIL image and (overlay_w, overlay_h) tuple.
    """
    try:
        font = ImageFont.truetype(font_path, font_size)
    except Exception as e:
        print(f'  WARN: could not load {font_path} — falling back to PIL default. ({e})')
        font = ImageFont.load_default()

    # Measure text on a throwaway canvas
    tmp = Image.new('RGBA', (1, 1))
    tmp_draw = ImageDraw.Draw(tmp)
    bbox = tmp_draw.textbbox((0, 0), label, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Overlay dimensions: width = max(square, padded text), height = text + gap + square
    side_padding = 24
    overlay_w = max(square_side, text_w + side_padding * 2)
    overlay_h = text_h + text_gap + square_side

    img = Image.new('RGBA', (overlay_w, overlay_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Floating text (centered horizontally, top of overlay)
    text_x = (overlay_w - text_w) // 2 - bbox[0]
    text_y = -bbox[1]
    draw.text((text_x, text_y), label, fill=tuple(text_color) + (255,), font=font)

    # Rounded square outline (centered horizontally, below text+gap)
    sq_x0 = (overlay_w - square_side) // 2
    sq_y0 = text_h + text_gap
    sq_x1 = sq_x0 + square_side
    sq_y1 = sq_y0 + square_side
    draw.rounded_rectangle(
        [sq_x0, sq_y0, sq_x1, sq_y1],
        radius=corner_radius,
        outline=tuple(square_color) + (255,),
        width=stroke_px,
    )

    return img, overlay_w, overlay_h


def composite_overlay_bgr(frame_bgr, overlay_rgba_np, center_x, center_y):
    """Alpha-blend an RGBA overlay (numpy H x W x 4) onto a BGR frame, centered at (cx, cy).

    Mutates frame_bgr in place. Handles partial-off-screen clipping.
    """
    oh, ow = overlay_rgba_np.shape[:2]
    fh, fw = frame_bgr.shape[:2]

    x0 = center_x - ow // 2
    y0 = center_y - oh // 2
    x1 = x0 + ow
    y1 = y0 + oh

    # Clip to frame bounds
    src_x0 = max(0, -x0)
    src_y0 = max(0, -y0)
    dst_x0 = max(0, x0)
    dst_y0 = max(0, y0)
    src_x1 = ow - max(0, x1 - fw)
    src_y1 = oh - max(0, y1 - fh)
    dst_x1 = min(fw, x1)
    dst_y1 = min(fh, y1)

    if src_x1 <= src_x0 or src_y1 <= src_y0:
        return  # entirely off-screen

    crop = overlay_rgba_np[src_y0:src_y1, src_x0:src_x1]
    rgb = crop[..., :3][..., ::-1]  # RGB → BGR
    alpha = crop[..., 3:4].astype(np.float32) / 255.0

    target = frame_bgr[dst_y0:dst_y1, dst_x0:dst_x1].astype(np.float32)
    blended = rgb.astype(np.float32) * alpha + target * (1.0 - alpha)
    frame_bgr[dst_y0:dst_y1, dst_x0:dst_x1] = np.clip(blended, 0, 255).astype(np.uint8)


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
    print(f'  Effect window: frames {win_start_frame}..{win_end_frame} '
          f'({args.window_start}s–{args.window_start + args.window_duration}s)')
    print(f'  Label: "{args.label_text}"')

    square_min = int(src_w * args.square_min_frac)
    square_max = int(src_w * args.square_max_frac)
    print(f'  Square scaling: {args.square_hand_scale}x hand bbox, clamped to [{square_min}, {square_max}]px')

    tmp_video = out_path.with_suffix('.tmp.mp4')
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(str(tmp_video), fourcc, fps, (src_w, src_h))

    mp_hands = mp.solutions.hands
    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=args.min_detection_confidence,
        min_tracking_confidence=args.min_tracking_confidence,
    )

    pos_buffer = deque(maxlen=max(1, args.smoothing_frames))
    size_samples = []
    overlay_np = None  # will be set after size-lock
    overlay_w = 0
    overlay_h = 0

    t0 = time.time()
    effect_frames = 0
    passthrough_frames = 0
    detected_frames = 0

    for i in range(total_frames):
        ret, frame = cap.read()
        if not ret:
            break

        if win_start_frame <= i < win_end_frame:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = hands.process(rgb)

            if result.multi_hand_landmarks:
                lm = result.multi_hand_landmarks[0]

                # Hand bbox (all 21 landmarks) for size estimate
                xs_px = [p.x * src_w for p in lm.landmark]
                ys_px = [p.y * src_h for p in lm.landmark]
                bbox_w = max(xs_px) - min(xs_px)
                bbox_h = max(ys_px) - min(ys_px)
                hand_size = max(bbox_w, bbox_h)

                # Anchor: palm center (avg of WRIST + 4 MCPs) or wrist
                if args.landmark_anchor == 'palm':
                    anchor_pts = [lm.landmark[idx] for idx in PALM_LANDMARKS]
                    cx_px = int(sum(p.x for p in anchor_pts) / len(anchor_pts) * src_w)
                    cy_px = int(sum(p.y for p in anchor_pts) / len(anchor_pts) * src_h)
                else:
                    w = lm.landmark[WRIST]
                    cx_px = int(w.x * src_w)
                    cy_px = int(w.y * src_h)

                # Lock square size once we have enough samples
                if overlay_np is None:
                    size_samples.append(hand_size)
                    if len(size_samples) >= args.size_lock_samples:
                        locked_size = median(size_samples)
                        square_side = int(max(square_min, min(square_max, args.square_hand_scale * locked_size)))
                        font_size = args.font_size or max(20, int(square_side * 0.18))
                        print(f'  Hand size locked at frame {i}: bbox~{locked_size:.0f}px → square {square_side}px, font {font_size}px')
                        overlay_pil, overlay_w, overlay_h = render_overlay_tile(
                            args.label_text, square_side, font_size, args.font_path,
                            args.square_color, args.text_color,
                            args.stroke_px, args.corner_radius, args.text_gap,
                        )
                        overlay_np = np.array(overlay_pil)

                # Smooth position
                pos_buffer.append((cx_px, cy_px))
                sx = int(sum(p[0] for p in pos_buffer) / len(pos_buffer))
                sy = int(sum(p[1] for p in pos_buffer) / len(pos_buffer))

                # Composite if overlay is ready
                if overlay_np is not None:
                    composite_overlay_bgr(frame, overlay_np, sx, sy)

                detected_frames += 1
            else:
                # Hand not detected this frame — passthrough (no overlay)
                pass

            writer.write(frame)
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
    hands.close()

    proc_elapsed = time.time() - t0
    print(f'  Pipeline done in {proc_elapsed:.1f}s · '
          f'{effect_frames} effect frames ({detected_frames} with hand detected) · '
          f'{passthrough_frames} passthrough frames')

    if overlay_np is None:
        print(f'  WARN: hand never detected with enough samples to lock size — '
              f'no overlay rendered. Try a different window or lower confidence thresholds.')

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
