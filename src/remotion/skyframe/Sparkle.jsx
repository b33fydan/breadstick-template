// ─── Sparkle ─────────────────────────────────────────────────────────────
// 4-point burst SVG with white core + radial glow. Used by OpusGlisten and
// any other beat that needs the "premium hit" punctuation. Standalone so
// other compositions can use the same canonical sparkle shape.

import React from 'react';

export const Sparkle = ({ size = 200, color = '#fff7d6' }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: 'visible' }}>
    <defs>
      <radialGradient id="sparkle-core" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fff" stopOpacity="1" />
        <stop offset="40%" stopColor="#fff7d6" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="22" fill="url(#sparkle-core)" />
    <path d="M50 10 L54 46 L90 50 L54 54 L50 90 L46 54 L10 50 L46 46 Z" fill={color} />
    <path d="M50 22 L52 48 L78 50 L52 52 L50 78 L48 52 L22 50 L48 48 Z" fill="#fff" opacity="0.9" />
  </svg>
);
