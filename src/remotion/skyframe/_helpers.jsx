// ─── Skyframe shared helpers ─────────────────────────────────────────────
// Easings, font loader, time-window helper, 5×7 pixel-block font + renderer.
// Used by every skyframe effect. Kept dependency-free (only `remotion` core).

import React from 'react';
import { Easing, interpolate } from 'remotion';

// ─── Easings ─────────────────────────────────────────────────────────────
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_DRAWER = Easing.bezier(0.32, 0.72, 0, 1);
export const EASE_BACK = Easing.bezier(0.34, 1.56, 0.64, 1);

// ─── Skyframe palette (canonical) ────────────────────────────────────────
export const SKYFRAME_PALETTE = {
  hero: '#FFD24A',           // canonical yellow — used by intro hero, Opus tip, KaraokeCard hero word
  heroGlow: 'rgba(255, 210, 74, 0.55)',
  accent: '#00D9C8',         // teal — eyebrows, supporting underlines
  accentGlow: 'rgba(0, 217, 200, 0.55)',
  body: '#FFFFFF',           // white body text
  pixelBlock: '#FFFFFF',     // the chunky 8-bit pixel-block default (intro pixel line)
  // 3D extrusion stack for the hero phrase (Anton)
  extrusion: ['#E2A816', '#E2A816', '#9c6f0c', '#9c6f0c', '#5e4308', '#5e4308'],
};

// 6-step extrusion shadow stack for thick display text (yellow 3D look).
export const buildExtrusionShadow = (palette = SKYFRAME_PALETTE.extrusion) => [
  `1px 1px 0 ${palette[0]}`,
  `2px 2px 0 ${palette[1]}`,
  `3px 3px 0 ${palette[2]}`,
  `4px 4px 0 ${palette[3]}`,
  `5px 5px 0 ${palette[4]}`,
  `6px 6px 0 ${palette[5]}`,
  `0 10px 28px rgba(0,0,0,0.65)`,
  `0 4px 10px rgba(0,0,0,0.75)`,
].join(', ');

// ─── Time-window guard ───────────────────────────────────────────────────
// Skip rendering when the frame is outside [start, end] (with a small pad
// so entry/exit transitions don't clip).
export const inWindow = (frame, startSec, endSec, fps, padFrames = 8) =>
  frame >= startSec * fps - padFrames && frame <= endSec * fps + padFrames;

// ─── Google Fonts loader (Anton, Inter, VT323) ───────────────────────────
// Idempotent — call from each top-level composition. Resolves once
// document.fonts.ready signals; pair with delayRender / continueRender.
let fontPromise = null;
export const ensureFonts = () => {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    if (typeof document === 'undefined') return;
    if (!document.querySelector('link[data-skyframe-fonts]')) {
      const link = document.createElement('link');
      link.setAttribute('data-skyframe-fonts', 'true');
      link.rel = 'stylesheet';
      link.href =
        'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;700;900&family=VT323&display=block';
      document.head.appendChild(link);
    }
    // Force-load each face we use. document.fonts.ready alone resolves before
    // unrequested faces are fetched, causing a width shift when the first
    // <div fontFamily="Anton"> mounts mid-render. Explicitly load each face.
    await Promise.all([
      document.fonts.load('400 1em "Anton"'),
      document.fonts.load('400 1em "Inter"'),
      document.fonts.load('700 1em "Inter"'),
      document.fonts.load('900 1em "Inter"'),
      document.fonts.load('400 1em "VT323"'),
    ]);
    await document.fonts.ready;
  })();
  return fontPromise;
};

// ─── 5x7 pixel-block font ────────────────────────────────────────────────
// Each glyph is 5 columns × 7 rows of 'X' (lit) or '.' (dark).
// Used by PixelBlockText to render chunky 8-bit-style words.
export const PIXEL_FONT_5x7 = {
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  B: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X...X', 'X...X', 'XXXX.'],
  C: ['.XXXX', 'X....', 'X....', 'X....', 'X....', 'X....', '.XXXX'],
  D: ['XXXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  E: ['XXXXX', 'X....', 'X....', 'XXX..', 'X....', 'X....', 'XXXXX'],
  F: ['XXXXX', 'X....', 'X....', 'XXX..', 'X....', 'X....', 'X....'],
  G: ['.XXXX', 'X....', 'X....', 'X.XXX', 'X...X', 'X...X', '.XXX.'],
  H: ['X...X', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  I: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', 'XXXXX'],
  J: ['XXXXX', '....X', '....X', '....X', '....X', 'X...X', '.XXX.'],
  K: ['X...X', 'X..X.', 'X.X..', 'XX...', 'X.X..', 'X..X.', 'X...X'],
  L: ['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX'],
  M: ['X...X', 'XX.XX', 'X.X.X', 'X.X.X', 'X...X', 'X...X', 'X...X'],
  N: ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  P: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X....', 'X....', 'X....'],
  Q: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X.X.X', 'X..X.', '.XX.X'],
  R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
  S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'],
  U: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  V: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.X.X.', '..X..'],
  W: ['X...X', 'X...X', 'X...X', 'X.X.X', 'X.X.X', 'XX.XX', 'X...X'],
  X: ['X...X', 'X...X', '.X.X.', '..X..', '.X.X.', 'X...X', 'X...X'],
  Y: ['X...X', 'X...X', '.X.X.', '..X..', '..X..', '..X..', '..X..'],
  Z: ['XXXXX', '....X', '...X.', '..X..', '.X...', 'X....', 'XXXXX'],
  '0': ['.XXX.', 'X...X', 'X..XX', 'X.X.X', 'XX..X', 'X...X', '.XXX.'],
  '1': ['..X..', '.XX..', '..X..', '..X..', '..X..', '..X..', '.XXX.'],
  '2': ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.X...', 'XXXXX'],
  '3': ['.XXX.', 'X...X', '....X', '..XX.', '....X', 'X...X', '.XXX.'],
  '4': ['...X.', '..XX.', '.X.X.', 'X..X.', 'XXXXX', '...X.', '...X.'],
  '5': ['XXXXX', 'X....', 'XXXX.', '....X', '....X', 'X...X', '.XXX.'],
  '6': ['.XXX.', 'X....', 'X....', 'XXXX.', 'X...X', 'X...X', '.XXX.'],
  '7': ['XXXXX', '....X', '...X.', '..X..', '.X...', '.X...', '.X...'],
  '8': ['.XXX.', 'X...X', 'X...X', '.XXX.', 'X...X', 'X...X', '.XXX.'],
  '9': ['.XXX.', 'X...X', 'X...X', '.XXXX', '....X', '....X', '.XXX.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..X..'],
  ',': ['.....', '.....', '.....', '.....', '.....', '..X..', '.X...'],
  '!': ['..X..', '..X..', '..X..', '..X..', '..X..', '.....', '..X..'],
  '?': ['.XXX.', 'X...X', '....X', '..XX.', '..X..', '.....', '..X..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};
const SPACE_COLS = 3;

// ─── PixelBlockText ──────────────────────────────────────────────────────
// Renders text as chunky 8-bit blocks with a swipe-reveal animation.
// Supports A-Z, 0-9, basic punctuation. Unknown glyphs render as a space.
export const PixelBlockText = ({
  text,
  frame,
  startFrame,
  color = '#FFFFFF',
  pixelSize = 14,
  gap = 2,
  swipeDur = 22,
}) => {
  const cell = pixelSize + gap;
  const charGap = 1;
  const upperText = text.toUpperCase();

  const pixels = [];
  let cursorX = 0;
  for (const ch of upperText) {
    const pattern = PIXEL_FONT_5x7[ch] || PIXEL_FONT_5x7[' '];
    const charCols = ch === ' ' ? SPACE_COLS : pattern[0].length;
    for (let r = 0; r < pattern.length; r++) {
      for (let c = 0; c < pattern[r].length; c++) {
        if (pattern[r][c] === 'X') {
          pixels.push({ x: cursorX + c * cell, y: r * cell });
        }
      }
    }
    cursorX += charCols * cell + charGap * cell;
  }

  const totalWidth = Math.max(0, cursorX - charGap * cell);
  const totalHeight = 7 * cell - gap;
  const maxX = Math.max(...pixels.map((p) => p.x), 1);

  const swipeProg = interpolate(frame - startFrame, [0, swipeDur], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  return (
    <div style={{ position: 'relative', width: totalWidth, height: totalHeight }}>
      {pixels.map((p, i) => {
        const xNorm = p.x / maxX;
        const op = interpolate(swipeProg - xNorm, [-0.03, 0.02], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: p.x,
              top: p.y,
              width: pixelSize,
              height: pixelSize,
              background: color,
              opacity: op,
              boxShadow: '0 4px 0 rgba(0,0,0,0.55), 0 7px 18px rgba(0,0,0,0.42)',
            }}
          />
        );
      })}
    </div>
  );
};
