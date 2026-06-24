// ─── AsciiPlanet ─────────────────────────────────────────────────────────
// Spinning ASCII disc on a transparent background. Decorative beat for
// "global / world / scale" anchor moments. Letters change cell-by-cell to
// sell the rotation without any actual rotation transform.
//
// Notes:
//   - Transparent bg by design; do NOT wrap in a card or HtmlInCanvas
//   - The CRT-shader version of this lives in PracticeOverlay008's
//     AsciiPlanetShader composition; that one's chrome'd, this one is clean
//   - Use sparingly — don't pair with a card-heavy beat (visual saturation)

import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { EASE_OUT, inWindow } from './_helpers.jsx';

export const AsciiPlanet = ({
  frame,
  fps,
  startSec,
  endSec,
  fontSize = 28,
  cols = 64,
  rows = 28,
  radius = 13,
  spinSpeed = 0.18,
  position = 'center',  // 'top' | 'center' | 'bottom' — vertical placement
}) => {
  if (!inWindow(frame, startSec, endSec, fps)) return null;

  const startF = startSec * fps;
  const endF = endSec * fps;
  const local = frame - startF;
  const total = endF - startF;
  const enterDur = 28;
  const exitStart = total - 16;

  const containerOpacity = interpolate(
    local, [0, 14, exitStart, total], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const cx = cols / 2 - 0.5;
  const cy = rows / 2 - 0.5;
  const dyStretch = 1.7;
  const spinOffset = local * spinSpeed;

  const cellHash = (x, y) => {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return ((v % 1) + 1) % 1;
  };
  const isLand = (x, y) => {
    const xRot = x + spinOffset;
    const n1 = Math.sin(xRot * 0.18 + 1.4) * Math.cos(y * 0.32);
    const n2 = Math.sin(xRot * 0.08 + y * 0.21 + 2.7) * 0.85;
    const n3 = Math.cos(xRot * 0.27 + y * 0.16) * 0.4;
    return (n1 + n2 + n3) > 0.25;
  };

  const scanRow = interpolate(local, [0, enterDur], [-1, rows + 2], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const dx = x - cx;
      const dy = (y - cy) * dyStretch;
      const distSq = dx * dx + dy * dy;
      if (distSq > radius * radius) { line += ' '; continue; }
      if (y > scanRow) { line += ' '; continue; }
      const distNorm = Math.sqrt(distSq) / radius;
      const land = isLand(x, y);
      const h = cellHash(x + Math.floor(spinOffset), y);
      if (distNorm > 0.94) { line += h < 0.5 ? '·' : ' '; continue; }
      if (land) line += h < 0.85 ? '/' : 'X';
      else line += h < 0.42 ? '/' : (h < 0.55 ? '·' : ' ');
    }
    lines.push(line);
  }

  const charW = fontSize * 0.6;
  const lineH = fontSize * 1.0;
  const planetW = cols * charW;
  const planetH = rows * lineH;

  const justify = position === 'top' ? 'flex-start'
              : position === 'bottom' ? 'flex-end'
              : 'center';
  // Top/bottom positioning adds the same 140/360 safe-area padding as
  // Win95Terminal so the planet doesn't crowd IG/TT chrome.
  const padTop = position === 'top' ? 140 : 0;
  const padBottom = position === 'bottom' ? 360 : 0;

  return (
    <AbsoluteFill style={{
      pointerEvents: 'none',
      opacity: containerOpacity,
      display: 'flex', alignItems: 'center', justifyContent: justify,
      paddingTop: padTop, paddingBottom: padBottom,
    }}>
      <pre style={{
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize, lineHeight: 1.0,
        color: 'rgba(245, 245, 245, 0.96)', letterSpacing: 0,
        margin: 0, padding: 0,
        textShadow: '0 0 8px rgba(0,200,255,0.32), 0 0 22px rgba(0,200,255,0.18), 0 4px 14px rgba(0,0,0,0.55)',
        whiteSpace: 'pre',
        width: planetW, height: planetH,
      }}>
        {lines.join('\n')}
      </pre>
    </AbsoluteFill>
  );
};
