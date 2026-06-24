"""
Pose-debug-style outline rectangles whose opposite corners pin to random
PAIRS of visible joints, so each rect drastically spans a region of the
figure. Each rect is labeled with a small random digit string. Retired
rectangles leave their label behind as a brief fading afterimage.

Applied to a time window of a full video; frames outside the window pass
through untouched.

Sibling of ascii_subject_window.py / bokeh_subject_window.py /
crt_background_window.py — same window-base-mod pattern, MediaPipe Pose
substrate (vs Selfie Segmentation in the others).

Per-frame pipeline (inside window only):
  1. Read frame
  2. MediaPipe Pose -> 33 landmarks with visibility scores
  3. Tick the particle state machine:
       - retire expired rectangles -> convert to fading label afterimages
       - drop expired afterimages
       - with --spawn-rate probability, pick two distinct visible joints,
         jitter each one, and use them as opposite corners of a new
         rectangle (size emerges from their distance — subject to live +
         ghost caps)
  4. Render rectangles + labels onto a PIL RGBA overlay
  5. Alpha-blend overlay onto source frame
  6. Write to output

Outside the window: passthrough. Audio muxed from source.

Determinism: --seed makes a given (input, window, params) combo reproducible.

Usage:
  python tools/ascii_squares_window.py --input <video.mp4> --output <out.mp4> \\
                                       --window-start 38 --window-duration 4 \\
                                       [--max-squares 16] [--spawn-rate 0.35] \\
                                       [--stroke-color 255 255 255]

Family-match phosphor variant:
  --stroke-color 51 255 102 --label-color 51 255 102
"""

import argparse
import os
import random
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
    p.add_argument('--window-duration', type=float, default=4.0)

    p.add_argument('--max-squares', type=int, default=16)
    p.add_argument('--max-ghosts', type=int, default=24)
    p.add_argument('--spawn-rate', type=float, default=0.35,
                   help='Per-frame probability of attempting a new emission')

    p.add_argument('--lifetime-min', type=int, default=4)
    p.add_argument('--lifetime-max', type=int, default=12)
    p.add_argument('--ghost-lifetime-min', type=int, default=6)
    p.add_argument('--ghost-lifetime-max', type=int, default=15)

    p.add_argument('--jitter-px', type=int, default=60,
                   help='Max +/- pixel offset applied independently to each corner')
    p.add_argument('--digit-len', type=int, default=4,
                   help='Number of digits in each label, zero-padded')

    p.add_argument('--stroke-color', nargs=3, type=int, default=[255, 255, 255],
                   help='Rectangle stroke color as RGB (default white)')
    p.add_argument('--stroke-px', type=int, default=2)
    p.add_argument('--steady-alpha', type=float, default=0.85,
                   help='Alpha after the initial 2-frame emit flash')

    p.add_argument('--label-color', nargs=3, type=int, default=[255, 255, 255],
                   help='Label text color as RGB (default white)')
    p.add_argument('--label-font-size', type=int, default=14)
    p.add_argument('--font-path', default=r'C:\Windows\Fonts\consola.ttf')

    p.add_argument('--visibility-threshold', type=float, default=0.5)
    p.add_argument('--seed', type=int, default=42)

    return p.parse_args()


def main():
    args = parse_args()
    random.seed(args.seed)

    in_path = Path(args.input)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        font = ImageFont.truetype(args.font_path, args.label_font_size)
    except Exception as e:
        print(f'WARN: could not load {args.font_path} -- using PIL default. ({e})')
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
    print(f'  Effect window: frames {win_start_frame}..{win_end_frame} '
          f'({args.window_start}s-{args.window_start + args.window_duration}s)')
    print(f'  Settings: max_squares={args.max_squares} · max_ghosts={args.max_ghosts} · '
          f'spawn_rate={args.spawn_rate} · lifetime={args.lifetime_min}-{args.lifetime_max}f · '
          f'ghost={args.ghost_lifetime_min}-{args.ghost_lifetime_max}f')
    print(f'  Geometry: opposite-corner span between two random visible joints · '
          f'jitter=+/-{args.jitter_px}px per corner · digits={args.digit_len} · '
          f'seed={args.seed}')

    tmp_video = out_path.with_suffix('.tmp.mp4')
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(str(tmp_video), fourcc, fps, (src_w, src_h))
    if not writer.isOpened():
        print(f'ERROR: could not open writer for {tmp_video}')
        sys.exit(1)

    mp_pose = mp.solutions.pose
    pose = mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    stroke_rgb = tuple(args.stroke_color)
    label_rgb = tuple(args.label_color)

    live_rects = []   # list of dict {anchor_idx, x, y, w, h, digit, emit_frame, lifetime, label_x, label_y}
    ghosts = []       # list of dict {x, y, digit, death_frame, fade_until}
    warned_no_landmarks = False

    t0 = time.time()
    effect_frames = 0
    passthrough_frames = 0
    for i in range(total_frames):
        ret, frame = cap.read()
        if not ret:
            break

        if win_start_frame <= i < win_end_frame:
            local_frame = i - win_start_frame

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = pose.process(rgb)

            visible_landmarks = []
            if result.pose_landmarks:
                for idx, lm in enumerate(result.pose_landmarks.landmark):
                    if lm.visibility >= args.visibility_threshold:
                        px = int(lm.x * src_w)
                        py = int(lm.y * src_h)
                        visible_landmarks.append((idx, px, py))
            elif not warned_no_landmarks:
                print('  WARN: no pose landmarks detected in first effect frame '
                      '(figure may be out of frame; effect will be silent passthrough)')
                warned_no_landmarks = True

            # 1. Retire expired rectangles -> ghosts
            new_live = []
            for r in live_rects:
                if local_frame >= r['emit_frame'] + r['lifetime']:
                    ghost_lifetime = random.randint(args.ghost_lifetime_min, args.ghost_lifetime_max)
                    ghosts.append({
                        'x': r['label_x'], 'y': r['label_y'], 'digit': r['digit'],
                        'death_frame': local_frame,
                        'fade_until': local_frame + ghost_lifetime,
                    })
                else:
                    new_live.append(r)
            live_rects = new_live

            # 2. Drop expired ghosts
            ghosts = [g for g in ghosts if local_frame < g['fade_until']]

            # 3. Attempt emit — two-landmark opposite-corner geometry
            if (len(visible_landmarks) >= 2
                    and len(live_rects) < args.max_squares
                    and len(ghosts) < args.max_ghosts
                    and random.random() < args.spawn_rate):
                lm_a, lm_b = random.sample(visible_landmarks, 2)
                _, ax, ay = lm_a
                _, bx, by = lm_b
                # Jitter each corner independently — allows corners to land
                # off the figure entirely per spec
                ax += random.randint(-args.jitter_px, args.jitter_px)
                ay += random.randint(-args.jitter_px, args.jitter_px)
                bx += random.randint(-args.jitter_px, args.jitter_px)
                by += random.randint(-args.jitter_px, args.jitter_px)
                # Bounding rect from the two opposite corners; clamp to frame
                x = max(0, min(src_w - 2, min(ax, bx)))
                y = max(0, min(src_h - 2, min(ay, by)))
                x2 = max(x + 2, min(src_w - 1, max(ax, bx)))
                y2 = max(y + 2, min(src_h - 1, max(ay, by)))
                w = x2 - x
                h = y2 - y
                lifetime = random.randint(args.lifetime_min, args.lifetime_max)
                upper = 10 ** args.digit_len - 1
                digit = str(random.randint(0, upper)).zfill(args.digit_len)
                live_rects.append({
                    'anchor_idx': lm_a[0],
                    'x': x, 'y': y, 'w': w, 'h': h,
                    'digit': digit,
                    'emit_frame': local_frame,
                    'lifetime': lifetime,
                    'label_x': x + w + 2,
                    'label_y': y,
                })

            # 4. Render overlay via PIL
            overlay_pil = Image.new('RGBA', (src_w, src_h), (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay_pil)

            # Rectangles + their live labels
            for r in live_rects:
                age = local_frame - r['emit_frame']
                alpha = 1.0 if age < 2 else args.steady_alpha
                a255 = int(round(max(0.0, min(1.0, alpha)) * 255))
                draw.rectangle(
                    [r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']],
                    outline=stroke_rgb + (a255,),
                    width=args.stroke_px,
                )
                draw.text(
                    (r['label_x'], r['label_y']),
                    r['digit'],
                    fill=label_rgb + (a255,),
                    font=font,
                )

            # Afterimage labels
            for g in ghosts:
                span = max(1, g['fade_until'] - g['death_frame'])
                t = (local_frame - g['death_frame']) / span
                alpha = max(0.0, 1.0 - t)
                a255 = int(round(alpha * 255))
                if a255 <= 0:
                    continue
                draw.text(
                    (g['x'], g['y']),
                    g['digit'],
                    fill=label_rgb + (a255,),
                    font=font,
                )

            # 5. Composite onto source frame
            overlay_rgba = np.array(overlay_pil)  # H W 4 uint8
            overlay_bgr = cv2.cvtColor(overlay_rgba[:, :, :3], cv2.COLOR_RGB2BGR)
            alpha_f = overlay_rgba[:, :, 3].astype(np.float32) / 255.0
            alpha_3 = np.dstack([alpha_f, alpha_f, alpha_f])
            composite = (frame.astype(np.float32) * (1.0 - alpha_3) +
                         overlay_bgr.astype(np.float32) * alpha_3)
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
    pose.close()

    proc_elapsed = time.time() - t0
    print(f'  Pipeline done in {proc_elapsed:.1f}s · {effect_frames} effect frames · '
          f'{passthrough_frames} passthrough frames')

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
