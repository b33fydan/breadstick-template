// ─── PulsingAsciiPlanet ────────────────────────────────────────────────────
// Reuses the existing Skyframe AsciiPlanet but modulates radius + spin
// speed by bass amplitude (avg of first ~8 frequency bins). The planet
// breathes with the music. No new ASCII rendering code — pure remix.

import React from 'react';
import { AsciiPlanet } from '../skyframe/AsciiPlanet.jsx';

export const PulsingAsciiPlanet = ({
  bins,
  frame,
  fps,
  durationInFrames,
  accent = '#F0F0F0',  // currently visual via the wrapping CrtFrame; AsciiPlanet uses its own white
  baseRadius = 13,
  pulseAmount = 4,     // radius pumps up to baseRadius + pulseAmount on bass hits
  baseSpinSpeed = 0.18,
  spinPulse = 0.08,    // spin speeds up on bass hits
}) => {
  // Bass amplitude — average the lowest 8 bins (typically 20-200 Hz range
  // depending on FFT size). Clamp to 0..1.
  const bass = bins && bins.length > 0
    ? Math.min(1, (bins.slice(0, 8).reduce((s, v) => s + v, 0) / 8) * 2.5)
    : 0;

  const radius = baseRadius + bass * pulseAmount;
  const spinSpeed = baseSpinSpeed + bass * spinPulse;

  // AsciiPlanet checks inWindow against startSec/endSec. Pass 0 → entire
  // composition duration so it's always visible. `accent` not yet a prop on
  // AsciiPlanet — defer color theming until a v2 needs it.
  return (
    <AsciiPlanet
      frame={frame}
      fps={fps}
      startSec={0}
      endSec={durationInFrames / fps}
      fontSize={28}
      cols={64}
      rows={28}
      radius={radius}
      spinSpeed={spinSpeed}
    />
  );
};
