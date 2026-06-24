// ─── AsciiSpectrum ─────────────────────────────────────────────────────────
// Grid spectrum field — each cell = one (column, frequency-band) sample.
// Intensity of cell mapped to the 5-char ramp (' ░▒▓█'). Reads like a
// retro waterfall display. Different visual identity from MirrorDotColumns:
// no mirror, full-frame grid, gradient surface.

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { phosphorGlow } from './CrtFrame.jsx';

const RAMP = ' ░▒▓█';

export const AsciiSpectrum = ({
  bins,
  accent = '#F0F0F0',
  fontSize = 20,
  cols = 56,
  rows = 28,
  gain = 1.6,
}) => {
  if (!bins || bins.length === 0) return null;

  const sampleBin = (c) => {
    const idx = Math.floor((c / cols) * bins.length);
    return Math.min(1, (bins[idx] || 0) * gain);
  };

  const grid = [];
  for (let r = 0; r < rows; r++) {
    let row = '';
    for (let c = 0; c < cols; c++) {
      const amp = sampleBin(c);
      // Build a bottom-up gradient: cells near the bottom are bright if amp is
      // any non-zero; cells near the top need high amp to light up.
      const rowFromBottom = rows - 1 - r;
      const threshold = rowFromBottom / rows;
      // intensity 0..1 — falls off as we go higher than the bin's amp
      const intensity = Math.max(0, Math.min(1, (amp - threshold) * 4));
      const idx = Math.min(RAMP.length - 1, Math.floor(intensity * RAMP.length));
      row += RAMP[idx];
    }
    grid.push(row);
  }

  return (
    <AbsoluteFill style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <pre style={{
        fontFamily: 'VT323, Consolas, "Courier New", monospace',
        fontSize,
        lineHeight: 1.0,
        letterSpacing: 0,
        color: accent,
        textShadow: phosphorGlow(accent),
        margin: 0,
        padding: 0,
        whiteSpace: 'pre',
      }}>
        {grid.join('\n')}
      </pre>
    </AbsoluteFill>
  );
};
