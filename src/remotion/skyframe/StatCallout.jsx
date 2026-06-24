// ─── StatCallout ─────────────────────────────────────────────────────────
// Huge gold number that counts up from 0 to target with an overshoot landing,
// teal label underneath. Anchored to a number-word in the script (or any
// numeric receipt moment). Pair with chime2 on landing — wire that through
// the SkyframeAudioCues chime slot or a dedicated cue.
//
// Window minimum: 1.5s — count-up 0.8s + linger 0.5s + fade 0.2s.

import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { EASE_OUT, EASE_BACK, SKYFRAME_PALETTE, inWindow, buildExtrusionShadow } from './_helpers.jsx';

export const StatCallout = ({
  frame,
  fps,
  startSec,
  endSec,
  value = 100,
  label = 'STAT',
  prefix = '',
  suffix = '',
  x = 50,            // % of width — center anchor
  y = 50,            // % of height — center anchor
  countDurSec = 0.8,
  fontSize = 320,
  labelSize = 36,
  color = SKYFRAME_PALETTE.hero,
  glow = SKYFRAME_PALETTE.heroGlow,
  labelColor = SKYFRAME_PALETTE.accent,
  labelGlow = SKYFRAME_PALETTE.accentGlow,
}) => {
  if (!inWindow(frame, startSec, endSec, fps)) return null;

  const startF = startSec * fps;
  const endF = endSec * fps;
  const local = frame - startF;
  const total = endF - startF;

  // Count-up math — integer interpolation 0 → value over countDurSec
  const countFrames = Math.round(countDurSec * fps);
  const countProg = interpolate(local, [4, 4 + countFrames], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const displayValue = Math.round(value * countProg);

  // Landing overshoot — number bumps to 1.08 then settles to 1.0 over 14 frames
  const landFrame = 4 + countFrames;
  const lcl = local - landFrame;
  const landScale = interpolate(lcl, [0, 8, 18], [1, 1.08, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_BACK,
  });

  // Container fade in/out
  const containerOpacity = interpolate(
    local, [0, 6, total - 10, total], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const numberY = interpolate(local, [0, 8], [18, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  // Label reveals 0.25s after the number lands
  const labelStartFrame = landFrame + 8;
  const labelOp = interpolate(local, [labelStartFrame, labelStartFrame + 10], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const labelTy = interpolate(local, [labelStartFrame, labelStartFrame + 10], [10, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -50%)',
        textAlign: 'center',
        opacity: containerOpacity,
      }}>
        {/* The big gold number with Anton 3D extrusion */}
        <div style={{
          fontFamily: 'Anton, Impact, sans-serif',
          fontWeight: 400,
          fontSize,
          color,
          lineHeight: 0.9,
          letterSpacing: '-0.02em',
          textShadow: buildExtrusionShadow(),
          transform: `translateY(${numberY}px) scale(${landScale})`,
          transformOrigin: 'center bottom',
          filter: `drop-shadow(0 0 24px ${glow})`,
        }}>
          {prefix}{displayValue.toLocaleString()}{suffix}
        </div>
        {/* Small teal label */}
        <div style={{
          marginTop: 14,
          fontFamily: 'Inter, Arial, sans-serif',
          fontWeight: 800,
          fontSize: labelSize,
          color: labelColor,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          opacity: labelOp,
          transform: `translateY(${labelTy}px)`,
          textShadow: `0 0 14px ${labelGlow}, 0 2px 6px rgba(0,0,0,0.7)`,
        }}>
          {label}
        </div>
      </div>
    </AbsoluteFill>
  );
};
