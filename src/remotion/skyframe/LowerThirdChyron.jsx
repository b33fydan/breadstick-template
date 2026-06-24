// ─── LowerThirdChyron ────────────────────────────────────────────────────
// Editorial info strip that slides in at the lower-third — black bar with a
// gold accent line, teal eyebrow, white name, small subtitle. Best for
// naming a person, tool, brand, or source attribution.
//
// Holds for the middle portion of the window; slides out at the end.
// Window minimum: 2.5s (entry 0.5s + hold ≥1.5s + exit 0.5s).

import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { EASE_OUT, EASE_DRAWER, SKYFRAME_PALETTE, inWindow } from './_helpers.jsx';

export const LowerThirdChyron = ({
  frame,
  fps,
  startSec,
  endSec,
  eyebrow = 'TOOL',
  name = 'BREADSTICK',
  subtitle = '',
  y = 78,                     // % of height — lower-third zone
  accentColor = SKYFRAME_PALETTE.hero,
  accentGlow = SKYFRAME_PALETTE.heroGlow,
  eyebrowColor = SKYFRAME_PALETTE.accent,
  width = 760,
}) => {
  if (!inWindow(frame, startSec, endSec, fps)) return null;

  const startF = startSec * fps;
  const endF = endSec * fps;
  const local = frame - startF;
  const total = endF - startF;

  // Slide in from left ~16f, hold, slide out left ~14f at end
  const enterDur = 16;
  const exitStart = total - 14;

  const slideX = interpolate(
    local, [0, enterDur, exitStart, total],
    [-width - 80, 0, 0, -width - 80],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_DRAWER }
  );
  const opacity = interpolate(
    local, [0, 4, exitStart, total], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Inner content slides in slightly faster than the bar for a layered feel
  const innerX = interpolate(local, [4, enterDur + 4], [-20, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const innerOp = interpolate(local, [6, enterDur + 6], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Accent vertical line draws downward then stays
  const accentDraw = interpolate(local, [2, 14], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        left: 60,
        top: `${y}%`,
        width,
        height: 132,
        transform: `translateX(${slideX}px)`,
        opacity,
        background: 'rgba(10, 12, 20, 0.92)',
        borderRadius: 4,
        boxShadow: '0 18px 48px rgba(0,0,0,0.55), 0 4px 10px rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 30px 0 24px',
        overflow: 'hidden',
      }}>
        {/* Accent vertical line on the left */}
        <div style={{
          position: 'absolute',
          left: 12,
          top: '50%',
          width: 5,
          height: `${accentDraw * 78}%`,
          transform: 'translateY(-50%)',
          background: accentColor,
          boxShadow: `0 0 14px ${accentGlow}`,
          borderRadius: 2,
        }} />
        <div style={{
          marginLeft: 16,
          transform: `translateX(${innerX}px)`,
          opacity: innerOp,
        }}>
          <div style={{
            fontFamily: 'Inter, Arial, sans-serif',
            fontWeight: 800,
            fontSize: 20,
            letterSpacing: '0.22em',
            color: eyebrowColor,
            textTransform: 'uppercase',
            marginBottom: 4,
          }}>
            {eyebrow}
          </div>
          <div style={{
            fontFamily: 'Inter, Arial, sans-serif',
            fontWeight: 900,
            fontSize: 46,
            color: '#FFFFFF',
            lineHeight: 1.0,
            letterSpacing: '-0.01em',
            textShadow: '0 3px 8px rgba(0,0,0,0.6)',
          }}>
            {name}
          </div>
          {subtitle && (
            <div style={{
              marginTop: 6,
              fontFamily: 'Inter, Arial, sans-serif',
              fontWeight: 500,
              fontSize: 17,
              color: 'rgba(255,255,255,0.72)',
              letterSpacing: '0.04em',
            }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
