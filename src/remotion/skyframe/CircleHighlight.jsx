// ─── CircleHighlight ─────────────────────────────────────────────────────
// Hand-drawn yellow marker circle that wraps itself around a region in ~0.8s
// with a slight tremor for the "real marker" feel. Best for emphasizing a
// word or phrase that's already on screen (e.g. burned-in caption) without
// covering it with a card.
//
// Position: x/y/w/h in PERCENT of the 1080×1920 frame so operator can place
// it over any region. The marker draws an ellipse fitted to that rectangle.
//
// Window minimum: 1.2s — entry 0.8s + linger 0.4s before fade.

import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { EASE_OUT, SKYFRAME_PALETTE, inWindow } from './_helpers.jsx';

export const CircleHighlight = ({
  frame,
  fps,
  startSec,
  endSec,
  x = 30,            // % of width
  y = 45,            // % of height
  w = 40,            // % of width
  h = 10,            // % of height
  color = SKYFRAME_PALETTE.hero,
  glow = SKYFRAME_PALETTE.heroGlow,
  strokeWidth = 8,
  tremor = true,
}) => {
  if (!inWindow(frame, startSec, endSec, fps)) return null;

  const startF = startSec * fps;
  const endF = endSec * fps;
  const local = frame - startF;
  const total = endF - startF;

  // Frame canvas: assume 1080×1920 portrait — convert % to px
  const canvasW = 1080;
  const canvasH = 1920;
  const rectX = (x / 100) * canvasW;
  const rectY = (y / 100) * canvasH;
  const rectW = (w / 100) * canvasW;
  const rectH = (h / 100) * canvasH;
  const cx = rectX + rectW / 2;
  const cy = rectY + rectH / 2;
  // Pad the ellipse slightly larger than the rect so the circle wraps AROUND
  // the content rather than slicing through its edges.
  const rx = rectW / 2 + 24;
  const ry = rectH / 2 + 20;

  // Path length for stroke-dasharray draw — approximation of ellipse circumference
  const pathLength = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));

  // Draw animation: 0 → 1 over ~22 frames (0.73s @ 30fps)
  const drawProg = interpolate(local, [4, 26], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  // Container fade in 4f, out over last 10 frames
  const containerOpacity = interpolate(
    local, [0, 4, total - 10, total], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Slight tremor — sin wave at 2 different frequencies for "hand-drawn" feel.
  // Subtle: ±1.5px translate.
  const tremorX = tremor ? Math.sin(local * 0.7) * 1.2 + Math.sin(local * 1.9) * 0.6 : 0;
  const tremorY = tremor ? Math.cos(local * 0.9) * 1.2 + Math.cos(local * 1.7) * 0.5 : 0;
  // Slight rotation tilt — like the operator wasn't perfectly axis-aligned.
  const rotateBase = -2;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: containerOpacity }}>
      <svg
        width={canvasW}
        height={canvasH}
        viewBox={`0 0 ${canvasW} ${canvasH}`}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <g transform={`translate(${tremorX} ${tremorY}) rotate(${rotateBase} ${cx} ${cy})`}>
          {/* Soft glow underlay */}
          <ellipse
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth + 6}
            strokeLinecap="round"
            strokeDasharray={pathLength}
            strokeDashoffset={pathLength * (1 - drawProg)}
            opacity={0.35}
            style={{ filter: `drop-shadow(0 0 12px ${glow})` }}
          />
          {/* Primary marker stroke */}
          <ellipse
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={pathLength}
            strokeDashoffset={pathLength * (1 - drawProg)}
            style={{ filter: `drop-shadow(0 2px 4px rgba(0,0,0,0.65))` }}
          />
        </g>
      </svg>
    </AbsoluteFill>
  );
};
