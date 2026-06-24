import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame, interpolate, Easing} from 'remotion';

// ── Storyboard Spine ─────────────────────────────────────────────────────
// Camera choreography over a single NB-Pro storyboard sheet (2×5 panels).
// Read pattern: establish (full sheet) → P1..P10 row-major → pull back.
// Motion grammar (motion-craft): drawer-eased snap transits, motion-blur
// ramps tied to camera travel, Ken Burns micro-drift on holds, two-layer
// drop-shadow under the sheet, no yoyo at the timeline boundary.
// `livePanels` lets a sliced panel "come alive": an OffthreadVideo is
// composited at the panel's exact sheet coordinates (stage 3 of the
// storyboard-grid pipeline — see docs/superpowers/specs/2026-06-04).

const SHEET_W = 3072;
const SHEET_H = 5504;
const COLS = 2;
const ROWS = 5;
const PANEL_W = SHEET_W / COLS; // 1536
const PANEL_H = SHEET_H / ROWS; // 1100.8

const VIEW_W = 1080;
const VIEW_H = 1920;

// Timing (30 fps): 66 + 10×(22+52) + 22 + 72 = 900 frames = 30.0s
const ESTABLISH_HOLD = 66;
const PANEL_HOLD = 52;
const TRANSIT = 22;
const PULLBACK_HOLD = 72;

const ESTABLISH_SCALE = 0.318; // full sheet + breathing room for the shadow
const PANEL_SCALE = VIEW_W / PANEL_W; // 0.703 — panel width-fit, neighbors peek
const HOLD_DRIFT_ZOOM = 1.034; // Ken Burns push-in during each panel hold

const EASE_DRAWER = Easing.bezier(0.32, 0.72, 0, 1); // iOS-drawer snap
const EASE_DRIFT = Easing.inOut(Easing.quad); // continuous decorative motion

// Camera poses: 0 = establish, 1..10 = panels (row-major), 11 = pull-back.
const POSES = [
  {cx: SHEET_W / 2, cy: SHEET_H / 2, s: ESTABLISH_SCALE},
  ...Array.from({length: 10}, (_, i) => ({
    cx: ((i % COLS) + 0.5) * PANEL_W,
    cy: (Math.floor(i / COLS) + 0.5) * PANEL_H,
    s: PANEL_SCALE,
  })),
  {cx: SHEET_W / 2, cy: SHEET_H / 2, s: ESTABLISH_SCALE},
];

// Flat segment timeline: hold(0), then transit→hold per pose, ending on hold(11).
const SEGMENTS = (() => {
  const segs = [];
  let t = 0;
  const hold = (pose, dur) => {
    segs.push({type: 'hold', pose, start: t, dur});
    t += dur;
  };
  const transit = (from, to) => {
    segs.push({type: 'transit', from, to, start: t, dur: TRANSIT});
    t += TRANSIT;
  };
  hold(0, ESTABLISH_HOLD);
  for (let i = 1; i <= 10; i++) {
    transit(i - 1, i);
    hold(i, PANEL_HOLD);
  }
  transit(10, 11);
  hold(11, PULLBACK_HOLD);
  return segs;
})();

export const STORYBOARD_SPINE_FRAMES = SEGMENTS.reduce((acc, s) => acc + s.dur, 0); // 900

// Where the hold drift lands — transits must start from the drifted pose so
// holds and transits chain without a position pop.
const driftedPose = (pose, poseIndex) => {
  if (poseIndex === 0 || poseIndex === POSES.length - 1) {
    // Bookends: settle-only drift, no push-in (no yoyo at the boundary).
    return {...pose, s: pose.s * 1.012};
  }
  const dir = poseIndex % 2 === 0 ? 1 : -1; // alternate drift direction
  return {cx: pose.cx, cy: pose.cy + dir * PANEL_H * 0.012, s: pose.s * HOLD_DRIFT_ZOOM};
};

const lerp = (a, b, p) => a + (b - a) * p;
// Zoom feels linear in log space — keeps big scale ratios from "accelerating".
const zoomLerp = (a, b, p) => Math.exp(lerp(Math.log(a), Math.log(b), p));

// Keep the viewport inside the sheet — no void reveals at edge-row panels.
// When the viewport is larger than the sheet (establish/pull-back), center it.
const clampAxis = (c, viewPx, s, total) => {
  const half = viewPx / s / 2;
  if (half * 2 >= total) return total / 2;
  return Math.min(Math.max(c, half), total - half);
};
const clampCam = ({cx, cy, s, blur = 0}) => ({
  cx: clampAxis(cx, VIEW_W, s, SHEET_W),
  cy: clampAxis(cy, VIEW_H, s, SHEET_H),
  s,
  blur,
});

const cameraAt = (frame) => {
  const seg =
    SEGMENTS.find((s) => frame >= s.start && frame < s.start + s.dur) ??
    SEGMENTS[SEGMENTS.length - 1];
  const pLin = Math.min(Math.max((frame - seg.start) / seg.dur, 0), 1);

  if (seg.type === 'hold') {
    const base = clampCam(POSES[seg.pose]);
    const target = clampCam(driftedPose(POSES[seg.pose], seg.pose));
    const p = interpolate(pLin, [0, 1], [0, 1], {easing: EASE_DRIFT});
    return clampCam({
      cx: lerp(base.cx, target.cx, p),
      cy: lerp(base.cy, target.cy, p),
      s: zoomLerp(base.s, target.s, p),
      blur: 0,
    });
  }

  // Transit: from the (clamped) drifted end of the previous hold to the next pose.
  const from = clampCam(driftedPose(POSES[seg.from], seg.from));
  const to = clampCam(POSES[seg.to]);
  const p = interpolate(pLin, [0, 1], [0, 1], {easing: EASE_DRAWER});
  const sNow = zoomLerp(from.s, to.s, p);
  // Motion blur ramps with on-screen camera travel, bell-shaped over the
  // transit, capped at 8px (motion-craft distance table).
  const screenDist = Math.hypot(to.cx - from.cx, to.cy - from.cy) * ((from.s + to.s) / 2);
  const peak = Math.min(2.5 + screenDist / 260, 8);
  return clampCam({
    cx: lerp(from.cx, to.cx, p),
    cy: lerp(from.cy, to.cy, p),
    s: sNow,
    blur: peak * Math.sin(Math.PI * pLin),
  });
};

const panelRect = (panel) => {
  const i = panel - 1;
  return {
    left: (i % COLS) * PANEL_W,
    top: Math.floor(i / COLS) * PANEL_H,
    width: PANEL_W,
    height: PANEL_H,
  };
};

export const StoryboardSpine = ({sheetSrc = 'storyboard/cellB.png', livePanels = []}) => {
  const frame = useCurrentFrame();
  const cam = cameraAt(frame);

  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(120% 90% at 50% 38%, #2b2117 0%, #1a1410 55%, #0e0b08 100%)',
      }}
    >
      {/* Camera space — blur on the wrapper, drop-shadow on the sheet (no filter conflict) */}
      <div
        style={{
          position: 'absolute',
          width: SHEET_W,
          height: SHEET_H,
          transformOrigin: '0 0',
          transform: `translate(${VIEW_W / 2 - cam.s * cam.cx}px, ${VIEW_H / 2 - cam.s * cam.cy}px) scale(${cam.s})`,
          filter: cam.blur > 0.05 ? `blur(${cam.blur}px)` : undefined,
        }}
      >
        <Img
          src={staticFile(sheetSrc)}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            filter:
              'drop-shadow(0 70px 140px rgba(0,0,0,0.50)) drop-shadow(0 14px 32px rgba(0,0,0,0.35))',
          }}
        />
        {livePanels.map(({panel, src, fromFrame = 0, toFrame = STORYBOARD_SPINE_FRAMES}) => {
          if (frame < fromFrame || frame >= toFrame) return null;
          const rect = panelRect(panel);
          return (
            <div key={panel} style={{position: 'absolute', overflow: 'hidden', ...rect}}>
              <OffthreadVideo
                src={src.startsWith('http') ? src : staticFile(src)}
                startFrom={0}
                muted
                style={{width: '100%', height: '100%', objectFit: 'cover'}}
              />
            </div>
          );
        })}
      </div>

      {/* Vignette — sits above the camera, grounds the diorama */}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background: 'radial-gradient(95% 75% at 50% 46%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.34) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};
