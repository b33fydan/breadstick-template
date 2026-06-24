// src/remotion/compositions/AreciboTransmission.jsx
import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, Easing} from 'remotion';

// Arecibo Transmission — 23×41 weekly recap grid, hybrid-reveal doctrine.
// P1 stream f0-240 · P2 resolve f240-300 (f285 = orthodox still) ·
// P3 decode f300-600 (per-section color sweeps + labels) · P4 highlight
// pulse + caption f600-690 · tail hold to f720. No yoyo at the boundary.

export const ARECIBO_FRAMES = 720;
const COLS = 23;
const ROWS = 41;
const U = 10; // SVG grid unit; cells are 9×9 on a 10 pitch
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

const SECTION_META = [
  {key: 'counting', label: 'COUNT · WEEK', color: '#ffffff'},
  {key: 'elements', label: 'SCRIPT IMAGE VIDEO CAROUSEL POST', color: '#2ee6a6'},
  {key: 'rhythm', label: 'SEVEN DAYS', color: '#4ea8ff'},
  {key: 'operator', label: 'THE OPERATOR', color: '#ffd24e'},
  {key: 'instrument', label: 'THE INSTRUMENT', color: '#e85d75'},
];

export const AreciboTransmission = ({bits = [], sections = {}, caption = '', weekLabel = '', highlight = null}) => {
  const frame = useCurrentFrame();
  const onBits = bits.map((b, i) => ({b, i})).filter(({b}) => b === 1);

  // P1: cells reveal in transmission order (row-major bit index).
  const revealCount = interpolate(frame, [0, 240], [0, bits.length], {
    easing: Easing.inOut(Easing.quad), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const scanRow = Math.min(Math.floor(revealCount / COLS), ROWS - 1);

  // P3: each section sweeps to its color in a staggered window.
  const sectionColor = (row) => {
    const idx = SECTION_META.findIndex(({key}) => {
      const s = sections[key];
      return s && row >= s.rowStart && row <= s.rowEnd;
    });
    if (idx === -1) return {color: '#e8e8e8', p: 0, idx: -1};
    const start = 300 + idx * 55;
    const p = interpolate(frame, [start, start + 45], [0, 1], {
      easing: EASE_OUT, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    return {color: SECTION_META[idx].color, p, idx};
  };

  const captionChars = Math.floor(interpolate(frame, [620, 680], [0, caption.length], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }));

  return (
    <AbsoluteFill style={{background: '#0a0a0f', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace'}}>
      <div style={{fontSize: 30, letterSpacing: 14, color: '#555', marginBottom: 28}}>
        {weekLabel ? `TRANSMISSION ${weekLabel}` : 'TRANSMISSION'}
      </div>
      <div style={{position: 'relative'}}>
        <svg width={880} viewBox={`0 0 ${COLS * U} ${ROWS * U}`} style={{display: 'block'}}>
          {onBits.map(({i}, k) => {
            const row = Math.floor(i / COLS);
            const col = i % COLS;
            const revealed = i < revealCount;
            if (!revealed) return null;
            const {color, p} = sectionColor(row);
            const justArrived = frame < 240 && row === scanRow;
            const fill = p > 0 ? color : justArrived ? '#ffffff' : '#e8e8e8';
            const isHighlightPixel = row === 32 && bits[32 * COLS + col] === 1 && highlight;
            const pulse = isHighlightPixel
              ? 1 + 0.3 * Math.max(0, Math.sin(interpolate(frame, [600, 690], [0, Math.PI * 2], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})))
              : 1;
            const cx = col * U + U / 2;
            const cy = row * U + U / 2;
            return (
              <rect key={k}
                x={cx - (U - 1) / 2 * pulse} y={cy - (U - 1) / 2 * pulse}
                width={(U - 1) * pulse} height={(U - 1) * pulse}
                fill={fill} opacity={p > 0 ? 0.95 : 0.88} rx={1}
              />
            );
          })}
          {/* P1 scanline */}
          {frame < 240 && (
            <rect x={0} y={scanRow * U - 1} width={COLS * U} height={U + 1} fill="#ffffff" opacity={0.10} />
          )}
        </svg>
        {/* P3 section labels: absolutely placed relative to the grid, vertically centered on each section */}
        {SECTION_META.map(({key, label, color}, idx) => {
          const s = sections[key];
          if (!s) return null;
          const centerRow = (s.rowStart + s.rowEnd + 1) / 2;
          const start = 300 + idx * 55;
          const op = interpolate(frame, [start + 10, start + 40], [0, 1], {
            easing: EASE_OUT, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          });
          const slide = interpolate(frame, [start + 10, start + 40], [14, 0], {
            easing: EASE_OUT, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          });
          return (
            <div key={key} style={{
              position: 'absolute',
              left: '100%',
              marginLeft: 18,
              top: `${(centerRow / ROWS) * 100}%`,
              transform: `translateY(-50%) translateX(${slide}px)`,
              color, opacity: op, fontSize: 17, letterSpacing: 4,
              writingMode: 'vertical-rl', whiteSpace: 'nowrap',
            }}>
              {label}
            </div>
          );
        })}
      </div>
      <div style={{marginTop: 34, height: 44, fontSize: 28, letterSpacing: 3, color: '#e8e8e8'}}>
        {caption.slice(0, captionChars)}
        {captionChars > 0 && captionChars < caption.length ? '▌' : ''}
      </div>
    </AbsoluteFill>
  );
};
