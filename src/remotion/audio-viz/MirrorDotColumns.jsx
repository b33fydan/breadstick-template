// ─── MirrorDotColumns ──────────────────────────────────────────────────────
// The reference-image equalizer: frequency-bin columns rendered as vertical
// stacks of ASCII intensity characters, mirrored across the horizontal
// midline. Each column = one frequency bin. Height = amplitude in that bin.
// Reflected top↔bottom for the classic LED-matrix look.
//
// All ASCII — no canvas, no images. Uses block-shading chars (█▓▒░) so the
// gradient is built into the type, not via opacity tricks.

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { phosphorGlow } from './CrtFrame.jsx';

const BLOCK_RAMP = ['░', '▒', '▓', '█'];

export const MirrorDotColumns = ({
  bins,                     // Float32Array (or array) of frequency amplitudes
  accent = '#F0F0F0',
  fontSize = 24,
  cols = 48,                // total visible columns (interpolated from bins)
  halfRows = 18,            // rows per half (mirror duplicates this)
  gain = 1.4,               // amplitude multiplier — bumps quiet sections
}) => {
  if (!bins || bins.length === 0) return null;

  // Map each visible column to a frequency bin (downsample if cols > bins.length).
  const sampleBin = (c) => {
    const idx = Math.floor((c / cols) * bins.length);
    return Math.min(1, (bins[idx] || 0) * gain);
  };

  // Build the full mirror grid (halfRows * 2 rows tall, cols wide)
  const totalRows = halfRows * 2;
  const grid = [];
  for (let r = 0; r < totalRows; r++) {
    let row = '';
    for (let c = 0; c < cols; c++) {
      const amp = sampleBin(c);
      const litRows = Math.floor(amp * halfRows);
      // distance from the mirror center line (between halfRows-1 and halfRows)
      const distFromCenter = Math.abs(r - (halfRows - 0.5)) - 0.5;
      if (distFromCenter < litRows) {
        // intensity: fades from full (center) to dim (edge of the bar)
        const intensity = 1 - (distFromCenter / Math.max(1, litRows));
        const rampIdx = Math.max(0, Math.min(BLOCK_RAMP.length - 1, Math.floor(intensity * BLOCK_RAMP.length)));
        row += BLOCK_RAMP[rampIdx];
      } else {
        row += ' ';
      }
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
