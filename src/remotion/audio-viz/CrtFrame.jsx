// ─── CrtFrame ─────────────────────────────────────────────────────────────
// Non-negotiable brand wrapper for every audio-viz output. Every viz
// component renders inside this so the look stays consistent across the 4
// styles. Stack (bottom to top):
//   1. Pure black background
//   2. Dither pattern (4x4 Bayer, low opacity) — the speckle texture
//   3. The viz content (children)
//   4. CRT scanlines (horizontal alternating dark stripes)
//   5. Vignette (radial darkening at edges)
//
// All optional via props — but defaults are "all on" because that's the
// brand. Toggle off only when stacking with another CRT-treated layer.

import React from 'react';
import { AbsoluteFill } from 'remotion';

// Bayer 4x4 dither, encoded as a tileable PNG via data URI. Each cell is
// 1 black/white pixel using the classic ordered-dither matrix. Tile-repeats
// to fill the screen.
const BAYER_4x4_PATTERN = `data:image/svg+xml;base64,${typeof btoa !== 'undefined'
  ? btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">
<rect x="0" y="0" width="1" height="1" fill="#fff"/>
<rect x="2" y="0" width="1" height="1" fill="#fff" opacity="0.55"/>
<rect x="1" y="1" width="1" height="1" fill="#fff" opacity="0.7"/>
<rect x="3" y="1" width="1" height="1" fill="#fff" opacity="0.4"/>
<rect x="0" y="2" width="1" height="1" fill="#fff" opacity="0.55"/>
<rect x="2" y="2" width="1" height="1" fill="#fff" opacity="0.85"/>
<rect x="1" y="3" width="1" height="1" fill="#fff" opacity="0.4"/>
<rect x="3" y="3" width="1" height="1" fill="#fff" opacity="0.7"/>
</svg>`)
  : ''}`;

export const CrtFrame = ({
  children,
  bg = '#000000',
  scanlines = true,
  dither = true,
  vignette = true,
  chromaShift = false,        // off by default — punchy when needed
  ditherOpacity = 0.06,       // very subtle speckle
  scanlineOpacity = 0.32,
}) => {
  return (
    <AbsoluteFill style={{ background: bg, overflow: 'hidden' }}>
      {/* Bayer dither — speckled texture under everything */}
      {dither && (
        <AbsoluteFill style={{
          backgroundImage: `url(${BAYER_4x4_PATTERN})`,
          backgroundRepeat: 'repeat',
          backgroundSize: '4px 4px',
          opacity: ditherOpacity,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }} />
      )}

      {/* Optional chromatic aberration — split children into RGB layers */}
      {chromaShift ? (
        <>
          <AbsoluteFill style={{ filter: 'drop-shadow(2px 0 0 rgba(255,0,80,0.55)) drop-shadow(-2px 0 0 rgba(0,200,255,0.55))', mixBlendMode: 'screen' }}>
            {children}
          </AbsoluteFill>
        </>
      ) : (
        <AbsoluteFill>{children}</AbsoluteFill>
      )}

      {/* CRT horizontal scanlines */}
      {scanlines && (
        <AbsoluteFill style={{
          background: `repeating-linear-gradient(
            0deg,
            transparent 0px,
            transparent 2px,
            rgba(0, 0, 0, ${scanlineOpacity}) 2px,
            rgba(0, 0, 0, ${scanlineOpacity}) 3px
          )`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Vignette — radial darkening at the edges */}
      {vignette && (
        <AbsoluteFill style={{
          background: 'radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }} />
      )}
    </AbsoluteFill>
  );
};

// Standard phosphor-glow text-shadow for ASCII viz characters. Apply to
// any <pre> element rendering brand viz so the glow is consistent.
export const phosphorGlow = (accent) =>
  `0 0 4px ${accent}, 0 0 12px ${accent}aa, 0 0 24px ${accent}55`;

// Accent palette presets — operator picks one per render
export const CRT_PRESETS = {
  white:   { accent: '#F0F0F0', glow: 'rgba(240,240,240,0.7)' },
  amber:   { accent: '#FFB300', glow: 'rgba(255,179,0,0.7)' },
  green:   { accent: '#33FF66', glow: 'rgba(51,255,102,0.7)' },
  magenta: { accent: '#FF00FF', glow: 'rgba(255,0,255,0.7)' },
  cyan:    { accent: '#00FFFF', glow: 'rgba(0,255,255,0.7)' },
};
