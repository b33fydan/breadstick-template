// ─── Win95Terminal ───────────────────────────────────────────────────────
// Retro Win95-chrome terminal. Single typed line, then linger.
//
// Use for EXPLICATIVE beats — type out a definition, an insight, or a
// statement of what something IS. Not for CTAs, not for persuasive copy.
//
// Props:
//   text    — primary content typed into the terminal
//   payoff  — fallback if text not provided (legacy)
//   command — fallback if neither text nor payoff (legacy)
//
// The component auto-paces typing at 2 frames/char and holds the result
// until the window's natural fade-out — no wipes, no two-phase reveals.

import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { EASE_BACK, inWindow } from './_helpers.jsx';

export const Win95Terminal = ({
  frame,
  fps,
  startSec,
  endSec,
  text,
  payoff,
  command,
  title = 'C:\\Skyframe\\frame.exe',
  typeStartFrame = 14,
  position = 'center',  // 'top' | 'center' | 'bottom' — vertical placement on the 1920px-tall canvas
}) => {
  if (!inWindow(frame, startSec, endSec, fps)) return null;

  const body = (text || payoff || command || '').toString();

  const startF = startSec * fps;
  const endF = endSec * fps;
  const local = frame - startF;
  const total = endF - startF;

  const winScale = interpolate(local, [0, 10], [0.92, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_BACK,
  });
  const winOp = interpolate(local, [0, 8, total - 12, total], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const typed = Math.max(0, Math.min(body.length,
    Math.floor((local - typeStartFrame) / 2)
  ));
  const caretOn = Math.floor(local / 6) % 2 === 0;

  const WIN_BG = '#c0c0c0';
  const WIN_BG_DARK = '#808080';
  const WIN_HIGHLIGHT = '#ffffff';
  const WIN_SHADOW = '#404040';
  const TITLE_BLUE = '#000080';
  const SCREEN_BG = '#000000';
  const TERM_GREEN = '#33ff66';
  const TERM_DIM = '#1a994a';

  const winW = 880;
  const winH = 360;
  const winLeft = (1080 - winW) / 2;
  // Vertical placement: top gets a 140px breathing zone (safe-area for IG top
  // chrome), bottom gets 360px from bottom edge (safe for TT bottom UI).
  const winTop = position === 'top' ? 140
              : position === 'bottom' ? (1920 - winH - 360)
              : 780;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        left: winLeft, top: winTop,
        width: winW, height: winH,
        opacity: winOp,
        transform: `scale(${winScale})`,
        transformOrigin: 'center',
        background: WIN_BG,
        borderTop: `3px solid ${WIN_HIGHLIGHT}`,
        borderLeft: `3px solid ${WIN_HIGHLIGHT}`,
        borderRight: `3px solid ${WIN_SHADOW}`,
        borderBottom: `3px solid ${WIN_SHADOW}`,
        boxShadow: `0 0 0 1px #000, 0 24px 60px rgba(0,0,0,0.55), 0 8px 18px rgba(0,0,0,0.35)`,
        fontFamily: '"VT323", Consolas, "Courier New", monospace',
      }}>
        {/* Title bar */}
        <div style={{
          height: 36,
          background: `linear-gradient(90deg, ${TITLE_BLUE} 0%, #1084d0 100%)`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 6px',
          borderBottom: `2px solid ${WIN_BG_DARK}`,
        }}>
          <div style={{
            width: 22, height: 22, marginRight: 8,
            background: WIN_BG,
            border: `2px solid ${WIN_HIGHLIGHT}`,
            borderRight: `2px solid ${WIN_SHADOW}`,
            borderBottom: `2px solid ${WIN_SHADOW}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 14, color: '#000',
          }}>C:\</div>
          <div style={{
            color: '#fff', fontFamily: 'Inter, "Microsoft Sans Serif", sans-serif',
            fontWeight: 700, fontSize: 18, flex: 1,
          }}>
            {title}
          </div>
          {['_', '□', '×'].map((c, i) => (
            <div key={i} style={{
              width: 28, height: 26, marginLeft: 3,
              background: WIN_BG,
              border: `2px solid ${WIN_HIGHLIGHT}`,
              borderRight: `2px solid ${WIN_SHADOW}`,
              borderBottom: `2px solid ${WIN_SHADOW}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 16, color: '#000',
              lineHeight: 1,
            }}>{c}</div>
          ))}
        </div>

        {/* Inner screen */}
        <div style={{
          margin: 6,
          background: SCREEN_BG,
          height: winH - 36 - 12 - 6,
          borderTop: `2px solid ${WIN_SHADOW}`,
          borderLeft: `2px solid ${WIN_SHADOW}`,
          borderRight: `2px solid ${WIN_HIGHLIGHT}`,
          borderBottom: `2px solid ${WIN_HIGHLIGHT}`,
          padding: '20px 24px',
          color: TERM_GREEN,
          fontSize: 34,
          lineHeight: 1.2,
          fontFamily: '"VT323", Consolas, "Courier New", monospace',
          letterSpacing: '0.02em',
          overflow: 'hidden',
          textShadow: `0 0 6px ${TERM_DIM}`,
        }}>
          <div style={{ color: '#fff', marginBottom: 10 }}>C:\&gt;</div>
          <div style={{
            color: TERM_GREEN, fontWeight: 700,
            textShadow: `0 0 14px ${TERM_GREEN}`,
          }}>
            {body.slice(0, typed)}
            <span style={{
              display: 'inline-block', width: 16, height: 28,
              background: caretOn ? TERM_GREEN : 'transparent',
              marginLeft: 2, verticalAlign: '-4px',
            }} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
