// ─── PixelCity ─────────────────────────────────────────────────────────────
// The "buildings" silhouette from the reference image. Each frequency bin
// = one building. Building height = bin amplitude. Windows pepper the
// building face on a regular grid so it reads as a city, not just bars.
//
// Pure ASCII. Solid blocks for building walls (█), dim dots for windows (·),
// space for sky.

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { phosphorGlow } from './CrtFrame.jsx';

export const PixelCity = ({
  bins,
  accent = '#F0F0F0',
  fontSize = 22,
  cols = 32,               // number of buildings
  rows = 32,               // grid height
  gain = 1.5,
  minBuildingHeight = 2,   // even silent bins show a base — keeps city skyline
}) => {
  if (!bins || bins.length === 0) return null;

  const sampleBin = (c) => {
    const idx = Math.floor((c / cols) * bins.length);
    return Math.min(1, (bins[idx] || 0) * gain);
  };

  // Per-building height (cells). Floored, with a minimum so the skyline
  // is always present even in silent moments.
  const heights = [];
  for (let c = 0; c < cols; c++) {
    const amp = sampleBin(c);
    heights.push(Math.max(minBuildingHeight, Math.floor(amp * rows)));
  }

  const grid = [];
  for (let r = 0; r < rows; r++) {
    let row = '';
    for (let c = 0; c < cols; c++) {
      const buildingHeight = heights[c];
      const groundLine = rows - buildingHeight;
      if (r < groundLine) {
        row += ' ';   // sky
      } else {
        // inside building — windows on a 3-row × 2-col grid
        const heightWithin = r - groundLine;
        const isWindowRow = heightWithin % 3 === 1;
        const isWindowCol = c % 2 === 1;
        if (isWindowRow && isWindowCol && r < rows - 1) {
          row += '·';
        } else {
          row += '█';
        }
      }
    }
    grid.push(row);
  }

  return (
    <AbsoluteFill style={{
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      pointerEvents: 'none',
      paddingBottom: 80,
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
