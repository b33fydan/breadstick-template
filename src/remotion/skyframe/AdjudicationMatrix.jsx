// ─── AdjudicationMatrix ──────────────────────────────────────────────────
// The "verdict gate" snap. Two beveled evidence-grid halves fly in from
// left + right and SNAP shut at center — synced to a hand-clap on the doctrine
// line "LLM proposes. Deterministic code disposes." On impact: a seam flash, a
// spark burst, and a stamped verdict plate (default "DENIED").
//
// What it enacts: untrusted text is *structurally* denied authority. The jaws
// are the deterministic gate; the stamp is the verdict the LLM can't move.
//
// Sync: the clamp lands `snapSec` after the window opens (default 1.0s). Nudge
// `startSec` so the impact frame sits exactly on your clap. Pair with a whoosh
// cue at the impact frame via SkyframeAudioCues (impactFrame = (startSec+snapSec)*fps).
//
// Props:
//   leftLabel   — header over the left jaw  (default "LLM PROPOSES")
//   rightLabel  — header over the right jaw (default "CODE DISPOSES")
//   verdict     — word stamped at the seam  (default "DENIED")
//   caption     — small line under the rig  (default "untrusted text — no authority")
//   yOffset     — push the whole rig down to clear the face (default 70)
//   snapSec     — seconds after window-open that the jaws clamp (default 1.0)

import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { EASE_OUT, EASE_BACK, EASE_DRAWER, SKYFRAME_PALETTE, inWindow } from './_helpers.jsx';

const COLS = 3;      // evidence cells per jaw, horizontally
const ROWS = 4;      // cells, vertically
const CELL = 92;     // px per cell
const GUTTER = 6;
const JAW_W = COLS * CELL + (COLS + 1) * GUTTER;   // 300
const JAW_H = ROWS * CELL + (ROWS + 1) * GUTTER;   // 398

export const AdjudicationMatrix = ({
  frame,
  fps,
  startSec,
  endSec,
  leftLabel = 'LLM PROPOSES',
  rightLabel = 'CODE DISPOSES',
  verdict = 'DENIED',
  caption = 'untrusted text — no authority',
  yOffset = 70,
  snapSec = 1.0,
  accent = SKYFRAME_PALETTE.accent,   // teal grid
  hero = SKYFRAME_PALETTE.hero,       // gold seam / stamp
}) => {
  if (!inWindow(frame, startSec, endSec, fps)) return null;

  const startF = startSec * fps;
  const endF = endSec * fps;
  const local = frame - startF;
  const total = endF - startF;

  const snap = Math.round(snapSec * fps);   // local frame of impact

  // Jaws fly in from off-center and clamp at `snap` with a mechanical drawer ease.
  const travel = 600;
  const closeProg = interpolate(local, [4, snap], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_DRAWER,
  });
  const leftX = (1 - closeProg) * -travel;
  const rightX = (1 - closeProg) * travel;

  // Impact recoil — the whole rig jolts sideways on contact, then settles.
  const jolt = interpolate(local, [snap, snap + 4, snap + 14], [0, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const shakeX = jolt * Math.sin(local * 1.9) * 6;
  const rigScale = 1 + interpolate(local, [snap, snap + 3, snap + 12], [0, 0.03, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Seam flash on contact.
  const flashOp = interpolate(local, [snap - 1, snap + 2, snap + 14], [0, 0.85, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Verdict stamp slams in just after contact.
  const stampScale = interpolate(local, [snap + 2, snap + 9, snap + 16], [0.35, 1.12, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_BACK,
  });
  const stampOp = interpolate(local, [snap + 2, snap + 10], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const captionOp = interpolate(local, [snap + 12, snap + 22], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const containerOp = interpolate(local, [0, 8, total - 14, total], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Spark burst at the seam.
  const sparkProg = interpolate(local, [snap, snap + 16], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const sparkOp = interpolate(local, [snap, snap + 5, snap + 18], [0, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const jaw = (side) => {
    const isLeft = side === 'left';
    const cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        // cells light up as the jaws close, brightest at contact
        const lit = interpolate(local, [snap - 8 + idx * 0.4, snap], [0.12, 0.5], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        cells.push(
          <div key={`${side}-${r}-${c}`} style={{
            width: CELL, height: CELL,
            border: `1.5px solid rgba(0, 217, 200, ${lit})`,
            background: `rgba(0, 217, 200, ${lit * 0.14})`,
            boxShadow: `inset 0 0 12px rgba(0, 217, 200, ${lit * 0.3})`,
          }} />
        );
      }
    }
    return (
      <div style={{
        position: 'relative',
        width: JAW_W, height: JAW_H,
        transform: `translateX(${isLeft ? leftX : rightX}px)`,
        background: 'linear-gradient(135deg, #2a2f38 0%, #14171c 60%, #0c0e12 100%)',
        borderTop: '3px solid rgba(255,255,255,0.18)',
        borderLeft: isLeft ? '3px solid rgba(255,255,255,0.14)' : 'none',
        borderRight: !isLeft ? '3px solid rgba(255,255,255,0.14)' : 'none',
        borderBottom: '3px solid rgba(0,0,0,0.6)',
        boxShadow: `${isLeft ? '6px' : '-6px'} 0 24px rgba(0,0,0,0.5)`,
        display: 'grid',
        gridTemplateColumns: `repeat(${COLS}, ${CELL}px)`,
        gridTemplateRows: `repeat(${ROWS}, ${CELL}px)`,
        gap: GUTTER,
        padding: GUTTER,
        borderRadius: isLeft ? '14px 0 0 14px' : '0 14px 14px 0',
      }}>
        {cells}
        <div style={{
          position: 'absolute',
          top: -42,
          [isLeft ? 'left' : 'right']: 4,
          fontFamily: 'Inter, Arial, sans-serif', fontWeight: 800, fontSize: 22,
          letterSpacing: '0.16em', color: accent,
          textShadow: '0 0 12px rgba(0,217,200,0.45), 0 2px 6px rgba(0,0,0,0.7)',
          whiteSpace: 'nowrap',
        }}>
          {isLeft ? leftLabel : rightLabel}
        </div>
      </div>
    );
  };

  const CENTER_Y = 960 + yOffset;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        left: 540, top: CENTER_Y,
        transform: `translate(-50%, -50%) translateX(${shakeX}px) scale(${rigScale})`,
        opacity: containerOp,
        display: 'flex', alignItems: 'stretch',
      }}>
        {jaw('left')}
        {jaw('right')}

        {/* Seam flash */}
        <div style={{
          position: 'absolute', left: '50%', top: '50%',
          width: 60, height: JAW_H + 80,
          transform: 'translate(-50%, -50%)',
          background: `linear-gradient(90deg, transparent, ${hero}, transparent)`,
          opacity: flashOp,
          filter: 'blur(6px)',
        }} />

        {/* Spark burst */}
        <svg width={420} height={420} style={{
          position: 'absolute', left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)', opacity: sparkOp, overflow: 'visible',
        }}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const ang = (i / 8) * Math.PI * 2;
            const r0 = 20, r1 = 150;
            const r = r0 + (r1 - r0) * sparkProg;
            return (
              <line key={i}
                x1={210 + Math.cos(ang) * r0} y1={210 + Math.sin(ang) * r0}
                x2={210 + Math.cos(ang) * r} y2={210 + Math.sin(ang) * r}
                stroke={hero} strokeWidth={3} strokeLinecap="round"
                opacity={1 - sparkProg} />
            );
          })}
        </svg>

        {/* Verdict stamp */}
        <div style={{
          position: 'absolute', left: '50%', top: '50%',
          transform: `translate(-50%, -50%) rotate(-7deg) scale(${stampScale})`,
          opacity: stampOp,
          padding: '14px 40px',
          background: 'rgba(12, 8, 6, 0.86)',
          border: `4px solid ${hero}`,
          borderRadius: 10,
          boxShadow: '0 0 40px rgba(255,210,74,0.5), 0 12px 30px rgba(0,0,0,0.6)',
          textAlign: 'center',
        }}>
          <div style={{
            fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400, fontSize: 92,
            color: hero, letterSpacing: '0.04em', lineHeight: 0.95,
            textShadow: '0 0 18px rgba(255,210,74,0.55), 0 4px 10px rgba(0,0,0,0.7)',
          }}>
            {verdict}
          </div>
        </div>

        {/* Caption under the rig */}
        {caption && (
          <div style={{
            position: 'absolute', left: '50%', top: '100%', marginTop: 26,
            transform: 'translateX(-50%)',
            opacity: captionOp,
            fontFamily: 'Inter, Arial, sans-serif', fontWeight: 600, fontSize: 30,
            color: 'rgba(255,255,255,0.82)', letterSpacing: '0.04em', whiteSpace: 'nowrap',
            textShadow: '0 2px 8px rgba(0,0,0,0.7)',
          }}>
            {caption}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
